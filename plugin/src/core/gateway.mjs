// gateway.mjs - the one door every browser action passes through. Pure: no files, no network.
//
// An action is DATA written by a viewer: { verb, card?, to?, title?, text?, goal?, owner?, deps? }.
// The gateway never follows free text. It checks the verb against a fixed vocabulary, the
// arguments against that verb's schema, the viewer's level against the verb's minimum, and
// the verb's risk, then returns a decision:
//
//   { ok: false, reason }                              refused, with a reason a person can read
//   { ok: true, verb, risk, mode: "apply", args }      safe to apply to the record mechanically
//   { ok: true, verb, risk, mode: "work", args }       valid, but needs the agent to do real work
//   { ok: true, verb, risk, mode: "confirm", args }    valid, high risk: waits for a second yes
//
// LEVEL comes from WHERE the action was written, never from the action's own fields: the page
// database's rules decide who may write `actions/` (Contributor, "interact") and `approvals/`
// (the owner). The caller passes that level in.

export const LEVELS = ["view", "interact", "admin", "owner"];
const atLeast = (have, need) => LEVELS.indexOf(have) >= LEVELS.indexOf(need);

export const STATES = ["BACKLOG", "DOING", "START", "DONE", "BLOCKED"];

// Rule 1, START: a card starts only when every dependency is done, and only an agent card can
// be handed to Claude. Starting is work: the card moves to START and Claude executes it.
// Rule 2, DONE: nobody closes a card, the owner included, until it is CONFIRMED ("• Verified:"
// in its text). A move to DONE on an unconfirmed card becomes work: Claude checks the done-when,
// writes the evidence and closes it, or says why not. The card stays where it was meanwhile.
// What a request field may be when text is wanted: a string, or a finite number. Anything else (an object, a
// list, a boolean, nothing) reads as empty. String(x) is never called on a value a viewer chose: an object
// with its own toString would run there, or throw.
export const str = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
// Control characters, every kind of line break, and the marks that reorder text on screen. The letters and
// punctuation of every script are kept.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
// Cut to n UTF-16 units, never between the two halves of one character.
const cutTo = (t, n) => { if (t.length <= n) return t; const c = t.charCodeAt(n - 1); return t.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n); };
// safe(value, max) -> one short plain line. Everything that came from a request passes through here before it
// is printed, logged or put in a result, so it can never look like a heading, an instruction or a second line.
export function safe(v, n = 40) {
  return cutTo(str(v).slice(0, Math.max(n * 8, 400)).replace(CONTROL, " ").replace(/\s+/g, " ").trim(), n).trim();
}

const openDeps = (c, byId) => (c.deps === "-" || !c.deps ? [] : c.deps.split(",").map((s) => s.trim()).filter(Boolean))
  .filter((d) => byId[d] && byId[d].st !== "DONE");
