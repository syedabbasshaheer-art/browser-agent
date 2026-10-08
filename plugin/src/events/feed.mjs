// feed.mjs (src/events) - the live rail's content: the event log, read back as plain sentences.
//
//   buildFeed({ file, limit }) -> { updatedAt, now, entries }
//     now      the latest thing Claude said (claude.said), else the latest event, as { text, card?, at, kind }
//     entries  the newest `limit` events, newest first: { offset, at, kind, who, card?, text }
//              who   the tag a reader sees: "Agent" (the agent said or did it), "You" (the owner asked or
//                    approved), "Board" (the system recorded a change). kind stays as the machine key.
//              say   only on lines the agent writes: milestone, problem, result, question, turn-end, session,
//                    pulse, auto. It decides how the page draws the line (docs/16-live-feed-contract.md).
//   entryOf(event, { answers }) -> one entry; `answers` (from answersOf) marks a question answered
//   answersOf(events) / questionsOf(events) / openQuestionCards(events) / lastChanges(events)
//
// How a line is made: nothing is copied from anywhere. Each event in the log has a type; the table SAY
// below holds one sentence per type and fills in the card and the states. Only "claude.said" carries
// free text, and that text is what the agent wrote with `cockpit say`.
//
// The page embeds one at build time and the agent writes a fresh one to live/feed with every batch.
// The feed is shown to every viewer, so what a person typed (prompt.received) never goes in: only
// that a message arrived.

import * as events from "./events.mjs";

export const FEED_SIZE = 60;
// The same names the board uses for its columns.
const STATE = { BACKLOG: "Backlog", DOING: "Ready", ACTIVE: "Ready", START: "In progress", BLOCKED: "Blocked", DONE: "Done" };
const st = (s) => STATE[s] || String(s || "?");
// The record's state words: what a line's `move` may hold, and nothing else.
const RECORD_STATES = ["BACKLOG", "DOING", "START", "BLOCKED", "DONE"];
const clip = (s, n = 280) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const cardOf = (e) => e.card || e.id || null; // older card.moved events carried the id as `id`

function asked(e) {
  const c = e.card ? " card " + e.card : "";
  switch (e.verb) {
    case "card.move": return `You asked to move${c || " a card"}` + (e.to ? ` to ${st(e.to)}` : "") + ".";
    case "task.start": return `You asked the agent to start${c || " a card"}.`;
    case "card.note": return `You added a note to${c || " a card"}.`;
    case "card.add": return "You asked for a new card.";
    case "card.edit": return `You asked to edit${c || " a card"}.`;
    case "gate.approve": return `You approved${c || " a card"}.`;
    case "plan.accept": return "You accepted the plan.";
    case "question.answer": return `You answered a question on${c || " a card"}.`;
    case "auto.set": return "You used the switch for automatic work.";
    case "message.send": return "You sent the agent a message.";
    case "notes.add": return "You asked to add a note for the agent.";
    case "notes.remove": return "You asked to remove a note for the agent.";
    default: return `You asked for ${clip(e.verb || "an action", 40)}${c}`;
  }
}

