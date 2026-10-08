// memory.mjs - the line grammar of the agent's memory files and the owner's notes file (card 11.9).
// Pure: text in, text or plain objects out. No files, no clock. The design is docs/17-agent-memory.md;
// its "As built" section holds these grammars word for word.
//
//   .cockpit/NOTES.md              the owner's file          - [n3] 2026-10-06 · <text> (replaces n1)
//   .cockpit/memory/DECISIONS.md   one line per decision     - [d2] 2026-10-06 · [event 191] · <text> (replaces d1)
//   .cockpit/memory/QUESTIONS.md   one line per question     - [q191] 2026-10-06 · [event 191] · 8.1:tax · open · <question>
//                                                            - [q191] 2026-10-06 · [event 191] · 8.1:tax · answered 2026-10-07 [event 204] · <question> · Answer: <answer>
//   .cockpit/memory/STATE.md       the agent's working notes - 2026-10-06 · [card 8.1] · <text>
//   .cockpit/memory/ARCHIVE.md     replaced decisions that `cockpit tidy` moved out, same grammar as DECISIONS
//
// A source tag is [event N] (a number in the event log) or [card X.Y] (a card in the record). Every text has
// been through the gateway's cleanText, which removes "·" and "|", so " · " only ever separates fields.
// A line that does not match its grammar is never used: it is listed in `problems` with its line number.

import crypto from "node:crypto";
import { NOTE_SECTIONS, REPLACES_TAIL } from "./gateway.mjs";

export const SEP = " · ";
export const tokens = (s) => Math.ceil(String(s == null ? "" : s).length / 4); // the one estimate used everywhere: characters divided by 4
// The most each file may hold, in estimated tokens. `cockpit tidy` fails when one is over; a write to STATE fails at once.
export const CAPS = Object.freeze({ notes: 1500, decisions: 3000, questions: 1500, state: 1500 });
export { NOTE_SECTIONS };
export const TITLES = Object.freeze({ notes: "# Notes for the agent", decisions: "# Decisions the owner made", questions: "# Questions asked on the board",
  state: "# Working notes", archive: "# Archive: replaced decisions" });
export const FILES = Object.freeze({ notes: ".cockpit/NOTES.md", decisions: ".cockpit/memory/DECISIONS.md", questions: ".cockpit/memory/QUESTIONS.md",
  state: ".cockpit/memory/STATE.md", archive: ".cockpit/memory/ARCHIVE.md" });

const DATE = "(\\d{4}-\\d\\d-\\d\\d)";
const realDate = (d) => /^\d{4}-\d\d-\d\d$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const linesOf = (text) => String(text == null ? "" : text).split(/\r?\n/);
const nlOf = (text) => (String(text || "").includes("\r\n") ? "\r\n" : "\n");
const skip = (l) => !l.trim() || /^#\s/.test(l) || /^<!--.*-->\s*$/.test(l.trim()); // blank, the title, a one-line comment
const clipped = (l) => (l.length > 80 ? l.slice(0, 79) + "…" : l);
// The next free id. Only an id a line carries as its own ("- [d7] …") counts: a number that merely appears in a
// text ("see ticket d999999") is not an id, and never pushes the next one out of range. An id that an existing
// line already claims to replace is skipped, so a new line is never born replaced.
const ownIds = (text, letter) => [...String(text || "").matchAll(new RegExp("^- \\[" + letter + "(\\d{1,6})\\]", "gm"))].map((m) => +m[1]);
function nextId(letter, texts, linked = []) {
  const taken = new Set(linked.filter(Boolean).map((id) => +String(id).slice(1)));
  let n = Math.max(0, ...texts.flatMap((t) => ownIds(t, letter))) + 1;
  while (taken.has(n)) n++;
  return letter + n;
}
// A text may not end the way a line says it replaces another: only the explicit option or field writes that.
const noLinkInText = (body, how) => { if (REPLACES_TAIL.test(String(body))) throw new Error(`the text ends with "(replaces …)", which is how a line says it replaces another. ${how}`); };

// ── The owner's notes ──
const NOTE_RE = new RegExp(`^- \\[(n\\d{1,6})\\] ${DATE} · (.+?)(?: \\(replaces (n\\d{1,6})\\))?$`);

