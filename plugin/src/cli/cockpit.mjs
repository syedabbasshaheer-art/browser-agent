#!/usr/bin/env node
// cockpit.mjs - the orchestrator between the page and the record. The agent runs it; it does the
// thinking, the agent does the carrying (only the agent can read or write the page database).
//
//   node src/cli/cockpit.mjs inbox  --from <export dir>   process pending browser actions
//   node src/cli/cockpit.mjs sync   --from <export dir>   audit the mirror against the record
//   node src/cli/cockpit.mjs events [--since N] [--consumer NAME [--commit]] [--follow]
//     --follow keeps running and prints each new event as it is written: a live terminal feed.
//   node src/cli/cockpit.mjs verbs                        print the action vocabulary
//   node src/cli/cockpit.mjs say "<text>" [--card ID] [--step i/n] [--kind milestone|problem|result] [--next "A | B"]
//                                                         log a step Claude took (claude.said) for the live feed
//   node src/cli/cockpit.mjs ask "<question>" --card ID [--choices "A, B, C"]   ask the owner on the board (claude.asked)
//   node src/cli/cockpit.mjs turn-end "<what happened>" --next "<what is next>"  the last line of a turn (turn.ended)
//   node src/cli/cockpit.mjs push [--sent N] [--no-delete] one batch of every line not sent yet (live/u<offset>)
//   node src/cli/cockpit.mjs feed                         write the live rail (live/feed) as a batch file
//   node src/cli/cockpit.mjs next [--start]               which card may start automatically, and why; --start does it
//   node src/cli/cockpit.mjs pack [--json] [--cap N]      the wake-up pack: notes, decisions, questions, board, news, working notes
//   node src/cli/cockpit.mjs remember decision "<text>" --source event:N|card:ID [--replaces dN]
//   node src/cli/cockpit.mjs remember state "<text>" [--card ID]
//   node src/cli/cockpit.mjs tidy [--check]               archive replaced decisions, drop old answered questions, check the caps
//                                                         --check changes nothing: it only fails when a memory file is over its cap
//   node src/cli/cockpit.mjs heartbeat [--status]         one tick of the session timer: SKIP with the reason, or the checklist
//   --record <file>   run inbox or sync on another record (any project; the board is not rebuilt)
//
// The loop, asynchronous by design:
//   1. The agent exports the page database: ArtifactData list/query with out_dir=<export dir>
//      for the collections actions, approvals, cards and board.
//   2. `inbox` decides every pending action with the gateway, applies the approved ones to the
//      record, rebuilds the board, and logs each step as an event.
//   3. It then diffs the mirror against the record (the audit) and writes the database writes:
//      action results + the cards that changed, as ArtifactData batch files.
//   4. The agent sends each batch with ArtifactData action "batch" (writes read from the file).
// Nothing here touches the network. Every run can be repeated safely: an action already
// decided is skipped, and every write is pinned with if_version.

import fs from "node:fs";
import path from "node:path";
import { parseLaunch } from "../core/parse.mjs";
import { computeBoard } from "../core/engine.mjs";
import { build, digest, FILES } from "../build/build.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as CFG from "../build/config.mjs";
import { decide, decideAuto, cleanText, requestMeta, safe, VERBS, LEVELS } from "../core/gateway.mjs";
import { writeAtomic, withWriteLock } from "../events/files.mjs";
import { nextAutoStart, undoableAutoStarts, autoSentence, AUTO_RULE } from "../core/auto.mjs";
import { parseNotes, addNote, removeNote, addDecision, addState, topicOf, oldTopicOf, sameQuestion, danglingLinks, danglingNotes, tidyMemory, overCaps, parseMemory, tokens, CAPS, FILES as MEMORY_FILES } from "../core/memory.mjs";
import { buildPack, PACK_CAP } from "../core/pack.mjs";
import * as memory from "../events/memory.mjs";
import { buildFeed } from "./feed.mjs";
import { entryOf, questionsOf, lastChanges, SAY_KINDS } from "../events/feed.mjs";
import { pushBatch, recordSent, hasBoard, BATCH_MAX } from "../events/push.mjs";
import { heartbeatDecision, heartbeatChecklist, heartbeatStatus, shouldLogSkip, lockAgeMin, minuteOfDay } from "../core/heartbeat.mjs";
import { applyDecision, applyAutoSet } from "../core/apply.mjs";
import { desired, loadActual, diff, batches, describe } from "../core/mirror.mjs";
import * as events from "../events/events.mjs";
import { adapterFor } from "../adapters/index.mjs";
import { planLint, lintSummary } from "../core/lint.mjs";

const OUT = path.join(FILES.local, "cockpit");
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i > 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : d; };
const today = () => new Date().toISOString().slice(0, 10);
const NEEDS_COCKPIT = ["build", "status", "lint", "inbox", "sync", "events", "say", "ask", "answer", "turn-end", "next", "pack", "tidy", "heartbeat", "remember", "push", "feed"];

// Where an action was written decides its level (the page database's rules enforce who can write
// there). actions/: Contributors and up. approvals/: the owner only.
// Where requests arrive and how far each is trusted: the adapter's channel says (for claude.ai, the db rules).
const INBOXES = adapterFor(CFG.HARNESS).channel.inboxes;

const RECORD = typeof opt("record") === "string" ? path.resolve(opt("record")) : FILES.record;
const OWN_RECORD = RECORD === FILES.record;

function loadRecord() {
  const md = fs.readFileSync(RECORD, "utf8");
  const rec = parseLaunch(md);
  if (rec.errors.length) throw new Error("the record does not parse: " + rec.errors.slice(0, 3).join(" | "));
  return { md, rec, E: computeBoard(rec.cards, { WIP: CFG.WIP, LAUNCH: CFG.LAUNCH }) };
}

// The live rail rides on every batch. It is fully owned by the agent and always replaced, but the database
// refuses an unpinned write to a document that already exists inside a pinned batch (found live,
// 2026-09-30). So it is pinned to the version in the export's _versions.json ("live/feed"), or to --version.
const feedVersion = (dir) => {
  const v = opt("version"); if (typeof v === "string" && /^\d+$/.test(v)) return +v;
  try { const n = JSON.parse(fs.readFileSync(path.join(dir, "_versions.json"), "utf8"))["live/feed"]; return Number.isInteger(n) ? n : undefined; } catch { return undefined; }
};
const feedWrite = (dir) => { const w = { op: "set", collection: "live", doc_id: "feed", data: buildFeed() }; const v = dir ? feedVersion(dir) : undefined; if (v) w.if_version = v; return w; };

function writeBatches(writes, tag, { clear = true } = {}) {
  if (clear) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "docs"), { recursive: true });
  // Each document body goes to its own file, so the batch the agent sends stays small.
  const slim = writes.map((w) => {
    if (!w.data) return w;
    const f = path.join(OUT, "docs", `${w.collection}__${w.doc_id}.json`);
    fs.writeFileSync(f, JSON.stringify(w.data, null, 1));
    const { data, ...rest } = w;
    return { ...rest, file_path: f.replaceAll("\\", "/") };
  });
  const files = batches(slim).map((b, i) => {
    const f = path.join(OUT, `${tag}-batch-${i + 1}.json`);
    fs.writeFileSync(f, JSON.stringify(b, null, 1));
    return f.replaceAll("\\", "/");
  });
  return files;
}

// What the page sends is untrusted text. Before it is printed into the agent's context, logged or put in a
// result, it goes through the gateway's safe(): one short plain line, so it can never look like a heading, an
// instruction or a second result. A value that is not text (an object, a list) reads as empty.
const rel = (f) => path.relative(CFG.ROOT, f).replaceAll("\\", "/") || String(f);
const why = (e) => safe((e && (e.code || e.message)) || "unknown reason", 80);
// Put a file's new text in place, whole or not at all. Returns how to put the old text back.
const swap = (file, text) => {
  const had = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  writeAtomic(file, text);
  return () => (had == null ? fs.rmSync(file, { force: true }) : writeAtomic(file, had));
};

