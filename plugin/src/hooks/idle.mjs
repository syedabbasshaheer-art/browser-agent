// idle.mjs - which cards in progress would be left with nobody working on them if the agent stopped now?
// Pure: the cards and the event log in, a list of card ids out.
//
// A card in progress (START) that the agent owns is accounted for when the board already says why nothing
// more is happening on it: the agent posted its result (it waits for the owner's check), or the agent asked a
// question about it that is still open. Any other card in progress is one the agent is supposed to be working.
export const KEEP_MAX = 3;   // how many times in one turn the agent is sent back to work before it may stop

export function idleCards(cards, events, openQuestions = []) {
  const open = new Set(openQuestions);
  const out = [];
  for (const c of cards) {
    if (!c || c.st !== "START" || c.own !== "agent") continue;
    if (open.has(c.id)) continue;
    let started = 0, result = 0, last = null;
    for (const e of events) {
      if (e.card !== c.id && e.id !== c.id) continue;
      const t = Date.parse(e.at) || 0;
      if (e.type === "card.moved" && e.to === "START" && t > started) started = t;
      if (e.type === "claude.said" && (e.kind === "result" || e.say === "result") && t > result) result = t;
      if (e.type === "claude.said" && (!last || t >= last.t)) last = { t, kind: e.kind || e.say };
    }
    if (result && result >= started) continue;   // finished: it waits for the owner's check
    if (last && last.kind === "queued" && last.t >= started) continue;   // the board says it is queued, and why
    out.push(c.id);
  }
  return out;
}

export function keepText(ids, n, cli) {
  const many = ids.length > 1;
  return (many ? "cards " + ids.slice(0, 4).join(", ") + " are" : "card " + ids[0] + " is") + " in progress and nothing on the board says " + (many ? "they are" : "it is") +
    " finished or waiting. Do NOT stop: continue the work now (" + n + " of " + KEEP_MAX + "). A card nobody is working on must not sit in progress. " +
    "If you cannot continue a card, make the board say why before you stop: post its result (node \"" + cli + "\" say \"<result>\" --card <id> --kind result), " +
    "or ask the owner (node \"" + cli + "\" ask \"<question>\" --card <id>), or set it back to BACKLOG in the record with a note saying why and when it resumes.";
}
