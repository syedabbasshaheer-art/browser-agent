// The rules behind the left rail's saved views: card state, goal status, needs-you.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boardViews } from "../plugin/src/core/views.mjs";
import { parseLaunch } from "../plugin/src/core/parse.mjs";

const card = (id, st, own = "agent", deps = "-") => ({ id, g: Number(id.split(".")[0]), st, own, deps });
const STATES = ["done", "blocked", "doing", "ready", "backlog"];
const STATUS = ["done", "doing", "ready", "waiting"];

test("a card's state follows the five rules", () => {
  const v = boardViews([
    card("1.1", "DONE"), card("1.2", "BLOCKED"), card("1.3", "START"),
    card("1.4", "BACKLOG", "agent", "1.1"), card("1.5", "BACKLOG", "agent", "1.1, 1.3"), card("1.6", "DOING"),
  ]);
  assert.deepEqual({ ...v.state }, { "1.1": "done", "1.2": "blocked", "1.3": "doing", "1.4": "ready", "1.5": "backlog", "1.6": "ready" });
});

test("a card that waits on an id that does not exist is never ready", () => {
  assert.equal(boardViews([card("1.1", "BACKLOG", "agent", "9.9")]).state["1.1"], "backlog");
});

test("a goal's status is the first that applies: done, doing, ready, waiting", () => {
  const v = boardViews([
    card("1.1", "DONE"), card("1.2", "DONE"),                              // goal 1: done
    card("2.1", "START"), card("2.2", "BACKLOG"),                          // goal 2: doing, though it also has a ready card
    card("3.1", "BACKLOG"), card("3.2", "BACKLOG", "agent", "3.1"),        // goal 3: ready
    card("4.1", "BACKLOG", "agent", "3.2"), card("4.2", "BLOCKED"),        // goal 4: waiting
  ]);
  assert.deepEqual({ ...v.goal }, { 1: "done", 2: "doing", 3: "ready", 4: "waiting" });
  assert.deepEqual(v.views.doing, ["2"]);
  assert.deepEqual(v.views.ready, ["3"]);
  assert.deepEqual(v.views.all, ["2", "3", "4", "1"]);   // doing, ready, waiting, done
});

test("goals are listed most active first, and keep record order inside a group", () => {
  const v = boardViews([
    card("1.1", "DONE"), card("2.1", "BACKLOG", "agent", "9.9"), card("3.1", "BACKLOG"), card("4.1", "START"),
    card("5.1", "DONE"), card("6.1", "BACKLOG"), card("7.1", "START"), card("8.1", "BLOCKED"),
  ]);
  assert.deepEqual(v.views.all, ["4", "7", "3", "6", "2", "8", "1", "5"]);
});

test("needs-you gives one reason: question, then approval, then yours", () => {
  const g = (id, st, own, gate, deps = "-") => ({ ...card(id, st, own, deps), gate });
  const v = boardViews([
    g("1.1", "BACKLOG", "agent", "approval"),          // ready and gated: your approval
    g("1.2", "BACKLOG", "human", "-"),                 // ready and yours
    g("1.3", "BACKLOG", "human", "money"),             // gated wins over yours
    g("1.4", "BACKLOG", "agent", "approval", "1.1"),   // gated but not ready yet: nothing needed now
    g("1.5", "START", "agent", "approval"),            // already in progress: nothing needed
    g("1.6", "BACKLOG", "agent", "-"),                 // an ordinary ready agent card
    g("1.7", "START", "agent", "-"),                   // has a question
  ], { openQuestions: ["1.7"] });
  assert.deepEqual({ ...v.needsYou }, { "1.1": "approval", "1.2": "yours", "1.3": "approval", "1.7": "question" });
});

test("a card needs you when it is yours and ready, or has an unanswered question", () => {
  const cards = [card("1.1", "BACKLOG", "human"), card("1.2", "BACKLOG", "human", "1.1"), card("2.1", "START"), card("3.1", "DONE", "human")];
  const v = boardViews(cards, { openQuestions: ["2.1", "3.1", "7.7"] });
  assert.deepEqual(Object.keys(v.needsYou).sort(), ["1.1", "2.1"]);          // 1.2 waits; 3.1 is done; 7.7 does not exist
  assert.deepEqual(v.views.you, ["2", "1"]);                                   // goal 2 is in progress, so it is listed first
});

