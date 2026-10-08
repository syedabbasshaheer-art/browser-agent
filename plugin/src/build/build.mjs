// Record → board. The ONLY way .claude/board.html is produced.
//
//   node src/build/build.mjs           parse + validate + log card moves + write the page
//   node src/build/build.mjs --check   parse + validate only; writes nothing
//   node src/build/build.mjs --digest  as default, then print a short digest (used by hooks)
//
// Exit 1 on any record ERROR — a broken record never reaches the page.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { parseLaunch, isVerified } from "../core/parse.mjs";
import { computeBoard } from "../core/engine.mjs";
import { boardViews } from "../core/views.mjs";
import { boardSuggest } from "../core/suggest.mjs";
import * as CFG from "./config.mjs";
import { applyTheme } from "./page/theme.mjs";
import { append as appendEvent, read as readEvents, lastOffset } from "../events/events.mjs";
import { buildFeed } from "../events/feed.mjs";
import { parseNotes, NOTE_SECTIONS, FILES as MEMORY_FILES } from "../core/memory.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // the code: template and themes only
export const ROOT = CFG.ROOT;                               // the project: record, page, local state
const P = (rel) => path.join(ROOT, rel);
export const FILES = {
  record: P(CFG.RECORD), out: P(CFG.OUT), template: path.join(HERE, "template.html"),
  local: P(CFG.LOCAL), activity: P(CFG.LOCAL + "/activity.jsonl"),
  snapshot: P(CFG.LOCAL + "/snapshot.json"), receipt: P(CFG.LOCAL + "/published.json"),
};

export const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

