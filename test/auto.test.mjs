// node --test test/auto.test.mjs — card 11.5: automatic starts, with limits the owner can see.
// The rules are docs/15-live-feed-design.md section 6 and docs/16-live-feed-contract.md section 5.
// Pure parts are called directly; `cockpit next` and `cockpit inbox` are the real CLI, run as a child
// process against a scratch project in the OS temp folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readAuto, AUTO_DEFAULTS } from "../plugin/src/build/config.mjs";
import { nextAutoStart, undoableAutoStarts, autoSentence, autoFacts, isOwnerAction } from "../plugin/src/core/auto.mjs";
import { decide, decideAuto, NEVER_AUTOMATIC, VERBS, contributed } from "../plugin/src/core/gateway.mjs";
import { applyDecision, applyAutoSet } from "../plugin/src/core/apply.mjs";
import { parseLaunch } from "../plugin/src/core/parse.mjs";
import { computeBoard } from "../plugin/src/core/engine.mjs";
import { boardViews } from "../plugin/src/core/views.mjs";
import { openQuestionCards } from "../plugin/src/events/feed.mjs";
import { entryOf } from "../plugin/src/cli/feed.mjs";
import { REPO, project, exported, pending, cli, cliEnv, rm, P, read, readJSON, lines, row, setRow } from "./qa/_helpers.mjs";

// ── A small board: every card an agent card with no gate, unless a row says otherwise. ──
const HEAD = ["## GOALS", "", "| # | Goal | One line | Cards | State |", "|---|---|---|---|---|", "| **1** | **One** | A goal | 6 | ACTIVE |", "",
  "## GOAL 1 — One", "", "### Phase 1 · One", "", "Ends with: done", "",
  "| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |", "|---|---|---|---|---|---|---|---|---|"].join("\n") + "\n";
const cardRow = (id, o = {}) => `| ${id} | ${o.st || "BACKLOG"} | ${o.own || "agent"} | code | ${o.eff || "S"} | ${o.gate || "-"} | ${o.deps || "-"} | **Card ${id}.** Does a thing. • Why: A reason.` +
  (o.contributed ? " • Note: Added by a contributor on **2026-10-01**." : "") + (o.st === "DONE" ? " • Verified: it was seen." : "") + " | Seen |";
const board = (rows) => HEAD + Object.entries(rows).map(([id, o]) => cardRow(id, o)).join("\n") + "\n";
const cardsOf = (rows) => { const r = parseLaunch(board(rows)); assert.deepEqual(r.errors, []); return r.cards; };

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const AUTO = { ...AUTO_DEFAULTS, start: true };
const ON = { plan: "accepted", auto: AUTO };
// An event log written by hand: log(["prompt.received"], ["claude.auto", { card: "1.2" }, minutesAgo], ...)
const log = (...list) => list.map(([type, data = {}, ago = 5], i) => ({ offset: i + 1, at: new Date(NOW - ago * 60000).toISOString(), type, ...data }));
const started = (card) => [["card.moved", { card, from: "BACKLOG", to: "START", via: "auto" }], ["claude.auto", { card }]];
const result = (card) => ["claude.said", { card, say: "result", text: "Finished." }];
const THREE = { "1.1": {}, "1.2": {}, "1.3": {} };
const next = (rows, entries = [], settings = ON, now = NOW) => nextAutoStart(cardsOf(rows), entries, settings, now);
const gate = (rows, card, entries = [], extra = {}) => { const cards = cardsOf(rows); return decideAuto({ verb: "card.move", card, to: "START" }, { cards, plan: "accepted", auto: AUTO, entries, now: NOW, score: computeBoard(cards, {}).score, ...extra }); };

// ── A. Settings ──

test("settings: the contract's defaults, and each wrong value falls back to its default and is reported", () => {
  assert.deepEqual(readAuto(undefined), { auto: { start: false, inARow: 3, perDay: 12, pauseOnQuestion: true, paused: false, quietMin: 10, pulseGapMin: 5, pulsePerHour: 8, holdGoals: [],
    heartbeat: { installed: false, everyMin: 30, from: "09:00", to: "22:00", perDay: 24 } }, problems: [] });
  const good = { start: false, inARow: 5, perDay: 30, pauseOnQuestion: false, paused: true, quietMin: 20, pulseGapMin: 3, pulsePerHour: 0, holdGoals: [2], heartbeat: { installed: true, everyMin: 60, from: "08:30", to: "23:59", perDay: 12 } };
  assert.deepEqual(readAuto(good), { auto: good, problems: [] });
  const bad = { start: "yes", inARow: 0, perDay: 12.5, pauseOnQuestion: 1, paused: null, quietMin: -1, pulseGapMin: "5", pulsePerHour: 61, extra: 1,
    heartbeat: { installed: "no", everyMin: 1, from: "9am", to: "24:00", perDay: 0, more: true } };
  const r = readAuto(bad);
  assert.deepEqual(r.auto, { ...readAuto(undefined).auto, paused: true }, "every one fell back, and a paused that is not exactly false reads as paused (finding S7)");
  assert.match(r.off, /are wrong$/, "and automatic starts are off until the block is fixed");
  assert.equal(r.problems.length, 15);
  for (const k of ["auto.start", "auto.inARow", "auto.perDay", "auto.pauseOnQuestion", "auto.paused", "auto.quietMin", "auto.pulseGapMin", "auto.pulsePerHour", "auto.extra",
    "auto.heartbeat.installed", "auto.heartbeat.everyMin", "auto.heartbeat.from", "auto.heartbeat.to", "auto.heartbeat.perDay", "auto.heartbeat.more"])
    assert.ok(r.problems.some((p) => p.startsWith(k + " ")), k);
  assert.match(r.problems.find((p) => p.startsWith("auto.inARow")), /must be a whole number from 1 to 20, not 0: using the default 3/);
  // One bad value does not spoil its neighbours.
  assert.deepEqual(readAuto({ inARow: 99, perDay: 4 }).auto.perDay, 4);
  for (const junk of [null, "on", 7, [], true]) { const j = readAuto(junk); assert.deepEqual(j.auto, readAuto(undefined).auto); assert.equal(j.problems.length, 1); }
  assert.match(readAuto({ heartbeat: "hourly" }).problems[0], /auto\.heartbeat must be an object/);
  assert.ok(Object.isFrozen(AUTO_DEFAULTS) && Object.isFrozen(AUTO_DEFAULTS.heartbeat));
});

test("settings: a new project starts with automatic starts off and the whole block written out; status reports a bad value", () => {
  const tpl = readJSON(path.join(REPO, "plugin", "templates", "config.json"));
  assert.equal(tpl.auto.start, false, "controlled first");
  assert.deepEqual(tpl.auto, { ...readAuto(undefined).auto, start: false });
  assert.deepEqual(readAuto(tpl.auto).problems, []);
  const dir = project({ title: "Auto", auto: { start: true, inARow: "three", perDay: 4 } });
  const s = cli(dir, "status");
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /^Automatic work: starts off; at most 3 in a row and 4 in 24 hours; waits while a question is unanswered\.$/m, "a wrong limit turns automatic starts off (finding S7)");
  assert.match(s.stdout, /^AUTOMATIC STARTS ARE OFF: auto\.inARow is wrong\./m);
  assert.match(cli(dir, "next").stdout, /^No automatic start\. Automatic starts are off: auto\.inARow is wrong in \.cockpit\/config\.json\./);
  assert.match(s.stdout, /^SETTING IGNORED: auto\.inARow must be a whole number from 1 to 20, not "three": using the default 3$/m);
  rm(dir);
  const fresh = project(null, null);   // an empty folder: no cockpit yet
  assert.equal(cli(fresh, "init").status, 0);
  assert.equal(readJSON(P(fresh).config).auto.start, false);
  assert.match(cli(fresh, "status").stdout, /^Automatic work: starts off;/m);
  rm(fresh);
});

// ── B. The decision, one rule at a time ──

test("decision: with nothing in the way, the next ready agent card starts, and it says which one of the row it is", () => {
  const d = next(THREE);
  assert.deepEqual({ card: d.card, n: d.n, of: d.of, rule: d.rule, after: d.after }, { card: "1.1", n: 1, of: 3, rule: "next-ready", after: undefined });
  assert.match(d.why, /^Nothing is in progress, 1\.1 is the highest-priority ready agent card, and it needs no approval\.$/);
  assert.equal(gate(THREE, "1.1").ok, true);
});

test("decision: a draft plan starts nothing", () => {
  assert.deepEqual(next(THREE, [], { plan: "draft", auto: AUTO }), { none: "The plan is a draft. Nothing starts until the owner accepts it." });
  assert.deepEqual(next(THREE, [], { auto: AUTO }), { none: "The plan is a draft. Nothing starts until the owner accepts it." }, "a plan that is not stated is not accepted");
  assert.match(gate(THREE, "1.1", [], { plan: "draft" }).reason, /The plan is a draft/);
});