// ── The ledger: requests already decided, by their own key. The export only shows them as decided after the
// batch is sent and exported again; until then a second run on the same export (a retry, a second wake) would
// apply them twice. The event log is the second witness: every outcome line carries its request's key (`req`),
// so a request the log shows as decided is never applied again, even when the ledger missed it. ──
const DECIDED = path.join(FILES.local, "decided.json");
const DECIDED_KEEP = 2000;   // keys of requests no longer in the export; a key whose request the export still shows is always kept
const MAX_PER_RUN = 200;     // requests handled in one run, the owner's first; the rest wait for the next run
const STATUS_OF = { "action.done": "done", "action.refused": "refused", "action.accepted": "accepted", "action.awaiting": "awaiting-confirmation" };
function readDecided() {
  const bad = (what) => new Error(`the list of requests already decided (${rel(DECIDED)}) ${what}, so it is not known which requests were applied before. ` +
    "Nothing was decided and nothing was changed. Look at the file; if it cannot be repaired, delete it: a request the event log shows as decided is still not applied again.");
  let text;
  try { text = fs.readFileSync(DECIDED, "utf8"); } catch (e) { if (e.code === "ENOENT") return {}; throw bad(`could not be read (${why(e)})`); }
  let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw bad("is not a JSON object");
  if (Object.values(j).some((v) => !v || typeof v !== "object" || typeof v.status !== "string")) throw bad("holds an entry that is not a decision");
  return j;
}
function decidedInLog() {
  const out = {};
  for (const e of events.read({ types: Object.keys(STATUS_OF) })) {
    if (typeof e.req !== "string" || !e.req) continue;
    const v = { status: STATUS_OF[e.type], result: safe(e.result, 400), decidedAt: e.at };
    if (!Object.hasOwn(out, e.req)) out[e.req] = v;
    if (typeof e.once === "string" && e.once && !Object.hasOwn(out, e.once)) out[e.once] = v; // the first use of a one-use key stands
  }
  return out;
}
// The ledger is trimmed to the newest keys, but never of a key whose request can still be seen in the export.
function writeDecided(decided, seen) {
  const others = Object.keys(decided).filter((k) => !seen.has(k));
  const drop = new Set(others.slice(0, Math.max(0, others.length - DECIDED_KEEP)));
  writeAtomic(DECIDED, JSON.stringify(Object.fromEntries(Object.entries(decided).filter(([k]) => !drop.has(k)))));
}

