// The owner's choices while reading a plan: accept or set aside one goal, and close a card on their own word.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decide, VERBS } from "../plugin/src/core/gateway.mjs";
import { applyDecision } from "../plugin/src/core/apply.mjs";
import { parseLaunch, isVerified } from "../plugin/src/core/parse.mjs";
import { project, exported, pending, cli, rm, P, read, readJSON, lines } from "./qa/_helpers.mjs";

const HEAD = (goals) => ["## GOALS", "", "| # | Goal | One line | Cards | State |", "|---|---|---|---|---|", ...goals.map(([n, k]) => `| **${n}** | **Goal ${n}** | What is true when goal ${n} is reached | ${k} | ACTIVE |`), ""].join("\n");
const SEC = (n, rows) => [`## GOAL ${n} — Goal ${n}`, "", `### Phase ${n} · Phase ${n}`, "", "Ends with: it is done", "", "| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |", "|---|---|---|---|---|---|---|---|---|", ...rows, ""].join("\n");
const row = (id, st = "BACKLOG", own = "agent") => `| ${id} | ${st} | ${own} | code | S | - | - | **Card ${id}.** Does a thing. • Why: A reason. • Check: Look. | Seen |`;
const MD = HEAD([[1, 2], [2, 1], [3, 1]]) + "\n" + SEC(1, [row("1.1"), row("1.2")]) + "\n" + SEC(2, [row("2.1")]) + "\n" + SEC(3, [row("3.1")]);
const REC = parseLaunch(MD);
const owner = (a, more = {}) => decide(a, { cards: REC.cards, goals: REC.goals, level: "owner", plan: "draft", ...more });
const types = (dir) => lines(P(dir).events).map((e) => e.type);
const inbox = (dir, approvals, actions) => cli(dir, "inbox", "--from", exported({ approvals, ...(actions ? { actions } : {}) }));

test("both requests are the owner's alone", () => {
  assert.equal(VERBS["card.close"].level, "owner"); assert.equal(VERBS["goal.set"].level, "owner");
  for (const a of [{ verb: "card.close", card: "1.1", why: "done" }, { verb: "goal.set", goal: 1, to: "aside" }]) {
    const d = decide(a, { cards: REC.cards, goals: REC.goals, level: "interact", plan: "draft" });
    assert.equal(d.ok, false); assert.match(d.reason, /needs owner access/);
  }
});

test("card.close: a card is closed as done or as unneeded, in a draft too, and never one that is done or being worked on", () => {
  assert.equal(owner({ verb: "card.close", card: "1.1", why: "done" }).ok, true, "a draft does not stop the owner's own word");
  assert.equal(owner({ verb: "card.close", card: "1.1", why: "unneeded" }).mode, "apply");
  assert.match(owner({ verb: "card.close", card: "1.1", why: "because" }).reason, /already done or as not needed/);
  assert.match(owner({ verb: "card.close", card: "9.9", why: "done" }).reason, /no card/);
  const busy = parseLaunch(MD.replace("| 1.1 | BACKLOG |", "| 1.1 | START |"));
  assert.match(decide({ verb: "card.close", card: "1.1", why: "done" }, { cards: busy.cards, goals: busy.goals, level: "owner" }).reason, /being worked on/);
});

test("card.close writes the owner's word on the card as its evidence, and only the owner's", () => {
  const d = owner({ verb: "card.close", card: "1.2", why: "done" });
  const r = applyDecision(MD, d, { date: "2026-10-11", by: "the owner" });
  const c = parseLaunch(r.md).cards.find((x) => x.id === "1.2");
  assert.equal(c.st, "DONE"); assert.ok(isVerified(c), "the record's own rule for a closed card holds");
  assert.match(r.md, /• Verified: the owner said on the board on \*\*2026-10-11\*\* that this was already done\./);
  assert.deepEqual(r.change, { type: "card.moved", card: "1.2", from: "BACKLOG", to: "DONE", closed: "done" });
  assert.match(applyDecision(MD, owner({ verb: "card.close", card: "1.2", why: "unneeded" }), { date: "2026-10-11" }).md, /closed by the owner on the board on \*\*2026-10-11\*\* as not needed/);
  assert.throws(() => applyDecision(MD, d, { by: "a contributor" }), /only the owner/);
});