// One entry per event type: [kind, sentence, who]. Unknown types still show, by their name.
const A = "Agent", Y = "You", B = "Board";
const SAY = {
  "claude.said": (e) => ["said", clip(e.text), A],
  "claude.asked": (e) => ["question", clip(e.text), A],
  "question.answered": (e) => ["answered", "You answered: " + clip(e.text, 240), Y],
  "session.started": () => ["session", "An agent session started.", A],
  "claude.reply": (e) => ["reply", String(e.text == null ? "" : e.text), A],   // the agent's own words, line breaks kept
  "turn.ended": (e) => ["turn-end", clip(e.text), A],
  "claude.answered": (e) => ["answer", String(e.text == null ? "" : e.text), A],   // the agent's answer to one message of the owner's, whole
  "claude.auto": (e) => ["auto", clip(e.text), A],
  "claude.pulse": (e) => ["pulse", clip(e.text), A],
  "prompt.received": () => ["message", "You sent a message", Y],
  "action.received": (e) => ["asked", asked(e), Y],
  "agent.stopped": (e) => ["problem", "The agent stopped while " + (Array.isArray(e.cards) && e.cards.length > 1 ? "cards " + e.cards.slice(0, 4).join(", ") + " were" : "card " + clip((e.cards || [])[0] || "", 14) + " was") + " still in progress. Nothing is happening on " + (Array.isArray(e.cards) && e.cards.length > 1 ? "them" : "it") + " until the agent's next turn.", B],
  "owner.message": (e) => ["message", String(e.text == null ? "" : e.text), Y],   // the owner's own words, whole
  "action.accepted": (e) => { const r = clip(String(e.result || "").replace(/^Accepted\.?\s*/i, ""), 240); return ["accepted", r ? "Request accepted: " + r : "Request accepted.", B]; },
  "action.done": (e) => ["done", "Request carried out: " + clip(e.result, 240), B],
  "action.awaiting": (e) => ["waiting", "Waiting for you to confirm: " + clip(e.result, 200), B],
  "action.refused": (e) => ["refused", "Request refused: " + clip(e.result || e.reason, 240), B],
  "card.moved": (e) => ["moved", `Card ${cardOf(e)} moved from ${st(e.from)} to ${st(e.to)}.`, B],
  "card.added": (e) => ["added", `Card ${cardOf(e)} was added` + (e.text ? ": " + clip(e.text, 160) : "."), B],
  "card.noted": (e) => ["note", `A note was added to card ${cardOf(e)}.`, B],
  "card.edited": (e) => ["edited", `The text of card ${cardOf(e)} was edited.`, B],
  "gate.approved": (e) => ["approved", `Card ${cardOf(e)} was approved by the owner.`, B],
  "note.added": (e) => ["note", "Note: " + clip(e.text, 260), A],
  "mirror.diffed": (e) => { const n = (e.added || 0) + (e.changed || 0) + (e.removed || 0);
    return ["mirror", `The board page's data was updated to match the plan file: ${n} item${n === 1 ? "" : "s"} changed.`, B]; },
  "board.published": () => ["published", "A new version of the board page was published.", B],
  "plan.accepted": () => ["accepted", "The plan was accepted. Cards can now start.", B],
  "auto.paused": () => ["paused", "You paused automatic work.", Y],
  "auto.resumed": () => ["resumed", "You switched automatic work back on.", Y],
  // The feed is shown to every viewer; a note is the owner's instruction to the agent. Only that it changed is said.
  "notes.added": (e) => ["notes", `You added a note for the agent${e.id ? " (" + clip(e.id, 8) + ")" : ""}.`, Y],
  "notes.removed": (e) => ["notes", `You removed a note for the agent${e.id ? " (" + clip(e.id, 8) + ")" : ""}.`, Y],
};
// Bookkeeping events: in the log, never a line on the board. buildFeed and `cockpit push` both leave them out.
// A heartbeat that ran or was skipped is bookkeeping too: what came of it (a line, a start) is the news.
export const SILENT = Object.freeze(["pack.built", "pack.failed", "heartbeat.ran", "heartbeat.skipped", "heartbeat.done", "timer.woke"]);
export const isLine = (e) => !!e && !SILENT.includes(e.type);

// The kinds of line the agent chooses between with `say --kind`. Every other `say` value follows from the event type.
export const SAY_KINDS = ["milestone", "problem", "result", "queued"];   // queued: in progress by the owner's word, waiting its turn
const SAY_OF = { "claude.reply": "reply", "claude.asked": "question", "turn.ended": "turn-end", "session.started": "session", "claude.pulse": "pulse", "claude.auto": "auto", "agent.stopped": "problem" };
export const qidOf = (e) => "q" + e.offset; // a question's id is its own event number: unique, and nothing to store

// qid -> { text, at } for every answered question. The first answer stands; a later one never replaces it.
export function answersOf(all) {
  const out = Object.create(null);
  for (const e of all) if (e.type === "question.answered" && typeof e.qid === "string" && !out[e.qid]) out[e.qid] = { text: clip(e.text, 280), at: e.at };
  return out;
}
// qid -> { card, answered } for every question asked: what the gateway checks an answer against.
export function questionsOf(all) {
  const ans = answersOf(all), out = Object.create(null);
  for (const e of all) if (e.type === "claude.asked") out[qidOf(e)] = { card: typeof e.card === "string" ? e.card : null, answered: !!ans[qidOf(e)] };
  return out;
}
// The card ids with a question nobody answered yet: what boardViews takes as `openQuestions`.
export function openQuestionCards(all) {
  const q = questionsOf(all);
  return [...new Set(Object.values(q).filter((x) => !x.answered && x.card).map((x) => x.card))];
}
// card id -> the offset of the last event that changed that card's state. A request built before it is stale.
export function lastChanges(all) {
  const out = Object.create(null);
  for (const e of all) if (e.type === "card.moved") { const c = cardOf(e); if (typeof c === "string" && Number.isInteger(e.offset)) out[c] = e.offset; }
  return out;
}