test("decision: auto.start must be true, and auto.paused must be false", () => {
  assert.match(next(THREE, [], { plan: "accepted", auto: { ...AUTO, start: false } }).none, /^Automatic starts are off/);
  assert.match(next(THREE, [], { plan: "accepted", auto: { ...AUTO, paused: true } }).none, /^Automatic work is paused by the owner\.$/);
  // A setting that is missing or of the wrong type refuses: nothing is guessed.
  for (const auto of [undefined, null, {}, { ...AUTO, start: "true" }, { ...AUTO, start: 1 }, { ...AUTO, paused: undefined }, { ...AUTO, paused: 0 }, { ...AUTO, inARow: "3" }, { ...AUTO, perDay: 0 }])
    assert.ok(next(THREE, [], { plan: "accepted", auto }).none, JSON.stringify(auto));
  assert.equal(gate(THREE, "1.1", [], { auto: { ...AUTO, start: false } }).reason, "Automatic starts are off.");
  assert.equal(gate(THREE, "1.1", [], { auto: { ...AUTO, paused: true } }).reason, "Automatic work is paused by the owner.");
  assert.equal(gate(THREE, "1.1", [], { auto: null }).ok, false);
});

test("decision: a card in progress with no result line since its start stops the next one; with a result it is followed", () => {
  const rows = { "1.1": { st: "START" }, "1.2": {}, "1.3": {} };
  const noResult = log(...started("1.1"));
  assert.deepEqual(next(rows, noResult), { none: "Card 1.1 is in progress and has not posted a result yet." });
  assert.match(gate(rows, "1.2", noResult).reason, /^1\.1 is in progress and has not posted a result yet\.$/);
  // A milestone or a problem is not a result, and neither is a result about another card.
  for (const line of [["claude.said", { card: "1.1", text: "Half way." }], ["claude.said", { card: "1.1", say: "problem", text: "Stuck." }], result("1.2")])
    assert.ok(next(rows, log(...started("1.1"), line)).none, JSON.stringify(line));
  // A result posted before this start belongs to an earlier run of the card.
  assert.ok(next(rows, log(result("1.1"), ...started("1.1"))).none);
  const done = log(["prompt.received"], ...started("1.1"), result("1.1"));
  const d = next(rows, done);
  assert.deepEqual([d.card, d.after, d.n], ["1.2", "1.1", 2]);
  assert.match(d.why, /^1\.1 is finished and waits for the owner's check, 1\.2 is the highest-priority ready agent card/);
  assert.equal(gate(rows, "1.2", done).ok, true);
  // Two in progress: both must have reported.
  const two = { "1.1": { st: "START" }, "1.2": { st: "START" }, "1.3": {} };
  assert.deepEqual(next(two, log(...started("1.1"), result("1.1"), ...started("1.2"))), { none: "Card 1.2 is in progress and has not posted a result yet." });
  assert.equal(next(two, log(...started("1.1"), result("1.1"), ...started("1.2"), result("1.2"), ["prompt.received"])).after, "1.2", "it follows the card that finished last");
});

test("decision: the in-a-row ceiling, and it starts again only after the owner acts", () => {
  const rows = { "1.1": {}, "1.2": {}, "1.3": {}, "1.4": {}, "1.5": {} };
  const autos = (n) => Array.from({ length: n }, (_, i) => ["claude.auto", { card: "9." + i }]);
  assert.equal(next(rows, log(...autos(2))).n, 3);
  assert.deepEqual(next(rows, log(...autos(3))), { none: "3 cards were started automatically in a row, which is the limit (3). It waits for the owner." });
  assert.match(gate(rows, "1.1", log(...autos(3))).reason, /^The limit of 3 automatic starts in a row is reached/);
  assert.match(next(rows, log(...autos(1)), { plan: "accepted", auto: { ...AUTO, inARow: 1 } }).none, /^1 card was started automatically in a row, which is the limit \(1\)/);
  // The owner typing, or a request from the owner's inbox, resets the count.
  for (const act of [["prompt.received"], ["action.received", { inbox: "approvals", level: "owner", verb: "card.note" }], ["action.received", { inbox: "approvals", verb: "card.note" }]]) {
    const entries = log(...autos(3), act);
    assert.equal(next(rows, entries).n, 1, JSON.stringify(act));
    assert.equal(gate(rows, "1.1", entries).ok, true, JSON.stringify(act));
    assert.equal(next(rows, log(...autos(3), act, ...autos(2))).n, 3);
    assert.ok(next(rows, log(...autos(3), act, ...autos(3))).none);
  }
  // A contributor's request is not the owner's action, and neither is anything the agent or the board wrote.
  for (const act of [["action.received", { inbox: "actions", level: "interact", verb: "card.note" }], ["action.received", { inbox: "actions" }], ["claude.said", { text: "Still here." }], ["session.started"], ["action.done", { inbox: "approvals" }], ["pack.built"]]) {
    assert.ok(next(rows, log(...autos(3), act)).none, JSON.stringify(act));
    assert.equal(gate(rows, "1.1", log(...autos(3), act)).ok, false, JSON.stringify(act));
    assert.equal(isOwnerAction({ offset: 1, type: act[0], ...act[1] }), false);
  }
});

test("decision: the daily limit counts the last 24 hours, whoever acted in between", () => {
  const rows = { "1.1": {}, "1.2": {} };
  const settings = { plan: "accepted", auto: { ...AUTO, perDay: 4, inARow: 20 } };
  const autos = (n, ago) => Array.from({ length: n }, () => ["claude.auto", { card: "9.1" }, ago]);
  assert.equal(next(rows, log(...autos(3, 60)), settings).card, "1.1");
  assert.deepEqual(next(rows, log(...autos(4, 60)), settings), { none: "4 cards were started automatically in the last 24 hours, which is the daily limit (4)." });
  // The owner acting does not reset the day.
  assert.match(next(rows, log(...autos(4, 60), ["prompt.received"]), settings).none, /daily limit \(4\)/);
  assert.match(decideAuto({ verb: "card.move", card: "1.1", to: "START" }, { cards: cardsOf(rows), plan: "accepted", auto: settings.auto, entries: log(...autos(4, 60), ["prompt.received"]), now: NOW }).reason, /^The limit of 4 automatic starts in 24 hours is reached\.$/);
  // Starts older than 24 hours no longer count; one exactly 24 hours old has just dropped out.
  assert.equal(next(rows, log(...autos(4, 24 * 60 + 1), ["prompt.received"]), settings).card, "1.1");
  assert.equal(next(rows, log(...autos(3, 24 * 60 + 1), ...autos(3, 23 * 60), ["prompt.received"]), settings).card, "1.1");
  assert.ok(next(rows, log(...autos(1, 24 * 60), ...autos(4, 23 * 60 + 59), ["prompt.received"]), settings).none);
  // A start whose time cannot be read is counted, never forgiven; and with no clock nothing starts.
  assert.ok(nextAutoStart(cardsOf(rows), [1, 2, 3, 4].map((offset) => ({ offset, at: "not a time", type: "claude.auto" })).concat([{ offset: 5, at: "x", type: "prompt.received" }]), settings, NOW).none);
  assert.match(next(rows, [], settings, "soon").none, /The time is not known/);
});

test("decision: a card blocked after the last automatic start stops the row until the owner has acted", () => {
  const rows = { "1.1": { st: "BLOCKED" }, "1.2": {}, "1.3": {} };
  const blocked = ["card.moved", { card: "1.1", from: "START", to: "BLOCKED" }];
  const entries = log(["prompt.received"], ...started("1.1"), blocked);
  assert.deepEqual(next(rows, entries), { none: "Card 1.1 was blocked after the last automatic start. Automatic starts wait until the owner has acted." });
  assert.match(gate(rows, "1.2", entries).reason, /^Card 1\.1 was blocked after the last automatic start\.$/);
  // Blocked before the last automatic start: that start already happened knowing it.
  assert.equal(next(rows, log(blocked, ["prompt.received"], ["claude.auto", { card: "9.1" }])).card, "1.2");
  // The owner has seen it: the row may go on.
  assert.equal(next(rows, log(...started("1.1"), blocked, ["prompt.received"])).card, "1.2");
  assert.equal(gate(rows, "1.2", log(...started("1.1"), blocked, ["prompt.received"])).ok, true);
  // A block by an older event name still counts.
  assert.ok(next(rows, log(["card.moved", { id: "1.1", to: "BLOCKED" }])).none);
});

test("decision: an unanswered question pauses automatic starts, unless the owner switched that off", () => {
  const rows = { "1.1": {}, "1.2": {}, "1.3": { st: "DONE" } };
  const asked = log(["prompt.received"], ["claude.asked", { card: "1.3", text: "Which host?" }]);
  assert.deepEqual(next(rows, asked), { none: "A question on card 1.3 is waiting for the owner's answer." });
  assert.equal(gate(rows, "1.1", asked).reason, "A question is waiting for the owner's answer.");
  const answered = log(["prompt.received"], ["claude.asked", { card: "1.3", text: "Which host?" }], ["question.answered", { card: "1.3", qid: "q2", text: "The cheap one" }]);
  assert.equal(next(rows, answered).card, "1.1");
  assert.equal(gate(rows, "1.1", answered).ok, true);
  // An answer to another question does not answer this one.
  assert.ok(next(rows, log(["claude.asked", { card: "1.3" }], ["question.answered", { card: "1.3", qid: "q9" }])).none);
  // pauseOnQuestion false: the row goes on, but never onto the card the question is about.
  const off = { plan: "accepted", auto: { ...AUTO, pauseOnQuestion: false } };
  const onIt = log(["claude.asked", { card: "1.1", text: "Which colour?" }]);
  assert.equal(next(rows, onIt, off).card, "1.2");
  const cards = cardsOf(rows);
  assert.match(decideAuto({ verb: "card.move", card: "1.1", to: "START" }, { cards, plan: "accepted", auto: off.auto, entries: onIt, now: NOW }).reason, /1\.1 has a question waiting/);
  assert.equal(decideAuto({ verb: "card.move", card: "1.2", to: "START" }, { cards, plan: "accepted", auto: off.auto, entries: onIt, now: NOW }).ok, true);
  // The same open questions the page's rule sees.
  assert.deepEqual(autoFacts(asked, NOW).openQuestions, openQuestionCards(asked));
});

test("decision: the candidate is ready, the agent's, ungated and not a contributor's; anything else is never chosen", () => {
  const none = { none: "No agent card is ready that needs no approval." };
  assert.deepEqual(next({ "1.1": { gate: "approval" }, "1.2": { gate: "money" } }), none);
  assert.deepEqual(next({ "1.1": { own: "human" } }), none);
  assert.deepEqual(next({ "1.1": { contributed: true } }), none);
  assert.deepEqual(next({ "1.1": { st: "BLOCKED" }, "1.2": { deps: "1.1" }, "1.3": { st: "DONE" } }), none, "blocked, waiting on a card, and done");
  assert.equal(contributed(cardsOf({ "1.1": { contributed: true } })[0]), true, "the gateway's own test is the one reused");
  // The gateway refuses each by name, as never automatic.
  assert.equal(gate({ "1.1": { gate: "approval" } }, "1.1").never, "gate.approve");
  assert.equal(gate({ "1.1": { own: "human" } }, "1.1").never, "start.human");
  assert.equal(gate({ "1.1": { contributed: true } }, "1.1").never, "start.contributed");
  assert.match(gate({ "1.1": { st: "DONE" }, "1.2": { deps: "1.3" }, "1.3": {} }, "1.2").reason, /1\.2 is waiting on 1\.3/);
  assert.match(gate({ "1.1": { st: "DONE" } }, "1.1").reason, /only a ready card starts automatically/);
  assert.match(gate(THREE, "9.9").reason, /There is no card 9\.9/);
  // It steps over what does not qualify and takes the first that does.
  assert.equal(next({ "1.1": { gate: "approval" }, "1.2": { own: "human" }, "1.3": { contributed: true }, "1.4": { st: "DONE" }, "1.5": { deps: "1.4" } }).card, "1.5");
  // A pinned card (DOING) with its dependencies done is Ready by the board's rule.
  assert.equal(next({ "1.1": { st: "DOING" } }).card, "1.1");
});

test("decision: among the cards that qualify, the engine's priority decides, and the gateway refuses any other", () => {
  // 1.3 unblocks two cards, 1.2 is quick, 1.1 is plain: the engine scores 1.3 highest.
  const rows = { "1.1": { eff: "L" }, "1.2": { eff: "Q" }, "1.3": { eff: "L" }, "1.4": { deps: "1.3" }, "1.5": { deps: "1.4" } };
  const cards = cardsOf(rows), E = computeBoard(cards, {});
  const order = cards.filter((c) => ["1.1", "1.2", "1.3"].includes(c.id)).sort((a, b) => E.score(b) - E.score(a)).map((c) => c.id);
  assert.deepEqual(order, ["1.3", "1.2", "1.1"]);
  assert.equal(next(rows).card, "1.3");
  assert.equal(gate(rows, "1.3").ok, true);
  assert.match(gate(rows, "1.2").reason, /^1\.3 comes before 1\.2: only the next card by priority starts automatically\.$/);
  // A tie goes to the lower id, as in the engine.
  assert.equal(next({ "1.10": {}, "1.9": {}, "1.2": {} }).card, "1.2");
  assert.match(gate({ "1.10": {}, "1.9": {} }, "1.10").reason, /^1\.9 comes before 1\.10/);
  // The finish path counts when the project names one.
  const finish = { "1.1": {}, "1.2": {}, "1.3": { deps: "1.2" } };
  assert.equal(nextAutoStart(cardsOf(finish), [], { ...ON, finish: "1.3" }, NOW).card, "1.2");
});

test("decision: the function is pure — the same inputs give the same answer, and nothing it was given is changed", () => {
  const cards = cardsOf(THREE), entries = log(["prompt.received"], ...started("1.1"));
  const before = JSON.stringify([cards, entries, ON]);
  const a = nextAutoStart(cards, entries, ON, NOW), b = nextAutoStart(cards, entries, ON, new Date(NOW)), c = nextAutoStart(cards, entries, ON, new Date(NOW).toISOString());
  assert.deepEqual(a, b); assert.deepEqual(a, c);
  assert.equal(JSON.stringify([cards, entries, ON]), before);
  // Rubbish in the log is stepped over, never thrown on.
  assert.equal(nextAutoStart(cards, [null, 7, "x", {}, { offset: "1" }, { type: "claude.auto" }], ON, NOW).card, "1.1");
  for (const junk of [null, undefined, "x", 7]) { assert.ok(nextAutoStart(junk, junk, ON, NOW).none); assert.ok(nextAutoStart(cards, [], junk, NOW).none); }
});

test("on 300 random boards the decision never returns a card that is gated, the human's, a contributor's, not Ready, or past a ceiling; and the gateway agrees card by card", () => {
  let seed = 20261006;
  const rnd = (n) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; }; // mulberry32
  const pick = (a) => a[rnd(a.length)];
  let chosen = 0, refused = 0;
  for (let b = 0; b < 300; b++) {
    const n = 3 + rnd(22), cards = [];
    for (let i = 1; i <= n; i++) {
      const deps = i > 1 && rnd(3) === 0 ? [...new Set([1 + rnd(i - 1), 1 + rnd(i - 1)])].map((d) => "1." + d).join(", ") : "-";
      const added = rnd(8) === 0;
      cards.push({ id: "1." + i, g: 1, st: pick(["BACKLOG", "BACKLOG", "BACKLOG", "DOING", "START", "DONE", "DONE", "BLOCKED"]), own: rnd(4) === 0 ? "human" : "agent", type: "code", eff: pick(["Q", "S", "L"]),
        gate: pick(["-", "-", "-", "-", "approval", "money"]), deps, title: "Card " + i, t: "Card " + i, pts: added ? ["Note: Added by a contributor on 2026-10-01."] : ["Why: A reason."] });
    }
    const entries = [], add = (type, data = {}) => entries.push({ offset: entries.length + 1, at: new Date(NOW - rnd(40 * 60) * 60000).toISOString(), type, ...data });
    for (let i = 0, m = rnd(30); i < m; i++) {
      const c = pick(cards).id;
      switch (rnd(9)) {
        case 0: add("prompt.received"); break;
        case 1: add("claude.auto", { card: c }); break;
        case 2: add("card.moved", { card: c, to: pick(["START", "START", "BLOCKED", "DONE", "BACKLOG"]) }); break;
        case 3: case 4: add("claude.said", { card: c, say: pick(["result", "result", "problem", undefined]), text: "x" }); break;
        case 5: add("claude.asked", { card: c, text: "?" }); break;
        case 6: { const q = entries.filter((e) => e.type === "claude.asked"); if (q.length) add("question.answered", { qid: "q" + pick(q).offset }); break; }
        case 7: add("action.received", { inbox: pick(["approvals", "actions"]) }); break;
        default: add("session.started");
      }
    }
    // Every card in progress usually has its result, so that the later rules are reached too.
    cards.filter((c) => c.st === "START").forEach((c) => { if (rnd(4)) add("claude.said", { card: c.id, say: "result", text: "Finished." }); });
    if (rnd(3)) add("prompt.received");
    const auto = { ...AUTO, start: rnd(10) !== 0, paused: rnd(10) === 0, inARow: 1 + rnd(4), perDay: 1 + rnd(6), pauseOnQuestion: rnd(2) === 0 };
    const settings = { plan: rnd(12) === 0 ? "draft" : "accepted", auto };
    const d = nextAutoStart(cards, entries, settings, NOW);
    const E = computeBoard(cards, {});
    const g = (id) => decideAuto({ verb: "card.move", card: id, to: "START" }, { cards, plan: settings.plan, auto, entries, now: NOW, score: E.score });
    if (d.card) {
      chosen++;
      const c = cards.find((x) => x.id === d.card), V = boardViews(cards, { openQuestions: openQuestionCards(entries) });
      assert.equal(V.state[c.id], "ready", `board ${b}: ${c.id} is not Ready`);
      assert.equal(c.own, "agent", `board ${b}`); assert.equal(c.gate, "-", `board ${b}`); assert.equal(contributed(c), false, `board ${b}`);
      assert.equal(V.needsYou[c.id], undefined, `board ${b}`);
      assert.ok(settings.plan === "accepted" && auto.start === true && auto.paused === false, `board ${b}`);
      const lastOwner = Math.max(0, ...entries.filter(isOwnerAction).map((e) => e.offset));
      const autos = entries.filter((e) => e.type === "claude.auto");
      assert.ok(autos.filter((e) => e.offset > lastOwner).length < auto.inARow, `board ${b}: past the in-a-row ceiling`);
      assert.ok(autos.filter((e) => Date.parse(e.at) > NOW - 86400000).length < auto.perDay, `board ${b}: past the daily limit`);
      if (auto.pauseOnQuestion) assert.deepEqual(openQuestionCards(entries), [], `board ${b}: a question is open`);
      assert.equal(d.n, autos.filter((e) => e.offset > lastOwner).length + 1);
    } else { refused++; assert.equal(typeof d.none, "string"); assert.ok(d.none.length > 10); }
    // The second check, written separately, gives the same answer for every card on the board.
    for (const c of cards) assert.equal(g(c.id).ok, c.id === d.card, `board ${b}: the gateway and the rule disagree on ${c.id} (${JSON.stringify(g(c.id))} against ${JSON.stringify(d)})`);
  }
  assert.ok(chosen >= 40 && refused >= 40, `the boards must exercise both answers: ${chosen} chosen, ${refused} refused`);
});

