// Shared by the three Claude Code hooks. Hooks get one JSON object on stdin.
import * as events from "../events/events.mjs";
import { repliesIn, readTail } from "./replies.mjs";
import * as CFG from "../build/config.mjs";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { FILES, ROOT, sha } from "../build/build.mjs";
import { SKIP as CFG_SKIP, HARNESS, HAS_CONFIG } from "../build/config.mjs";
import { adapterFor } from "../adapters/index.mjs";

// The harness this project runs in. Hooks read events and answer through it, never directly.
export const A = adapterFor(HARNESS);

// The agent's replies not yet in the event log, taken from the session's transcript and logged as events.
// Returns how many were logged. It never throws: a hook must not break a turn over the feed.
export function captureReplies(session, transcript, { final = false } = {}) {
  try {
    if (!CFG.LOG_REPLIES || !transcript || !fs.existsSync(transcript)) return 0;
    const mark = FILES.local + "/replies-" + sid(session) + ".json";
    const last = readJSON(mark, {}).uuid || null;
    const list = repliesIn(readTail(transcript), last);
    if (!list.length) return 0;
    list.forEach((r, i) => events.append("claude.reply", { text: r.text, src: r.uuid, ...(final && i === list.length - 1 ? { final: true } : {}) }));
    writeJSON(mark, { uuid: list[list.length - 1].uuid, at: Date.now() });
    return list.length;
  } catch { return 0; }
}

// A turn that a timer started, not the owner: Claude Code's own /loop wake-ups (including its autonomous
// sentinel) and the cockpit heartbeat. Erring towards "timer" is the safe side: a timer wake that looked like
// the owner typing would reset the ceiling on automatic starts every time it fired.
// The heartbeat can also be typed as a command of its own: "/heartbeat", "/<plugin>:heartbeat". The command was /cockpit until 2026-10-08; a timer set then still counts.
export const isTimerWake = (text) => /^\s*\/loop\b|<<autonomous-loop|\/(?:browser-agent|cockpit)(?::[\w-]+)?[\s:]+heartbeat\b|\bcockpit(\.mjs)?\s+heartbeat\b|^\s*\/(?:[\w-]+:)?heartbeat\b/i.test(String(text || ""));

export async function readStdin() {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

export const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
export const writeJSON = (f, v) => { fs.mkdirSync(FILES.local, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
export const ACK = FILES.local + "/ack.json";

export const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
export const boardHash = () => { try { return sha(fs.readFileSync(FILES.out, "utf8")); } catch { return null; } };
// The record is wherever the project config says (FILES.record), not a fixed path.
const norm = (p) => String(p).replaceAll(String.fromCharCode(92), "/").toLowerCase();
export const isRecord = (p) => !!p && norm(p) === norm(FILES.record);
export const isBoard = (p) => !!p && norm(p) === norm(FILES.out); // wherever the config puts the page

// Work files changed in the working tree, newest first. Excluded: generated output,
// the board's own machinery (work ON the board is not work the board tracks),
// visual-review captures, and images. They never finish a card on their own.
const SKIP = CFG_SKIP;
const SKIP_EXT = /\.(png|jpe?g|webp|gif|svg|ico)$/i;

// WHO touched what. Several writers share this repo (sessions and their subagents),
// and a repo-wide "anything newer than the record" check blamed every one of them for
// the others' work: ten false blocks in one afternoon. So the after-edit hook records
// each path this session edits, keyed by session_id, and the Stop hook checks only
// those. Edits made through Bash are not seen here; the publish check still catches
// a stale board, and a note covers the rest.
const slash = (p) => String(p || "").replaceAll(String.fromCharCode(92), "/");
// Repo-relative path, or null when the file is outside the repo. Case-insensitive on
// the root because Windows hands the drive letter over in either case.
const rel = (p) => {
  const abs = slash(p), root = slash(ROOT).replace(/\/$/, "") + "/";
  return abs.toLowerCase().startsWith(root.toLowerCase()) ? abs.slice(root.length) : null;
};
const sid = (session) => String(session || "unknown").replace(/[^\w-]/g, "");
export const touchedFile = (session) => FILES.local + "/touched-" + sid(session) + ".json";
export const turnFile = (session) => FILES.local + "/turn-" + sid(session) + ".json";

// { path: lastEditedAt }. An older session may have left a plain array; read it as "long ago".
export const readTouched = (session) => {
  const v = readJSON(touchedFile(session), {});
  return Array.isArray(v) ? Object.fromEntries(v.map((p) => [p, 0])) : v;
};
export function recordTouch(session, filePath) {
  if (!session || !filePath) return;
  const p = rel(filePath);
  if (!p) return; // outside the repo
  writeJSON(touchedFile(session), { ...readTouched(session), [p]: Date.now() });
}

// WHEN a turn started. Written by the prompt hook, so the Stop hook can look at this
// turn's edits only: the ones the agent made since you last spoke.
export const markTurn = (session) => { if (session) writeJSON(turnFile(session), { at: Date.now() }); };
export const turnStart = (session) => readJSON(turnFile(session), { at: 0 }).at;

// True the first time it is asked about a session, false ever after: the marker file is created exclusively,
// so two hooks racing for the same session cannot both be first.
export const sessionFile = (session) => FILES.local + "/session-" + sid(session) + ".json";
export function firstOfSession(session) {
  if (!session) return false;
  fs.mkdirSync(FILES.local, { recursive: true });
  try { fs.writeFileSync(sessionFile(session), JSON.stringify({ at: Date.now() }), { flag: "wx" }); return true; } catch { return false; }
}

// Paths this session edited since the turn began.
export const touchedThisTurn = (session) => {
  if (!session) return [];
  const since = turnStart(session);
  return Object.entries(readTouched(session)).filter(([, at]) => at >= since).map(([p]) => p);
};

// IMPACT: which cards a file belongs to. Cards cite the files they change
// (`src/legal.mjs`, `README.md`), so a card whose text names the file's base name
// is the likely one to update.
export function cardsMentioning(cards, p) {
  // Match the file name, or its stem when that is distinctive: a card says "the README",
  // not "README.md". Short stems ("app", "data") would match half the board, so not those.
  const base = p.split("/").pop(), stem = base.replace(/\.[^.]+$/, "");
  const names = stem.length >= 5 ? [base, stem] : [base];
  return cards.filter((c) => {
    const text = [c.t, c.title, c.desc, ...(c.pts || []), c.dw].filter(Boolean).join(" ");
    return names.some((n) => text.includes(n));
  }).map((c) => c.id);
}
export const substanceNow = () => { try { return fs.readFileSync(FILES.local + "/substance.txt", "utf8").trim(); } catch { return null; } };
export function changedWork() {
  let out = "";
  try { out = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: ROOT, encoding: "utf8" }); } catch { return []; }
  return out.split(String.fromCharCode(10)).filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop())
    .filter((p) => !SKIP.some((s) => p.startsWith(s)) && !SKIP_EXT.test(p))
    .map((p) => ({ p, t: mtime(ROOT + "/" + p) }))
    .sort((a, b) => b.t - a.t);
}

// Fail open: a broken hook must never wedge the session.
// Every hook runs through guard. No cockpit in this project (no .cockpit/config.json): leave at once,
// before reading stdin, building, logging or writing anything. Silence is the whole contract.
export function guard(fn) {
  if (!HAS_CONFIG) process.exit(0);
  return fn().catch((e) => { process.stderr.write("board hook error (ignored): " + (e && e.message) + String.fromCharCode(10)); process.exit(0); });
}
