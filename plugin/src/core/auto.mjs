// auto.mjs - which card, if any, the agent may start by itself (card 11.5). Pure: data in, a decision out.
// No files, no clock of its own, no network. docs/15-live-feed-design.md section 6 is the design.
//
//   nextAutoStart(cards, entries, settings, now) -> { card, n, of, after?, why } or { none: "<plain reason>" }
//     cards     the record's cards (parseLaunch)
//     entries   every event of the log, oldest first
//     settings  { plan: "accepted" | "draft", auto: <the config's auto block>, wip?, finish? }
//     now       a Date, a number of milliseconds, or an ISO time
//
// The rules, in the order they are checked. The first that fails is the reason given:
//   1. the plan is accepted
//   2. auto.start is true, and auto.paused is false
//   3. every card in progress has posted a result line since it started ("finished, waiting for the owner's
//      check"), or nothing is in progress
//   4. no card became Blocked after the last automatic start (the owner acting clears this)
//   5. no question is unanswered, when auto.pauseOnQuestion is true
//   6. fewer than auto.inARow automatic starts since the owner's last action
//   7. fewer than auto.perDay automatic starts in the last 24 hours
//   8. a card qualifies: Ready by boardViews, owned by the agent, no open gate, not added by a contributor,
//      nothing on it waiting for the owner; the highest by the engine's priority wins
//
// The gateway checks every one of these again on its own (decideAuto in gateway.mjs) before anything is
// written. A setting that is missing or of the wrong type refuses: this function never guesses a limit.
import { boardViews } from "./views.mjs";
import { computeBoard } from "./engine.mjs";
import { contributed } from "./gateway.mjs";

export const AUTO_RULE = "next-ready";
const DAY = 24 * 60 * 60 * 1000;
const time = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));
const isEvent = (e) => !!e && typeof e === "object" && Number.isInteger(e.offset);
const cardOf = (e) => (typeof e.card === "string" ? e.card : typeof e.id === "string" ? e.id : null); // older moves carried `id`

// The owner acted: they typed a message, or a request arrived in the owner's own inbox. A contributor's
// request is not the owner's action, so it never resets the in-a-row ceiling.
export const isOwnerAction = (e) => isEvent(e) && (e.type === "prompt.received"
  || (e.type === "action.received" && (e.level === "owner" || (e.level == null && e.inbox === "approvals"))));

// What the log says, counted once. Every number a rule needs.
export function autoFacts(entries, now) {
  const all = (Array.isArray(entries) ? entries : []).filter(isEvent);
  const t = time(now);
  let lastOwner = 0, lastAuto = 0, inRow = 0, day = 0;
  const started = Object.create(null), result = Object.create(null), blockedAt = Object.create(null);
  const asked = Object.create(null), answered = Object.create(null);
  for (const e of all) {
    if (isOwnerAction(e)) { lastOwner = e.offset; inRow = 0; }
    else if (e.type === "claude.auto") { lastAuto = e.offset; inRow++; if (!(Date.parse(e.at) <= t - DAY)) day++; }
    else if (e.type === "card.moved") {
      const c = cardOf(e) || "?"; // a move that names no card still counts: a block is a block
      if (e.to === "START") started[c] = e.offset;
      if (e.to === "BLOCKED") blockedAt[c] = e.offset;
    }
    else if (e.type === "claude.said" && e.say === "result" && typeof e.card === "string") result[e.card] = e.offset;
    else if (e.type === "claude.asked") asked["q" + e.offset] = typeof e.card === "string" ? e.card : "";
    else if (e.type === "question.answered" && typeof e.qid === "string") answered[e.qid] = 1;
  }
  const since = Math.max(lastAuto, lastOwner);
  const blocked = Object.keys(blockedAt).filter((c) => blockedAt[c] > since);
  const openQuestions = [...new Set(Object.keys(asked).filter((q) => !answered[q]).map((q) => asked[q]))];
  return { lastOwner, lastAuto, inRow, day, started, result, blocked, openQuestions };
}

