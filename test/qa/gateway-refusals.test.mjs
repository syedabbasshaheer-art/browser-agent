// node --test test/qa/gateway-refusals.test.mjs
// PROPOSED (QA 2026-10-05). The gateway's refusal branches that no test in test/ reaches: each of
// these survived a mutation (the refusal was deleted and the suite stayed green). Pure: no files.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLaunch } from "../../plugin/src/core/parse.mjs";
import { decide, cleanText, VERBS, LEVELS, STATES, MAX_TEXT } from "../../plugin/src/core/gateway.mjs";
import { MD, withRow } from "./_helpers.mjs";

const REC = parseLaunch(MD);
const ctx = (level = "owner", extra = {}) => ({ cards: REC.cards, goals: REC.goals, level, ...extra });
const refused = (a, c, re) => { const d = decide(a, c); assert.equal(d.ok, false, JSON.stringify(a)); assert.match(d.reason, re, JSON.stringify(a)); };

test("gateway: the level each verb needs, written out by hand, matches the table", () => {
  // An independent list: a verb added to the table without a line here fails, and so does a lowered level.
  const NEEDS = { "card.move": "interact", "card.note": "interact", "card.edit": "owner", "card.add": "interact",
    "task.start": "interact", "gate.approve": "owner", "plan.accept": "owner", "release.push": "owner", "question.answer": "owner",
    "auto.set": "owner", "notes.add": "owner", "notes.remove": "owner", "message.send": "owner" };
  assert.deepEqual(Object.keys(VERBS).sort(), Object.keys(NEEDS).sort(), "every verb is listed here");
  for (const [verb, need] of Object.entries(NEEDS)) assert.equal(VERBS[verb].level, need, verb);
  assert.deepEqual(LEVELS, ["view", "interact", "admin", "owner"]);
  assert.equal(VERBS["release.push"].mode, "confirm"); assert.equal(VERBS["release.push"].risk, "high");
});

test("gateway: every verb is refused below its level, and a viewer can do nothing", () => {
  const sample = { "card.move": { card: "1.2", to: "DOING" }, "card.note": { card: "1.2", text: "x" }, "card.edit": { card: "1.2", title: "T" },
    "card.add": { goal: 1, title: "New card", owner: "agent" }, "task.start": { card: "1.2" }, "gate.approve": { card: "1.3" },
    "plan.accept": {}, "release.push": {}, "question.answer": { card: "1.2", qid: "q7", text: "Yes" },
    "auto.set": { paused: true }, "notes.add": { section: "Preferences", text: "Say Agent" }, "notes.remove": { id: "n1" }, "message.send": { text: "Start card 1.3 next." } };
  for (const verb of Object.keys(VERBS)) {
    const a = { verb, ...sample[verb] }, need = VERBS[verb].level, plan = verb === "plan.accept" ? "draft" : "accepted";
    refused(a, ctx("view", { plan }), /needs \w+ access; this came from view/);
    for (const level of LEVELS.slice(0, LEVELS.indexOf(need))) refused(a, ctx(level, { plan }), new RegExp(`needs ${need} access`));
    assert.equal(decide(a, ctx("owner", { plan })).ok, true, verb + " at owner");
  }
});

test("gateway: a level the gateway has never heard of is refused, not trusted", () => {
  refused({ verb: "card.note", card: "1.2", text: "x" }, ctx("root"), /needs interact access/);
  refused({ verb: "release.push", confirmed: true }, ctx("superuser"), /needs owner access/);
});

test("gateway: an action that is not an object is refused, never thrown", () => {
  for (const a of [null, undefined, "card.move", 7, [], true]) refused(a, ctx(), /Unknown action/);
  refused({}, ctx(), /Unknown action/);
  refused({ verb: 12 }, ctx(), /Unknown action/);
});

test("gateway: a card can only move to a state the board has", () => {
  for (const to of ["ARCHIVED", "done", "DONE | x", ["DOING"], 3, { st: "DONE" }]) refused({ verb: "card.move", card: "1.2", to }, ctx(), /Cards move to/);
  for (const to of STATES.filter((s) => s !== "BACKLOG" && s !== "START")) assert.equal(decide({ verb: "card.move", card: "1.2", to }, ctx()).ok, true, to);
});

test("gateway: release.push becomes work only on a literal confirmed: true, and only from the owner", () => {
  for (const confirmed of ["true", 1, "yes", {}, [], "1"]) assert.equal(decide({ verb: "release.push", confirmed }, ctx()).mode, "confirm", JSON.stringify(confirmed));
  assert.equal(decide({ verb: "release.push", confirmed: true }, ctx()).mode, "work");
  refused({ verb: "release.push", confirmed: true }, ctx("interact"), /needs owner access/);
  refused({ verb: "release.push", confirmed: true }, ctx("admin"), /needs owner access/);
});

test("gateway: gate.approve needs a gate to approve", () => {
  refused({ verb: "gate.approve", card: "1.2" }, ctx(), /1\.2 has no gate to approve/);
  const d = decide({ verb: "gate.approve", card: "1.3" }, ctx());
  assert.deepEqual([d.ok, d.mode, d.args.card], [true, "apply", "1.3"]);
});

