// events.mjs - the event log: an append-only, ordered stream with named consumers.
//
// Kafka's model at the size of one project. Every event gets the next OFFSET (1, 2, 3 ...)
// and is never rewritten. A CONSUMER is anything that reads the stream (the page mirror,
// a digest, an audit) and keeps its own position in cursors.json, so it can stop, restart
// and resume exactly where it left off, and several consumers read independently.
//
//   append(type, data)            -> { offset, at, type, ...data }
//   read({ from, types, limit })  -> events with offset >= from
//   cursor(name) / commit(name, offset)
//   poll(name, { types, limit })  -> the events this consumer has not seen yet (does not commit)
//
// Types are dotted nouns-then-verbs: card.moved, card.added, action.received,
// action.applied, action.refused, action.awaiting, mirror.diffed, note.added, board.published.
// The file lives in .claude/local/ (gitignored): it can hold what people asked.

import fs from "node:fs";
import path from "node:path";
import { LOCAL, ROOT } from "../build/config.mjs";

const DIR = path.resolve(ROOT, LOCAL);
export const EVENTS = path.join(DIR, "events.jsonl");
export const CURSORS = path.join(DIR, "cursors.json");

const readLines = (f) => { try { return fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()); } catch { return []; } };
// A line is an event when it is one JSON object. A line that is not (cut off by a crash, or damaged) is skipped
// by every reader and counted by damaged(): it is never joined to the line after it.
const parse = (l) => { try { const e = JSON.parse(l); return e && typeof e === "object" && !Array.isArray(e) ? e : null; } catch { return null; } };
// How many lines of the log could not be read. `cockpit status` says so when it is not zero.
export const damaged = (file = EVENTS) => readLines(file).filter((l) => !parse(l)).length;
// Does the file end in the middle of a line? Then the next event must start on a line of its own.
function endsMidLine(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (!size) return false;
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nothing to close */ } }
}

export function lastOffset(file = EVENTS) {
  const lines = readLines(file);
  for (let i = lines.length - 1; i >= 0; i--) { const e = parse(lines[i]); if (e && Number.isInteger(e.offset)) return e.offset; }
  return 0;
}

export function append(type, data = {}, file = EVENTS) {
  if (!/^[a-z]+(\.[a-z]+)+$/.test(type)) throw new Error("event type must be dotted lowercase, e.g. card.moved: " + type);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Reading the last offset and appending are two steps; several sessions and hooks write here at once.
  // A lock file makes them one. A lock older than 5 seconds belonged to a writer that died: take it.
  const lock = file + ".lock";
  for (let tries = 0; ; tries++) {
    try { fs.closeSync(fs.openSync(lock, "wx")); break; }
    catch (err) {
      // On Windows a lock that another writer is deleting answers EPERM, EBUSY or EACCES, not EEXIST: all mean "wait".
      if (!["EEXIST", "EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) { fs.rmSync(lock, { force: true }); continue; } } catch { /* it vanished or is busy: try again */ }
      if (tries > 4000) throw new Error("event log is locked: " + lock);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); // sleep 2 ms without spinning
    }
  }
  try {
    const e = { offset: lastOffset(file) + 1, at: new Date().toISOString(), type, ...data };
    // A log whose last line was cut off (no newline) would swallow this event into that line: start a new one.
    fs.appendFileSync(file, (endsMidLine(file) ? "\n" : "") + JSON.stringify(e) + "\n");
    return e;
  } finally { for (let i = 0; i < 50; i++) { try { fs.rmSync(lock, { force: true }); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); } } }
}

export function read({ from = 1, types = null, limit = Infinity } = {}, file = EVENTS) {
  const out = [];
  for (const l of readLines(file)) {
    const e = parse(l);
    if (!e || e.offset < from) continue;
    if (types && !types.some((t) => e.type === t || (t.endsWith(".*") && e.type.startsWith(t.slice(0, -1))))) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

const readCursors = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
export const cursor = (name, file = CURSORS) => readCursors(file)[name] || 0;
export function commit(name, offset, file = CURSORS) {
  const c = readCursors(file);
  if ((c[name] || 0) >= offset) return c[name] || 0; // never move a consumer backwards
  c[name] = offset;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(c, null, 2));
  return offset;
}
export const poll = (name, opts = {}, files = {}) =>
  read({ ...opts, from: cursor(name, files.cursors) + 1 }, files.events);