// Every activity line is also an event on the ordered stream (events.mjs), so consumers can
// replay the project's history from any offset. The activity file stays as the page's feed.
const EVENT_TYPE = { move: "card.moved", add: "card.added", note: "note.added", ask: "prompt.received", timer: "timer.woke", publish: "board.published" };
export function logActivity(entry, { stream = true } = {}) {
  fs.mkdirSync(FILES.local, { recursive: true });
  fs.appendFileSync(FILES.activity, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  if (!stream) return;
  try {
    const { kind, id, ...rest } = entry;
    appendEvent(EVENT_TYPE[kind] || "note.added", id ? { card: id, ...rest } : rest);
  } catch { /* the feed must never fail on the stream */ }
}
export function readActivity() {
  try {
    return fs.readFileSync(FILES.activity, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// Diff the record against the last build and log every state change.
// This is how "the agent did Y" reaches the page without the agent reporting it.
function logMoves(cards) {
  const snap = readJSON(FILES.snapshot, null);
  const prev = snap && snap.cards ? snap.cards : snap; // older snapshots were the bare map
  const now = Object.fromEntries(cards.map((c) => [c.id, c.st]));
  const since = snap && Number.isInteger(snap.offset) ? snap.offset + 1 : Infinity;
  const onStream = since === Infinity ? [] : readEvents({ from: since, types: ["card.moved", "card.added"] });
  const streamed = (m) => (m.kind === "move" && onStream.some((e) => e.type === "card.moved" && e.card === m.id && e.to === m.to)) ||
    (m.kind === "add" && onStream.some((e) => e.type === "card.added" && e.card === m.id));
  const moves = [];
  if (prev) {
    cards.forEach((c) => {
      if (!(c.id in prev)) moves.push({ kind: "add", id: c.id, text: c.title.slice(0, 160) });
      else if (prev[c.id] !== c.st) moves.push({ kind: "move", id: c.id, from: prev[c.id], to: c.st, text: c.title.slice(0, 120) });
    });
    Object.keys(prev).forEach((id) => { if (!(id in now)) moves.push({ kind: "note", text: `card ${id} removed from the record` }); });
  }
  moves.forEach((m) => logActivity(m, { stream: !streamed(m) }));
  fs.mkdirSync(FILES.local, { recursive: true });
  fs.writeFileSync(FILES.snapshot, JSON.stringify({ offset: lastOffset(), cards: now }, null, 0));
  return moves;
}

// The files each card produced, from git history, and where the repository can be browsed. A commit belongs
// to card <id> when its message says "Card <id>" followed by ":", "." or a space, when its subject starts
// with "Card <id>", or when its subject lists it ("Cards 4.1 and 4.2: ...", "... (card 10.9, in progress)").
// One `git log` is read and matched here. Paths that no longer exist are dropped. A project with no git,
// or no commits, gets none: the page then says no files are recorded.
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 15000 });
export function filesByCard(ids) {
  const NL = String.fromCharCode(10);
  const SOH = String.fromCharCode(1), STX = String.fromCharCode(2), ETX = String.fromCharCode(3);
  let raw = "";
  try {
    if (path.resolve(git(["rev-parse", "--show-toplevel"]).trim()) !== path.resolve(ROOT)) return {}; // the project is not its own repository
    raw = git(["log", "--name-only", "--format=%x01%s%x02%b%x03"]);
  } catch { return {}; }
  const commits = raw.split(SOH).slice(1).map((c) => {
    const [head, rest = ""] = c.split(ETX);
    const [subject, body = ""] = head.split(STX);
    return { subject, msg: subject + NL + body, files: rest.split(NL).map((x) => x.trim()).filter(Boolean) };
  });
  const out = {};
  for (const id of ids) {
    const q = String(id).split(".").join("[.]");   // ids are digits and dots
    const strict = new RegExp("Card " + q + "[:. ]"), starts = new RegExp("^Card " + q + "(?![0-9])");
    const loose = new RegExp("(^|[^a-z])cards? [^" + NL + "]*?(?<![0-9.])" + q + "(?![0-9])(?![.][0-9])", "i");
    const seen = new Set();
    for (const c of commits) {
      if (!(strict.test(c.msg) || starts.test(c.subject) || loose.test(c.subject))) continue;
      for (const x of c.files) if (!seen.has(x) && fs.existsSync(path.join(ROOT, x))) seen.add(x);
    }
    if (seen.size) out[id] = [...seen].sort();
  }
  return out;
}
// Only a GitHub address is turned into links; anything else leaves the file names as plain text.
export function repoUrl() {
  try {
    const u = git(["remote", "get-url", "origin"]).trim(), at = u.indexOf("github.com");
    if (at < 0) return "";
    const [owner, name] = u.slice(at + "github.com".length + 1).split("/");
    return owner && name ? `https://github.com/${owner}/${name.endsWith(".git") ? name.slice(0, -4) : name}` : "";
  } catch { return ""; }
}

// The owner's notes for the agent (.cockpit/NOTES.md), as the page shows them: the lines no other line replaces,
// read by the one parser (src/core/memory.mjs). A project with no notes file, or an unreadable one, has none.
export function ownerNotes() {
  let text = "";
  try { text = fs.readFileSync(P(MEMORY_FILES.notes), "utf8"); } catch { return []; }
  return parseNotes(text).current.map((n) => ({ id: n.id, date: n.date, section: n.section, text: n.text, ...(n.replaces ? { replaces: n.replaces } : {}) }));
}

const LS = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g");
// "<" is escaped so data cannot close the script block; "__" is escaped so a card that says __FILE__ is
// never mistaken for (or filled as) one of the template's own __PLACEHOLDERS__.
const J = (v) => JSON.stringify(v).split("<").join(String.fromCharCode(92) + "u003c").split("__").join("_" + String.fromCharCode(92) + "u005f").replace(LS, " ");

export function build({ write = true } = {}) {
  // The log's last event number, read BEFORE the record: the card states on the page are at least this new.
  // The page takes a line that carries a state change (move: {from, to}) as newer than its own card data only
  // when the line's offset is higher than this. Read first, so an event written while this build runs is
  // applied again by the page (harmless: it agrees) rather than ignored.
  let asOf = 0;
  try { asOf = lastOffset(); } catch { /* no log yet */ }
  const md = fs.readFileSync(FILES.record, "utf8");
  const rec = parseLaunch(md);
  const DEC_GOAL = { ...rec.decGoal, ...CFG.DEC_GOAL }, WATCH_GOAL = { ...rec.watchGoal, ...CFG.WATCH_GOAL };
  const PHASE_END = { ...rec.phaseEnd, ...CFG.PHASE_END };
  [[rec.decisions, DEC_GOAL], [rec.watch, WATCH_GOAL]].forEach(([rows, map]) => {
    rows.forEach((r) => { if (!(r[0] in map)) rec.warnings.push(`${r[0]} has no goal: fill its Goal column in the record; shown under Goal 1`); });
  });
  // Done means confirmed. A card that becomes DONE after the last build must carry its evidence
  // ("• Verified: …"). Cards closed before this rule existed are left as they were.
  const snap = readJSON(FILES.snapshot, null), was = snap && snap.cards ? snap.cards : snap;
  if (was) rec.cards.forEach((c) => {
    // A card the last build did not see as DONE: moved there, or newly written as DONE. Both need evidence.
    if (c.st === "DONE" && was[c.id] !== "DONE" && !isVerified(c))
      rec.errors.push(`card ${c.id} ${was[c.id] ? "moved to" : "was added as"} DONE without confirmation: add "• Verified: <what was observed>" to its text${was[c.id] ? ", or leave it in " + was[c.id] : ""}`);
  });
  // A draft is the owner's to accept. The gateway refuses a start or a close asked for in the browser; this is
  // the same rule for a record edited by hand or by the agent in the terminal.
  if (CFG.PLAN === "draft" && !CFG.CONFIG_ERROR) rec.cards.forEach((c) => {
    if (c.st === "START") rec.errors.push(`card ${c.id} is in START but the plan is a draft: nothing starts until the owner accepts the plan on the board; put it back to BACKLOG`);
    else if (c.st === "DONE" && was && was[c.id] && was[c.id] !== "DONE") rec.errors.push(`card ${c.id} moved to DONE but the plan is a draft: nothing closes until the owner accepts the plan on the board; leave it in ${was[c.id]}`);
  });
  if (CFG.PATH_ERROR) rec.errors.push(`.cockpit/config.json: ${CFG.PATH_ERROR}`);
  if (CFG.CONFIG_ERROR) rec.errors.push(`.cockpit/config.json is not valid JSON (${CFG.CONFIG_ERROR}): fix it; until then the plan is treated as a draft`);
  if (rec.errors.length) return { ok: false, rec };

  const E = computeBoard(rec.cards, { WIP: CFG.WIP, LAUNCH: CFG.LAUNCH });
  const result = { ok: true, rec, E };
  if (!write) return result;

  result.moves = logMoves(rec.cards);

  const stateOf = (k) => (rec.state.find((r) => r[0].toLowerCase().startsWith(k.toLowerCase())) || [k, ""])[1];
  const live = stateOf("Live");
  // Trailing punctuation is prose, not URL: "https://example.com: public" showed a colon in the pill.
  const liveUrl = (live.match(/https?:\/\/[^\s)|—]+/) || ["#"])[0].replace(/[:.,;]+$/, "");
  const rowsTxt = CFG.TILE ? stateOf(CFG.TILE.row) : "";
  const BOARD = {
    WIP: CFG.WIP, LAUNCH: CFG.LAUNCH, title: CFG.TITLE, repo: repoUrl(),
    liveWord: /noindex|hidden|not findable/i.test(live) ? "Hidden" : liveUrl === "#" ? "Not yet" : "Public",
    liveNote: (live.split(". ")[0] || "No Live row in the record").replace(/[.]$/, "") + ".",
    tile: CFG.TILE ? CFG.TILE.label : "", record: CFG.RECORD, plan: CFG.PLAN,
    rows: (rowsTxt.match(/[\d,]+/) || ["?"])[0],
    rowsNote: rowsTxt.replace(/^[\d,]+\s*—?\s*/, "") || "From the record",
  };
  const ACT = readActivity().filter((a) => a.kind !== "publish").slice(-CFG.ACTIVITY_ON_PAGE).reverse();

  const data = [
    `  var GOALS = ${J(rec.goals.map((g) => ({ n: g.n, title: g.title, sub: g.sub })))};`,
    `  var C = ${J(rec.cards.map(({ line, ...c }) => c))};`,
    `  var DEC = ${J(rec.decisions)};`,
    `  var WATCH = ${J(rec.watch)};`,
    `  var STATE = ${J(rec.state)};`,
    `  var ACT = ${J(ACT)};`,
    `  var BOARD = ${J(BOARD)};`,
    `  var FEED = ${J(buildFeed())};`,
    `  var ASOF = ${J(asOf)};`,   // the event number the card data above is true at (see the top of build())
    `  var CARD_FILES = ${J(filesByCard(rec.cards.map((c) => c.id)))};`,
    // How the agent works here: the checked automatic-work settings, what was ignored in them, and the owner's notes.
    `  var AUTO = ${J(CFG.AUTO)};`,
    `  var AUTO_PROBLEMS = ${J(CFG.AUTO_PROBLEMS)};`,
    `  var NOTE_SECTIONS = ${J(NOTE_SECTIONS)};`,
    `  var NOTES = ${J(ownerNotes())};`,
    `var DEC_GOAL=${J(DEC_GOAL)};`,
    `var WATCH_GOAL=${J(WATCH_GOAL)};`,
    `var PHASE_END=${J(PHASE_END)};`,
  ].join("\n");

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  let html = fs.readFileSync(FILES.template, "utf8");
  const put = (k, v) => { if (!html.includes(k)) throw new Error(`template lost placeholder ${k}`); html = html.split(k).join(v); };
  put("/*__DATA__*/", data);
  put("/*__ENGINE__*/", computeBoard.toString());
  put("/*__VIEWS__*/", boardViews.toString());
  put("/*__SUGGEST__*/", boardSuggest.toString());   // the rule that proposes the next move, run by the Live view
  put("__TITLE__", esc(CFG.TITLE));
  put("__RECORD__", esc(CFG.RECORD));
  put("__LIVE_URL__", esc(liveUrl));
  put("__LIVE_WORD__", esc(BOARD.liveWord));
  put("__LIVE_HOST__", esc(liveUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")));
  put("__BUILT__", `from record #${sha(md)} · ${rec.cards.length} cards · ${ACT.length} activity entries`);
  if (/__[A-Z_]+__/.test(html)) throw new Error("unfilled placeholder left in page: " + html.match(/__[A-Z_]+__/)[0]);

  result.rawHtml = html;                 // unthemed, for the prototype builder
  html = applyTheme(html, CFG.THEME);
  fs.writeFileSync(FILES.out, html);
  result.hash = sha(html);
  // The SUBSTANCE of the board: everything except the activity feed. Every message
  // you send is logged to the feed, so the full hash changed on every turn and the
  // Stop hook demanded a republish even for a plain question. The feed now rides
  // along with the next publish that has a real reason to happen.
  // The live rail's feed is the same kind of thing (and carries its build time), so it is left out too.
  // So is the list of files per card: a commit changes it, and a commit alone is no reason to republish.
  // So is the event number the page was built at: every logged line moves it.
  result.substance = sha(html.replace(/ {2}var ACT = .*;/, "").replace(/ {2}var FEED = .*;/, "").replace(/ {2}var ASOF = .*;.*/, "").replace(/ {2}var CARD_FILES = .*;/, "").replace(/ · \d+ activity entries/, ""));
  fs.mkdirSync(FILES.local, { recursive: true });
  fs.writeFileSync(FILES.local + "/substance.txt", result.substance);
  return result;
}

export function digest(r) {
  const { E, rec } = r, byId = Object.fromEntries(rec.cards.map((c) => [c.id, c]));
  const name = (id) => `${id} ${byId[id].title.slice(0, 70)}`;
  const lane = (o) => rec.cards.filter((c) => E.phase[c.id] === "ACTIVE" && c.own === o).map((c) => name(c.id) + (E.autoset[c.id] ? " (auto)" : ""));
  return [
    // the board's own words: Ready is a card that can start now, In progress is one handed to the agent
    `BOARD ${E.count.DONE}/${rec.cards.length} done · ${rec.cards.filter((c) => c.st === "START").length} in progress · ${E.count.ACTIVE} ready · ${E.count.BLOCKED} blocked · ${E.stuck} waiting on a card`,
    `Launch waits on: ${E.gateCard ? name(E.gateCard) + " (human)" : "nothing human"}`,
    `You (human lane): ${lane("human").join(" | ") || "—"}`,
    `Agent lane: ${lane("agent").join(" | ") || "—"}`,
    `In progress (the agent is on these): ${rec.cards.filter((c) => c.st === "START").map((c) => name(c.id)).join(" | ") || "—"}`,
    `Next up: ${E.queued.join(", ") || "—"}`,
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const check = process.argv.includes("--check");
  const r = build({ write: !check });
  r.rec.warnings.forEach((w) => console.warn("WARN  " + w));
  if (!r.ok) { r.rec.errors.forEach((e) => console.error("ERROR " + e)); console.error(`BOARD FAILED: ${r.rec.errors.length} error(s) in ${CFG.RECORD}`); process.exit(1); }
  if (check) { console.log(`BOARD CHECK OK: ${r.rec.cards.length} cards`); process.exit(0); }
  (r.moves || []).forEach((m) => console.log(`MOVE  ${m.id || ""} ${m.from ? m.from + " → " + m.to : m.kind}`));
  console.log(`BOARD OK → ${CFG.OUT} #${r.hash}`);
  if (process.argv.includes("--digest")) console.log(digest(r));
}