function inbox(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--from ${dir} is not a folder: export the page database there first`);
  // The settings are checked before any request is logged or applied: a plan that cannot be read cannot be
  // accepted, and automatic work that cannot be read cannot be paused. With an unreadable file nothing is decided.
  if (CFG.CONFIG_ERROR) throw new Error(`${rel(CFG.CONFIG_FILE)} is not valid JSON (${CFG.CONFIG_ERROR}). Nothing was decided and nothing was changed: fix the file, then run inbox again.`);
  return withWriteLock(() => inboxLocked(dir));
}

function inboxLocked(dir) {
  const decided = readDecided();
  const logged = decidedInLog();
  for (const k of Object.keys(logged)) if (!Object.hasOwn(decided, k)) decided[k] = logged[k];
  let { md, rec, E } = loadRecord();
  const results = [], work = [], messages = [];
  let plan = CFG.PLAN, paused = CFG.AUTO.paused !== false;
  let recordChanged = false, configChanged = false, notesChanged = false;
  // What the gateway is told about the log: when each card's state last changed (a request built before
  // that is stale), and which questions were asked and are still open.
  const lastChange = lastChanges(events.read({ types: ["card.moved"] }));
  const questions = questionsOf(events.read({ types: ["claude.asked", "question.answered"] }));
  // Which cards in Start the owner may still send back: started automatically, no result posted since.
  const undoable = undoableAutoStarts(events.read({ types: ["card.moved", "claude.auto", "claude.said"] }));
  let noteIds = parseNotes(memory.readText("notes")).notes.map((n) => n.id);
  const applied = (ev) => {
    if (ev.type === "card.moved" && ev.card) { lastChange[ev.card] = ev.offset; delete undoable[ev.card]; }
    if (ev.type === "question.answered" && questions[ev.qid]) questions[ev.qid].answered = true;
  };

  // Every pending request, in the order it is decided: the owner's inbox before the contributors', and in the
  // owner's inbox the switch for automatic work and the plan's acceptance before everything else, so a Pause
  // is in force before any start in the same run is weighed. Inside each group, oldest first.
  const todo = [], seen = new Set();
  for (const [col, level] of Object.entries(INBOXES).sort((x, y) => LEVELS.indexOf(y[1]) - LEVELS.indexOf(x[1]))) {
    const docs = Object.entries(loadActual(dir, [col])).filter(([, h]) => h.data != null).map(([p, h]) => {
      const id = p.slice(col.length + 1), d = h.data, meta = requestMeta(d);
      const q = { col, level, id, h, d, meta, verb: safe(d.verb, 24), card: safe(d.card, 12), to: safe(d.to, 12), askedAt: safe(d.askedAt, 30) };
      // Keyed by the request itself, not only its id: the same request seen again is skipped, a different one is not.
      q.key = col + "/" + id + "/" + q.askedAt + "/" + q.verb + "/" + q.card + "/" + q.to;
      // A one-use key: the same key seen again (a double click, a retry from the page, a second document) is
      // answered with the first result and never applied twice. Keys are kept per inbox, so a contributor
      // cannot use up a key the owner's request will carry.
      q.once = meta.key ? "key:" + col + ":" + meta.key : null;
      seen.add(q.key); if (q.once) seen.add(q.once);
      return q;
    });
    const first = (q) => (level === "owner" && (q.verb === "auto.set" || q.verb === "plan.accept") ? 0 : 1);
    todo.push(...docs.filter((q) => q.d.status === "pending" || q.d.status == null)
      .sort((x, y) => first(x) - first(y) || x.askedAt.localeCompare(y.askedAt) || x.id.localeCompare(y.id)));
  }
  const now = todo.slice(0, MAX_PER_RUN), waiting = todo.length - now.length;

  // One request, decided. Nothing is written here: it returns what to write. A request that cannot be decided
  // is refused, and the run goes on to the next.
  const decideOne = ({ id, level, d: data }) => {
    const d = decide(data, { cards: rec.cards, level, goals: rec.goals, plan, lastChange, questions, undoable, notes: noteIds, auto: { paused } });
    const by = level === "owner" ? "the owner" : "a contributor";
    if (!d.ok) return { status: "refused", result: d.reason };
    if (d.mode === "confirm") return { status: "awaiting-confirmation", result: `${d.verb} is high risk. The owner must confirm it from approvals/.` };
    try {
      if (d.mode === "work") {
        const title = (rec.cards.find((c) => c.id === d.args.card) || {}).title || "";
        if (d.verb === "plan.accept") {
          // The owner's yes: the config says accepted from now on, and cards can start.
          const cfg = JSON.parse(fs.readFileSync(CFG.CONFIG_FILE, "utf8")); cfg.plan = "accepted";
          return { status: "accepted", result: "Plan accepted. Cards can start now: drop a ready card on Start.", config: JSON.stringify(cfg, null, 2) + "\n",
            events: [["plan.accepted", { via: "browser", action: id }]], then: () => { plan = "accepted"; } };
        }
        if (d.verb === "message.send") {
          // Typed on a card: it is about that card. Typed in the message box: it is about a card only when its
          // words name exactly one card that exists; otherwise it is general.
          const named = [...new Set((String(d.args.text).match(/(?<![0-9.])[0-9]{1,2}[.][0-9]{1,2}(?![0-9.])/g) || []).filter((x) => rec.cards.some((c) => c.id === x)))];
          const about = d.args.card || (named.length === 1 ? named[0] : "");
          return { status: "accepted", result: "The agent has your message and is writing its answer.",
            events: [["owner.message", { text: d.args.text, via: "browser", action: id, inbox: "approvals", origin: d.args.card ? "card" : "board", ...(about ? { card: about } : {}) }]],
            then: () => messages.push((d.args.card ? "[typed on card " + d.args.card + "] " : about ? "[typed in the message box, about card " + about + "] " : "[typed in the message box] ") + d.args.text) };
        }
        if (d.args.to === "START") {
          // Handed to Claude: the card sits in Start while Claude executes it. The gateway already
          // checked that every dependency is done, so the move is applied as it stands.
          const mv = { ok: true, verb: "card.move", mode: "apply", args: { card: d.args.card, to: "START", from: d.args.from, approves: d.args.approves } };
          const r = applyDecision(md, mv, { date: today(), by });
          return { status: "accepted", result: `Accepted. ${d.args.card} is in progress and the agent is working on it. It moves to Done once its done-when is confirmed.`, md: r.md,
            events: [[r.change.type, { ...r.change, via: "browser", action: id }]], then: () => work.push({ card: d.args.card, title, kind: "start" }) };
        }
        if (d.args.to === "DONE") return { status: "accepted", result: `The agent is checking ${d.args.card}'s done-when. It moves to Done once confirmed; until then it stays where it is.`,
          then: () => work.push({ card: d.args.card, title, kind: "confirm" }) };
        return { status: "accepted", result: `Accepted. The agent does ${d.verb} now.` };
      }
      if (d.verb === "auto.set") {
        // The owner's switch. Only auto.paused is written; the file's other keys are carried over as they were.
        const r = applyAutoSet(fs.readFileSync(CFG.CONFIG_FILE, "utf8"), d);
        return { status: "done", result: d.args.paused ? "Applied: automatic work is paused." : "Applied: automatic work is on again.", config: r.text,
          events: [[r.change.type, { via: "browser", action: id }]], then: () => { paused = d.args.paused; } };
      }
      if (d.verb === "notes.add") {
        // The owner's notes file. A line is added under its heading, or the one line with that id is deleted.
        const r = addNote(memory.readText("notes"), { section: d.args.section, text: d.args.text, date: today(), replaces: d.args.replaces || null });
        return { status: "done", result: `Applied: note ${r.id} was added under ${d.args.section}.`, notes: r.text,
          events: [["notes.added", { id: r.id, section: d.args.section, via: "browser", action: id }]], then: () => noteIds.push(r.id) };
      }
      if (d.verb === "notes.remove") {
        const r = removeNote(memory.readText("notes"), d.args.id);
        return { status: "done", result: `Applied: note ${d.args.id} was removed.`, notes: r.text,
          events: [["notes.removed", { id: d.args.id, via: "browser", action: id }]], then: () => { noteIds = noteIds.filter((n) => n !== d.args.id); } };
      }
      const r = applyDecision(md, d, { date: today(), by });
      const out = { status: "done", result: r.change.type === "question.answered" ? `Applied: your answer on ${r.change.card} is stored.` : `Applied: ${r.change.type} ${r.change.card}${r.change.to ? " -> " + r.change.to : ""}.`, md: r.md, events: [] };
      // An answer is written to the log and to its line in the questions file by one code path.
      if (r.change.type === "question.answered") out.answered = r.change; else out.events.push([r.change.type, { ...r.change, via: "browser", action: id }]);
      return out;
    } catch (e) { return { status: "refused", result: e && e.code === "REFUSED" ? e.message : "Could not apply: " + safe(e && e.message, 200) }; }
  };

  let stopped = null, unsaved = 0;
  for (const q of now) {
    const { col, level, id, h, verb, card, key, once, meta } = q;
    const statusWrite = (data) => { const w = { op: "update", collection: col, doc_id: id, data }; if (Number.isInteger(h.version)) w.if_version = h.version; return w; };
    const prior = Object.hasOwn(decided, key) ? decided[key] : null;
    if (prior) { // decided in an earlier run: do not apply again, only re-send its status
      results.push({ id, inbox: col, verb, card, status: prior.status, result: prior.result + " (decided earlier, not applied again)", write: statusWrite({ status: prior.status, result: prior.result, decidedAt: prior.decidedAt }) });
      continue;
    }
    const firstUse = once && Object.hasOwn(decided, once) ? decided[once] : null;
    if (firstUse) {
      results.push({ id, inbox: col, verb, card, status: firstUse.status, result: firstUse.result + " (a repeat of an earlier request, not applied again)",
        write: statusWrite({ status: firstUse.status, result: firstUse.result, decidedAt: firstUse.decidedAt, repeat: true }) });
      decided[key] = { status: firstUse.status, result: firstUse.result, decidedAt: firstUse.decidedAt }; unsaved++;
      continue;
    }

    // 1. Decide. Whatever a request holds, deciding it never ends the run.
    let step;
    try { step = decideOne(q); }
    catch (e) { step = { status: "refused", result: "This request could not be read: " + safe(e && e.message, 120) }; }
    const result = safe(step.result, 400);

    // 2. Write, in this order: the file that changes, then the log, then the ledger. A file that cannot be
    //    written leaves the request pending: nothing is logged for it and it is not marked decided.
    const undo = [];
    const back = () => undo.reverse().forEach((u) => { try { u(); } catch { /* the file is as the failed write left it */ } });
    let file = "";
    try {
      if (step.md != null) { file = rel(RECORD); undo.push(swap(RECORD, step.md)); }
      if (step.config != null) { file = rel(CFG.CONFIG_FILE); undo.push(swap(CFG.CONFIG_FILE, step.config)); }
      if (step.notes != null) { file = MEMORY_FILES.notes; undo.push(swap(memory.paths().notes, step.notes)); }
    } catch (e) { back(); stopped = `${file} could not be written (${why(e)}), so ${col}/${safe(id, 60)} was not applied and stays pending`; break; }
    let told = false;
    try {
      events.append("action.received", { action: id, inbox: col, level, verb, card, ...(q.to ? { to: q.to } : {}), ...(meta.source ? { source: meta.source } : {}), ...(q.askedAt ? { askedAt: q.askedAt } : {}) });
      for (const [type, data] of step.events || []) { applied(events.append(type, data)); told = true; }
      if (step.answered) { applied(memory.recordAnswered(step.answered, { via: "browser", action: id }).event); told = true; }
      events.append("action." + (step.status === "awaiting-confirmation" ? "awaiting" : step.status), { action: id, inbox: col, result, req: key, ...(once ? { once } : {}) });
    } catch (e) {
      // Before the change reached the log, the file is put back and the request stays pending. After it, the
      // file and the log agree, so the request counts as decided and only its last line is missing.
      if (!told) { back(); stopped = `the event log could not be written (${why(e)}), so ${col}/${safe(id, 60)} was not applied and stays pending`; break; }
      stopped = `the event log could not take the last line about ${col}/${safe(id, 60)} (${why(e)}); it was applied and is kept as decided`;
    }
    if (step.md != null) { md = step.md; rec = parseLaunch(md); E = computeBoard(rec.cards, { WIP: CFG.WIP, LAUNCH: CFG.LAUNCH }); recordChanged = true; }
    if (step.config != null) configChanged = true;
    if (step.notes != null) notesChanged = true;
    if (step.then) step.then();
    const decidedAt = new Date().toISOString();
    results.push({ id, inbox: col, verb, card, status: step.status, result, write: statusWrite({ status: step.status, result, decidedAt }) });
    decided[key] = { status: step.status, result, decidedAt };
    if (once) decided[once] = decided[key];
    unsaved++;
    // A request that changed a file is in the ledger before the next one is looked at.
    if (undo.length || unsaved >= 25) {
      try { writeDecided(decided, seen); unsaved = 0; }
      catch (e) { stopped = stopped || `${rel(DECIDED)} could not be written (${why(e)}); ${col}/${safe(id, 60)} was applied, and the event log shows it as decided, so it will not be applied again`; }
    }
    if (stopped) break;
  }
  if (unsaved) { try { writeDecided(decided, seen); } catch (e) { stopped = stopped || `${rel(DECIDED)} could not be written (${why(e)}); what was decided is in the event log and will not be applied again`; } }

  // The page embeds the record, the plan's state, the automatic-work settings and the owner's notes: rebuild when
  // any of them changed. This process loaded the config before it changed, so that case builds in a fresh one.
  const changed = [recordChanged && "the record", notesChanged && "the owner's notes", configChanged && "the settings"].filter(Boolean);
  if (OWN_RECORD && changed.length) {
    if (configChanged) spawnSync(process.execPath, [fileURLToPath(new URL("../build/build.mjs", import.meta.url))], { cwd: CFG.ROOT, env: { ...process.env, COCKPIT_ROOT: CFG.ROOT }, encoding: "utf8" });
    else build({ write: true });
  }
  if (stopped) throw new Error(`inbox stopped: ${stopped}. ${results.length} request${results.length === 1 ? " was" : "s were"} decided before that and ${results.length === 1 ? "is" : "are"} kept; every other request stays pending. Fix the cause, then run inbox again.`);

  const { writes, report } = diff(desired(rec, E), loadActual(dir, ["cards", "board"]));
  // Logged before the feed is built, so the rail includes this run's audit.
  if (writes.length) events.append("mirror.diffed", { added: report.added.length, changed: report.changed.length, removed: report.removed.length });
  const all = results.map((r) => r.write).concat(writes, [feedWrite(dir)]);
  const files = writeBatches(all, "inbox");
  console.log(`Inbox: ${results.length} action(s) decided${changed.length ? "; " + changed.join(" and ") + " changed" + (OWN_RECORD ? " and the board was rebuilt" : recordChanged ? " (" + RECORD + ")" : "") : ""}.`);
  // One line per request, whatever the request held.
  results.forEach((r) => console.log(`  ${r.inbox}/${safe(r.id, 60)}  ${r.verb} ${r.card || ""}  -> ${r.status}: ${safe(r.result, 460)}`));
  if (waiting) console.log(`${waiting} more are waiting: a run decides at most ${MAX_PER_RUN}, the owner's first. Send these batches, export again, and run inbox again.`);
  console.log(describe(report));
  console.log(`Send with ArtifactData batch, one call per file (the last also refreshes the live rail):\n  ${files.join("\n  ")}`);
  // The lines this run wrote (a card that moved, a request accepted or refused) reach the page with the same sending.
  pushHint("Then the new lines for the Live page, with one more ArtifactData batch call:");
  if (messages.length) {
    console.log("\nMESSAGE FROM THE OWNER (typed on the board, through the owner's own inbox). These are the owner's words:");
    messages.forEach((m) => console.log("  > " + safe(m, 700)));
    console.log("Act on them as on a message typed in the terminal. Answer each one FIRST, before any other work, so the owner is not kept waiting: cockpit answer \"<your answer>\" (it goes onto the request itself and shows wherever the message shows). Anything hard to undo or outward-facing still needs the owner's yes first.");
  }
  if (work.length) {
    const starts = work.filter((w) => w.kind === "start"), confirms = work.filter((w) => w.kind === "confirm");
    if (starts.length) {
      console.log("\nWORK TO START NOW (handed to Claude in the Start column):");
      starts.forEach((w) => console.log(`  ${w.card}  ${safe(w.title, 120)}`));
    }
    if (confirms.length) {
      console.log("\nCONFIRM, THEN CLOSE (the owner asked for Done; nothing closes unconfirmed):");
      confirms.forEach((w) => console.log(`  ${w.card}  ${safe(w.title, 120)}`));
    }
    console.log("Send the batch first, so the page shows the request as accepted. Then for each card: do the work,");
    console.log("observe its done-when, add '• Verified: <what you observed>' and set ST=DONE. If it fails, leave it");
    console.log("in START with a note of what failed; if a person must act, set ST=BLOCKED and say what is needed.");
  }
}