// Evidence is a pointer the worker wrote. Anything that came from the browser carries that stamp and never counts.
const FROM_BROWSER = /\(from [^)]*browser|Added by a contributor/i;
const verified = (c) => (c.pts || []).some((p) => /^Verified\s*:/i.test(String(p)) && !FROM_BROWSER.test(String(p)));
// A card a contributor added is their words: only the owner may hand it to Claude.
// Its title and description are then not the owner's words, so it never starts automatically. Editing a card is
// the owner's alone, so "added by a contributor" is the whole case; an edit mark is read too, should a record carry one.
export const contributed = (c) => (c.pts || []).some((p) => /^(?:Note: )?(?:Added|Edited) by a contributor\b/i.test(String(p)));
// Everything a contributor may ask for: a note, a new card, and the start of a ready agent card that needs no
// approval, while automatic work is not paused and no agent card is in progress. Anything else is refused.
export const CONTRIBUTOR_MAY = "A contributor can add a note, add a card, or ask to start a ready agent card.";
function startable(c, byId, level, auto) {
  const owner = atLeast(level, "owner");
  if (contributed(c) && !owner) return `${c.id} was added by a contributor: only the owner can hand it to Claude.`;
  if (c.own !== "agent") return `${c.id} is a card for you, not for Claude. Move it to In progress, and to Done once it is confirmed.`;
  if (c.st === "DONE") return `${c.id} is already done.`;
  const w = openDeps(c, byId);
  if (w.length) return `${c.id} is waiting on ${w.join(", ")}. It can start once ${w.length > 1 ? "they are" : "that is"} done.`;
  // A gate is the owner's yes. The owner starting the card gives it; nobody else can.
  if (gated(c) && !owner) return `${c.id} needs the owner's ${c.gate} before it can start.`;
  if (owner) return null;
  // The rest binds everyone but the owner. A card leaves Start, Done or Blocked only by the owner's hand.
  if (c.st !== "BACKLOG" && c.st !== "DOING") return `${c.id} is ${c.st}: only the owner moves a card out of Start, Done or Blocked.`;
  // Pause and one-at-a-time hold for a contributor's start as they do for an automatic one. Settings the
  // caller did not give, or that are not exactly "paused: false", read as paused.
  if (!auto || typeof auto !== "object" || auto.paused !== false) return "Automatic work is paused by the owner, so only the owner can start a card now.";
  const running = Object.values(byId).find((x) => x.st === "START" && x.own === "agent");
  if (running) return `${running.id} is already in progress. A contributor's start waits until no agent card is in progress; the owner is not limited by this.`;
  return null;
}
export const gated = (c) => !!c && !!c.gate && c.gate !== "-";
export const MAX_TEXT = 280;
export const MESSAGE_MAX = 600;   // characters of one message from the owner

// The vocabulary. mode: apply = the record changes mechanically; work = the agent must act;
// confirm = high risk, applied only when the action carries `confirmed: true` from `approvals/`.
export const VERBS = {
  "card.move":    { level: "interact", risk: "low",    mode: "apply",   args: ["card", "to"] },
  "card.note":    { level: "interact", risk: "low",    mode: "apply",   args: ["card", "text"] },
  // Editing a card rewrites what the agent will be handed, so it is the owner's alone.
  "card.edit":    { level: "owner",    risk: "low",    mode: "apply",   args: ["card"], optional: ["title", "text"] },
  "card.add":     { level: "interact", risk: "low",    mode: "apply",   args: ["goal", "title", "owner"], optional: ["text", "deps"] },
  "gate.approve": { level: "owner",    risk: "medium", mode: "apply",   args: ["card"] },
  "task.start":   { level: "interact", risk: "medium", mode: "work",    args: ["card"] },
  "plan.accept":  { level: "owner",    risk: "medium", mode: "work",    args: [] },
  "release.push": { level: "owner",    risk: "high",   mode: "confirm", args: [] },
  // The owner's answer to a question the agent asked on the board. Stored as a note and shown; never obeyed.
  "question.answer": { level: "owner", risk: "low",    mode: "apply",   args: ["card", "qid", "text"] },
  // The owner's switch for automatic work. It writes auto.paused and nothing else in the settings.
  "auto.set":     { level: "owner",    risk: "low",    mode: "apply",   args: ["paused"] },
  // The owner's notes for the agent (.cockpit/NOTES.md): the one place owner text is an instruction.
  "notes.add":    { level: "owner",    risk: "low",    mode: "apply",   args: ["section", "text"], optional: ["replaces"] },
  "notes.remove": { level: "owner",    risk: "low",    mode: "apply",   args: ["id"] },
  // The owner's own words to the agent, typed on the board. Only the owner's inbox carries it (the database lets
  // nobody else write there). It changes nothing by itself: it is handed to the agent, which acts on it as on a
  // message typed in the terminal, and it is never a card's text, so a contributor cannot plant one.
  "message.send": { level: "owner",    risk: "medium", mode: "work",    args: ["text"], optional: ["card"] },   // card: the card the message was typed on
};

// The three headings of the owner's notes file, in the order the file keeps them.
export const NOTE_SECTIONS = Object.freeze(["Preferences", "Standing orders", "May be done without asking"]);
// Every setting under "auto". Only `paused` can be changed by a verb, and only by the owner.
export const AUTO_SETTABLE = Object.freeze(["paused"]);
const AUTO_KEYS = ["auto", "start", "inARow", "perDay", "pauseOnQuestion", "quietMin", "pulseGapMin", "pulsePerHour", "heartbeat"];