// ── `cockpit next`, end to end ──

const BOARD = { title: "Auto", artifact: "https://claude.ai/artifact/auto-test", auto: { start: true } };
const FIVE = board({ "1.1": {}, "1.2": {}, "1.3": {}, "1.4": {}, "1.5": { gate: "approval" } });
const writeLog = (dir, list) => { fs.mkdirSync(P(dir).local, { recursive: true }); fs.writeFileSync(P(dir).events, list.map((e, i) => JSON.stringify({ offset: i + 1, at: new Date().toISOString(), ...e })).join("\n") + "\n"); };
const snapshot = (dir) => [read(P(dir).record), read(P(dir).config), lines(P(dir).events).length];

test("next: prints the decision and its reason, and changes nothing", () => {
  const dir = project(BOARD, FIVE);
  const before = snapshot(dir);
  const r = cli(dir, "next");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), ["Next automatic start: 1.1 Card 1.1 (it would be 1 of 3 in a row).",
    "Why: Nothing is in progress, 1.1 is the highest-priority ready agent card, and it needs no approval.", "Nothing was changed. To start it: cockpit next --start"]);
  assert.deepEqual(snapshot(dir), before);
  assert.ok(!fs.existsSync(P(dir).page), "not even the page is built");
  rm(dir);
  const off = project({ title: "Auto" }, FIVE);   // no auto block: automatic starts are off until a project turns them on
  assert.match(cli(off, "next").stdout, /^No automatic start\. Automatic starts are off/);
  rm(off);
  const never = project({ title: "Auto", auto: { start: false } }, FIVE);
  const n = cli(never, "next");
  assert.deepEqual([n.status, n.stdout.trim()], [0, "No automatic start. Automatic starts are off (auto.start is not true in .cockpit/config.json).\nNothing was changed."]);
  rm(never);
});

