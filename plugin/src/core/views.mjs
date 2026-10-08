// views.mjs - the one place that says what state a card is in, what status a goal has, and what the
// saved views in the left rail contain. Pure: cards in, plain objects out. No WIP limits, no scoring.
//
// A card is in exactly one state:
//   done     its record state is DONE
//   blocked  its record state is BLOCKED
//   doing    it was handed to the agent (record state START)
//   ready    none of the above, and every card it waits on is done
//   backlog  none of the above, and it waits on at least one card that is not done
//
// A goal has exactly one status, the first that applies:
//   done     every card is done
//   doing    at least one card is doing
//   ready    at least one card is ready (and none is doing)
//   waiting  anything else (its open cards are all in backlog or blocked)
//
// Goals are listed most active first: doing, then ready, then waiting, then done. Inside each group
// they keep the order of the record. Every view uses this order.
//
// A card needs you for exactly one stated reason, the first that applies (a done card never does):
//   question  it has a question nobody has answered
//   approval  it is ready, and its gate is still open: it cannot start until you say yes
//   yours     it is ready and it is your card to do
// A goal needs you when one of its cards does.
//
// Written as one self-contained function so a page can inline it with boardViews.toString().
export function boardViews(cards, opts) {
  var openQuestions = (opts && opts.openQuestions) || []; // card ids with an unanswered question
  var byId = Object.create(null);
  cards.forEach(function (c) { byId[c.id] = c; });
  function depsOf(c) {
    if (!c || !c.deps || c.deps === "-") return [];
    return (Array.isArray(c.deps) ? c.deps : String(c.deps).split(",")).map(function (s) { return String(s).trim(); }).filter(Boolean);
  }
  function isDone(id) { var c = byId[id]; return !!c && c.st === "DONE"; }

  var state = Object.create(null), needsYou = Object.create(null), asked = Object.create(null);
  openQuestions.forEach(function (id) { if (byId[id]) asked[id] = 1; });
  cards.forEach(function (c) {
    state[c.id] = c.st === "DONE" ? "done" : c.st === "BLOCKED" ? "blocked" : c.st === "START" ? "doing"
      : depsOf(c).every(isDone) ? "ready" : "backlog";
    var why = state[c.id] === "done" ? null : asked[c.id] ? "question"
      : state[c.id] !== "ready" ? null : (c.gate && c.gate !== "-") ? "approval" : c.own === "human" ? "yours" : null;
    if (why) needsYou[c.id] = why;
  });

  var order = [], inGoal = Object.create(null);
  cards.forEach(function (c) { var g = String(c.g); if (!inGoal[g]) { inGoal[g] = []; order.push(g); } inGoal[g].push(c); });
  var goal = Object.create(null), goalNeedsYou = Object.create(null);
  order.forEach(function (g) {
    var list = inGoal[g], has = function (s) { return list.some(function (c) { return state[c.id] === s; }); };
    goal[g] = list.every(function (c) { return state[c.id] === "done"; }) ? "done" : has("doing") ? "doing" : has("ready") ? "ready" : "waiting";
    if (list.some(function (c) { return needsYou[c.id]; })) goalNeedsYou[g] = 1;
  });

  var RANK = { doing: 0, ready: 1, waiting: 2, done: 3 };
  order = order.map(function (g, i) { return [g, i]; }).sort(function (a, b) { return RANK[goal[a[0]]] - RANK[goal[b[0]]] || a[1] - b[1]; }).map(function (x) { return x[0]; });
  var pick = function (f) { return order.filter(f); };
  return {
    state: state,               // card id -> done | blocked | doing | ready | backlog
    needsYou: needsYou,         // card id -> question | approval | yours
    goal: goal,                 // goal -> done | doing | ready | waiting
    views: {                    // the left rail: each is a list of goals, most active first
      all: order.slice(),
      you: pick(function (g) { return goalNeedsYou[g]; }),
      doing: pick(function (g) { return goal[g] === "doing"; }),
      ready: pick(function (g) { return goal[g] === "ready"; }),
    },
    count: function (s) { return cards.filter(function (c) { return state[c.id] === s; }).length; },
  };
}