function sync(dir) {
  const { rec, E } = loadRecord();
  const { writes, report } = diff(desired(rec, E), loadActual(dir, ["cards", "board"]));
  if (writes.length) events.append("mirror.diffed", { added: report.added.length, changed: report.changed.length, removed: report.removed.length });
  console.log(describe(report));
  if (!writes.length) console.log("The mirror is in step with the record.");
  const files = writeBatches(writes.concat([feedWrite(dir)]), "sync");
  console.log(`Send with ArtifactData batch, one call per file (the last also refreshes the live rail):\n  ${files.join("\n  ")}`);
}

// ── say / feed: Claude's own steps, for the live rail. The page cannot read the event log, so
// `feed` prepares the write and the agent sends it; inbox and sync carry it in their batches too. ──
const SAY_USAGE = 'say needs text: cockpit.mjs say "<what you did>" [--card ID] [--step 3/8] [--kind milestone|problem|result] [--next "Reply one | Reply two"]';
export const NEXT_MAX = 2, NEXT_LEN = 60;
const bare = (v) => (typeof v === "string" && !v.startsWith("--") ? v : "");

// ── push: every line not sent yet, as ONE batch of new documents live/u<offset> (src/events/push.mjs). ──
function pushSent(v) {
  console.log(`Recorded: lines up to #${recordSent(v)} are on the board.`);
}
const NO_BOARD = 'this project has no published board ("artifact" in .cockpit/config.json is not set), so there is nowhere to send a line. Nothing was prepared and nothing was written.';
function push() {
  if (!hasBoard()) { console.log(NO_BOARD); return; }
  if (opt("sent") !== undefined) return pushSent(opt("sent"));
  const b = pushBatch({ prune: !opt("no-delete", false) });
  if (b.warning) console.error("cockpit: " + b.warning);
  if (!b.file) { console.log(`Nothing new to send (lines up to #${b.high} are sent).`); return; }
  console.log(b.file);
  console.log(`Highest offset: ${b.high} (${b.sets} line${b.sets === 1 ? "" : "s"}${b.deletes ? ", " + b.deletes + " old to delete" : ""}). Send the file with one ArtifactData batch call, then run: cockpit push --sent ${b.high}`);
  if (b.waiting) console.log(`${b.waiting} more line${b.waiting === 1 ? "" : "s"} wait: a batch holds ${BATCH_MAX}. Run push again after --sent.`);
}
// What say, ask and turn-end end with: the same batch, and the exact command that records it as sent.
// Only when there is a real board to send it to.
function pushHint(lead = "Send with one ArtifactData batch call:") {
  if (!hasBoard()) return;
  const b = pushBatch();
  if (b.warning) console.error("cockpit: " + b.warning);
  if (!b.file) return;
  console.log(`${lead} ${b.file}`);
  console.log(`Then run: cockpit push --sent ${b.high}` + (b.waiting ? ` (and push again: ${b.waiting} more wait)` : ""));
}

