// push.mjs (src/events) - every line not sent yet, as ONE batch of new documents live/u<offset>.
// A new document needs no version, so the batch is sent blind. What was sent is remembered only when the
// agent says so (`cockpit push --sent N`), so a send that failed is simply prepared again next time.
// Used by the CLI (`push`, and the end of `say`, `ask`, `turn-end`, `next --start`) and by the after-tool
// hook when it writes a pulse. Nothing here touches the network: it writes files the agent sends.
//
//   hasBoard()                -> is there a published board to send to?
//   pushBatch({ prune })      -> { file, high, sets, deletes, waiting } (file null when there is nothing to send)
//   recordSent(n)             -> the last offset now recorded as sent (throws on a number that cannot be right)
import fs from "node:fs";
import path from "node:path";
import { ROOT, LOCAL, ARTIFACT_URL } from "../build/config.mjs";
import * as events from "./events.mjs";
import { entryOf, answersOf, isLine } from "./feed.mjs";

const DIR = path.join(ROOT, LOCAL);   // the same folder the CLI calls FILES.local
const OUT = path.join(DIR, "cockpit");
const PUSHED = path.join(DIR, "pushed.json");
export const LIVE_KEEP = 200;   // the page database keeps the newest 200 lines; older ones are listed for deletion
export const BATCH_MAX = 50;    // one ArtifactData batch call takes at most 50 writes

export const hasBoard = () => !!ARTIFACT_URL && /^https?:\/\//.test(ARTIFACT_URL) && !ARTIFACT_URL.includes("<");

const ints = (a) => (Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n > 0) : []);
// What was sent, as recorded. A recorded offset past the end of the log cannot be right (the file was damaged,
// or the log was replaced): it is ignored with a warning and read as the log's last real offset, so the next
// line written is sent. Believing it would silence push until the log grew past that number.
const readPushed = () => {
  let p = {}; try { p = JSON.parse(fs.readFileSync(PUSHED, "utf8")) || {}; } catch { /* nothing sent yet */ }
  if (typeof p !== "object" || Array.isArray(p)) p = {};
  let last = Number.isInteger(p.last) && p.last > 0 ? p.last : 0, warning = "";
  const end = events.lastOffset();
  if (last > end) {
    warning = `The record of what was sent says lines up to #${last} are on the board, but the event log ends at #${end}. That number is ignored: lines up to #${end} are taken as sent.`;
    last = end;
  }
  return { last, warning, have: ints(p.have).filter((o) => o <= end), pending: p.pending && typeof p.pending === "object" && !Array.isArray(p.pending) ? p.pending : {} };
};
const writePushed = (p) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(PUSHED, JSON.stringify(p)); };

// The lines that are logged and not yet recorded as sent. Reads only: nothing is prepared or written.
export function unsentLines() {
  if (!hasBoard()) return [];
  const st = readPushed();
  return events.read({}).filter((e) => isLine(e) && e.offset > st.last);
}

export function pushBatch({ prune = true } = {}) {
  const st = readPushed();
  // No published board: there is nowhere to send a line, so nothing is prepared and nothing is written.
  if (!hasBoard()) return { file: null, high: st.last, sets: 0, deletes: 0, waiting: 0, noBoard: true };
  // Bookkeeping events are never lines on the board. A wake-up check is the one exception that travels: the page
  // shows when the last one ran and when the next is due, and never draws it as a line.
  const all = events.read({}).filter((e) => isLine(e) || (e && /^heartbeat\.(ran|done|skipped)$/.test(e.type)));
  const ctx = { answers: answersOf(all) };
  // The lowest offset the page keeps. A line older than that is never sent: it would be deleted at once.
  const cutoff = all.length > LIVE_KEEP ? all[all.length - LIVE_KEEP].offset : 0;
  const unsent = all.filter((e) => e.offset > st.last && e.offset >= cutoff);
  const send = unsent.slice(0, BATCH_MAX);                    // oldest first, so the next batch carries on where this ends
  const high = send.length ? send[send.length - 1].offset : st.last;
  // Deletions: documents this project sent before that are now older than the newest 200. They were created
  // by one "set" and never changed, so they are still at version 1; an existing document is not deleted unpinned.
  const dels = prune ? st.have.filter((o) => o < cutoff).sort((a, b) => a - b).slice(0, BATCH_MAX - send.length) : [];
  if (!send.length && !dels.length) {
    if (st.warning) writePushed({ last: st.last, have: st.have, pending: {} });   // the corrected number is what is kept
    return { file: null, high: st.last, sets: 0, deletes: 0, waiting: 0, warning: st.warning };
  }
  const docs = path.join(OUT, "docs");
  fs.mkdirSync(docs, { recursive: true });
  const writes = send.map((e) => {
    const f = path.join(docs, "live__u" + e.offset + ".json");
    fs.writeFileSync(f, JSON.stringify(entryOf(e, ctx)));
    return { op: "set", collection: "live", doc_id: "u" + e.offset, file_path: f.replaceAll("\\", "/") };
  }).concat(dels.map((o) => ({ op: "delete", collection: "live", doc_id: "u" + o, if_version: 1 })));
  const file = path.join(OUT, "push-batch-1.json");
  fs.writeFileSync(file, JSON.stringify(writes, null, 1));
  // Not "sent": only what this batch would add and remove, so --sent can record exactly that.
  const pending = Object.fromEntries(Object.entries(st.pending).slice(-20));
  pending[high] = { add: send.map((e) => e.offset), del: dels };
  writePushed({ last: st.last, have: st.have, pending });
  return { file: file.replaceAll("\\", "/"), high, sets: send.length, deletes: dels.length, waiting: unsent.length - send.length, warning: st.warning };
}

export function recordSent(v) {
  if (!hasBoard()) throw new Error("this project has no published board, so nothing was sent and nothing is recorded");
  const n = typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1) throw new Error("--sent needs the offset that push printed, for example: push --sent 42");
  if (n > events.lastOffset()) throw new Error(`--sent ${n} is past the last event (#${events.lastOffset()})`);
  const st = readPushed();
  const p = st.pending[n];
  let have = st.have;
  if (p) { const gone = new Set(ints(p.del)); have = [...new Set(have.concat(ints(p.add)))].filter((o) => !gone.has(o)).sort((a, b) => a - b); }
  const last = Math.max(st.last, n);                          // never backwards
  const pending = Object.fromEntries(Object.entries(st.pending).filter(([k]) => Number(k) > last));
  writePushed({ last, have, pending });
  return last;
}
