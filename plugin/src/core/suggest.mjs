// suggest.mjs - what the board proposes to its viewer next. Pure: cards and the views rule in, proposals out.
// No agent and no model: the page runs this on every change, so the proposal is always current.
//
//   boardSuggest(cards, V, opts) -> [{ key, kind, card?, title?, text, button?, verb?, args? }]   (at most opts.max, default 3)
//     V     the result of boardViews(cards) for the same cards
//     opts  owner     true when the viewer is the owner (only the owner is offered approvals)
//           score     function(card) -> number, higher first (the page passes the engine's priority); optional
//           pending   { cardId: 1 } cards with a request already sent and not yet answered: never proposed again
//           wip       how many agent cards may be in progress before no further start is proposed (default 1)
//           awaiting  { cardId: 1 } cards in progress whose newest line from the agent is a result: the work is
//                     finished and waits for the owner's check. They do not count as work in progress.
//
// Order, most important first:
//   question  a card has a question nobody has answered            -> "Answer"            (opens the card)
//   check     a card is finished and waits for the owner's check    -> "Check it"          (opens the card)
//   approve   a ready card cannot start without the owner's yes    -> "Approve and start" (task.start)
//   yours     a ready card is the viewer's own to do                -> "Open it"
//   start     fewer agent cards in progress than wip, one is ready  -> "Start it"          (task.start)
//   stuck     nothing in progress, nothing ready, work remains      -> no button
//   finished  every card is done                                    -> no button
//
// Written as one self-contained function so a page can inline it with boardSuggest.toString().
export function boardSuggest(cards, V, opts) {
  opts = opts || {};
  var max = opts.max || 3, pending = opts.pending || {}, wip = opts.wip == null ? 1 : opts.wip, awaiting = opts.awaiting || {};
  var score = typeof opts.score === "function" ? opts.score : function () { return 0; };
  var open = cards.filter(function (c) { return !pending[c.id]; });
  var by = function (a, b) { return score(b) - score(a) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }); };
  var name = function (c) { return c.id + " “" + (c.title || c.t || "").replace(/\s+/g, " ").trim() + "”"; };
  var out = [];
  var add = function (kind, c, text, button, verb) {
    var p = { key: kind + ":" + (c ? c.id : "board"), kind: kind, text: text };
    if (c) { p.card = c.id; p.title = c.title || ""; }
    if (button) p.button = button;
    if (verb) { p.verb = verb; p.args = { card: c.id }; }
    out.push(p);
  };

  open.filter(function (c) { return V.needsYou[c.id] === "question"; }).sort(by).forEach(function (c) {
    add("question", c, name(c) + " has a question waiting for your answer.", "Answer");
  });
  open.filter(function (c) { return awaiting[c.id] && V.state[c.id] === "doing"; }).sort(by).forEach(function (c) {
    add("check", c, name(c) + " is finished and waits for your check.", "Check it");
  });
  if (opts.owner) open.filter(function (c) { return V.needsYou[c.id] === "approval"; }).sort(by).forEach(function (c) {
    add("approve", c, name(c) + " is ready, and it needs your approval before it starts.", "Approve and start", c.own === "agent" ? "task.start" : null);
  });
  open.filter(function (c) { return V.needsYou[c.id] === "yours"; }).sort(by).forEach(function (c) {
    add("yours", c, name(c) + " is your card, and nothing is in its way.", "Open it");
  });

  var doing = cards.filter(function (c) { return V.state[c.id] === "doing" && c.own === "agent" && !awaiting[c.id]; }).length;
  var startable = open.filter(function (c) { return V.state[c.id] === "ready" && c.own === "agent" && !V.needsYou[c.id]; }).sort(by);
  if (doing < wip && startable.length) {
    var c0 = startable[0], more = startable.length - 1;
    add("start", c0, (doing ? "" : "Nothing is in progress. ") + name(c0) + " is ready." + (more ? " " + more + " more " + (more === 1 ? "is" : "are") + " ready after it." : ""), "Start it", "task.start");
  }

  if (!out.length) {
    var left = cards.filter(function (c) { return V.state[c.id] !== "done"; });
    var pend = cards.filter(function (c) { return pending[c.id]; }).length;
    if (!cards.length) { /* an empty board proposes nothing */ }
    else if (!left.length) add("finished", null, "Every card is done.");
    else if (!pend && !cards.some(function (c) { return V.state[c.id] === "ready" || (V.state[c.id] === "doing" && !awaiting[c.id]); }))
      add("stuck", null, "Nothing can move: every open card is blocked or waits on a card that is not done.");
  }
  return out.slice(0, max);
}
