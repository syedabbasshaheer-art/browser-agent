// What the board proposes next: one rule, no agent, no model.
import test from "node:test";
import assert from "node:assert/strict";
import { boardSuggest } from "../plugin/src/core/suggest.mjs";
import { boardViews } from "../plugin/src/core/views.mjs";

const card = (id, st, own = "agent", deps = "-", gate = "-") => ({ id, g: Number(id.split(".")[0]), st, own, deps, gate, title: "Card " + id });
const run = (cards, opts) => boardSuggest(cards, boardViews(cards, { openQuestions: (opts && opts.questions) || [] }), { owner: true, ...opts });
const kinds = (list) => list.map((p) => p.kind + ":" + (p.card || "board"));

test("with nothing in progress it proposes the best ready agent card, with one real request", () => {
  const cards = [card("1.1", "BACKLOG"), card("1.2", "BACKLOG"), card("1.3", "BACKLOG", "agent", "1.1")];
  const [p] = run(cards, { score: (c) => (c.id === "1.2" ? 9 : 0) });
  assert.equal(p.kind, "start"); assert.equal(p.card, "1.2");
  assert.deepEqual([p.verb, p.args, p.button], ["task.start", { card: "1.2" }, "Start it"]);
  assert.match(p.text, /^Nothing is in progress\. 1\.2 .Card 1\.2. is ready\. 1 more is ready after it\.$/);
});

test("while the agent is on a card no further start is proposed, unless the limit allows it", () => {
  const cards = [card("1.1", "START"), card("1.2", "BACKLOG")];
  assert.deepEqual(kinds(run(cards)), []);
  assert.deepEqual(kinds(run(cards, { wip: 2 })), ["start:1.2"]);
});

test("the order is question, approval, your card, then start; at most three", () => {
  const cards = [card("1.1", "BACKLOG"), card("1.2", "BACKLOG", "human"), card("1.3", "BACKLOG", "agent", "-", "approval"),
    card("1.4", "START"), card("1.5", "BACKLOG", "human")];
  assert.deepEqual(kinds(run(cards, { questions: ["1.4"], wip: 2 })), ["question:1.4", "approve:1.3", "yours:1.2"]);
  assert.deepEqual(kinds(run(cards, { questions: ["1.4"], wip: 2, max: 9 })), ["question:1.4", "approve:1.3", "yours:1.2", "yours:1.5", "start:1.1"]);
});

test("only the owner is offered an approval, and an approval of an agent card is one start request", () => {
  const cards = [card("1.1", "BACKLOG", "agent", "-", "approval"), card("1.2", "BACKLOG", "human", "-", "money")];
  assert.deepEqual(kinds(run(cards, { owner: false })), []);
  const [a, b] = run(cards);
  assert.deepEqual([a.kind, a.verb, a.button], ["approve", "task.start", "Approve and start"]);
  assert.equal(b.verb, undefined, "an owner's own gated card is opened, not started");
});

test("a card with a request already sent is not proposed again", () => {
  const cards = [card("1.1", "BACKLOG"), card("1.2", "BACKLOG")];
  assert.deepEqual(kinds(run(cards, { pending: { "1.1": 1 } })), ["start:1.2"]);
  assert.deepEqual(kinds(run(cards, { pending: { "1.1": 1, "1.2": 1 } })), [], "and it does not claim the board is stuck while requests are out");
});

test("it says so when nothing can move, and when everything is done", () => {
  assert.deepEqual(kinds(run([card("1.1", "BLOCKED"), card("1.2", "BACKLOG", "agent", "1.1")])), ["stuck:board"]);
  assert.deepEqual(kinds(run([card("1.1", "DONE"), card("1.2", "DONE")])), ["finished:board"]);
  assert.deepEqual(run([]), []);
});

test("on 300 random boards every proposal is true of the board and no card is proposed twice", () => {
  let seed = 11; const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let b = 0; b < 300; b++) {
    const cards = [];
    for (let g = 1, G = 1 + rnd(4); g <= G; g++) for (let i = 1, n = 1 + rnd(6); i <= n; i++) {
      const ids = cards.map((c) => c.id);
      cards.push(card(g + "." + i, ["BACKLOG", "BACKLOG", "START", "BLOCKED", "DONE"][rnd(5)], rnd(4) ? "agent" : "human",
        ids.length && rnd(2) ? ids[rnd(ids.length)] : "-", rnd(5) ? "-" : "approval"));
    }
    const V = boardViews(cards), wip = 1 + rnd(2), owner = !!rnd(2);
    const list = boardSuggest(cards, V, { owner, wip, max: 50 });
    assert.equal(new Set(list.map((p) => p.key)).size, list.length, "no duplicate proposal");
    for (const p of list) {
      const c = cards.find((x) => x.id === p.card);
      if (p.kind === "start") { assert.equal(V.state[c.id], "ready"); assert.equal(c.own, "agent"); assert.equal(c.gate, "-");
        assert.ok(cards.filter((x) => V.state[x.id] === "doing" && x.own === "agent").length < wip); }
      if (p.kind === "approve") { assert.ok(owner); assert.equal(V.needsYou[c.id], "approval"); }
      if (p.kind === "yours") assert.equal(V.needsYou[c.id], "yours");
      if (p.kind === "finished") assert.ok(cards.every((x) => V.state[x.id] === "done"));
      if (p.kind === "stuck") assert.ok(!cards.some((x) => V.state[x.id] === "ready" || V.state[x.id] === "doing"));
      if (p.verb) assert.equal(p.verb, "task.start");
    }
    assert.ok(list.filter((p) => p.kind === "start").length <= 1, "at most one start is proposed at a time");
  }
});

test("it can be inlined into a page: the function text runs on its own", () => {
  const f = new Function("return (" + boardSuggest.toString() + ")")();
  const cards = [card("1.1", "BACKLOG")];
  assert.equal(f(cards, boardViews(cards), {})[0].kind, "start");
});

test("a card that is finished and waits for the owner's check is said so, and is not counted as work in progress", () => {
  const cards = [card("1.1", "START"), card("1.2", "BACKLOG"), card("1.3", "START")];
  const V = boardViews(cards);
  assert.deepEqual(kinds(boardSuggest(cards, V, { owner: true })), [], "two cards in progress, nothing to propose");
  const list = boardSuggest(cards, V, { owner: true, awaiting: { "1.1": 1, "1.3": 1 }, max: 9 });
  assert.deepEqual(kinds(list), ["check:1.1", "check:1.3", "start:1.2"]);
  assert.match(list[0].text, /^1\.1 .Card 1\.1. is finished and waits for your check\.$/);
  assert.deepEqual([list[0].button, list[0].verb], ["Check it", undefined], "it opens the card; it sends nothing");
  assert.match(list[2].text, /^Nothing is in progress\. /, "a finished card waiting for a check is not work in progress");
  assert.deepEqual(kinds(boardSuggest(cards, V, { owner: true, awaiting: { "1.1": 1 }, max: 9 })), ["check:1.1"], "while 1.3 is still being worked on, no further start");
  assert.deepEqual(kinds(boardSuggest(cards, V, { owner: true, awaiting: { "1.2": 1 } })), [], "only a card in progress can be awaiting");
});