test("next --start: the row moves to START with its note, the event carries the sentence and the undo, the page is rebuilt and the batch is prepared", () => {
  const dir = project(BOARD, FIVE);
  const before = read(P(dir).record), config = read(P(dir).config);
  const r = cli(dir, "next", "--start");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = r.stdout.trim().split("\n");
  assert.equal(out[0], "Started automatically #2: 1.1 Card 1.1 (1 of 3 in a row).");
  assert.equal(out[1], "I started 1.1 because nothing was in progress, it was next, and it needs no approval.");
  assert.match(out[2], /^WORK TO START NOW: 1\.1 Card 1\.1\./);
  assert.equal(out[3], "Send with one ArtifactData batch call: " + path.join(P(dir).out, "push-batch-1.json").replaceAll("\\", "/"));
  assert.equal(out[4], "Then run: cockpit push --sent 2");

  // The record: one row changed, by the existing apply path, and nothing else.
  const a = before.split("\n"), b = read(P(dir).record).split("\n");
  assert.equal(a.length, b.length, "no row was added or removed");
  const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i != null);
  assert.equal(changed.length, 1);
  const [was, is] = [a[changed[0]].split(" | "), b[changed[0]].split(" | ")];
  assert.deepEqual([was[1], is[1]], ["BACKLOG", "START"]);
  assert.match(is[7], /^\*\*Card 1\.1\.\*\* Does a thing\. • Why: A reason\. • Started automatically by the agent on \*\*\d{4}-\d\d-\d\d\*\* \(rule: next ready card, 1 of 3\)\.$/);
  assert.ok(is[7].startsWith(was[7]), "the card's own text is untouched");
  for (const i of [0, 2, 3, 4, 5, 6, 8]) assert.equal(is[i], was[i], "cell " + i);
  assert.deepEqual(parseLaunch(read(P(dir).record)).errors, []);
  assert.equal(read(P(dir).config), config, "the settings are not touched");

  // The log: the move, then the announcement.
  const all = lines(P(dir).events);
  assert.deepEqual(all.map((e) => e.type), ["card.moved", "claude.auto"]);
  assert.deepEqual({ card: all[0].card, from: all[0].from, to: all[0].to, via: all[0].via }, { card: "1.1", from: "BACKLOG", to: "START", via: "auto" });
  const { offset, at, ...auto } = all[1];
  assert.deepEqual(auto, { type: "claude.auto", text: "I started 1.1 because nothing was in progress, it was next, and it needs no approval.", card: "1.1", rule: "next-ready", n: 1, of: 3,
    move: { from: "BACKLOG", to: "START" }, undo: { verb: "card.move", card: "1.1", to: "BACKLOG" } });
  assert.deepEqual(entryOf(all[1]), { offset: 2, at, kind: "auto", who: "Agent", text: auto.text, card: "1.1", say: "auto", move: { from: "BACKLOG", to: "START" }, auto: { rule: "next-ready", undo: { verb: "card.move", card: "1.1", to: "BACKLOG" } } });

  // The page and the batch.
  assert.ok(fs.existsSync(P(dir).page), "the board was rebuilt");
  assert.equal(lines(P(dir).events).length, 2, "the rebuild did not log the move a second time");
  const batch = readJSON(path.join(P(dir).out, "push-batch-1.json"));
  assert.deepEqual(batch.map((w) => [w.op, w.collection, w.doc_id]), [["set", "live", "u1"], ["set", "live", "u2"]]);
  assert.deepEqual(readJSON(batch[1].file_path), entryOf(all[1]));
  rm(dir);
});

