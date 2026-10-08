// The reminder that keeps the board from going silent while a card is in progress.
import test from "node:test";
import assert from "node:assert/strict";
import { quietCards, nudgeText, QUIET_MIN } from "../plugin/src/hooks/quiet.mjs";

const MD = `| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 1.1 | START | agent | code | S | - | - | **A.** x | y |
| 1.2 | BACKLOG | agent | code | S | - | - | **B.** x | y |
| 1.3 | START | agent | code | S | - | - | **C.** x | y |
| 1.4 | DONE | agent | code | S | - | - | **D.** x | y |`;
const T = Date.parse("2026-10-05T12:00:00Z");
const at = (minAgo) => new Date(T - minAgo * 60000).toISOString();

test("a card in progress is quiet when the agent's last line about it is older than the limit", () => {
  const ev = [
    { type: "card.moved", card: "1.1", to: "START", at: at(40) }, { type: "claude.said", card: "1.1", text: "a", at: at(12) },
    { type: "card.moved", card: "1.3", to: "START", at: at(30) }, { type: "claude.said", card: "1.3", text: "b", at: at(3) },
  ];
  assert.deepEqual(quietCards(MD, ev, T), [{ card: "1.1", minutes: 12 }]);
});

test("a card that was started and never spoken about is quiet from its start; one with no events at all is reported too", () => {
  assert.deepEqual(quietCards(MD, [{ type: "card.moved", card: "1.1", to: "START", at: at(QUIET_MIN + 1) }], T),
    [{ card: "1.1", minutes: QUIET_MIN + 1 }, { card: "1.3", minutes: null }]);
});

test("cards that are not in progress never count, whatever the log says", () => {
  assert.deepEqual(quietCards(MD.replace(/START/g, "BACKLOG"), [{ type: "claude.said", card: "1.1", text: "a", at: at(90) }], T), []);
});

test("lines about other cards, and other kinds of event, do not reset the clock", () => {
  const ev = [{ type: "claude.said", card: "1.1", text: "a", at: at(25) }, { type: "claude.said", card: "1.3", text: "b", at: at(1) },
    { type: "mirror.diffed", card: "1.1", at: at(1) }, { type: "claude.said", text: "no card", at: at(1) }];
  assert.deepEqual(quietCards(MD, ev, T), [{ card: "1.1", minutes: 25 }]);
});

test("the reminder names the card, the silence and the command", () => {
  const t = nudgeText([{ card: "1.1", minutes: 12 }, { card: "1.3", minutes: null }]);
  assert.match(t, /Card 1\.1 is in progress and the board has had no update for 12 min/);
  assert.match(t, /Card 1\.3 .* no update at all/);
  assert.match(t, /say ".*" --card 1\.1 --step/);
});

test("a queued card is expected to be silent and earns no reminder", () => {
  const ev = [{ type: "card.moved", card: "1.1", to: "START", at: at(60) }, { type: "claude.said", card: "1.1", say: "queued", text: "Queued.", at: at(50) },
    { type: "card.moved", card: "1.3", to: "START", at: at(60) }, { type: "claude.said", card: "1.3", text: "b", at: at(1) }];
  assert.deepEqual(quietCards(MD, ev, T), []);
});
