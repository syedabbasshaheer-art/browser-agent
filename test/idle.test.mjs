// A card must not sit in progress with nobody working on it: the turn-end hook sends the agent back to work.
import test from "node:test";
import assert from "node:assert/strict";
import { idleCards, keepText, KEEP_MAX } from "../plugin/src/hooks/idle.mjs";
import { entryOf } from "../plugin/src/events/feed.mjs";

const T = Date.parse("2026-10-06T12:00:00Z");
const at = (minAgo) => new Date(T - minAgo * 60000).toISOString();
const card = (id, st, own = "agent") => ({ id, st, own });

test("a card of the agent's in progress with no result and no open question is idle", () => {
  const cards = [card("1.1", "START"), card("1.2", "BACKLOG"), card("1.3", "DONE"), card("1.4", "START", "human")];
  const log = [{ type: "card.moved", card: "1.1", to: "START", at: at(30) }, { type: "claude.said", card: "1.1", text: "Step one.", at: at(20) }];
  assert.deepEqual(idleCards(cards, log), ["1.1"], "the owner's own card and cards in other states never count");
});

test("a posted result, or an open question, accounts for the card", () => {
  const cards = [card("1.1", "START"), card("1.2", "START")];
  const log = [{ type: "card.moved", card: "1.1", to: "START", at: at(30) }, { type: "claude.said", card: "1.1", kind: "result", text: "Done.", at: at(5) },
    { type: "card.moved", card: "1.2", to: "START", at: at(30) }];
  assert.deepEqual(idleCards(cards, log), ["1.2"]);
  assert.deepEqual(idleCards(cards, log, ["1.2"]), [], "1.2 has an open question");
});

test("a result from before the card was started again does not count", () => {
  const log = [{ type: "claude.said", card: "1.1", kind: "result", text: "Done.", at: at(60) }, { type: "card.moved", card: "1.1", to: "START", at: at(10) }];
  assert.deepEqual(idleCards([card("1.1", "START")], log), ["1.1"]);
});

test("the message names the cards, the count, and the three honest ways out", () => {
  const t = keepText(["1.1", "1.2"], 2, "cockpit.mjs");
  assert.match(t, /^cards 1\.1, 1\.2 are in progress and nothing on the board says they are finished or waiting\. Do NOT stop: continue the work now \(2 of 3\)\./);
  assert.match(t, /--kind result/); assert.match(t, / ask "/); assert.match(t, /back to BACKLOG in the record with a note/);
  assert.equal(KEEP_MAX, 3);
});

test("when the agent does stop, the board says so in a plain sentence", () => {
  const e = entryOf({ offset: 9, at: at(0), type: "agent.stopped", cards: ["1.1"] });
  assert.equal(e.text, "The agent stopped while card 1.1 was still in progress. Nothing is happening on it until the agent's next turn.");
  assert.equal(e.say, "problem");
});

test("a card the agent marked queued is accounted for, until it is started again or spoken about", () => {
  const cards = [card("1.1", "START")];
  const log = [{ type: "card.moved", card: "1.1", to: "START", at: at(30) }, { type: "claude.said", card: "1.1", say: "queued", text: "Queued behind 1.0.", at: at(20) }];
  assert.deepEqual(idleCards(cards, log), []);
  assert.deepEqual(idleCards(cards, log.concat([{ type: "claude.said", card: "1.1", text: "Starting.", step: 0, of: 3, at: at(5) }])), ["1.1"], "work began: it is no longer queued");
});