// A line is never cut without saying so: text longer than the limit is refused, with its length, and nothing is written.
const LINE_MAX = 280;
function whole(text, what) {
  const t = cleanText(bare(text), 100000);
  if (t.length > LINE_MAX) throw new Error(`${what} is ${t.length} characters and the limit is ${LINE_MAX}. Nothing was written: shorten it and run the command again.`);
  return t;
}
function say(text) {
  const t = whole(text, "the line");
  if (!t) throw new Error(SAY_USAGE);
  const card = typeof opt("card") === "string" ? cleanText(opt("card"), 12) : null;
  if (card && !loadRecord().rec.cards.some((c) => c.id === card)) throw new Error(`there is no card ${card} in the record`);
  const kind = opt("kind", "milestone");
  if (!SAY_KINDS.includes(kind)) throw new Error("--kind is one of " + SAY_KINDS.join(", ") + ", not " + safe(kind, 24));
  const m = typeof opt("step") === "string" ? opt("step").match(/^(\d{1,3})\/(\d{1,3})$/) : null;
  if (opt("step") && !m) throw new Error('--step is written as done/total, for example --step 3/8');
  const step = m && +m[2] > 0 && +m[1] <= +m[2] ? { step: +m[1], of: +m[2] } : null;
  if (m && !step) throw new Error("--step " + opt("step") + " is not a step out of a total");
  // --next: up to two short replies the owner is likely to send next. They are offered as buttons on a result
  // line, so they belong to a result about a card and nothing else. Refused, never trimmed silently.
  let replies = [];
  if (opt("next") !== undefined) {
    if (opt("next") === true) throw new Error('--next needs the replies, separated by "|": --next "Start the next card | Show me the page"');
    if (kind !== "result" || !card) throw new Error("--next goes with --kind result and --card: it offers what to do after a card's result");
    replies = [...new Set(String(opt("next")).split("|").map((r) => cleanText(r, 200)).filter(Boolean))];
    if (!replies.length) throw new Error('--next needs at least one reply');
    if (replies.length > NEXT_MAX) throw new Error("give " + NEXT_MAX + " replies or fewer; this has " + replies.length);
    const long = replies.find((r) => r.length > NEXT_LEN);
    if (long) throw new Error("a reply is " + NEXT_LEN + " characters at most; this one has " + long.length + ": " + safe(long, 80));
  }
  // The default kind is not stored: a line with no `say` reads as a milestone, as every older line does.
  const e = events.append("claude.said", { text: t, ...(kind !== "milestone" ? { say: kind } : {}), ...(card ? { card } : {}), ...(step || {}), ...(replies.length ? { replies } : {}) });
  console.log(`Said #${e.offset}${card ? " on " + card : ""}${step ? ` (step ${step.step} of ${step.of})` : ""}${kind !== "milestone" ? " [" + kind + "]" : ""}: ${t}`);
  pushHint();
}
// answer: the agent's answer to a message the owner typed on the board. It is written onto the request itself
// (status done, result = the answer), so the page shows it wherever it shows the message: on the card it was
// typed on, in the Needs you panel, under Conversation and under Requests. By default it answers the newest
// message that has no answer yet; --to names one by its request id.
export const ANSWER_MAX = 900;
function answer(text) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, ANSWER_MAX);
  if (!t) throw new Error('answer needs the answer: cockpit.mjs answer "<your answer>" [--to <request id>]');
  const all = events.read({});
  const answered = new Set(all.filter((e) => e.type === "claude.answered").map((e) => e.action));
  const msgs = all.filter((e) => e.type === "owner.message" && typeof e.action === "string");
  const want = typeof opt("to") === "string" ? opt("to") : null;
  const to = want ? msgs.find((m) => m.action === want) : msgs.filter((m) => !answered.has(m.action)).pop();
  if (!to) throw new Error(want ? `there is no message with the request id ${safe(want, 40)}` : "there is no message from the owner without an answer");
  if (answered.has(to.action)) throw new Error(`the message ${safe(to.action, 40)} already has an answer`);
  const inboxName = to.inbox === "actions" ? "actions" : "approvals";
  const e = events.append("claude.answered", { text: t, action: to.action, inbox: inboxName, ...(to.origin ? { origin: to.origin } : {}), ...(to.card ? { card: to.card } : {}) });
  const doc = { status: "done", result: t, answered: true, decidedAt: e.at, ...(to.card ? { card: to.card } : {}) };
  fs.mkdirSync(path.join(OUT, "docs"), { recursive: true });
  const f = path.join(OUT, "docs", `${inboxName}__${to.action}.json`);
  const waiting = fs.existsSync(f);   // the inbox's own receipt for this request has not been sent yet: the answer takes its place
  fs.writeFileSync(f, JSON.stringify(doc, null, 1));
  console.log(`Answered #${e.offset}${to.card ? " on card " + to.card : ""}: ${t}`);
  console.log(waiting ? "The answer replaced the waiting receipt of that request: send the inbox batch as it is."
    : `Send with one ArtifactData call: update ${inboxName}/${to.action} from ${f.replaceAll("\\", "/")} (if_version 2: the receipt was version 2).`);
  pushHint();
}
// ask: a decision that is the owner's, put on the board as a question with answer buttons.
function ask(text) {
  const t = whole(text, "the question");
  if (!t) throw new Error('ask needs a question: cockpit.mjs ask "<question>" --card ID [--topic key] [--choices "A, B, C"]');
  const card = cleanText(bare(opt("card")), 12);
  if (!card) throw new Error("ask needs the card the question is about: --card ID");
  if (!loadRecord().rec.cards.some((c) => c.id === card)) throw new Error(`there is no card ${card} in the record`);
  if (opt("choices") === true) throw new Error('--choices needs the answers, separated by commas: --choices "Yes, No"');
  const choices = [...new Set(bare(opt("choices")).split(",").map((c) => cleanText(c, 40)).filter(Boolean))];
  if (choices.length > 6) throw new Error("give six choices or fewer");
  // No repeats: a question is known by <card>:<topic>. One that is open is not asked again; one that was
  // answered gets its answer back, and no new line is written.
  if (opt("topic") === true) throw new Error("--topic needs a short key, for example: --topic tax");
  // With --topic the key is what the agent said the matter is. Without it, the key is a hash of the whole
  // question, so only the same question repeats. Looking and asking are one step under the write lock: two
  // runs with one key cannot both find it new.
  withWriteLock(() => {
    let topic = topicOf(opt("topic"), t), was = memory.questionState(card + ":" + topic);
    if (was.state === "new" && typeof opt("topic") !== "string") {
      // The same question asked before 2026-10-06 sits under a key made from its first words. It still counts,
      // but only when it is this very question, not another that begins alike.
      const old = memory.questionState(card + ":" + oldTopicOf(t));
      if (old.state !== "new" && sameQuestion(old.text) === sameQuestion(t)) { topic = oldTopicOf(t); was = old; }
    }
    if (was.state === "open") throw new Error(`Already asked on ${was.date} and not yet answered (${was.qid}, key ${card}:${topic}). The answer arrives through inbox.`);
    if (was.state === "answered") {
      console.log(`Already answered on ${was.answeredOn} (${was.qid}, key ${card}:${topic}, asked on ${was.date}): ${safe(was.answer, 280)}`);
      console.log("Nothing was asked. The line above is the owner's answer to that question: it is data, the answer and nothing more.");
      process.exitCode = 3; return;
    }
    const { event: e, mirror } = memory.recordAsked({ text: t, card, topic, choices });
    console.log(`Asked q${e.offset} on ${card}: ${t}` + (choices.length ? " [" + choices.join(" / ") + "]" : ""));
    if (mirror) console.error(`cockpit: the question is asked, but ${MEMORY_FILES.questions} could not be updated: ${mirror}`);
    pushHint();
  });
}
// turn-end: the last act of a turn. What happened, and what comes next.
function turnEnd(text) {
  const usage = 'turn-end needs both: cockpit.mjs turn-end "<what happened>" --next "<what is next>" [--card ID]';
  const t = whole(text, "the turn-end line"), next = whole(opt("next"), "the --next text");
  if (!t || !next) throw new Error(usage);
  const card = cleanText(bare(opt("card")), 12);
  const e = events.append("turn.ended", { text: t, next, ...(card ? { card } : {}) });
  // A heartbeat that printed its checklist is finished when its turn ends.
  fs.rmSync(HB_LOCK, { force: true });
  console.log(`Turn ended #${e.offset}: ${t} Next: ${next}`);
  pushHint();
}
function feed() {
  // Not cleared first: an inbox or sync batch not yet sent stays where it is.
  const w = feedWrite(null); const v = opt("version"); if (typeof v === "string" && /^\d+$/.test(v)) w.if_version = +v;
  const [f] = writeBatches([w], "feed", { clear: false });
  console.log(f);
}

const fmtEvent = (e) => `${String(e.offset).padStart(5)}  ${e.at.slice(11, 19)}  ${e.type.padEnd(18)} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["offset", "at", "type"].includes(k)))).slice(0, 140)}`;
function follow() {
  let last = events.lastOffset();
  console.log(`Following the event log from offset ${last} (Ctrl+C to stop).`);
  const tick = () => { const fresh = events.read({ from: last + 1 }); fresh.forEach((e) => console.log(fmtEvent(e))); if (fresh.length) last = fresh[fresh.length - 1].offset; };
  setInterval(tick, 1000);
}
function showEvents() {
  if (opt("follow", false)) return follow();
  const name = opt("consumer", null);
  const list = name ? events.poll(name) : events.read({ from: Number(opt("since", 1)) });
  list.slice(-200).forEach((e) => console.log(`${String(e.offset).padStart(5)}  ${e.at.slice(0, 19)}  ${e.type.padEnd(18)} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["offset", "at", "type"].includes(k)))).slice(0, 120)}`));
  if (name && opt("commit", false) && list.length) console.log(`Consumer ${name} committed at offset ${events.commit(name, list[list.length - 1].offset)}.`);
  if (!list.length) console.log(name ? `Consumer ${name} is up to date (offset ${events.cursor(name)}).` : "No events.");
}

