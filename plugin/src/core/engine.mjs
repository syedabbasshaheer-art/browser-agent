// The promotion engine. Pure: cards in, board out. No DOM, no I/O.
//
// Two states are DECLARED in the record (.cockpit/BOARD.md) because nothing can infer them:
// DONE (someone observed the done-when condition) and BLOCKED (something outside
// the repo is in the way). DOING is declared too — a pin saying "already under
// way". Every other column is COMPUTED here, on every build, so the board cannot
// decay into a backlog and a graveyard with nothing between.
//
// build.mjs inlines computeBoard.toString() into the page, so this function must
// stay self-contained: no imports, no closures over module scope, ES5-safe syntax.

export function computeBoard(C, opt) {
  opt = opt || {};
  var WIP = opt.WIP || { human: 2, agent: 3 };
  var LAUNCH = opt.LAUNCH || null; // no finish card: no finish path
  var QUEUE_MAX = opt.QUEUE_MAX == null ? 6 : opt.QUEUE_MAX;

  var idx = {};
  C.forEach(function (c) { idx[c.id] = c; });
  function byId(id) { return idx[id] || null; }
  function depsOf(c) {
    return !c || c.deps === "-" || !c.deps ? [] :
      c.deps.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function isDone(id) { var c = byId(id); return !!c && c.st === "DONE"; }
  function ready(c) { return depsOf(c).every(isDone); }

  // 1. The launch path: every card the launch card transitively depends on.
  var critical = {};
  (function walk(id, seen) {
    if (!id || seen[id]) return; seen[id] = 1; critical[id] = 1;
    depsOf(byId(id)).forEach(function (d) { walk(d, seen); });
  })(LAUNCH, {});

  // 2. Reach: how many cards sit downstream of each card.
  var dependents = {};
  C.forEach(function (c) {
    depsOf(c).forEach(function (d) { (dependents[d] = dependents[d] || []).push(c.id); });
  });
  function reach(id, seen) {
    var n = 0;
    (dependents[id] || []).forEach(function (k) {
      if (seen[k]) return; seen[k] = 1; n += 1 + reach(k, seen);
    });
    return n;
  }
  var unblocks = {};
  C.forEach(function (c) { unblocks[c.id] = reach(c.id, {}); });

  // 3. Priority among cards that are ready at the same time.
  function score(c) {
    var s = 0;
    if (critical[c.id]) s += 45;
    s += Math.min(unblocks[c.id], 8) * 7;
    s += ({ Q: 9, S: 5, L: 0 })[c.eff] || 0;
    if (c.type === "verify") s += 4;
    if (c.gate === "money") s -= 25;
    if (c.gate === "approval") s -= 10;
    if (/never calls|bypassed|defect|wrong/i.test(c.t)) s += 18;
    return s;
  }

  // 4. Columns. Declared states first, then fill each owner's free slots with
  //    the best ready BACKLOG cards. A human card can only take a human slot.
  var phase = {}, autoset = {}, used = { human: 0, agent: 0 }, queued = [];
  C.forEach(function (c) { phase[c.id] = (c.st === "DONE" || c.st === "BLOCKED" || c.st === "START") ? c.st : "BACKLOG"; });
  C.forEach(function (c) { if (c.st === "DOING") { phase[c.id] = "ACTIVE"; used[c.own]++; } });
  C.filter(function (c) { return phase[c.id] === "BACKLOG" && ready(c); })
    .sort(function (a, b) { return score(b) - score(a) || a.id.localeCompare(b.id, "en", { numeric: true }); })
    .forEach(function (c) {
      if (used[c.own] < WIP[c.own]) { phase[c.id] = "ACTIVE"; autoset[c.id] = 1; used[c.own]++; }
      else if (queued.length < QUEUE_MAX) queued.push(c.id);
    });

  // 5. The launch path in dependency order, and the first human card on it:
  //    the person the whole launch is currently waiting on.
  var chainAll = Object.keys(critical).filter(byId), placed = {}, chain = [];
  for (var g = 0; g < 250 && chain.length < chainAll.length; g++)
    chainAll.forEach(function (id) {
      if (placed[id]) return;
      if (depsOf(byId(id)).every(function (d) { return !critical[d] || placed[d]; })) { placed[id] = 1; chain.push(id); }
    });
  var openPath = chain.filter(function (id) { return !isDone(id); });
  // The person the launch waits on = the best human card on the open path that
  // can be done RIGHT NOW. v1 took the first human card in dependency order, which
  // named a card still waiting on the agent, or a small decision over the card that
  // frees the whole next phase. Fallback: the first human card, ready or not.
  var humanOpen = openPath.filter(function (id) { return byId(id).own === "human" && byId(id).st !== "BLOCKED"; });
  var humanReady = humanOpen.filter(function (id) { return ready(byId(id)); })
    .sort(function (a, b) { return score(byId(b)) - score(byId(a)); });
  var gateCard = humanReady[0] || humanOpen[0] || null;

  // 6. Hand-overs: a dependency edge between two OPEN cards with different
  //    owners. That crossing is where days get lost, so the page draws it.
  var handovers = [];
  C.forEach(function (c) {
    if (phase[c.id] === "DONE") return;
    depsOf(c).forEach(function (d) {
      var dc = byId(d);
      if (dc && dc.st !== "DONE" && dc.own !== c.own) handovers.push({ from: d, to: c.id, fromOwn: dc.own, toOwn: c.own });
    });
  });

  var count = { BACKLOG: 0, ACTIVE: 0, START: 0, BLOCKED: 0, DONE: 0 };
  C.forEach(function (c) { count[phase[c.id]]++; });
  var stuck = C.filter(function (c) { return phase[c.id] === "BACKLOG" && !ready(c); }).length;

  return {
    WIP: WIP, LAUNCH: LAUNCH, critical: critical, dependents: dependents, unblocks: unblocks,
    phase: phase, autoset: autoset, used: used, queued: queued, chain: chain, openPath: openPath,
    gateCard: gateCard, handovers: handovers, count: count, stuck: stuck, score: score
  };
}