test("gateway: task.start refuses a card that is started, done, a person's, or waiting", () => {
  const started = parseLaunch(withRow(MD, "1.2", (c) => { c[1] = "START"; })).cards;
  refused({ verb: "task.start", card: "1.2" }, { cards: started, level: "owner" }, /1\.2 is already started/);
  refused({ verb: "task.start", card: "1.1" }, ctx(), /1\.1 is already done/);
  refused({ verb: "task.start", card: "1.3" }, ctx(), /card for you, not for Claude/);
  refused({ verb: "task.start", card: "1.4" }, ctx(), /waiting on 1\.2, 1\.3\. It can start once they are done/);
  refused({ verb: "task.start", card: "1.5" }, ctx(), /waiting on 1\.4\. It can start once that is done/);
  refused({ verb: "task.start" }, ctx(), /missing "card"/);
});

test("gateway: card.add checks the goal, the owner, the title and every dependency", () => {
  const add = (x) => ({ verb: "card.add", goal: 1, title: "A new card", owner: "agent", ...x });
  refused(add({ goal: 7 }), ctx(), /There is no goal 7/);
  refused(add({ goal: "one" }), ctx(), /There is no goal one/);
  refused(add({ goal: 1.5 }), ctx(), /There is no goal/);
  refused(add({ owner: "claude" }), ctx(), /Owner must be human or agent/);
  refused(add({ owner: "" }), ctx(), /missing "owner"/);
  refused(add({ title: "** \t **" }), ctx(), /The new card needs a title/);
  refused(add({ deps: "1.1, 9.9" }), ctx(), /Unknown dependencies: 9\.9/);
  refused(add({ deps: ["1.1", "4.2", "8.8"] }), ctx(), /Unknown dependencies: 4\.2, 8\.8/);
  const ok = decide(add({ goal: "1", deps: "1.1 1.2,1.3", text: "why | not", title: "Ship the changelog." }), ctx("interact"));
  assert.deepEqual(ok.args, { goal: 1, owner: "agent", title: "Ship the changelog", text: "Why / not", deps: ["1.1", "1.2", "1.3"] });
  assert.deepEqual(decide(add({}), ctx()).args.deps, []);
});

test("gateway: an empty note and an empty edit are refused; an edit is cleaned and capped", () => {
  refused({ verb: "card.note", card: "1.2", text: "  ** \n ** " }, ctx(), /The note is empty/);
  refused({ verb: "card.note", card: "1.2", text: "" }, ctx(), /missing "text"/);
  refused({ verb: "card.edit", card: "1.2" }, ctx(), /needs a title or text/);
  refused({ verb: "card.edit", card: "1.2", title: "**", text: " " }, ctx(), /needs a title or text/);
  const d = decide({ verb: "card.edit", card: "1.2", title: "a new | title.", text: "x".repeat(400) }, ctx());
  assert.equal(d.args.title, "A new / title");
  assert.equal(d.args.text.length, MAX_TEXT);
  assert.ok(decide({ verb: "card.edit", card: "1.2", title: "t".repeat(200) }, ctx()).args.title.length <= 80);
});

test("gateway: the decision carries the state the card was in, and does not change its input", () => {
  const cards = REC.cards.map((c) => Object.freeze({ ...c, pts: Object.freeze([...c.pts]) }));
  const a = Object.freeze({ verb: "card.move", card: "1.2", to: "START", level: "owner", risk: "none", mode: "apply" });
  const d = decide(a, { cards: Object.freeze(cards), level: "interact", auto: Object.freeze({ paused: false }) });
  assert.deepEqual(d, { ok: true, verb: "card.move", risk: "low", mode: "work", args: { card: "1.2", to: "START", from: "BACKLOG" } });
  assert.deepEqual(decide({ ...a, to: "DOING" }, { cards: Object.freeze(cards), level: "owner" }), { ok: true, verb: "card.move", risk: "low", mode: "apply", args: { card: "1.2", to: "DOING", from: "BACKLOG" } });
  // The level comes from the caller. An action that claims its own level gains nothing.
  refused({ verb: "gate.approve", card: "1.3", level: "owner" }, { cards, level: "interact" }, /needs owner access/);
});

test("cleanText: nothing a viewer types can split a cell, start a row or run past the cap", () => {
  const dirty = "a|b\nc\r\nd\te\u0000f\u001bg\u007fh || **bold** x";
  const t = cleanText(dirty);
  assert.doesNotMatch(t, /[|\u0000-\u001f\u007f]/, "no pipe and no control character survives");
  assert.doesNotMatch(t, /\*\*/);
  assert.equal(t, "A/b c d e f g h // bold x");
  assert.equal(cleanText(null), ""); assert.equal(cleanText(undefined), ""); assert.equal(cleanText(42), "42");
  assert.equal(cleanText("x".repeat(280)).length, 280, "exactly at the cap: untouched");
  const long = cleanText("y".repeat(281));
  assert.equal(long.length, 280); assert.ok(long.endsWith("…"));
  assert.equal(cleanText("one two three", 8), "One two…");
  // What comes out can sit in a card row and the row still has nine cells.
  const rec = parseLaunch(withRow(MD, "1.2", (c) => { c[7] += " • " + cleanText("x | y\n| 9.9 | DONE | agent | code | S | - | - | injected | row |"); }));
  assert.deepEqual(rec.errors, []);
  assert.equal(rec.cards.length, 5, "no row was injected");
});