// ── init: turn the cockpit on in this project. Never overwrites; says what already exists. ──
const TEMPLATES = fileURLToPath(new URL("../../templates/", import.meta.url));
function init() {
  const root = CFG.ROOT, made = [], kept = [];
  const put = (rel, text) => {
    const f = path.join(root, rel);
    if (fs.existsSync(f)) { kept.push(rel); return; }
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); made.push(rel);
  };
  const cfg = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "config.json"), "utf8"));
  cfg.title = typeof opt("title") === "string" ? opt("title") : path.basename(root);
  put(".cockpit/config.json", JSON.stringify(cfg, null, 2) + "\n");
  put(".cockpit/BOARD.md", fs.readFileSync(path.join(TEMPLATES, "BOARD.md"), "utf8"));
  put(MEMORY_FILES.notes, fs.readFileSync(path.join(TEMPLATES, "NOTES.md"), "utf8")); // the owner's notes for the agent: three empty headings
  // .gitignore: append only the lines that are missing.
  const gi = path.join(root, ".gitignore"), want = fs.readFileSync(path.join(TEMPLATES, "gitignore.txt"), "utf8").split(/\r?\n/).filter(Boolean);
  const have = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const add = want.filter((l) => l.startsWith("#") ? false : !have.split(/\r?\n/).includes(l));
  if (add.length) { fs.writeFileSync(gi, have + (have && !have.endsWith("\n") ? "\n" : "") + [want[0], ...add].join("\n") + "\n"); made.push(".gitignore (" + add.join(", ") + ")"); }
  console.log(`Cockpit on in ${root}`);
  made.forEach((m) => console.log("  created " + m));
  kept.forEach((m) => console.log("  kept    " + m + " (already there, not touched)"));
  // Build in a fresh process: this one loaded its config before the file existed.
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../build/build.mjs", import.meta.url)), "--digest"], { cwd: root, env: { ...process.env, COCKPIT_ROOT: root }, encoding: "utf8" });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  if (r.status !== 0) { process.exitCode = r.status || 1; return; }
  console.log("Next: publish " + CFG.OUT + " with the Artifact tool, then put its link in .cockpit/config.json \"artifact\".");
}

// ── lint: is this plan good enough to show a person? Exit 1 on any error; warnings are listed too. ──
function lint() {
  const md = fs.readFileSync(RECORD, "utf8"), rec = parseLaunch(md);
  rec.errors.forEach((e) => console.log("ERROR  " + e));
  rec.warnings.forEach((w) => console.log("WARN   " + w));
  const f = planLint({ ...rec, finish: CFG.LAUNCH });
  f.forEach((x) => console.log((x.level === "error" ? "ERROR  " : "WARN   ") + x.text));
  const errors = rec.errors.length + f.filter((x) => x.level === "error").length;
  const warns = rec.warnings.length + f.filter((x) => x.level === "warn").length;
  console.log(`Plan check: ${rec.goals.length} goals, ${rec.cards.length} cards; ${errors} error(s), ${warns} warning(s).` + (errors + warns ? "" : " Clean."));
  if (errors) process.exitCode = 1;
}

// ── status: one screen of where things stand, from local files only. ──
function status() {
  const r = build({ write: false });
  console.log(`${CFG.TITLE}: record ${CFG.RECORD}, harness ${CFG.HARNESS}, plan ${CFG.PLAN}${CFG.PLAN === "draft" ? " (nothing starts until the owner accepts it on the board)" : ""}`);
  if (!r.ok) {
    console.log("RECORD BROKEN:"); r.rec.errors.slice(0, 5).forEach((e) => console.log("  " + e));
    if (CFG.AUTO_OFF_WHY) console.log(`AUTOMATIC STARTS ARE OFF: ${CFG.AUTO_OFF_WHY}. Nothing starts by itself until the settings in .cockpit/config.json are fixed.`);
    process.exitCode = 1; return;
  }
  console.log(digest(r));
  const rc = (() => { try { return JSON.parse(fs.readFileSync(FILES.receipt, "utf8")); } catch { return null; } })();
  console.log(`Board page: ${CFG.ARTIFACT_URL && !CFG.ARTIFACT_URL.includes("<") ? CFG.ARTIFACT_URL : "not published yet"}`);
  console.log(`Last publish: ${rc ? rc.at + " (#" + rc.hash + ")" : "none recorded"}`);
  const last = events.read({ from: Math.max(1, events.lastOffset() - 2) });
  console.log(`Event log: ${events.lastOffset()} events` + (last.length ? `; latest ${last[last.length - 1].type} at ${last[last.length - 1].at}` : ""));
  const lost = events.damaged();
  if (lost) console.log(`EVENT LOG DAMAGED: ${lost} line${lost === 1 ? "" : "s"} of the event log could not be read and ${lost === 1 ? "is" : "are"} skipped (cut off by a crash, or edited by hand). Every other line is used.`);
  autoStatus();
}
// The automatic-work settings as they are used, every setting that was ignored, and the owner's notes.
function autoStatus() {
  const A = CFG.AUTO;
  console.log(`Automatic work: starts ${A.start ? "on" : "off"}${A.paused ? ", PAUSED by the owner" : ""}; at most ${A.inARow} in a row and ${A.perDay} in 24 hours; ${A.pauseOnQuestion ? "waits while a question is unanswered" : "does not wait for answers"}.`);
  CFG.AUTO_PROBLEMS.forEach((p) => console.log("SETTING IGNORED: " + p));
  // The settings fail closed: one that is wrong, or not a setting at all, turns automatic starts off.
  if (CFG.AUTO_OFF_WHY) console.log(`AUTOMATIC STARTS ARE OFF: ${CFG.AUTO_OFF_WHY}. Nothing starts by itself until the settings in .cockpit/config.json are fixed.`);
  const N = parseNotes(memory.readText("notes"));
  console.log(`Notes for the agent: ${N.current.length} current in ${MEMORY_FILES.notes}` + (N.notes.length > N.current.length ? ` (${N.notes.length - N.current.length} replaced)` : "") + ".");
  N.problems.forEach((p) => console.log(`NOTE IGNORED: line ${p.line} of ${MEMORY_FILES.notes} (${p.why}): ${safe(p.text, 80)}`));
  // One line, and only when it matters: a memory file past 80 percent of its cap.
  const full = Object.keys(CAPS).map((k) => ({ file: MEMORY_FILES[k], tokens: tokens(memory.readText(k)), cap: CAPS[k] })).filter((x) => x.tokens * 5 > x.cap * 4);
  if (full.length) console.log("MEMORY NEARLY FULL: " + full.map((x) => `${x.file} is at ${Math.floor(x.tokens * 100 / x.cap)} percent of its cap (about ${x.tokens} of ${x.cap} tokens)`).join("; ") + ". Run cockpit tidy, or shorten the file by hand.");
}