export function nextAutoStart(cards, entries, settings, now) {
  const s = settings && typeof settings === "object" ? settings : {};
  const auto = s.auto && typeof s.auto === "object" ? s.auto : {};
  const list = Array.isArray(cards) ? cards : [];
  const none = (reason) => ({ none: reason });
  if (s.plan !== "accepted") return none("The plan is a draft. Nothing starts until the owner accepts it.");
  if (auto.start !== true) return none("Automatic starts are off (auto.start is not true in .cockpit/config.json).");
  if (auto.paused !== false) return none("Automatic work is paused by the owner.");
  if (!Number.isInteger(auto.inARow) || auto.inARow < 1 || !Number.isInteger(auto.perDay) || auto.perDay < 1) return none("The limits auto.inARow and auto.perDay are not whole numbers above zero, so nothing starts automatically.");
  if (!Number.isFinite(time(now))) return none("The time is not known, so the daily limit cannot be checked.");

  const f = autoFacts(entries, now);
  const V = boardViews(list, { openQuestions: f.openQuestions });
  const doing = list.filter((c) => V.state[c.id] === "doing");
  const finished = (c) => f.result[c.id] > (f.started[c.id] || 0);
  const open = doing.filter((c) => !finished(c)).map((c) => c.id);
  if (open.length) return none(`${open.length === 1 ? "Card " + open[0] + " is" : "Cards " + open.slice(0, 5).join(", ") + " are"} in progress and ${open.length === 1 ? "has" : "have"} not posted a result yet.`);
  if (f.blocked.length) return none(`Card ${f.blocked[0]} was blocked after the last automatic start. Automatic starts wait until the owner has acted.`);
  if (auto.pauseOnQuestion !== false && f.openQuestions.length) return none(`A question${f.openQuestions[0] ? " on card " + f.openQuestions[0] : ""} is waiting for the owner's answer.`);
  if (f.inRow >= auto.inARow) return none(`${f.inRow} card${f.inRow === 1 ? " was" : "s were"} started automatically in a row, which is the limit (${auto.inARow}). It waits for the owner.`);
  if (f.day >= auto.perDay) return none(`${f.day} card${f.day === 1 ? " was" : "s were"} started automatically in the last 24 hours, which is the daily limit (${auto.perDay}).`);

  const E = computeBoard(list, { WIP: s.wip, LAUNCH: s.finish || null });
  const hold = Array.isArray(auto.holdGoals) ? auto.holdGoals : [];
  const can = list.filter((c) => V.state[c.id] === "ready" && c.own === "agent" && (!c.gate || c.gate === "-") && !contributed(c) && !V.needsYou[c.id] && !hold.includes(c.g))
    .sort((a, b) => E.score(b) - E.score(a) || String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
  if (!can.length) return none(hold.length ? `No agent card is ready that needs no approval, outside the goal${hold.length === 1 ? "" : "s"} on hold (${hold.join(", ")}).` : "No agent card is ready that needs no approval.");
  const after = doing.slice().sort((a, b) => f.result[b.id] - f.result[a.id])[0];
  const out = { card: can[0].id, n: f.inRow + 1, of: auto.inARow, rule: AUTO_RULE };
  if (after) out.after = after.id;
  out.why = after ? `${after.id} is finished and waits for the owner's check, ${out.card} is the highest-priority ready agent card, and it needs no approval.`
    : `Nothing is in progress, ${out.card} is the highest-priority ready agent card, and it needs no approval.`;
  return out;
}

// The one sentence the feed shows for an automatic start.
export const autoSentence = (card, after) => (after
  ? `I finished ${after} and started ${card} because it was next and needs no approval.`
  : `I started ${card} because nothing was in progress, it was next, and it needs no approval.`);

// { [card]: true } for every card the owner may still send back from Start: its current Start came from an
// automatic start, and the agent has posted no result for it since. `cockpit inbox` hands this to the gateway.
export function undoableAutoStarts(entries) {
  const all = (Array.isArray(entries) ? entries : []).filter(isEvent);
  const move = Object.create(null), auto = Object.create(null), result = Object.create(null);
  for (const e of all) {
    if (e.type === "card.moved") { const c = cardOf(e); if (c) move[c] = e; }
    else if (e.type === "claude.auto" && typeof e.card === "string") auto[e.card] = e.offset;
    else if (e.type === "claude.said" && e.say === "result" && typeof e.card === "string") result[e.card] = e.offset;
  }
  const out = Object.create(null);
  for (const c of Object.keys(auto)) {
    const m = move[c];
    if (m && m.to === "START" && m.via === "auto" && m.offset < auto[c] && !(result[c] > m.offset)) out[c] = true;
  }
  return out;
}