test("finishing a card moves what waited on it from backlog to ready", () => {
  const cards = [card("1.1", "START"), card("1.2", "BACKLOG", "human", "1.1")];
  assert.equal(boardViews(cards).state["1.2"], "backlog");
  assert.deepEqual(boardViews(cards).views.you, []);
  cards[0].st = "DONE";
  const v = boardViews(cards);
  assert.equal(v.state["1.2"], "ready");
  assert.deepEqual(v.views.you, ["1"]);
  assert.deepEqual(v.views.ready, ["1"]);
  assert.deepEqual(v.views.doing, []);
});

test("handing a ready card to the agent moves its goal from the ready view to the doing view", () => {
  const cards = [card("1.1", "BACKLOG"), card("1.2", "BACKLOG")];
  assert.deepEqual(boardViews(cards).views.ready, ["1"]);
  cards[0].st = "START";
  const v = boardViews(cards);
  assert.deepEqual(v.views.ready, []);
  assert.deepEqual(v.views.doing, ["1"]);
});

test("on 300 random boards every card has one state, every goal one status, and the views agree with them", () => {
  let seed = 7; const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let b = 0; b < 300; b++) {
    const cards = [];
    const goals = 1 + rnd(6);
    for (let g = 1; g <= goals; g++) for (let i = 1, n = 1 + rnd(7); i <= n; i++) {
      const earlier = cards.map((c) => c.id);
      const deps = earlier.length && rnd(3) ? [...new Set([earlier[rnd(earlier.length)], earlier[rnd(earlier.length)]])].join(", ") : "-";
      cards.push(card(g + "." + i, ["BACKLOG", "BACKLOG", "DOING", "START", "BLOCKED", "DONE", "DONE"][rnd(7)], rnd(4) ? "agent" : "human", deps));
    }
    const v = boardViews(cards, { openQuestions: cards.filter(() => !rnd(9)).map((c) => c.id) });
    for (const c of cards) assert.ok(STATES.includes(v.state[c.id]), "state of " + c.id);
    assert.equal(STATES.reduce((n, s) => n + v.count(s), 0), cards.length, "states partition the cards");
    for (const g of v.views.all) {
      assert.ok(STATUS.includes(v.goal[g]), "status of goal " + g);
      const list = cards.filter((c) => String(c.g) === g).map((c) => v.state[c.id]);
      assert.equal(v.views.doing.includes(g), list.includes("doing"), "doing view, goal " + g);
      assert.equal(v.views.ready.includes(g), !list.includes("doing") && list.includes("ready"), "ready view, goal " + g);
      assert.equal(v.goal[g] === "done", list.every((s) => s === "done"), "done, goal " + g);
      assert.equal(v.views.you.includes(g), cards.some((c) => String(c.g) === g && v.needsYou[c.id]), "you view, goal " + g);
    }
    const rank = { doing: 0, ready: 1, waiting: 2, done: 3 };
    for (let i = 1; i < v.views.all.length; i++) assert.ok(rank[v.goal[v.views.all[i - 1]]] <= rank[v.goal[v.views.all[i]]], "goals are in status order");
    assert.equal(new Set(v.views.all).size, new Set(cards.map((c) => String(c.g))).size, "every goal is listed once");
    assert.equal(v.views.doing.filter((g) => v.views.ready.includes(g)).length, 0, "doing and ready never share a goal");
    for (const id in v.needsYou) assert.notEqual(v.state[id], "done", "a done card never needs you");
    for (const c of cards) if (v.state[c.id] === "ready") for (const d of String(c.deps).split(",").map((s) => s.trim()).filter((s) => s && s !== "-")) assert.equal(v.state[d], "done", c.id + " is ready so " + d + " is done");
  }
});

test("a real record (the demo plan): the states add up and the views are consistent", () => {
  const rec = parseLaunch(fs.readFileSync(new URL("../examples/demo/BOARD.md", import.meta.url), "utf8"));
  const v = boardViews(rec.cards);
  assert.equal(STATES.reduce((n, s) => n + v.count(s), 0), rec.cards.length);
  assert.equal(v.views.all.length, rec.goals.length);
  assert.equal(v.count("done"), rec.cards.filter((c) => c.st === "DONE").length);
});

test("it can be inlined into a page: the function text runs on its own", () => {
  const f = new Function("return (" + boardViews.toString() + ")")();
  assert.deepEqual({ ...f([card("1.1", "DONE"), card("1.2", "BACKLOG", "human", "1.1")]).state }, { "1.1": "done", "1.2": "ready" });
});