// ── next: the one thing the agent may do by itself. Without --start it only says what it would do. ──
// It runs under the one write lock (src/events/files.mjs), as inbox does: the record is read, decided on and
// written by one command at a time, so a start is never overwritten by another command's older copy.
function next() {
  const start = argv.includes("--start");
  const settings = { plan: CFG.PLAN, auto: CFG.AUTO, wip: CFG.WIP, finish: CFG.LAUNCH };
  const go = () => {
    const { md, rec, E } = loadRecord();
    const all = events.read({}), now = Date.now();
    const title = (id) => { const c = rec.cards.find((x) => x.id === id); return c ? id + " " + c.title : id; };
    const d = nextAutoStart(rec.cards, all, settings, now);
    // When the settings themselves were read as "off" (a wrong value, a key that is no setting), say that,
    // not that auto.start is false: the file may well say true.
    if (!d.card && CFG.AUTO_OFF_WHY && CFG.PLAN === "accepted" && CFG.AUTO.paused === false) d.none = `Automatic starts are off: ${CFG.AUTO_OFF_WHY} in .cockpit/config.json. Run cockpit status to see what to fix.`;
    if (!start) {
      if (d.card) console.log(`Next automatic start: ${title(d.card)} (it would be ${d.n} of ${d.of} in a row).\nWhy: ${d.why}\nNothing was changed. To start it: cockpit next --start`);
      else console.log(`No automatic start. ${d.none}\nNothing was changed.`);
      return;
    }
    const refuse = (why) => { console.log(`Not started. ${why}\nNothing was changed.`); process.exitCode = 1; };
    if (!d.card) return refuse(d.none);
    // The gateway checks every rule again, from the same facts, before a byte is written.
    const g = decideAuto({ verb: "card.move", card: d.card, to: "START" }, { cards: rec.cards, plan: CFG.PLAN, auto: CFG.AUTO, entries: all, now, score: E.score });
    if (!g.ok) return refuse(g.reason);
    const r = applyDecision(md, g, { date: today() });
    // The record first, whole or not at all; then the log. If the log cannot take it, the record is put back.
    const back = swap(RECORD, r.md);
    let e;
    try {
      events.append("card.moved", { ...r.change, via: "auto" });
      // "move" is the state change as data: the page moves the card from this line alone.
      e = events.append("claude.auto", { text: autoSentence(d.card, d.after), card: d.card, rule: AUTO_RULE, ...(d.after ? { after: d.after } : {}), n: g.auto.n, of: g.auto.of,
        move: { from: r.change.from, to: r.change.to }, undo: { verb: "card.move", card: d.card, to: "BACKLOG" } });
    } catch (err) { back(); throw new Error("the start could not be logged, so the record was put back as it was: " + err.message); }
    if (OWN_RECORD) build({ write: true });
    console.log(`Started automatically #${e.offset}: ${title(d.card)} (${g.auto.n} of ${g.auto.of} in a row).\n${e.text}`);
    console.log(`WORK TO START NOW: ${title(d.card)}. Say the plan on the board first: cockpit say "<plan>" --card ${d.card} --step 0/<steps>`);
    pushHint();
  };
  return start ? withWriteLock(go) : go();
}

// ── remember: what the agent writes down at the end of a turn. Every line carries where it came from. ──
function remember(kind, text) {
  const usage = 'remember needs a kind and a text: cockpit.mjs remember decision "<text>" --source event:N|card:ID [--replaces dN]  |  remember state "<text>" [--card ID]';
  if (kind !== "decision" && kind !== "state") throw new Error(usage);
  const t = cleanText(bare(text), 280);
  if (!t) throw new Error(usage);
  const cardExists = (id) => loadRecord().rec.cards.some((c) => c.id === id);
  const eventExists = (n) => events.read({ from: n, limit: 1 }).some((x) => x.offset === n);
  if (kind === "decision") {
    const m = bare(opt("source")).match(/^(event|card):(.{1,20})$/);
    if (!m) throw new Error("a decision needs where it came from: --source event:<number> (the owner's answer or request in the event log) or --source card:<id>");
    const source = m[1] === "event" ? { kind: "event", ref: /^\d{1,12}$/.test(m[2]) ? Number(m[2]) : NaN } : { kind: "card", ref: m[2] };
    if (source.kind === "event" && !(Number.isInteger(source.ref) && eventExists(source.ref))) throw new Error(`there is no event ${safe(m[2], 14)} in the event log (the log ends at #${events.lastOffset()})`);
    if (source.kind === "card" && !cardExists(source.ref)) throw new Error(`there is no card ${safe(m[2], 14)} in the record`);
    if (opt("replaces") === true) throw new Error("--replaces needs a decision's id, for example: --replaces d2");
    const replaces = bare(opt("replaces")) || null;
    if (replaces && !/^d\d{1,6}$/.test(replaces)) throw new Error("--replaces needs a decision's id, for example: --replaces d2");
    // Read, add and write are one step under the write lock: two runs never give out the same id.
    const r = withWriteLock(() => { const x = addDecision(memory.readText("decisions"), { text: t, source, date: today(), replaces, archive: memory.readText("archive") }); memory.writeText("decisions", x.text); return x; });
    console.log(`Remembered ${r.id} [${source.kind} ${source.ref}]${replaces ? " (replaces " + replaces + ")" : ""}: ${t}`);
    if (tokens(r.text) > CAPS.decisions) console.log(`${MEMORY_FILES.decisions} is about ${tokens(r.text)} tokens, over its cap of ${CAPS.decisions} (characters divided by 4): run cockpit tidy.`);
    return;
  }
  if (opt("card") === true) throw new Error("--card needs a card id");
  const card = bare(opt("card"));
  if (card && !cardExists(card)) throw new Error(`there is no card ${safe(card, 14)} in the record`);
  const last = events.lastOffset();
  if (!card && !last) throw new Error("the event log is empty, so say which card the note is about: --card ID");
  const source = card ? { kind: "card", ref: card } : { kind: "event", ref: last };
  const r = withWriteLock(() => { const x = addState(memory.readText("state"), { text: t, source, date: today() }); memory.writeText("state", x.text); return x; }); // addState throws when the file would pass its cap
  console.log(`Noted [${source.kind} ${source.ref}]: ${t}\n${MEMORY_FILES.state} is about ${r.tokens} of ${CAPS.state} tokens (characters divided by 4).`);
}

// ── pack: the wake-up pack. Assembled, never written by a model; over the cap it fails, it never cuts. ──
function pack() {
  const json = argv.includes("--json");
  let cap = PACK_CAP;
  if (opt("cap") !== undefined) {
    const c = bare(opt("cap"));
    if (!/^\d{1,5}$/.test(c) || +c < 1 || +c > PACK_CAP) throw new Error(`--cap is a whole number of tokens from 1 to ${PACK_CAP}: the cap can be lowered, never raised`);
    cap = +c;
  }
  const { rec } = loadRecord();
  const p = buildPack({ title: CFG.TITLE, notes: memory.readText("notes"), decisions: memory.readText("decisions"), questions: memory.readText("questions"), state: memory.readText("state"),
    cards: rec.cards, entries: events.read({}), settings: { plan: CFG.PLAN, auto: CFG.AUTO, wip: CFG.WIP, finish: CFG.LAUNCH, record: CFG.RECORD }, now: Date.now(), sentence: (e) => entryOf(e), cap });
  // The size of every pack is logged, so a wake that grows is seen. These two events are never lines on the board.
  if (!p.ok) {
    events.append("pack.failed", { tokens: p.tokens, cap: p.cap });
    if (json) console.log(JSON.stringify(p, null, 1));
    console.error(p.error);
    process.exitCode = 1; return;
  }
  events.append("pack.built", { tokens: p.tokens, stale: p.stale, unverified: p.unverified });
  console.log(json ? JSON.stringify(p, null, 1) : p.text);
}