export function entryOf(e, { answers = null } = {}) {
  const f = SAY[e.type];
  const [kind, text, who] = f ? f(e) : [e.type.split(".")[0], e.type.replace(".", " "), B];
  const out = { offset: e.offset, at: e.at, kind, who, text };
  const c = cardOf(e);
  if (c && typeof c === "string") out.card = c;
  if (Number.isInteger(e.step) && Number.isInteger(e.of) && e.of > 0 && e.step >= 0 && e.step <= e.of) { out.step = e.step; out.of = e.of; }
  if (e.type === "claude.said") out.say = SAY_KINDS.includes(e.say) ? e.say : "milestone";
  // up to two replies the agent offered with a result: text the owner may send with one press
  if (e.type === "claude.said" && out.say === "result" && out.card && Array.isArray(e.replies)) {
    const r = e.replies.filter((x) => typeof x === "string" && x.trim()).slice(0, 2).map((x) => clip(x, 60));
    if (r.length) out.replies = r;
  }
  else if (SAY_OF[e.type]) out.say = SAY_OF[e.type];
  if (e.type === "claude.asked") {
    const a = answers && answers[qidOf(e)];
    out.question = { qid: qidOf(e), choices: (Array.isArray(e.choices) ? e.choices : []).filter((c) => typeof c === "string" && c).slice(0, 6).map((c) => clip(c, 40)),
      answer: a ? a.text : null, answeredAt: a ? a.at : null };
  }
  // The answer names its question, so the page can mark a question whose own document was sent before the answer.
  if (e.type === "question.answered" && typeof e.qid === "string") out.answer = { qid: clip(e.qid, 14), text: clip(e.text, 280) };
  // A line that reports a state change carries the change as data, in the record's own state words, so an open
  // page can move the card from the line alone, before any mirror document arrives. An undo says it is one.
  if (e.type === "card.moved" || e.type === "claude.auto") {
    const m = e.type === "claude.auto" ? (e.move && typeof e.move === "object" ? e.move : null) : e;
    if (m && RECORD_STATES.includes(m.from) && RECORD_STATES.includes(m.to)) out.move = { from: m.from, to: m.to };
    if (e.type === "card.moved" && e.undo === true) out.undo = true;
  }
  if (typeof e.action === "string" && e.action) out.re = clip(e.action, 60);   // the request this line is about
  if (e.type === "action.received" && e.verb === "message.send") out.msg = true;
  if (e.type === "owner.message" || e.type === "claude.answered") { out.msg = true; if (e.origin === "card" || e.origin === "board") out.origin = e.origin; }
  if (e.type === "turn.ended" && e.next) out.next = clip(e.next);
  if (e.type === "claude.reply" && e.final === true) out.final = true;   // the reply that ended a turn
  if (e.type === "claude.auto") {
    const u = e.undo && typeof e.undo === "object" ? e.undo : null;
    out.auto = { rule: clip(e.rule, 40), ...(u ? { undo: { verb: clip(u.verb, 24), card: clip(u.card, 12), to: clip(u.to, 12) } } : {}) };
  }
  return out;
}

export function buildFeed({ file = events.EVENTS, limit = FEED_SIZE } = {}) {
  const all = events.read({}, file).filter(isLine);
  const ctx = { answers: answersOf(all) };
  const entries = all.slice(-limit).reverse().map((e) => entryOf(e, ctx));
  let now = null;
  for (let i = all.length - 1; i >= 0; i--) if (all[i].type === "claude.said") { now = all[i]; break; }
  const n = now ? entryOf(now) : entries[0] || null;
  // The latest thing the agent said about each card, with its step when it gave one: what a card shows while in progress.
  const progress = {};
  for (const e of all) if (e.type === "claude.said" && typeof e.card === "string") { const x = entryOf(e); progress[e.card] = { text: x.text, at: x.at, ...(x.of ? { step: x.step, of: x.of } : {}) }; }
  return {
    updatedAt: new Date().toISOString(),
    progress,
    now: n ? { text: n.text, at: n.at, kind: n.kind, who: n.who, ...(n.card ? { card: n.card } : {}), ...(n.of ? { step: n.step, of: n.of } : {}) } : null,
    entries,
  };
}
