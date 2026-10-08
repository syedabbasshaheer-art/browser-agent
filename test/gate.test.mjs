// A gate is the owner's yes before a card starts. The owner's hand-over gives it; nobody else can.
import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../plugin/src/core/gateway.mjs";
import { applyDecision } from "../plugin/src/core/apply.mjs";
import { parseLaunch } from "../plugin/src/core/parse.mjs";

const MD = `## GOALS

| # | Goal | One line | Cards | State |
|---|---|---|---|---|
| **1** | **One** | A goal | 3 | ACTIVE |

## GOAL 1 — One

### Phase 1 · One

Ends with: done

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 1.1 | BACKLOG | agent | code | S | approval | - | **Gated card.** Does a thing. • Why: A reason. • Check: Look. | Seen |
| 1.2 | BACKLOG | agent | code | S | - | - | **Plain card.** Does a thing. • Why: A reason. • Check: Look. | Seen |
| 1.3 | BACKLOG | human | decision | Q | approval | - | **Owner's card.** Decide. • Why: A reason. • Check: Look. | Seen |
`;
const cards = () => parseLaunch(MD).cards;

test("a contributor cannot start a gated card, by drop or by button", () => {
  for (const act of [{ verb: "card.move", card: "1.1", to: "START" }, { verb: "task.start", card: "1.1" }]) {
    const d = decide(act, { cards: cards(), level: "interact" });
    assert.equal(d.ok, false);
    assert.match(d.reason, /needs the owner's approval/);
  }
});

test("a contributor can still start a card with no gate", () => {
  assert.equal(decide({ verb: "card.move", card: "1.2", to: "START" }, { cards: cards(), level: "interact", auto: { paused: false } }).ok, true);
  assert.match(decide({ verb: "card.move", card: "1.2", to: "START" }, { cards: cards(), level: "interact" }).reason, /paused/, "settings the caller did not give read as paused (finding S2)");
});

test("the owner starting a gated card is the approval, and the decision says so", () => {
  for (const act of [{ verb: "card.move", card: "1.1", to: "START" }, { verb: "task.start", card: "1.1" }]) {
    const d = decide(act, { cards: cards(), level: "owner" });
    assert.equal(d.ok, true);
    assert.equal(d.args.approves, "approval");
  }
  assert.equal(decide({ verb: "card.move", card: "1.2", to: "START" }, { cards: cards(), level: "owner" }).args.approves, undefined);
});

test("writing that hand-over clears the gate and records the approval on the card", () => {
  const mv = { ok: true, verb: "card.move", mode: "apply", args: { card: "1.1", to: "START", from: "BACKLOG", approves: "approval" } };
  const { md } = applyDecision(MD, mv, { date: "2026-10-05", by: "the owner" });
  const c = parseLaunch(md).cards.find((x) => x.id === "1.1");
  assert.equal(c.st, "START");
  assert.equal(c.gate, "-");
  assert.match(md, /Approved \(approval\) and handed to Claude by the owner from the browser on \*\*2026-10-05\*\*/);
  const plain = applyDecision(MD, { ...mv, args: { card: "1.2", to: "START", from: "BACKLOG" } }, { date: "2026-10-05" }).md;
  assert.doesNotMatch(plain, /Approved \(/);
});

test("approving without starting still works, for the owner only, and only where a gate exists", () => {
  assert.equal(decide({ verb: "gate.approve", card: "1.3" }, { cards: cards(), level: "owner" }).ok, true);
  assert.equal(decide({ verb: "gate.approve", card: "1.3" }, { cards: cards(), level: "interact" }).ok, false);
  assert.equal(decide({ verb: "gate.approve", card: "1.2" }, { cards: cards(), level: "owner" }).ok, false);
});

test("message.send: the owner's words are handed over whole; a contributor, an empty one and a non-text one are refused", async () => {
  const { decide, MESSAGE_MAX } = await import("../plugin/src/core/gateway.mjs");
  const cards = [{ id: "1.1", st: "BACKLOG", own: "agent", gate: "-", deps: [], title: "A", text: "" }];
  const ok = decide({ verb: "message.send", text: "  Start card 1.1 next,\n and tell me when it is done.  " }, { cards, level: "owner" });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.verb, ok.mode, ok.args.text], ["message.send", "work", "Start card 1.1 next, and tell me when it is done."]);
  assert.match(decide({ verb: "message.send", text: "Do it" }, { cards, level: "interact" }).reason, /needs owner access/);
  assert.equal(decide({ verb: "message.send", text: "   " }, { cards, level: "owner" }).ok, false);
  assert.equal(decide({ verb: "message.send", text: { toString: () => "x" } }, { cards, level: "owner" }).reason, "A message is text.");
  assert.ok(decide({ verb: "message.send", text: "x".repeat(5000) }, { cards, level: "owner" }).args.text.length <= MESSAGE_MAX);
});