// What the agent may do by itself is one act: start the next ready agent card that needs no approval.
// Everything below is NEVER automatic, whatever the settings say. The list is fixed here; decideAuto refuses
// each one by name, apply.mjs refuses to write any of them for an automatic decision, and
// test/auto.test.mjs proves that `cockpit next --start` cannot reach them.
export const NEVER_AUTOMATIC = Object.freeze([
  Object.freeze({ key: "gate.approve", what: "approving a gate" }),
  Object.freeze({ key: "plan.accept", what: "accepting the plan" }),
  Object.freeze({ key: "card.done", what: "marking a card Done" }),
  Object.freeze({ key: "start.human", what: "starting a card owned by the human" }),
  Object.freeze({ key: "start.contributed", what: "starting a card a contributor added" }),
  Object.freeze({ key: "card.edit", what: "editing a card" }),
  Object.freeze({ key: "card.delete", what: "deleting a card" }),
  Object.freeze({ key: "auto.change", what: "changing the automatic-work settings" }),
]);
const never = (key) => ({ ok: false, never: key, reason: "Never automatic: " + NEVER_AUTOMATIC.find((n) => n.key === key).what + "." });

// decideAuto - the door for the one automatic act. It takes the action the agent's own rule proposed
// (src/core/auto.mjs) and checks every rule again from the raw facts, sharing no code with that rule:
//   ctx: { cards, plan, auto, entries, now, score? }
//     entries  the whole event log; now  milliseconds, a Date or an ISO time
//     score    the engine's priority (function(card) -> number). When given, only the top card is accepted.
// The answer is a card.move to START with mode "apply" and auto: { n, of }, or a refusal with the reason.
// There is no level here: nobody's access makes an automatic act wider.
export function decideAuto(action, { cards = [], plan = "draft", auto = null, entries = [], now = null, score = null } = {}) {
  const a = action && typeof action === "object" ? action : {};
  const verb = typeof a.verb === "string" ? a.verb : "";
  if (verb === "gate.approve") return never("gate.approve");
  if (verb === "plan.accept") return never("plan.accept");
  if (verb === "card.edit" || verb === "card.note" || verb === "card.add" || verb.startsWith("notes.")) return never("card.edit");
  if (verb === "card.delete" || verb === "card.remove") return never("card.delete");
  if (verb.startsWith("auto.") || verb.startsWith("config.")) return never("auto.change");
  if (verb === "card.done" || (verb === "card.move" && a.to === "DONE")) return never("card.done");
  if (!(verb === "card.move" && a.to === "START")) return { ok: false, reason: "The only automatic act is starting the next ready agent card." };
  if (a.approves != null || a.confirmed != null) return never("gate.approve");

  const S = auto && typeof auto === "object" ? auto : {};
  if (plan !== "accepted") return { ok: false, reason: DRAFT_REASON };
  if (S.start !== true) return { ok: false, reason: "Automatic starts are off." };
  if (S.paused !== false) return { ok: false, reason: "Automatic work is paused by the owner." };
  if (!Number.isInteger(S.inARow) || S.inARow < 1 || !Number.isInteger(S.perDay) || S.perDay < 1) return { ok: false, reason: "The automatic-start limits are not set." };
  const t = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(t)) return { ok: false, reason: "The time is not known, so the daily limit cannot be checked." };

  const list = Array.isArray(cards) ? cards : [];
  const byId = Object.assign(Object.create(null), Object.fromEntries(list.map((c) => [c.id, c])));
  const c = typeof a.card === "string" ? byId[a.card] : null;
  if (!c) return { ok: false, reason: `There is no card ${safe(a.card, 20) || "with that id"}.` };
  const hold = Array.isArray(S.holdGoals) ? S.holdGoals : [];
  if (hold.includes(c.g)) return { ok: false, reason: `Goal ${c.g} is on hold by the owner, so ${c.id} does not start automatically.` };
  if (c.own !== "agent") return never("start.human");
  if (contributed(c)) return never("start.contributed");
  if (gated(c)) return never("gate.approve");
  if (c.st !== "BACKLOG" && c.st !== "DOING") return { ok: false, reason: `${c.id} is ${c.st}: only a ready card starts automatically.` };
  // A dependency that is not in the record is not done either: here an unknown card never counts as finished.
  const waitsOn = (x) => (x.deps === "-" || !x.deps ? [] : String(x.deps).split(",").map((s) => s.trim()).filter(Boolean)).filter((d) => !byId[d] || byId[d].st !== "DONE");
  if (waitsOn(c).length) return { ok: false, reason: `${c.id} is waiting on ${waitsOn(c).join(", ")}.` };

  // The log, read here from scratch.
  const log = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === "object" && Number.isInteger(e.offset));
  const idOf = (e) => (typeof e.card === "string" ? e.card : typeof e.id === "string" ? e.id : "");
  const ownerActed = (e) => e.type === "prompt.received" || (e.type === "action.received" && (e.level === "owner" || (e.level == null && e.inbox === "approvals")));
  const lastOf = (test) => { for (let i = log.length - 1; i >= 0; i--) if (test(log[i])) return log[i].offset; return 0; };
  const lastOwner = lastOf(ownerActed), lastAuto = lastOf((e) => e.type === "claude.auto");
  const autos = log.filter((e) => e.type === "claude.auto");
  const inRow = autos.filter((e) => e.offset > lastOwner).length;
  if (inRow >= S.inARow) return { ok: false, reason: `The limit of ${S.inARow} automatic starts in a row is reached. It waits for the owner.` };
  const day = autos.filter((e) => !(Date.parse(e.at) <= t - 86400000)).length;
  if (day >= S.perDay) return { ok: false, reason: `The limit of ${S.perDay} automatic starts in 24 hours is reached.` };
  for (const x of list) {
    if (x.st !== "START") continue;
    const from = lastOf((e) => e.type === "card.moved" && idOf(e) === x.id && e.to === "START");
    if (!log.some((e) => e.type === "claude.said" && e.say === "result" && e.card === x.id && e.offset > from)) return { ok: false, reason: `${x.id} is in progress and has not posted a result yet.` };
  }
  const floor = Math.max(lastOwner, lastAuto);
  const blocked = log.find((e) => e.type === "card.moved" && e.to === "BLOCKED" && e.offset > floor);
  if (blocked) return { ok: false, reason: `Card ${idOf(blocked)} was blocked after the last automatic start.` };
  const answered = new Set(log.filter((e) => e.type === "question.answered").map((e) => e.qid));
  const waiting = log.filter((e) => e.type === "claude.asked" && !answered.has("q" + e.offset));
  if (S.pauseOnQuestion !== false && waiting.length) return { ok: false, reason: "A question is waiting for the owner's answer." };
  if (waiting.some((e) => e.card === c.id)) return { ok: false, reason: `${c.id} has a question waiting for the owner's answer.` };
  if (typeof score === "function") {
    const eligible = (x) => !hold.includes(x.g) && x.own === "agent" && !gated(x) && !contributed(x) && (x.st === "BACKLOG" || x.st === "DOING") && !waitsOn(x).length && !waiting.some((e) => e.card === x.id);
    const better = list.find((x) => x.id !== c.id && eligible(x) && (score(x) > score(c) || (score(x) === score(c) && String(x.id).localeCompare(String(c.id), "en", { numeric: true }) < 0)));
    if (better) return { ok: false, reason: `${better.id} comes before ${c.id}: only the next card by priority starts automatically.` };
  }
  return { ok: true, verb: "card.move", risk: "low", mode: "apply", auto: { n: inRow + 1, of: S.inARow }, args: { card: c.id, to: "START", from: c.st } };
}