test("next --start: after a result it follows the finished card and says so; every refusal leaves the record byte for byte as it was", () => {
  const dir = project(BOARD, FIVE);
  assert.equal(cli(dir, "next", "--start").status, 0);
  // 1. The card in progress has not reported.
  let before = snapshot(dir);
  let r = cli(dir, "next", "--start");
  assert.deepEqual([r.status, r.stdout.trim()], [1, "Not started. Card 1.1 is in progress and has not posted a result yet.\nNothing was changed."]);
  assert.deepEqual(snapshot(dir), before);
  // It reports: the next one starts, and the sentence names both.
  assert.equal(cli(dir, "say", "Card 1.1 is finished: 12 of 12 checks pass.", "--card", "1.1", "--kind", "result").status, 0);
  r = cli(dir, "next", "--start");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Started automatically #5: 1\.2 Card 1\.2 \(2 of 3 in a row\)\.\nI finished 1\.1 and started 1\.2 because it was next and needs no approval\.$/m);
  const e = lines(P(dir).events).at(-1);
  assert.deepEqual([e.type, e.card, e.after, e.n, e.of, e.text], ["claude.auto", "1.2", "1.1", 2, 3, autoSentence("1.2", "1.1")]);
  assert.match(row(dir, "1.2"), /• Started automatically by the agent on \*\*\d{4}-\d\d-\d\d\*\* \(rule: next ready card, 2 of 3\)\. \| Seen \|$/);
  assert.match(row(dir, "1.1"), /^\| 1\.1 \| START \|/, "the finished card stays in Start: Done is the owner's");
  // 2. The third starts, and then the ceiling holds.
  assert.equal(cli(dir, "say", "Finished.", "--card", "1.2", "--kind", "result").status, 0);
  assert.equal(cli(dir, "next", "--start").status, 0);
  assert.equal(cli(dir, "say", "Finished.", "--card", "1.3", "--kind", "result").status, 0);
  before = snapshot(dir);
  r = cli(dir, "next", "--start");
  assert.deepEqual([r.status, r.stdout.trim()], [1, "Not started. 3 cards were started automatically in a row, which is the limit (3). It waits for the owner.\nNothing was changed."]);
  assert.deepEqual(snapshot(dir), before);
  assert.match(row(dir, "1.4"), /^\| 1\.4 \| BACKLOG \|/);
  rm(dir);

  // 3. Every other reason, each on its own project.
  const cases = [
    [{ ...BOARD, plan: "draft" }, FIVE, null, /^Not started\. The plan is a draft/],
    [{ ...BOARD, auto: { start: false } }, FIVE, null, /^Not started\. Automatic starts are off/],
    [{ ...BOARD, auto: { start: true, paused: true } }, FIVE, null, /^Not started\. Automatic work is paused by the owner\./],
    [BOARD, FIVE, (d) => assert.equal(cli(d, "ask", "Which host?", "--card", "1.5").status, 0), /^Not started\. A question on card 1\.5 is waiting for the owner's answer\./],
    [BOARD, board({ "1.1": { st: "BLOCKED" }, "1.2": {} }), (d) => writeLog(d, [{ type: "card.moved", card: "1.1", from: "START", to: "BLOCKED" }]), /^Not started\. Card 1\.1 was blocked after the last automatic start/],
    [{ ...BOARD, auto: { start: true, perDay: 1 } }, FIVE, (d) => writeLog(d, [{ at: new Date(Date.now() - 3600000).toISOString(), type: "claude.auto", card: "9.9" }, { type: "prompt.received" }]), /^Not started\. 1 card was started automatically in the last 24 hours, which is the daily limit \(1\)\./],
    [BOARD, board({ "1.1": { gate: "approval" }, "1.2": { own: "human" }, "1.3": { contributed: true }, "1.4": { st: "DONE" } }), null, /^Not started\. No agent card is ready that needs no approval\./],
  ];
  for (const [config, md, setup, re] of cases) {
    const d = project(config, md);
    if (setup) setup(d);
    const was = snapshot(d);
    const x = cli(d, "next", "--start");
    assert.equal(x.status, 1, String(re)); assert.match(x.stdout, re); assert.match(x.stdout, /\nNothing was changed\.\n$/);
    assert.deepEqual(snapshot(d), was, String(re));
    rm(d);
  }
});

test("next --start: two at once start one card, not two", async () => {
  const dir = project(BOARD, FIVE);
  // A lock another run holds: this run changes nothing and says why.
  fs.mkdirSync(P(dir).local, { recursive: true });
  fs.writeFileSync(path.join(P(dir).local, "write.lock"), "");   // the one lock of every writing command (finding R2)
  const before = snapshot(dir);
  const r = cliEnv(dir, { COCKPIT_LOCK_WAIT_MS: "100" }, "next", "--start");
  assert.equal(r.status, 1); assert.match(r.stderr, /another command is writing: run it again\. Nothing was changed\./);
  assert.deepEqual(snapshot(dir), before);
  // A lock left by a run that died (older than a minute) is taken over.
  const old = new Date(Date.now() - 5 * 60000);
  fs.utimesSync(path.join(P(dir).local, "write.lock"), old, old);
  assert.equal(cli(dir, "next", "--start").status, 0);
  assert.ok(!fs.existsSync(path.join(P(dir).local, "write.lock")), "the lock is given back");
  rm(dir);
});

// ── NEVER_AUTOMATIC ──

test("NEVER_AUTOMATIC: the list is fixed, and the automatic door refuses each thing on it by name", () => {
  assert.deepEqual(NEVER_AUTOMATIC.map((n) => n.key), ["gate.approve", "plan.accept", "card.done", "start.human", "start.contributed", "card.edit", "card.delete", "auto.change"]);
  assert.ok(Object.isFrozen(NEVER_AUTOMATIC) && NEVER_AUTOMATIC.every(Object.isFrozen));
  assert.throws(() => { "use strict"; NEVER_AUTOMATIC.push({ key: "x" }); });
  const rows = { "1.1": {}, "1.2": { gate: "approval" }, "1.3": { own: "human" }, "1.4": { contributed: true }, "1.5": { st: "START" } };
  const cards = cardsOf(rows);
  // Everything allowed: the plan accepted, starts on, nothing counted, the fullest access anyone could claim.
  const ctx = { cards, plan: "accepted", auto: { ...AUTO, inARow: 20, perDay: 200 }, entries: log(result("1.5")), now: NOW, level: "owner", confirmed: true };
  const tries = [
    [{ verb: "gate.approve", card: "1.2" }, "gate.approve"], [{ verb: "card.move", card: "1.2", to: "START" }, "gate.approve"],
    [{ verb: "card.move", card: "1.1", to: "START", approves: "approval" }, "gate.approve"], [{ verb: "card.move", card: "1.1", to: "START", confirmed: true }, "gate.approve"],
    [{ verb: "plan.accept" }, "plan.accept"],
    [{ verb: "card.move", card: "1.5", to: "DONE" }, "card.done"], [{ verb: "card.move", card: "1.1", to: "DONE" }, "card.done"], [{ verb: "card.done", card: "1.5" }, "card.done"],
    [{ verb: "card.move", card: "1.3", to: "START" }, "start.human"],
    [{ verb: "card.move", card: "1.4", to: "START" }, "start.contributed"],
    [{ verb: "card.edit", card: "1.1", title: "New" }, "card.edit"], [{ verb: "card.note", card: "1.1", text: "x" }, "card.edit"], [{ verb: "card.add", goal: 1, title: "New", owner: "agent" }, "card.edit"],
    [{ verb: "notes.add", section: "Preferences", text: "x" }, "card.edit"], [{ verb: "notes.remove", id: "n1" }, "card.edit"],
    [{ verb: "card.delete", card: "1.1" }, "card.delete"], [{ verb: "card.remove", card: "1.1" }, "card.delete"],
    [{ verb: "auto.set", paused: false }, "auto.change"], [{ verb: "auto.set", start: true }, "auto.change"], [{ verb: "config.set", auto: { inARow: 99 } }, "auto.change"],
  ];
  const reached = new Set();
  for (const [action, key] of tries) {
    const d = decideAuto(action, ctx);
    assert.equal(d.ok, false, JSON.stringify(action));
    assert.equal(d.never, key, JSON.stringify(action));
    assert.equal(d.reason, "Never automatic: " + NEVER_AUTOMATIC.find((n) => n.key === key).what + ".");
    reached.add(key);
  }
  assert.deepEqual([...reached].sort(), NEVER_AUTOMATIC.map((n) => n.key).sort(), "every item on the list was tried");
  // Every verb of the board, and anything else, is refused: one act is automatic.
  for (const verb of [...Object.keys(VERBS), "task.start", "release.push", "", "constructor", undefined, 7]) {
    for (const to of ["BACKLOG", "DOING", "BLOCKED", "DONE", undefined]) {
      const d = decideAuto({ verb, card: "1.1", to, paused: false, text: "x", title: "x", id: "n1", section: "Preferences", goal: 1, owner: "agent", qid: "q1" }, ctx);
      assert.equal(d.ok, false, verb + " " + to);
    }
  }
  for (const junk of [null, undefined, "card.move", 7, []]) assert.equal(decideAuto(junk, ctx).ok, false);
  // The one thing it allows, and what the allowed decision holds: a start, with no approval in it.
  const ok = decideAuto({ verb: "card.move", card: "1.1", to: "START" }, ctx);
  assert.deepEqual(ok, { ok: true, verb: "card.move", risk: "low", mode: "apply", auto: { n: 1, of: 20 }, args: { card: "1.1", to: "START", from: "BACKLOG" } });
});

test("NEVER_AUTOMATIC: the apply path refuses to write anything automatic that is not a plain start of an ungated agent card", () => {
  const md = board({ "1.1": {}, "1.2": { gate: "approval" }, "1.3": { own: "human" }, "1.4": { contributed: true }, "1.5": { st: "START" }, "1.6": { st: "DONE" } });
  const auto = { n: 1, of: 3 }, base = { ok: true, mode: "apply", auto };
  const start = (card, extra = {}) => ({ ...base, verb: "card.move", args: { card, to: "START", from: "BACKLOG", ...extra } });
  assert.match(applyDecision(md, start("1.1"), { date: "2026-10-06" }).md, /\| 1\.1 \| START \|.*Started automatically by the agent on \*\*2026-10-06\*\* \(rule: next ready card, 1 of 3\)\./);
  const refused = [
    [start("1.2"), /cannot be started automatically/, "a gated card"], [start("1.2", { approves: "approval" }), /never approves one/, "an approval"],
    [start("1.3"), /cannot be started automatically/, "the human's card"], [start("1.4"), /cannot be started automatically/, "a contributor's card"],
    [start("1.5"), /cannot be started automatically/, "a card already in Start"], [start("1.6"), /cannot be started automatically/, "a done card"],
    [{ ...base, verb: "card.move", args: { card: "1.5", to: "DONE", from: "START" } }, /can only start a card/, "marking Done"],
    [{ ...base, verb: "card.move", args: { card: "1.1", to: "BLOCKED", from: "BACKLOG" } }, /can only start a card/, "blocking"],
    [{ ...base, verb: "gate.approve", args: { card: "1.2" } }, /can only start a card/, "approving a gate"],
    [{ ...base, verb: "card.edit", args: { card: "1.1", title: "New" } }, /can only start a card/, "editing"],
    [{ ...base, verb: "card.note", args: { card: "1.1", text: "x" } }, /can only start a card/, "a note"],
    [{ ...base, verb: "card.add", args: { goal: 1, title: "New", owner: "agent", deps: [] } }, /can only start a card/, "adding a card"],
    [{ ...base, verb: "question.answer", args: { card: "1.1", qid: "q1", text: "x" } }, /can only start a card/, "answering for the owner"],
    [{ ...start("1.1"), auto: { n: 4, of: 3 } }, /within the limit/, "past the ceiling"], [{ ...start("1.1"), auto: true }, /which one it is in the row/, "an unnumbered start"],
    [{ ...start("1.1"), auto: {} }, /which one it is in the row/, "an unnumbered start"],
  ];
  for (const [d, re, what] of refused) assert.throws(() => applyDecision(md, d, { date: "2026-10-06" }), re, what);
  // And the settings applier takes nothing automatic at all: it wants the gateway's own auto.set decision.
  assert.throws(() => applyAutoSet('{"auto":{"paused":true}}', { ...base, verb: "card.move", args: { paused: false } }), /only an approved auto\.set/);
});

// Boards on which the forbidden thing is the ONLY move left. Each must end with nothing changed.
// (Moved out of the test below on 2026-10-06, word for word, so the heartbeat's proof runs on the same boards.)
const ONLY_FORBIDDEN = () => ({
  "approving a gate": [BOARD, board({ "1.1": { gate: "approval" }, "1.2": { gate: "money" } })],
  "accepting the plan": [{ ...BOARD, plan: "draft" }, FIVE],
  "marking a card Done": [BOARD, board({ "1.1": { st: "START" } })],
  "starting a card owned by the human": [BOARD, board({ "1.1": { own: "human" } })],
  "starting a card a contributor added": [BOARD, board({ "1.1": { contributed: true } })],
  "changing the automatic-work settings": [{ ...BOARD, auto: { start: false, inARow: 1 } }, FIVE],
});

test("NEVER_AUTOMATIC: through `next --start` no gate is approved, no plan accepted, nothing marked Done, no human or contributor card started, no card edited or deleted, no setting changed", () => {
  const only = ONLY_FORBIDDEN();
  for (const [what, [config, md]] of Object.entries(only)) {
    assert.ok(NEVER_AUTOMATIC.some((n) => n.what === what), what + " is on the list");
    const dir = project(config, md);
    if (what === "marking a card Done") writeLog(dir, [{ type: "card.moved", card: "1.1", to: "START" }, { type: "claude.said", say: "result", card: "1.1", text: "Finished." }]);
    const before = snapshot(dir);
    for (let i = 0; i < 3; i++) assert.equal(cli(dir, "next", "--start").status, 1, what);
    assert.deepEqual(snapshot(dir), before, what + ": the record, the settings and the log are as they were");
    rm(dir);
  }
  // On a board with every kind of card, run it until it stops. Then look at everything it did.
  const md = board({ "1.1": {}, "1.2": { gate: "approval" }, "1.3": { own: "human" }, "1.4": { contributed: true }, "1.5": {}, "1.6": { st: "DONE" }, "1.7": { deps: "1.2" }, "1.8": {} });
  const dir = project({ ...BOARD, auto: { start: true, inARow: 20, perDay: 200 } }, md);
  const config = read(P(dir).config);
  let starts = 0;
  for (let i = 0; i < 12; i++) {
    const r = cli(dir, "next", "--start");
    if (r.status !== 0) break;
    starts++;
    const c = lines(P(dir).events).at(-1).card;
    assert.equal(cli(dir, "say", "Finished.", "--card", c, "--kind", "result").status, 0);
  }
  assert.equal(starts, 3, "1.1, 1.5 and 1.8: the three ready agent cards that need no approval");
  const was = parseLaunch(md).cards, now = parseLaunch(read(P(dir).record));
  assert.deepEqual(now.errors, []);
  assert.deepEqual(now.cards.map((c) => c.id), was.map((c) => c.id), "no card was added or deleted");
  for (const c of now.cards) {
    const o = was.find((x) => x.id === c.id);
    assert.deepEqual([c.own, c.gate, c.deps, c.type, c.eff, c.title, c.desc, c.dw], [o.own, o.gate, o.deps, o.type, o.eff, o.title, o.desc, o.dw], c.id + ": nothing about the card was edited");
    if (["1.1", "1.5", "1.8"].includes(c.id)) { assert.equal(c.st, "START"); assert.deepEqual(c.pts.slice(0, -1), o.pts); assert.match(c.pts.at(-1), /^Started automatically by the agent on /); }
    else { assert.equal(c.st, o.st, c.id + " did not move"); assert.deepEqual(c.pts, o.pts); }
  }
  assert.equal(now.cards.filter((c) => c.st === "DONE").length, 1, "nothing was marked Done");
  assert.equal(read(P(dir).config), config, "the settings file is byte for byte the same");
  const types = new Set(lines(P(dir).events).map((e) => e.type));
  assert.deepEqual([...types].sort(), ["card.moved", "claude.auto", "claude.said"], "no approval, no plan, no edit and no settings event was ever written");
  assert.ok(lines(P(dir).events).filter((e) => e.type === "card.moved").every((e) => e.to === "START" && e.via === "auto"));
  rm(dir);
});

test("NEVER_AUTOMATIC: the code of `next` reaches the record only through the automatic door, and never the settings file", () => {
  const src = read(path.join(REPO, "plugin", "src", "cli", "cockpit.mjs"));
  const body = src.slice(src.indexOf("function next() {"), src.indexOf("// ── remember:"));
  assert.ok(body.length > 400 && body.length < 4000, "the function was found");
  assert.match(body, /decideAuto\(\{ verb: "card\.move", card: d\.card, to: "START" \}/);
  assert.equal((body.match(/applyDecision\(/g) || []).length, 1);
  assert.match(body, /applyDecision\(md, g,/, "what is applied is the gateway's own answer, unchanged");
  for (const word of ["CONFIG_FILE", "applyAutoSet", "decide(", "gate.approve", "plan.accept", "\"DONE\"", "addNote", "removeNote", "writeText"]) assert.ok(!body.includes(word), word);
  assert.deepEqual((body.match(/writeFileSync\(([A-Z_a-z.]+)/g) || []), [], "no file is written in place (finding R1)");
  assert.deepEqual((body.match(/(?:swap|writeAtomic)\(([A-Z_a-z.]+)/g) || []).map((m) => m.split("(")[1]), ["RECORD"], "it writes the record, whole, and nothing else");
  assert.match(body, /catch \(err\) \{ back\(\);/, "and puts it back if the log fails");
});

// ── The heartbeat (card 11.8): the same proof, through every command its checklist names ──

test("NEVER_AUTOMATIC: a heartbeat that follows its whole checklist reaches nothing on the list", () => {
  const ALL_DAY = { everyMin: 30, from: "00:00", to: "00:00", perDay: 24 };
  const stepsOf = (out) => out.split("\n").filter((l) => /^[1-6]\. /.test(l)).map((l) => l.slice(l.lastIndexOf(": cockpit ") + 10));
  const allowed = new Set(["heartbeat.ran", "pack.built", "mirror.diffed", "claude.said", "turn.ended"]);
  const follow = (dir) => {
    const beat = cli(dir, "heartbeat");
    assert.equal(beat.status, 0, beat.stderr);
    assert.match(beat.stdout, /^HEARTBEAT 1 of 24/, "the tick ran");
    // The commands are taken from what the heartbeat printed, not from this test: these six, in this order, and no others.
    const steps = stepsOf(beat.stdout);
    assert.deepEqual(steps.map((s) => s.split(" ")[0]), ["pack", "inbox", "next", "say", "turn-end", "push"]);
    assert.deepEqual(steps, ["pack", "inbox --from <dir>", "next --start", 'say "<what changed>"', 'turn-end "<what happened>" --next "<what is next>"', "push --sent <number>"]);
    assert.ok(!/gate|approve|accept|done|edit|delete|config|auto\.set|notes/i.test(steps.join(" ")), "no step names a forbidden act");
    const from = exported({ actions: {}, approvals: {}, cards: {}, board: {} });   // the board has no waiting request
    const ran = [];
    ran.push(cli(dir, "pack"));
    ran.push(cli(dir, "inbox", "--from", from));
    ran.push(cli(dir, "next", "--start"));
    ran.push(cli(dir, "say", "The heartbeat looked and nothing may start."));
    const end = cli(dir, "turn-end", "Nothing could be started.", "--next", "It waits for the owner.");
    ran.push(end);
    const sent = (end.stdout.match(/push --sent (\d+)/) || [])[1];
    assert.ok(sent, "turn-end named the batch to record: " + end.stdout);
    ran.push(cli(dir, "push", "--sent", sent));
    rm(from);
    return ran;
  };
  for (const [what, [config, md]] of Object.entries(ONLY_FORBIDDEN())) {
    assert.ok(NEVER_AUTOMATIC.some((n) => n.what === what), what + " is on the list");
    const dir = project({ ...config, auto: { ...config.auto, heartbeat: ALL_DAY } }, md);
    if (what === "marking a card Done") writeLog(dir, [{ type: "card.moved", card: "1.1", to: "START", at: new Date(Date.now() - 3600000).toISOString() },
      { type: "claude.said", say: "result", card: "1.1", text: "Finished.", at: new Date(Date.now() - 1800000).toISOString() }]);
    const [record, config0, n0] = snapshot(dir);
    const ran = follow(dir);
    assert.deepEqual(ran.map((r) => r.status), [0, 0, 1, 0, 0, 0], what + ": every step ran, and the automatic start was refused");
    assert.match(ran[2].stdout, /^Not started\. .*\nNothing was changed\./, what);
    assert.equal(read(P(dir).record), record, what + ": the record is byte for byte the same");
    assert.equal(read(P(dir).config), config0, what + ": the settings are byte for byte the same");
    const added = lines(P(dir).events).slice(n0).map((e) => e.type);
    assert.ok(added.length >= 4 && added.every((t) => allowed.has(t)), what + ": only the heartbeat's own bookkeeping and its two lines were written: " + added.join(", "));
    rm(dir);
  }
  // On the board with every kind of card, a heartbeat starts the one card it may, and touches nothing else.
  const md = board({ "1.1": {}, "1.2": { gate: "approval" }, "1.3": { own: "human" }, "1.4": { contributed: true }, "1.6": { st: "DONE" }, "1.7": { deps: "1.2" } });
  const dir = project({ ...BOARD, auto: { start: true, heartbeat: ALL_DAY } }, md);
  const config = read(P(dir).config);
  const ran = follow(dir);
  assert.deepEqual(ran.map((r) => r.status), [0, 0, 0, 0, 0, 0]);
  const was = parseLaunch(md).cards, now = parseLaunch(read(P(dir).record));
  assert.deepEqual(now.errors, []);
  assert.deepEqual(now.cards.map((c) => [c.id, c.st, c.own, c.gate, c.deps]), was.map((c) => [c.id, c.id === "1.1" ? "START" : c.st, c.own, c.gate, c.deps]), "1.1 started; every other card is as it was");
  assert.equal(read(P(dir).config), config, "the settings file is byte for byte the same");
  const moved = lines(P(dir).events).filter((e) => e.type === "card.moved");
  assert.deepEqual(moved.map((e) => [e.card, e.to, e.via]), [["1.1", "START", "auto"]]);
  assert.ok(lines(P(dir).events).every((e) => !["gate.approved", "plan.accepted", "card.edited", "card.added", "auto.paused", "auto.resumed", "notes.added", "notes.removed"].includes(e.type)));
  rm(dir);
});

// ── Undo ──

const undoCtx = (level, undoable) => ({ cards: cardsOf({ "1.1": { st: "START" }, "1.2": { st: "START" }, "1.3": {} }), level, undoable });
const EXECUTING = "1.1 is being executed. It leaves Start only when it is confirmed done, or blocked.";

test("undo: only the owner may send a card back from Start, and only one whose Start is an automatic start with no result", () => {
  const back = { verb: "card.move", card: "1.1", to: "BACKLOG" };
  const d = decide(back, undoCtx("owner", { "1.1": true }));
  assert.deepEqual(d, { ok: true, verb: "card.move", risk: "low", mode: "apply", args: { card: "1.1", undo: true, to: "BACKLOG", from: "START" } });
  // Everyone else keeps today's refusal, word for word.
  for (const level of ["view", "interact", "admin"]) assert.equal(decide(back, undoCtx(level, { "1.1": true })).ok, false, level);
  assert.equal(decide(back, undoCtx("interact", { "1.1": true })).reason, EXECUTING);
  assert.equal(decide(back, undoCtx("admin", { "1.1": true })).reason, EXECUTING);
  // Every other card in Start keeps it too, the owner included.
  assert.equal(decide(back, undoCtx("owner", null)).reason, EXECUTING);
  assert.equal(decide(back, undoCtx("owner", {})).reason, EXECUTING);
  assert.equal(decide(back, undoCtx("owner", { "1.2": true })).reason, EXECUTING, "another card's undo is not this card's");
  assert.equal(decide(back, undoCtx("owner")).reason, EXECUTING, "a caller that passes nothing gets today's behaviour");
  for (const v of ["true", 1, {}, [], "yes"]) assert.equal(decide(back, undoCtx("owner", { "1.1": v })).reason, EXECUTING, JSON.stringify(v));
  const inherited = Object.create({ "1.1": true });
  assert.equal(decide(back, undoCtx("owner", inherited)).reason, EXECUTING, "only the card's own entry counts");
  // The undo goes back to Ready and nowhere else.
  assert.equal(decide({ ...back, to: "DOING" }, undoCtx("owner", { "1.1": true })).reason, EXECUTING);
  // The other ways out of Start are as they were.
  assert.equal(decide({ ...back, to: "BLOCKED" }, undoCtx("owner", { "1.1": true })).ok, true);
  assert.equal(decide({ ...back, to: "DONE" }, undoCtx("owner", { "1.1": true })).mode, "work");
  // A card that is not in Start gains nothing from the mark.
  assert.equal(decide({ verb: "card.move", card: "1.3", to: "DOING" }, undoCtx("owner", { "1.3": true })).args.undo, undefined);
  // The row says what happened.
  const md = board({ "1.1": { st: "START" } });
  const r = applyDecision(md, decide(back, { cards: parseLaunch(md).cards, level: "owner", undoable: { "1.1": true } }), { date: "2026-10-06" });
  assert.match(r.md, /\| 1\.1 \| BACKLOG \|.* • Automatic start undone by the owner from the browser on \*\*2026-10-06\*\*\. \| Seen \|/);
  assert.deepEqual(r.change, { type: "card.moved", card: "1.1", from: "START", to: "BACKLOG", undo: true });
});

test("undo: which cards qualify is read from the log", () => {
  const u = (...list) => ({ ...undoableAutoStarts(log(...list)) });
  assert.deepEqual(u(...started("1.1")), { "1.1": true });
  assert.deepEqual(u(...started("1.1"), ["claude.said", { card: "1.1", text: "Half way." }]), { "1.1": true }, "a milestone is not a result");
  assert.deepEqual(u(...started("1.1"), result("1.1")), {}, "the agent has posted a result: the work is done, there is nothing to undo");
  assert.deepEqual(u(...started("1.1"), result("1.2")), { "1.1": true }, "another card's result");
  assert.deepEqual(u(["card.moved", { card: "1.1", to: "START", via: "browser" }]), {}, "the owner started it");
  assert.deepEqual(u(["card.moved", { card: "1.1", to: "START" }], ["claude.auto", { card: "1.1" }]), {}, "a move that does not say it was automatic");
  assert.deepEqual(u(["claude.auto", { card: "1.1" }]), {}, "an announcement with no move");
  assert.deepEqual(u(...started("1.1"), ["card.moved", { card: "1.1", from: "START", to: "BACKLOG", via: "browser" }]), {}, "already undone");
  assert.deepEqual(u(...started("1.1"), ["card.moved", { card: "1.1", to: "BACKLOG" }], ["card.moved", { card: "1.1", to: "START", via: "browser" }]), {}, "undone, then started by the owner: that Start is theirs");
  assert.deepEqual(u(...started("1.1"), ["card.moved", { card: "1.1", to: "BLOCKED" }]), {});
  assert.deepEqual(u(...started("1.1"), ...started("1.2"), result("1.1")), { "1.2": true });
  assert.deepEqual({ ...undoableAutoStarts(null) }, {}); assert.deepEqual({ ...undoableAutoStarts([null, 3, {}]) }, {});
});

test("undo: through the inbox the owner's Undo returns the card to Ready; a contributor's, or one after a result, is refused as before", () => {
  const dir = project(BOARD, FIVE);
  const inbox = (cols) => { const from = exported(cols); const r = cli(dir, "inbox", "--from", from); rm(from); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const resultOf = (out, id) => (out.split("\n").find((l) => l.includes("/" + id + " ")) || "").trim();
  assert.equal(cli(dir, "next", "--start").status, 0);
  const undo = { verb: "card.move", card: "1.1", to: "BACKLOG", source: "owner-click" };
  // A contributor cannot.
  assert.match(resultOf(inbox({ actions: { a1: pending(undo, 1) } }), "a1"), /-> refused: 1\.1 is being executed\. It leaves Start only when it is confirmed done, or blocked\.$/);
  assert.match(row(dir, "1.1"), /^\| 1\.1 \| START \|/);
  // The owner can.
  assert.match(resultOf(inbox({ approvals: { b1: pending(undo, 2) } }), "b1"), /-> done: Applied: card\.moved 1\.1 -> BACKLOG\.$/);
  assert.match(row(dir, "1.1"), /^\| 1\.1 \| BACKLOG \|.* • Automatic start undone by the owner from the browser on \*\*\d{4}-\d\d-\d\d\*\*\. \| Seen \|$/);
  const mv = lines(P(dir).events).filter((e) => e.type === "card.moved").at(-1);
  assert.deepEqual([mv.card, mv.from, mv.to, mv.undo, mv.via], ["1.1", "START", "BACKLOG", true, "browser"]);
  // The owner's request was the owner acting: the row starts again from one, and the same card is next.
  assert.match(cli(dir, "next").stdout, /^Next automatic start: 1\.1 Card 1\.1 \(it would be 1 of 3 in a row\)\./);
  // Started again automatically, and this time it reports: the undo is gone, for the owner too.
  assert.equal(cli(dir, "next", "--start").status, 0);
  assert.equal(cli(dir, "say", "Finished.", "--card", "1.1", "--kind", "result").status, 0);
  assert.match(resultOf(inbox({ approvals: { b2: pending(undo, 3) } }), "b2"), /-> refused: 1\.1 is being executed\./);
  // A card the owner handed over is not an automatic start: no undo. And one undo does not serve twice in a run.
  assert.match(resultOf(inbox({ approvals: { b3: pending({ verb: "task.start", card: "1.2" }, 4) } }), "b3"), /-> accepted:/);
  assert.match(resultOf(inbox({ approvals: { b4: pending({ verb: "card.move", card: "1.2", to: "BACKLOG" }, 5) } }), "b4"), /-> refused: 1\.2 is being executed\./);
  rm(dir);
  const two = project(BOARD, FIVE);
  assert.equal(cli(two, "next", "--start").status, 0);
  const from = exported({ approvals: { c1: pending(undo, 1), c2: pending({ verb: "task.start", card: "1.1" }, 2), c3: pending({ ...undo, key: "again" }, 3) } });
  const out = cli(two, "inbox", "--from", from).stdout;
  assert.match(resultOf(out, "c1"), /-> done: Applied: card\.moved 1\.1 -> BACKLOG\.$/);
  assert.match(resultOf(out, "c2"), /-> accepted:/);
  assert.match(resultOf(out, "c3"), /-> refused: 1\.1 is being executed\./, "the owner's own start is not undone by an old Undo");
  rm(two, from);
});

// ── auto.set ──

test("auto.set: the owner's switch, a boolean, and a request that names any other setting is refused whole", () => {
  assert.deepEqual([VERBS["auto.set"].level, VERBS["auto.set"].mode, VERBS["auto.set"].args], ["owner", "apply", ["paused"]]);
  const ctx = (level) => ({ cards: cardsOf(THREE), level });
  for (const paused of [true, false]) assert.deepEqual(decide({ verb: "auto.set", paused }, ctx("owner")), { ok: true, verb: "auto.set", risk: "low", mode: "apply", args: { paused } });
  for (const level of ["view", "interact", "admin"]) assert.match(decide({ verb: "auto.set", paused: true }, ctx(level)).reason, /auto\.set needs owner access/, level);
  for (const paused of ["true", "false", 1, 0, {}, [], "yes"]) assert.equal(decide({ verb: "auto.set", paused }, ctx("owner")).reason, "auto.set takes paused: true or false.", JSON.stringify(paused));
  assert.match(decide({ verb: "auto.set" }, ctx("owner")).reason, /missing "paused"/);
  assert.match(decide({ verb: "auto.set", paused: null }, ctx("owner")).reason, /missing "paused"/);
  for (const k of ["start", "inARow", "perDay", "pauseOnQuestion", "quietMin", "pulseGapMin", "pulsePerHour", "heartbeat", "auto"]) {
    const d = decide({ verb: "auto.set", paused: false, [k]: k === "auto" ? { start: true } : 99 }, ctx("owner"));
    assert.equal(d.ok, false, k); assert.match(d.reason, new RegExp(`^Only "paused" can be changed from the board\\. ${k} is set by the owner in \\.cockpit/config\\.json\\.$`), k);
  }
  // It works on a draft plan too: pausing starts nothing.
  assert.equal(decide({ verb: "auto.set", paused: true }, { ...ctx("owner"), plan: "draft" }).ok, true);
});

test("auto.set: applying it writes auto.paused and leaves every other key of the file as it was", () => {
  const cfg = { $schema: "x", title: "T", plan: "accepted", wip: { human: 2, agent: 3 }, auto: { start: true, inARow: 3, perDay: "many", heartbeat: { installed: false }, extra: [1] }, hooks: { skip: ["a/"] } };
  const d = (paused) => ({ ok: true, verb: "auto.set", mode: "apply", args: { paused } });
  const r = applyAutoSet(JSON.stringify(cfg), d(true));
  assert.deepEqual(JSON.parse(r.text), { ...cfg, auto: { ...cfg.auto, paused: true } });
  assert.deepEqual(Object.keys(JSON.parse(r.text)), Object.keys(cfg), "the order of the file is kept");
  assert.deepEqual(r.change, { type: "auto.paused", paused: true });
  assert.deepEqual(applyAutoSet(r.text, d(false)).change, { type: "auto.resumed", paused: false });
  assert.deepEqual(JSON.parse(applyAutoSet(r.text, d(false)).text), { ...cfg, auto: { ...cfg.auto, paused: false } });
  assert.deepEqual(JSON.parse(applyAutoSet('{"title":"T"}', d(true)).text), { title: "T", auto: { paused: true } }, "a project with no auto block gets one key");
  // Anything but the gateway's own decision is refused, and so is a file that cannot be carried over safely.
  for (const bad of [null, { ok: false }, { ...d(true), mode: "work" }, { ...d(true), verb: "card.move" }, { ...d(true), args: { paused: true, start: true } }, { ...d(true), args: { start: true } },
    { ...d(true), args: { paused: "true" } }, { ...d(true), args: {} }]) assert.throws(() => applyAutoSet(JSON.stringify(cfg), bad), /auto\.set/, JSON.stringify(bad));
  assert.throws(() => applyAutoSet("{ not json", d(true)), /not valid JSON, so it was not changed/);
  assert.throws(() => applyAutoSet("[]", d(true)), /not an object, so it was not changed/);
  assert.throws(() => applyAutoSet('{"auto":"on"}', d(true)), /"auto" in the config file is not an object/);
});

test("auto.set: through the inbox only `paused` changes; a contributor is refused; no other verb reaches the settings", () => {
  const start = { title: "Auto", artifact: "", plan: "accepted", auto: { start: true, inARow: 2, perDay: 5, pauseOnQuestion: false }, wip: { human: 1, agent: 1 } };
  const dir = project(start, FIVE);
  const run = (cols) => { const from = exported(cols); const r = cli(dir, "inbox", "--from", from); rm(from); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const lineOf = (out, id) => (out.split("\n").find((l) => l.includes("/" + id + " ")) || "").trim();
  const raw = read(P(dir).config);
  // A contributor, and an owner's request that tries to carry another setting along.
  let out = run({ actions: { a1: pending({ verb: "auto.set", paused: true }, 1) }, approvals: { b1: pending({ verb: "auto.set", paused: true, inARow: 99 }, 2), b2: pending({ verb: "auto.set", paused: "true" }, 3) } });
  assert.match(lineOf(out, "a1"), /-> refused: auto\.set needs owner access; this came from interact\.$/);
  assert.match(lineOf(out, "b1"), /-> refused: Only "paused" can be changed from the board\. inARow is set by the owner/);
  assert.match(lineOf(out, "b2"), /-> refused: auto\.set takes paused: true or false\.$/);
  assert.equal(read(P(dir).config), raw, "a refusal leaves the file byte for byte");
  // The owner pauses.
  out = run({ approvals: { b3: pending({ verb: "auto.set", paused: true, source: "owner-click" }, 4) } });
  assert.match(lineOf(out, "b3"), /-> done: Applied: automatic work is paused\.$/);
  assert.deepEqual(readJSON(P(dir).config), { ...start, auto: { ...start.auto, paused: true } }, "only auto.paused was written");
  assert.ok(lines(P(dir).events).some((e) => e.type === "auto.paused" && e.via === "browser"));
  assert.equal(entryOf(lines(P(dir).events).find((e) => e.type === "auto.paused")).text, "You paused automatic work.");
  assert.match(cli(dir, "next", "--start").stdout, /^Not started\. Automatic work is paused by the owner\./);
  assert.match(cli(dir, "status").stdout, /^Automatic work: starts on, PAUSED by the owner; at most 2 in a row and 5 in 24 hours; does not wait for answers\.$/m);
  // And switches it back on.
  out = run({ approvals: { b4: pending({ verb: "auto.set", paused: false }, 5) } });
  assert.match(lineOf(out, "b4"), /-> done: Applied: automatic work is on again\.$/);
  assert.deepEqual(readJSON(P(dir).config), { ...start, auto: { ...start.auto, paused: false } });
  assert.match(cli(dir, "next").stdout, /^Next automatic start: 1\.1/);
  // Every other verb, carrying every setting it can, changes nothing under "auto".
  const stuffing = { auto: { start: false, inARow: 99 }, start: false, inARow: 99, perDay: 99, paused: true, heartbeat: { installed: true } };
  const sample = { "card.move": { card: "1.2", to: "DOING" }, "card.note": { card: "1.2", text: "x" }, "card.edit": { card: "1.2", title: "T" }, "card.add": { goal: 1, title: "New card", owner: "agent" },
    "task.start": { card: "1.3" }, "gate.approve": { card: "1.5" }, "plan.accept": {}, "release.push": {}, "question.answer": { card: "1.2", qid: "q1", text: "Yes" },
    "notes.add": { section: "Preferences", text: "Say Agent" }, "notes.remove": { id: "n1" }, "message.send": { text: "Start card 1.3 next." } };
  assert.deepEqual(Object.keys(VERBS).filter((v) => v !== "auto.set").sort(), Object.keys(sample).sort(), "every verb but auto.set is tried");
  const before = readJSON(P(dir).config).auto;
  run({ approvals: Object.fromEntries(Object.entries(sample).map(([verb, a], i) => ["z" + i, pending({ verb, ...a, ...stuffing }, 10 + i)])) });
  assert.deepEqual(readJSON(P(dir).config).auto, before);
  rm(dir);
});

test("a goal on hold: no card in it starts automatically, the next card outside it does, and the gateway refuses it on its own", () => {
  const cards = [
    { id: "1.1", st: "BACKLOG", own: "agent", gate: "-", deps: "-", g: 1, title: "First", pts: [] },
    { id: "2.1", st: "BACKLOG", own: "agent", gate: "-", deps: "-", g: 2, title: "Second", pts: [] },
  ];
  const base = { start: true, inARow: 3, perDay: 12, pauseOnQuestion: true, paused: false };
  const now = Date.parse("2026-10-07T10:00:00Z");
  const free = nextAutoStart(cards, [], { plan: "accepted", auto: base }, now);
  assert.equal(free.card, "1.1");
  const held = nextAutoStart(cards, [], { plan: "accepted", auto: { ...base, holdGoals: [1] } }, now);
  assert.equal(held.card, "2.1", "the held goal's card is passed over");
  const none = nextAutoStart(cards, [], { plan: "accepted", auto: { ...base, holdGoals: [1, 2] } }, now);
  assert.equal(none.card, undefined, "nothing is proposed");
  assert.match(none.none, /outside the goals on hold \(1, 2\)/);
  const ctx = { cards, plan: "accepted", auto: { ...base, holdGoals: [1] }, entries: [], now, score: () => 0 };
  assert.match(decideAuto({ verb: "card.move", card: "1.1", to: "START" }, ctx).reason, /Goal 1 is on hold by the owner, so 1\.1 does not start automatically\./);
  assert.equal(decideAuto({ verb: "card.move", card: "2.1", to: "START" }, ctx).ok, true, "a held card ahead of it does not block the next one");
  // a hold that cannot be read turns automatic starts off; it is never read as no hold
  const bad = readAuto({ start: true, holdGoals: "8" });
  assert.equal(bad.auto.start, false);
  assert.match(bad.problems.join(" "), /auto\.holdGoals must be a list of goal numbers/);
  assert.deepEqual(readAuto({ start: true, holdGoals: [5, 8] }).auto.holdGoals, [5, 8]);
});