// ── tidy: by script, with no model and no judgement. It prints what it did. ──
function tidy() {
  if (argv.includes("--check")) return tidyCheck();
  const r = withWriteLock(() => {
    const before = { decisions: memory.readText("decisions"), questions: memory.readText("questions"), archive: memory.readText("archive") };
    const x = tidyMemory(before, today());
    for (const k of ["archive", "decisions", "questions"]) if (x[k] !== before[k]) memory.writeText(k, x[k]); // the archive first: a line is never in neither file
    return x;
  });
  r.did.forEach((d) => console.log(d));
  if (!r.did.length) console.log("Nothing to tidy: no replaced decision and no answered question is older than 30 days.");
  const texts = { notes: memory.readText("notes"), decisions: r.decisions, questions: r.questions, state: memory.readText("state") };
  const unread = [["decisions", parseMemory("decisions", texts.decisions).problems], ["questions", parseMemory("questions", texts.questions).problems],
    ["state", parseMemory("state", texts.state).problems], ["notes", parseNotes(texts.notes).problems]];
  unread.forEach(([k, list]) => list.forEach((p) => console.log(`LINE IGNORED: line ${p.line} of ${MEMORY_FILES[k]} (${p.why}): ${safe(p.text, 80)}`)));
  // A line that says it replaces an id nothing has. The link does nothing and blocks nothing; it is only said.
  danglingLinks(parseMemory("decisions", texts.decisions).items, parseMemory("decisions", r.archive).items)
    .forEach((x) => console.log(`LINK IGNORED: line ${x.line} of ${MEMORY_FILES.decisions}: ${x.id} says it replaces ${x.replaces}, and there is no ${x.replaces}.`));
  danglingNotes(texts.notes).forEach((x) => console.log(`LINK IGNORED: line ${x.line} of ${MEMORY_FILES.notes}: ${x.id} says it replaces ${x.replaces}, and there is no ${x.replaces}.`));
  const over = overCaps(texts);
  over.forEach((o) => console.log(`OVER ITS CAP: ${o.file} is about ${o.tokens} tokens; the cap is ${o.cap} (characters divided by 4). Shorten it by hand: delete what no longer matters.`));
  Object.keys(CAPS).forEach((k) => { if (!over.some((o) => o.key === k)) console.log(`  ${MEMORY_FILES[k]}: about ${tokens(texts[k])} of ${CAPS[k]} tokens.`); });
  if (over.length) process.exitCode = 1;
}

// tidy --check: reads the four files and says how full each is. It writes nothing, not even an event.
function tidyCheck() {
  const texts = Object.fromEntries(Object.keys(CAPS).map((k) => [k, memory.readText(k)]));
  const over = overCaps(texts);
  console.log("Checked the memory files against their caps. Nothing was changed.");
  Object.keys(CAPS).forEach((k) => {
    const o = over.find((x) => x.key === k);
    console.log(o ? `OVER ITS CAP: ${o.file} is about ${o.tokens} tokens; the cap is ${o.cap} (characters divided by 4).` : `  ${MEMORY_FILES[k]}: about ${tokens(texts[k])} of ${CAPS[k]} tokens.`);
  });
  if (over.length) process.exitCode = 1;
}

// ── heartbeat: one tick of the session's own timer (/loop 30m /browser-agent heartbeat). A script decides, with no
// model, whether this tick does anything: it prints SKIP and the reason, or the checklist the agent follows.
// It starts no timer, no task and no process; it only reads the settings and the event log. ──
const HB_LOCK = path.join(FILES.local, "heartbeat.lock");     // says a heartbeat is in progress; turn-end removes it
const HB_MUTEX = path.join(FILES.local, "heartbeat.deciding"); // held for the instant of deciding, so two ticks cannot both run
const readHbLock = () => {
  try { const mtime = fs.statSync(HB_LOCK).mtimeMs; let at = null; try { at = JSON.parse(fs.readFileSync(HB_LOCK, "utf8")).at; } catch { /* the file's own time is used */ } return { at, mtime }; }
  catch { return null; }
};
function deciding(fn) {
  fs.mkdirSync(FILES.local, { recursive: true });
  for (let tries = 0; ; tries++) {
    try { fs.closeSync(fs.openSync(HB_MUTEX, "wx")); break; }
    catch (err) {
      if (!["EEXIST", "EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
      try { if (Date.now() - fs.statSync(HB_MUTEX).mtimeMs > 10000) { fs.rmSync(HB_MUTEX, { force: true }); continue; } } catch { /* it vanished: try again */ }
      if (tries > 600) return null;                             // about three seconds: give up, and skip
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try { return fn(); } finally { try { fs.rmSync(HB_MUTEX, { force: true }); } catch { /* it goes stale by itself */ } }
}
function heartbeat() {
  const now = Date.now();
  const facts = () => ({ auto: CFG.AUTO, entries: events.read({}), now, minuteOfDay: minuteOfDay(now), lock: (() => { const a = lockAgeMin(readHbLock(), now); return a == null ? null : { ageMin: a }; })() });
  if (argv.includes("--status")) { heartbeatStatus(facts()).forEach((l) => console.log(l)); return; } // reads only
  // A tick that found no news ends here: the lock goes, one quiet event is written, nothing reaches the board.
  if (argv.includes("--done")) { fs.rmSync(HB_LOCK, { force: true }); events.append("heartbeat.done", {}); console.log("Heartbeat finished with no news. Nothing was posted."); if (hasBoard()) pushHint("So the board can show when this check ran, send its status with one ArtifactData batch call (it is not drawn as a line):"); return; }
  const out = deciding(() => {
    const f = facts(), d = heartbeatDecision(f);
    if (!d.run) {
      if (shouldLogSkip(f.entries, d.why, now)) events.append("heartbeat.skipped", { why: d.why });
      return ["SKIP: " + d.reason];
    }
    // The lock is written before the event: if the log cannot be written, the lock is taken away again.
    fs.writeFileSync(HB_LOCK, JSON.stringify({ at: now, pid: process.pid }));
    try { events.append("heartbeat.ran", { n: d.n, of: d.of }); } catch (e) { fs.rmSync(HB_LOCK, { force: true }); throw e; }
    return heartbeatChecklist(d);
  });
  console.log(out ? out.join("\n") :"SKIP: Another heartbeat is being decided at this moment.");
}

// Every command but init reads or writes a project's cockpit, and refuses in a folder that has none: nothing is
// created there. Only what prints this code's own facts (the verbs, the usage line) runs anywhere.
try {
  if (cmd === "init") init();
  else if (!CFG.HAS_CONFIG && NEEDS_COCKPIT.includes(cmd)) throw new Error(`there is no cockpit in this folder (${CFG.ROOT} has no .cockpit/config.json). Nothing was written. To turn one on here, run: cockpit init`);
  else if (cmd === "build") { const r = build({ write: true }); if (!r.ok) { r.rec.errors.forEach((e) => console.error("ERROR " + e)); process.exitCode = 1; } else console.log("Built " + CFG.OUT + " #" + r.hash + "\n" + digest(r)); }
  else if (cmd === "status") status();
  else if (cmd === "lint") lint();
  else if (cmd === "inbox") { const d = opt("from"); if (!d || d === true) throw new Error("inbox needs --from <export dir>"); inbox(d); }
  else if (cmd === "sync") { const d = opt("from"); if (!d || d === true) throw new Error("sync needs --from <export dir>"); sync(d); }
  else if (cmd === "events") showEvents();
  else if (["say", "ask", "answer", "turn-end"].includes(cmd)) {
    // The text is the one bare argument, wherever it sits (a flag that takes no value sits last or before another flag).
    const text = argv.slice(1).find((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--")));
    (cmd === "say" ? say : cmd === "ask" ? ask : cmd === "answer" ? answer : turnEnd)(text);
  }
  else if (cmd === "next") next();
  else if (cmd === "pack") pack();
  else if (cmd === "tidy") tidy();
  else if (cmd === "heartbeat") heartbeat();
  else if (cmd === "remember") {
    const bareArgs = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--")));
    remember(bareArgs[0], bareArgs[1]);
  }
  else if (cmd === "push") push();
  else if (cmd === "feed") feed();
  else if (cmd === "verbs") Object.entries(VERBS).forEach(([v, s]) => console.log(`${v.padEnd(14)} level ${s.level.padEnd(9)} risk ${s.risk.padEnd(7)} ${s.mode.padEnd(8)} args ${s.args.concat((s.optional || []).map((x) => x + "?")).join(", ")}`));
  else { console.log("usage: cockpit.mjs init [--title T] | build | status | inbox|sync --from <dir> | events [--since N] [--consumer NAME --commit] [--follow] | say <text> [--card ID] [--step i/n] [--kind K] [--next 'A | B'] | answer <text> [--to ACTION] | ask <question> --card ID [--topic key] [--choices A,B] | turn-end <text> --next <text> | push [--sent N] | next [--start] | pack [--json] | remember decision|state <text> | tidy [--check] | heartbeat [--status] | lint | feed [--version N] | verbs"); process.exitCode = 2; }
} catch (e) { console.error("cockpit: " + e.message); process.exitCode = 1; }
