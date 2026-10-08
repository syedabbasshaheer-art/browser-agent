// memory.mjs (src/events) - where the memory files are, and the one code path that writes a question or an
// answer both to the event log and to its mirror in .cockpit/memory/QUESTIONS.md.
// The line grammar and every rule live in src/core/memory.mjs (pure); this file only reads and writes.
//
//   paths()                         the five files, absolute
//   readText(key)                   a file's text, "" when it is not there
//   writeText(key, text)            written through a temporary file, so a crash never leaves half a file
//   questionState(key)              is a question with this <card>:<topic> key open, answered, or new?
//   recordAsked({...})              appends claude.asked and adds the open line          -> the event
//   recordAnswered(change, extra)   appends question.answered and rewrites that line     -> the event
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../build/config.mjs";
import * as events from "./events.mjs";
import { FILES, parseMemory, addQuestion, answerQuestion } from "../core/memory.mjs";
import { writeAtomic } from "./files.mjs";

export const paths = () => Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, path.join(ROOT, rel)]));
export const readText = (key) => { try { return fs.readFileSync(paths()[key], "utf8"); } catch { return ""; } };
export function writeText(key, text) { writeAtomic(paths()[key], text); }
const day = (iso) => String(iso || "").slice(0, 10);

// Every question that carries a key, from the log first and the file second (a fresh clone has the file only).
//   -> { state: "new" } | { state: "open", qid, date } | { state: "answered", qid, date, answer, answeredOn }
export function questionState(key, { file = events.EVENTS } = {}) {
  const all = events.read({ types: ["claude.asked", "question.answered"] }, file);
  const answers = Object.create(null);
  for (const e of all) if (e.type === "question.answered" && typeof e.qid === "string" && !answers[e.qid]) answers[e.qid] = e;
  const asked = all.filter((e) => e.type === "claude.asked" && e.key === key);
  const open = asked.find((e) => !answers["q" + e.offset]);
  if (open) return { state: "open", qid: "q" + open.offset, date: day(open.at), text: String(open.text || "") };
  const mine = parseMemory("questions", readText("questions")).items.filter((q) => q.key === key);
  const stillOpen = mine.find((q) => !q.answered && !answers[q.id]);
  if (stillOpen) return { state: "open", qid: stillOpen.id, date: stillOpen.date, text: stillOpen.text };
  if (asked.length) { const q = asked[asked.length - 1], a = answers["q" + q.offset]; return { state: "answered", qid: "q" + q.offset, date: day(q.at), text: String(q.text || ""), answer: String(a.text || ""), answeredOn: day(a.at) }; }
  if (mine.length) { const q = mine[mine.length - 1], a = answers[q.id]; return { state: "answered", qid: q.id, date: q.date, text: q.text, answer: q.answered ? q.answer : String(a.text || ""), answeredOn: q.answered ? q.answeredOn : day(a.at) }; }
  return { state: "new" };
}

// The mirror never stops the event: a question that reached the log is asked, whatever happens to the file.
// What went wrong with the file is returned as `mirror`, for the caller to print.
export function recordAsked({ text, card, topic, choices = [] }, { file = events.EVENTS } = {}) {
  const key = card + ":" + topic;
  const e = events.append("claude.asked", { text, card, topic, key, ...(choices.length ? { choices } : {}) }, file);
  let mirror = null;
  try { writeText("questions", addQuestion(readText("questions"), { qid: "q" + e.offset, event: e.offset, date: day(e.at), key, text })); }
  catch (err) { mirror = String(err && err.message || err).slice(0, 160); }
  return { event: e, key, mirror };
}

export function recordAnswered(change, extra = {}, { file = events.EVENTS } = {}) {
  const e = events.append("question.answered", { ...change, ...extra }, file);
  let mirror = null;
  try {
    const n = Number(String(e.qid).slice(1));
    const q = events.read({ from: n, limit: 1, types: ["claude.asked"] }, file).find((x) => x.offset === n);
    const topic = q && typeof q.topic === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(q.topic) ? q.topic : "q" + n;
    const asked = q ? { event: n, date: day(q.at), key: (q.card || e.card) + ":" + topic, text: String(q.text || "") } : null;
    writeText("questions", answerQuestion(readText("questions"), { qid: e.qid, date: day(e.at), event: e.offset, answer: String(e.text || ""), asked }));
  } catch (err) { mirror = String(err && err.message || err).slice(0, 160); }
  return { event: e, mirror };
}