// parseNotes(text) -> { notes, current, problems }
//   notes     every well-formed line: { id, date, section, text, replaces, line, raw }
//   current   the notes no other note replaces, in the file's order
//   problems  [{ line, text, why }] lines that were ignored
export function parseNotes(text) {
  const notes = [], problems = [], seen = Object.create(null);
  let section = null, known = false, headed = false;
  linesOf(text).forEach((raw, i) => {
    const l = raw.replace(/\s+$/, ""), n = i + 1;
    const h = l.match(/^##\s+(.*)$/);
    if (h) {
      section = NOTE_SECTIONS.find((s) => s.toLowerCase() === h[1].trim().toLowerCase()) || null; known = !!section; headed = true;
      if (!known) problems.push({ line: n, text: clipped(l), why: "not one of the three headings: " + NOTE_SECTIONS.join(", ") });
      return;
    }
    if (skip(l)) return;
    const m = l.match(NOTE_RE);
    const bad = (why) => problems.push({ line: n, text: clipped(l), why });
    if (!m) return bad("not written as: - [n<number>] <YYYY-MM-DD> · <text>");
    if (!known) return bad(headed ? "under a heading that is not known" : "not under one of the three headings");
    if (!realDate(m[2])) return bad("its date is not a real date");
    if (seen[m[1]]) return bad(`the id ${m[1]} is already used on line ${seen[m[1]]}`);
    seen[m[1]] = n;
    notes.push({ id: m[1], date: m[2], section, text: m[3], replaces: m[4] || null, line: n, raw: l });
  });
  const gone = new Set(notes.map((x) => x.replaces).filter(Boolean));
  return { notes, current: notes.filter((x) => !gone.has(x.id)), problems };
}
// A note that says it replaces an id no line has (never written, or removed since): [{ id, replaces, line }].
// Such a link changes nothing and blocks nothing; `cockpit tidy` lists it.
export function danglingNotes(text) {
  const { notes } = parseNotes(text), ids = new Set(notes.map((x) => x.id));
  return notes.filter((x) => x.replaces && !ids.has(x.replaces)).map((x) => ({ id: x.id, replaces: x.replaces, line: x.line }));
}

const skeleton = (key, nl) => (key === "notes" ? [TITLES.notes, "", ...NOTE_SECTIONS.flatMap((s) => ["## " + s, ""])] : [TITLES[key], ""]).join(nl);

// addNote(text, { section, text, date, replaces }) -> { text, id, line }. The new line goes last under its heading.
export function addNote(text, { section, text: body, date, replaces = null }) {
  if (!NOTE_SECTIONS.includes(section)) throw new Error("a note goes under one of: " + NOTE_SECTIONS.join(", "));
  if (!body || /[\r\n]/.test(body) || body.includes("·")) throw new Error("the note's text is empty or was not cleaned");
  if (!realDate(date)) throw new Error("the note needs a real date");
  if (replaces != null && !/^n\d{1,6}$/.test(replaces)) throw new Error("replaces needs a note's id");
  noLinkInText(body, "To replace a note, name it in the replaces field; otherwise reword the ending.");
  const had = parseNotes(text).notes;
  if (replaces != null && !had.some((x) => x.id === replaces)) throw new Error(`there is no note ${replaces} to replace`);
  const nl = nlOf(text);
  const L = linesOf(String(text || "").trim() ? text : skeleton("notes", nl));
  // Past every id a line of the file carries, and never an id some line already says it replaces.
  const id = nextId("n", [L.join("\n")], had.map((x) => x.replaces));
  const line = `- [${id}] ${date}${SEP}${body}` + (replaces ? ` (replaces ${replaces})` : "");
  if (!NOTE_RE.test(line)) throw new Error("the note would not be readable, so it was not written");
  let h = L.findIndex((l) => new RegExp("^##\\s+" + section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i").test(l));
  if (h < 0) { while (L.length && !L[L.length - 1].trim()) L.pop(); L.push("", "## " + section, ""); h = L.length - 2; }
  let end = h + 1;
  while (end < L.length && !/^##?\s/.test(L[end])) end++;
  let at = end;
  while (at > h + 1 && !L[at - 1].trim()) at--; // after the section's last line, before its trailing blanks
  L.splice(at, 0, line);
  if (at === L.length - 1) L.push("");
  return { text: L.join(nl), id, line };
}

// removeNote(text, id) -> { text, removed }. Throws when no well-formed note has that id; nothing else is touched.
export function removeNote(text, id) {
  const hit = parseNotes(text).notes.find((x) => x.id === id);
  if (!hit) throw new Error(`there is no note ${String(id).slice(0, 10)}`);
  const L = linesOf(text);
  L.splice(hit.line - 1, 1);
  return { text: L.join(nlOf(text)), removed: hit.raw };
}

// fit(lines, budget, pointer, keep) -> { lines, shown, more }. As many whole lines as the budget holds, then one
// pointer line saying how many are left out and where to read them. Nothing is cut inside a line.
//   pointer(more) -> string     keep: "first" keeps the first lines, "last" the last ones
export function fit(lines, budget, pointer, keep = "first") {
  const size = (a) => tokens(a.join("\n"));
  if (size(lines) <= budget) return { lines: lines.slice(), shown: lines.length, more: 0 };
  for (let k = lines.length - 1; k >= 0; k--) {
    const kept = keep === "last" ? lines.slice(lines.length - k) : lines.slice(0, k);
    const out = keep === "last" ? [pointer(lines.length - k), ...kept] : [...kept, pointer(lines.length - k)];
    if (size(out) <= budget || k === 0) return { lines: out, shown: k, more: lines.length - k };
  }
  return { lines: [pointer(lines.length)], shown: 0, more: lines.length };
}

// The owner's current notes as the block handed to the agent: verbatim lines under their headings.
//   notesBlock(text, budget) -> { lines, shown, more, total, problems }
export function notesBlock(text, budget = CAPS.notes) {
  const { current, problems } = parseNotes(text);
  const all = [];
  for (const s of NOTE_SECTIONS) { const mine = current.filter((n) => n.section === s); if (mine.length) all.push("## " + s, ...mine.map((n) => n.raw)); }
  const isNote = (l) => l.startsWith("- ");
  let out = fit(all, budget, (more) => `${more} more notes: read ${FILES.notes}`, "first");
  if (out.more) {
    const shown = out.lines.slice(0, -1).filter(isNote).length;
    const kept = out.lines.slice(0, -1);
    while (kept.length && !isNote(kept[kept.length - 1])) kept.pop(); // no heading left with nothing under it
    out = { lines: [...kept, `${current.length - shown} more note${current.length - shown === 1 ? "" : "s"}: read ${FILES.notes}`], shown, more: current.length - shown };
  } else out = { lines: out.lines, shown: current.length, more: 0 };
  return { ...out, total: current.length, problems };
}

// ── Memory lines ──
const SRC = "\\[(event|card) ([\\w.]+)\\]";
const GRAMMAR = {
  decisions: new RegExp(`^- \\[(d\\d{1,6})\\] ${DATE} · ${SRC} · (.+?)(?: \\(replaces (d\\d{1,6})\\))?$`),
  questions: new RegExp(`^- \\[(q\\d{1,12})\\] ${DATE} · \\[event (\\d{1,12})\\] · (\\d+\\.\\d+):([a-z0-9][a-z0-9-]{0,39}) · (open|answered ${DATE} \\[event (\\d{1,12})\\]) · (.+)$`),
  state: new RegExp(`^- ${DATE} · ${SRC} · (.+)$`),
};
export const GRAMMAR_TEXT = Object.freeze({
  notes: "- [n<number>] <YYYY-MM-DD> · <text>[ (replaces n<number>)]",
  decisions: "- [d<number>] <YYYY-MM-DD> · [event <N>|card <ID>] · <text>[ (replaces d<number>)]",
  questions: "- [q<N>] <YYYY-MM-DD> · [event <N>] · <card>:<topic> · open|answered <YYYY-MM-DD> [event <M>] · <question>[ · Answer: <answer>]",
  state: "- <YYYY-MM-DD> · [event <N>|card <ID>] · <text>",
});
const sourceOf = (kind, ref) => (kind === "event" ? (/^\d{1,12}$/.test(ref) ? { kind, ref: Number(ref) } : null) : /^\d+\.\d+$/.test(ref) ? { kind, ref } : null);

// parseMemory(kind, text) -> { items, problems }   kind: decisions | questions | state (archive reads as decisions)
export function parseMemory(kind, text) {
  const re = GRAMMAR[kind];
  if (!re) throw new Error("no memory file of kind " + kind);
  const items = [], problems = [], seen = Object.create(null);
  linesOf(text).forEach((raw, i) => {
    const l = raw.replace(/\s+$/, ""), n = i + 1;
    if (skip(l)) return;
    const bad = (why) => problems.push({ line: n, text: clipped(l), why });
    const m = l.match(re);
    if (!m) return bad("not written as: " + GRAMMAR_TEXT[kind]);
    if (!realDate(m[kind === "state" ? 1 : 2])) return bad("its date is not a real date");
    let it;
    if (kind === "decisions") {
      const source = sourceOf(m[3], m[4]);
      if (!source) return bad("its source is not [event <number>] or [card <id>]");
      it = { id: m[1], date: m[2], source, text: m[5], replaces: m[6] || null };
    } else if (kind === "questions") {
      const answered = m[6] !== "open";
      const [question, ...rest] = m[9].split(SEP + "Answer: ");
      if (answered && (!realDate(m[7]) || !rest.length)) return bad("an answered question needs its date and its answer");
      it = { id: m[1], date: m[2], source: { kind: "event", ref: Number(m[3]) }, card: m[4], topic: m[5], key: m[4] + ":" + m[5], answered,
        answeredOn: answered ? m[7] : null, answerEvent: answered ? Number(m[8]) : null, text: question, answer: answered ? rest.join(SEP + "Answer: ") : null };
    } else {
      const source = sourceOf(m[2], m[3]);
      if (!source) return bad("its source is not [event <number>] or [card <id>]");
      it = { id: null, date: m[1], source, text: m[4] };
    }
    if (it.id) { if (seen[it.id]) return bad(`the id ${it.id} is already used on line ${seen[it.id]}`); seen[it.id] = n; }
    items.push({ ...it, line: n, raw: l });
  });
  return { items, problems };
}
// The decisions no later decision replaces.
export const inForce = (items) => { const gone = new Set(items.map((x) => x.replaces).filter(Boolean)); return items.filter((x) => !gone.has(x.id)); };
// Links to an id that is in neither the file nor the archive: [{ id, replaces, line }]. They change nothing.
export function danglingLinks(items, archived = []) {
  const known = new Set(items.concat(archived).map((x) => x.id));
  return items.filter((x) => x.replaces && !known.has(x.replaces)).map((x) => ({ id: x.id, replaces: x.replaces, line: x.line }));
}

const append = (key, text, line) => {
  const nl = nlOf(text);
  const L = linesOf(String(text || "").trim() ? text : skeleton(key, nl));
  while (L.length && !L[L.length - 1].trim()) L.pop();
  L.push(line, "");
  return L.join(nl);
};
const cleanBody = (s, what) => { if (!s || /[\r\n]/.test(s) || s.includes("·")) throw new Error(`the ${what} is empty or was not cleaned`); return s; };
const tag = (source) => {
  const s = source && sourceOf(source.kind, String(source.ref));
  if (!s) throw new Error("a memory line needs its source: an event number or a card id");
  return `[${s.kind} ${s.ref}]`;
};

// addDecision(text, { text, source: { kind, ref }, date, replaces, archive }) -> { text, id, line }
// `archive` is the archive file's text: its ids are never given out again.
export function addDecision(text, { text: body, source, date, replaces = null, archive = "" }) {
  if (!realDate(date)) throw new Error("the decision needs a real date");
  const { items } = parseMemory("decisions", text);
  if (replaces != null && (typeof replaces !== "string" || !items.some((x) => x.id === replaces))) throw new Error(`there is no decision ${String(replaces).slice(0, 10)} to replace`);
  noLinkInText(body, "To replace a decision, use --replaces d<number>; otherwise reword the ending.");
  const id = nextId("d", [text, archive], items.map((x) => x.replaces).concat(parseMemory("decisions", archive).items.map((x) => x.replaces)));
  const line = `- [${id}] ${date}${SEP}${tag(source)}${SEP}${cleanBody(body, "decision")}` + (replaces ? ` (replaces ${replaces})` : "");
  if (!GRAMMAR.decisions.test(line)) throw new Error("the decision would not be readable, so it was not written");
  return { text: append("decisions", text, line), id, line };
}

// addState(text, { text, source, date }) -> { text, line, tokens }. Throws when the file would pass its cap.
export function addState(text, { text: body, source, date }) {
  if (!realDate(date)) throw new Error("the note needs a real date");
  const line = `- ${date}${SEP}${tag(source)}${SEP}${cleanBody(body, "note")}`;
  if (!GRAMMAR.state.test(line)) throw new Error("the note would not be readable, so it was not written");
  const out = append("state", text, line), size = tokens(out);
  if (size > CAPS.state) {
    const e = new Error(`${FILES.state} would be about ${size} tokens (estimated as characters divided by 4); the cap is ${CAPS.state}. Nothing was written. ` +
      `Tidy first: open ${FILES.state}, delete the lines that no longer matter (a finished card's notes, things already tried), then write again.`);
    e.code = "CAP"; throw e;
  }
  return { text: out, line, tokens: size };
}

// A question's key is <card>:<topic>. The topic is given (--topic: "this is the same matter", in any words), or it
// is a hash of the whole question, so only the same question repeats: two questions that begin alike, or that
// are written with no ASCII letter at all, never share a key.
export const sameQuestion = (q) => String(q == null ? "" : q).normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
export function topicOf(given, question) {
  const t = String(given == null || given === true ? "" : given).trim().toLowerCase();
  if (t) { if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(t)) throw new Error("--topic is a short key: lower-case letters, digits and hyphens, 40 at most (for example: tax)"); return t; }
  return "q-" + crypto.createHash("sha256").update(sameQuestion(question), "utf8").digest("hex").slice(0, 16);
}
// The topic the same question got before 2026-10-06 (its first words, ASCII letters only). Read only to recognise
// a question that was asked under the old rule; nothing new is written with it.
export const oldTopicOf = (question) => String(question).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "question";
const qLine = (q) => `- [${q.id}] ${q.date}${SEP}[event ${q.event}]${SEP}${q.key}${SEP}` +
  (q.answered ? `answered ${q.answeredOn} [event ${q.answerEvent}]${SEP}${q.text}${SEP}Answer: ${q.answer}` : `open${SEP}${q.text}`);

// addQuestion(text, { qid, event, date, key, text }) -> text with one more open line (or the same text when qid is there)
export function addQuestion(text, q) {
  if (parseMemory("questions", text).items.some((x) => x.id === q.qid)) return String(text);
  const line = qLine({ id: q.qid, date: q.date, event: q.event, key: q.key, answered: false, text: cleanBody(q.text, "question") });
  if (!GRAMMAR.questions.test(line)) throw new Error("the question would not be readable, so it was not written");
  return append("questions", text, line);
}
// answerQuestion(text, { qid, date, event, answer, asked }) -> text with that question's line rewritten as answered.
// `asked` ({ event, date, key, text }) is used when the file has no line for it yet (a question older than the file).
export function answerQuestion(text, { qid, date, event, answer, asked = null }) {
  const { items } = parseMemory("questions", text);
  const hit = items.find((x) => x.id === qid);
  const base = hit ? { id: hit.id, date: hit.date, event: hit.source.ref, key: hit.key, text: hit.text } : asked ? { id: qid, date: asked.date, event: asked.event, key: asked.key, text: asked.text } : null;
  if (!base) throw new Error(`question ${String(qid).slice(0, 14)} is not in the questions file`);
  if (hit && hit.answered) return String(text); // the first answer stands
  const line = qLine({ ...base, answered: true, answeredOn: date, answerEvent: event, answer: cleanBody(answer, "answer") });
  if (!GRAMMAR.questions.test(line)) throw new Error("the answer would not be readable, so it was not written");
  if (!hit) return append("questions", text, line);
  const L = linesOf(text); L[hit.line - 1] = line;
  return L.join(nlOf(text));
}

// tidyMemory({ decisions, questions, archive }, today, days) -> { decisions, questions, archive, did: [sentences] }
// Replaced decisions older than `days` move to the archive; answered questions older than `days` are dropped.
export function tidyMemory({ decisions = "", questions = "", archive = "" }, today, days = 30) {
  if (!realDate(today)) throw new Error("tidy needs today's date");
  const old = (d) => Date.parse(today + "T00:00:00Z") - Date.parse(d + "T00:00:00Z") > days * 86400000;
  const did = [];
  const D = parseMemory("decisions", decisions).items, replaced = new Set(D.map((x) => x.replaces).filter(Boolean));
  const move = D.filter((x) => replaced.has(x.id) && old(x.date));
  if (move.length) {
    const L = linesOf(decisions), drop = new Set(move.map((x) => x.line - 1));
    decisions = L.filter((_, i) => !drop.has(i)).join(nlOf(decisions));
    for (const x of move) archive = append("archive", archive, x.raw);
    did.push(`Moved ${move.length} replaced decision${move.length === 1 ? "" : "s"} older than ${days} days to ${FILES.archive}: ${move.map((x) => x.id).join(", ")}.`);
  }
  const Q = parseMemory("questions", questions).items;
  const gone = Q.filter((x) => x.answered && old(x.answeredOn));
  if (gone.length) {
    const L = linesOf(questions), drop = new Set(gone.map((x) => x.line - 1));
    questions = L.filter((_, i) => !drop.has(i)).join(nlOf(questions));
    did.push(`Dropped ${gone.length} question${gone.length === 1 ? "" : "s"} answered more than ${days} days ago: ${gone.map((x) => x.id).join(", ")}.`);
  }
  return { decisions, questions, archive, did };
}
// overCaps({ notes, decisions, questions, state }) -> [{ key, file, tokens, cap }] the files past their cap
export const overCaps = (texts) => Object.keys(CAPS).map((key) => ({ key, file: FILES[key], tokens: tokens(texts[key] || ""), cap: CAPS[key] })).filter((x) => x.tokens > x.cap);