test("goal.set: what may be asked, and a card of a goal set aside does not start for anyone", () => {
  assert.equal(owner({ verb: "goal.set", goal: 2, to: "aside" }).ok, true);
  assert.equal(owner({ verb: "goal.set", goal: "2", to: "accepted" }).args.goal, 2);
  assert.match(owner({ verb: "goal.set", goal: 7, to: "aside" }).reason, /no goal/);
  assert.match(owner({ verb: "goal.set", goal: 2, to: "delete" }).reason, /accepted, set aside or brought back/);
  assert.match(owner({ verb: "goal.set", goal: 2, to: "accepted" }, { plan: "accepted" }).reason, /already accepted/);
  assert.match(owner({ verb: "goal.set", goal: 2, to: "back" }).reason, /not set aside/);
  assert.match(owner({ verb: "goal.set", goal: 2, to: "aside" }, { aside: [2] }).reason, /already set aside/);
  for (const a of [{ verb: "task.start", card: "2.1" }, { verb: "card.move", card: "2.1", to: "START" }])
    assert.match(decide(a, { cards: REC.cards, goals: REC.goals, level: "owner", plan: "accepted", aside: [2], auto: { paused: false } }).reason, /Goal 2 is set aside/);
  assert.equal(decide({ verb: "task.start", card: "1.1" }, { cards: REC.cards, goals: REC.goals, level: "owner", plan: "accepted", aside: [2], auto: { paused: false } }).ok, true, "another goal's card starts");
});

test("through the inbox: goals are decided one by one, the last choice accepts the plan, and only goals and plan change in the settings", () => {
  const dir = project({ title: "Triage", plan: "draft", finish: "3.1", wip: { human: 2, agent: 3 } }, MD);
  let r = inbox(dir, { a1: pending({ verb: "goal.set", goal: 1, to: "accepted" }, 1), a2: pending({ verb: "goal.set", goal: 3, to: "aside" }, 2) });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  let cfg = readJSON(P(dir).config);
  assert.deepEqual(cfg.goals, { accepted: [1], aside: [3] }); assert.equal(cfg.plan, "draft", "one goal is still undecided");
  assert.deepEqual([cfg.title, cfg.finish, cfg.wip], ["Triage", "3.1", { human: 2, agent: 3 }]);
  r = inbox(dir, { a3: pending({ verb: "goal.set", goal: 2, to: "accepted" }, 3) });
  cfg = readJSON(P(dir).config);
  assert.equal(cfg.plan, "accepted", "every goal is accepted or set aside");
  assert.deepEqual(cfg.goals, { accepted: [1, 2], aside: [3] });
  assert.ok(types(dir).includes("plan.accepted") && types(dir).filter((t) => t === "goal.set").length === 3);
  assert.match(r.stdout, /Every goal is now decided, so the plan is accepted/);
  // a card of the goal set aside is refused; bringing the goal back lets it start
  r = inbox(dir, { a4: pending({ verb: "task.start", card: "3.1" }, 4) });
  assert.match(r.stdout, /Goal 3 is set aside/); assert.ok(!/\| 3\.1 \| START \|/.test(read(P(dir).record)));
  r = inbox(dir, { a5: pending({ verb: "goal.set", goal: 3, to: "back" }, 5), a6: pending({ verb: "task.start", card: "3.1" }, 6) });
  assert.deepEqual(readJSON(P(dir).config).goals.aside, []); assert.ok(/\| 3\.1 \| START \|/.test(read(P(dir).record)), r.stdout);
  rm(dir);
});

test("through the inbox: a card closed on the owner's word in a draft is done in the record, and the board still builds", () => {
  const dir = project({ title: "Triage", plan: "draft" }, MD);
  assert.equal(cli(dir, "build").status, 0);
  const r = inbox(dir, { c1: pending({ verb: "card.close", card: "1.1", why: "done" }, 1), c2: pending({ verb: "card.close", card: "2.1", why: "unneeded" }, 2) },
    { x1: pending({ verb: "card.close", card: "1.2", why: "done" }, 3) });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const md = read(P(dir).record);
  assert.match(md, /\| 1\.1 \| DONE \|.*that this was already done\./); assert.match(md, /\| 2\.1 \| DONE \|.*as not needed\./);
  assert.match(md, /\| 1\.2 \| BACKLOG \|/, "a contributor's request closes nothing");
  assert.match(r.stdout, /needs owner access/);
  const b = cli(dir, "build");
  assert.equal(b.status, 0, "a draft accepts the owner's own close: " + b.stdout + b.stderr);
  assert.equal(readJSON(P(dir).config).plan, "draft", "closing cards does not accept the plan");
  rm(dir);
});