// Every request may carry three extras. They are data about the request, never instructions:
//   key     one-use: the orchestrator applies a key once and answers a repeat with the first result
//   basis   the highest event number the page had seen when the button was drawn
//   source  where the click came from (owner-click, proposal, answer)
// Anything of the wrong type or over its length is dropped, not trusted and not repaired.
export const STALE_REASON = "The board changed after this was offered. Look again.";
export function requestMeta(action) {
  const a = action && typeof action === "object" ? action : {}, m = {};
  if (typeof a.key === "string" && /^[\x21-\x7e]{1,120}$/.test(a.key)) m.key = a.key;
  const b = typeof a.basis === "string" && /^\d{1,15}$/.test(a.basis) ? Number(a.basis) : a.basis;
  if (Number.isSafeInteger(b) && b >= 0) m.basis = b;
  if (typeof a.source === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(a.source)) m.source = a.source;
  return m;
}

// Viewer text is stored, never obeyed. It must also never break the record's table.
export function cleanText(s, max = MAX_TEXT) {
  let t = str(s)
    .replace(CONTROL, " ")                       // control characters, newlines, marks that reorder text
    .replace(/\|/g, "/")                         // would split a table cell
    .replace(/\s*[·→•]\s*/g, ", ")               // "•" starts a pointer in a card cell: viewer text never may
    .replace(/\bverified\s*:/gi, "verified,")     // "Verified:" is the evidence label; only the worker writes it
    .replace(/\b(answer\s+to\s+q\d*)\s*:/gi, "$1,") // "Answer to q12:" labels the owner's answer; only the gateway's apply writes it
    .replace(/\*\*/g, "")                        // no smuggled bold titles
    .replace(/\s+/g, " ").trim();
  if (t.length > max) t = cutTo(t, max - 1).trimEnd() + "…";
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// How a memory line says it replaces another. Only the explicit field or option may write it, never a text.
export const REPLACES_TAIL = /\(replaces [a-z]\d+\)\s*$/i;

export const DRAFT_REASON ="The plan is a draft. Accept the plan first; then cards can start.";

// lastChange: { [card]: offset of the last event that changed that card's state }, from the event log.
// questions:  { [qid]: { card, answered } } when the caller knows them; an answer is then checked against it.
// undoable:   { [card]: true } cards whose current Start came from an automatic start and that have posted no
//             result since (undoableAutoStarts in auto.mjs, computed from the log). Only the owner may send
//             such a card back to BACKLOG; every other card in Start stays where it is.
// notes:      the ids in the owner's notes file, when the caller knows them; a removal is then checked against it.
// auto:       the automatic-work settings ({ paused }). A start asked for by anyone but the owner is refused
//             while they say paused, and when they are not given: what is not known reads as paused.
export function decide(action, { cards = [], level = "interact", goals = [], plan = "accepted", lastChange = null, questions = null, undoable = null, notes = null, auto = null } = {}) {
  const a = action && typeof action === "object" && !Array.isArray(action) ? action : {};
  // A verb is text. Anything else is not looked up, so a list holding a verb's name is not that verb.
  const spec = typeof a.verb === "string" && Object.hasOwn(VERBS, a.verb) ? VERBS[a.verb] : null; // "constructor" and friends are not verbs
  if (!spec) return { ok: false, reason: `Unknown action "${safe(a.verb, 40)}". Allowed: ${Object.keys(VERBS).join(", ")}.` };
  if (!atLeast(level, spec.level)) return { ok: false, reason: `${a.verb} needs ${spec.level} access; this came from ${level}.` };
  for (const k of spec.args) if (a[k] == null || a[k] === "") return { ok: false, reason: `${a.verb} is missing "${k}".` };

  const owner = atLeast(level, "owner");
  const byId = Object.assign(Object.create(null), Object.fromEntries(cards.map((c) => [c.id, c])));
  const args = {};
  let mode = null;
  // A draft plan can be read, noted and edited, but no work starts and nothing closes until it is accepted.
  const draft = plan === "draft";
  if (a.verb === "plan.accept" && !draft) return { ok: false, reason: "The plan is already accepted." };
  if (draft && (a.verb === "task.start" || (a.verb === "card.move" && ["START", "DOING", "DONE"].includes(a.to)))) return { ok: false, reason: DRAFT_REASON };
  if ("card" in a && spec.args.concat(spec.optional || []).includes("card")) {
    // A card id is text that names a card in the record. A list or an object that would print as one is not.
    if (typeof a.card !== "string" || !byId[a.card]) return { ok: false, reason: `There is no card ${safe(a.card, 20) || "with that id (a card id is text, like 1.2)"}.` };
    args.card = a.card;
  }
  const meta = requestMeta(a);
  // Built on a state that has since changed: the button the person pressed no longer says what is true.
  if (args.card && meta.basis != null && lastChange && Object.hasOwn(lastChange, args.card)
    && Number.isInteger(lastChange[args.card]) && meta.basis < lastChange[args.card]) return { ok: false, reason: STALE_REASON };
  switch (a.verb) {
    case "card.move": {
      if (typeof a.to !== "string" || !STATES.includes(a.to)) return { ok: false, reason: `Cards move to ${STATES.join(", ")}, not ${safe(a.to, 20) || "that"}.` };
      const c = byId[a.card];
      if (c.st === a.to) return { ok: false, reason: `${a.card} is already ${a.to}.` };
      // DONE means the done-when was observed. From the browser only the owner can ask for it.
      if (a.to === "DONE" && !owner) return { ok: false, reason: `Only the owner can mark a card done from the browser (it attests the done-when was seen).` };
      args.to = a.to; args.from = c.st;
      if (a.to === "START") { const why = startable(c, byId, level, auto); if (why) return { ok: false, reason: why }; mode = "work"; if (gated(c)) args.approves = c.gate; }
      if (a.to === "DONE" && !verified(c)) mode = "work";   // confirm first, then close
      const undo = c.st === "START" && a.to === "BACKLOG" && atLeast(level, "owner") && !!undoable && Object.hasOwn(undoable, a.card) && undoable[a.card] === true;
      if (undo) args.undo = true;
      if (c.st === "START" && a.to !== "DONE" && a.to !== "BLOCKED" && !undo) return { ok: false, reason: `${a.card} is being executed. It leaves Start only when it is confirmed done, or blocked.` };
      // The one move a contributor may ask for is a start. Every other move is the owner's: out of Start, Done
      // or Blocked, into Blocked, and between Backlog and Ready.
      if (!owner && a.to !== "START") return { ok: false, reason: `Only the owner moves a card to ${a.to} from the browser. ${CONTRIBUTOR_MAY}` };
      break;
    }
    case "task.start": {
      if (byId[a.card].st === "START") return { ok: false, reason: `${a.card} is already started.` };
      const why = startable(byId[a.card], byId, level, auto); if (why) return { ok: false, reason: why };
      args.to = "START"; args.from = byId[a.card].st;
      if (gated(byId[a.card])) args.approves = byId[a.card].gate;
      break;
    }
    case "card.note": args.text = cleanText(a.text); if (!args.text) return { ok: false, reason: "The note is empty." }; break;
    case "card.edit":
      if (a.title != null) args.title = cleanText(a.title, 80).replace(/[.]$/, "");
      if (a.text != null) args.text = cleanText(a.text);
      if (!args.title && !args.text) return { ok: false, reason: "card.edit needs a title or text." };
      break;
    case "card.add": {
      const g = typeof a.goal === "number" ? a.goal : typeof a.goal === "string" && /^\s*\d{1,6}\s*$/.test(a.goal) ? Number(a.goal) : NaN;
      if (!Number.isInteger(g) || (goals.length && !goals.some((x) => x.n === g))) return { ok: false, reason: `There is no goal ${safe(a.goal, 10) || "with that number"}.` };
      if (!["human", "agent"].includes(a.owner)) return { ok: false, reason: `Owner must be human or agent.` };
      args.goal = g; args.owner = a.owner; args.title = cleanText(a.title, 80).replace(/[.]$/, "");
      if (!args.title) return { ok: false, reason: "The new card needs a title." };
      if (args.title.split(/\s+/).length > 10) return { ok: false, reason: "Keep the title to ten words or fewer." };
      args.text = a.text ? cleanText(a.text) : "";
      // Dependencies are card ids: text, each naming a card. Of a wrong one only a short cleaned excerpt is echoed.
      if (a.deps != null && !Array.isArray(a.deps) && typeof a.deps !== "string") return { ok: false, reason: "Dependencies are a list of card ids, like 1.1, 1.2." };
      const deps = (Array.isArray(a.deps) ? a.deps : a.deps ? a.deps.split(/[,\s]+/) : []).filter((d) => d !== "" && d != null);
      const bad = deps.filter((d) => typeof d !== "string" || !byId[d]);
      if (bad.length) return { ok: false, reason: `Unknown dependencies: ${bad.slice(0, 5).map((d) => safe(d, 12) || "(not text)").join(", ")}.` };
      args.deps = deps;
      break;
    }
    case "question.answer": {
      if (typeof a.qid !== "string" || !/^q\d{1,12}$/.test(a.qid)) return { ok: false, reason: "question.answer needs the question's id (qid), like q12." };
      if (questions) {
        const q = Object.hasOwn(questions, a.qid) ? questions[a.qid] : null;
        if (!q || q.card !== a.card) return { ok: false, reason: `There is no question ${a.qid} on card ${a.card}.` };
        if (q.answered) return { ok: false, reason: `Question ${a.qid} is already answered.` };
      }
      args.qid = a.qid;
      args.text = cleanText(a.text);
      if (!args.text) return { ok: false, reason: "The answer is empty." };
      break;
    }
    case "auto.set": {
      // One switch. A request that also names any other setting is refused whole, not half applied.
      const extra = AUTO_KEYS.filter((k) => k in a);
      if (extra.length) return { ok: false, reason: `Only "paused" can be changed from the board. ${extra.slice(0, 3).join(", ")} is set by the owner in .cockpit/config.json.` };
      if (typeof a.paused !== "boolean") return { ok: false, reason: "auto.set takes paused: true or false." };
      args.paused = a.paused;
      break;
    }
    case "message.send": {
      if (typeof a.text !== "string") return { ok: false, reason: "A message is text." };
      args.text = cleanText(a.text, MESSAGE_MAX);
      if (!args.text) return { ok: false, reason: "The message is empty." };
      break;
    }
    case "notes.add": {
      const sec = NOTE_SECTIONS.find((h) => typeof a.section === "string" && h.toLowerCase() === a.section.trim().toLowerCase());
      if (!sec) return { ok: false, reason: `A note goes under one of: ${NOTE_SECTIONS.join(", ")}.` };
      args.section = sec;
      args.text = cleanText(a.text);
      if (!args.text) return { ok: false, reason: "The note is empty." };
      // Only the `replaces` field makes one note replace another. A text that ends like that mark would be read as one.
      if (REPLACES_TAIL.test(args.text)) return { ok: false, reason: 'A note\'s text cannot end with "(replaces n…)". To replace a note, use Replace on that note; otherwise reword the ending.' };
      if (a.replaces != null && a.replaces !== "") {
        if (typeof a.replaces !== "string" || !/^n\d{1,6}$/.test(a.replaces)) return { ok: false, reason: "replaces needs a note's id, like n3." };
        if (Array.isArray(notes) && !notes.includes(a.replaces)) return { ok: false, reason: `There is no note ${a.replaces}.` };
        args.replaces = a.replaces;
      }
      break;
    }
    case "notes.remove":
      if (typeof a.id !== "string" || !/^n\d{1,6}$/.test(a.id)) return { ok: false, reason: "notes.remove needs the note's id, like n3." };
      if (Array.isArray(notes) && !notes.includes(a.id)) return { ok: false, reason: `There is no note ${a.id}.` };
      args.id = a.id;
      break;
    case "gate.approve":
      if (!byId[a.card].gate || byId[a.card].gate === "-") return { ok: false, reason: `${a.card} has no gate to approve.` };
      break;
  }
  if (!mode) mode = spec.mode === "confirm" && a.confirmed === true ? "work" : spec.mode;
  return { ok: true, verb: a.verb, risk: spec.risk, mode, args, ...meta };
}
