// node --test test/qa/core-pure.test.mjs
// PROPOSED (QA 2026-10-05). Untested branches of the pure core: apply, parse, lint, engine, mirror and
// the event log. No project is run; the only files are in the OS temp folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseLaunch, isVerified, splitCard } from "../../plugin/src/core/parse.mjs";
import { computeBoard } from "../../plugin/src/core/engine.mjs";
import { decide } from "../../plugin/src/core/gateway.mjs";
import { applyDecision } from "../../plugin/src/core/apply.mjs";
import { planLint, lintSummary } from "../../plugin/src/core/lint.mjs";
import { desired, diff, loadActual, describe, batches } from "../../plugin/src/core/mirror.mjs";
import * as ev from "../../plugin/src/events/events.mjs";
import { entryOf, buildFeed } from "../../plugin/src/events/feed.mjs";
import { MD, withRow } from "./_helpers.mjs";

const REC = parseLaunch(MD);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lob-qa-pure-"));
const owner = (a, md = MD) => { const r = parseLaunch(md); return decide(a, { cards: r.cards, goals: r.goals, level: "owner" }); };
const STARTED = withRow(MD, "1.2", (c) => { c[1] = "START"; });

// ── apply ──
test("apply: a move the gateway marked as work is never written mechanically", () => {
  const start = owner({ verb: "card.move", card: "1.2", to: "START" }), done = owner({ verb: "card.move", card: "1.2", to: "DONE" });
  assert.deepEqual([start.mode, done.mode], ["work", "work"]);
  // The message matters: with the mode guard deleted these would fall through and edit the row.
  assert.throws(() => applyDecision(MD, start), /only an approved decision with mode 'apply'/);
  assert.throws(() => applyDecision(MD, done), /only an approved decision with mode 'apply'/);
  assert.throws(() => applyDecision(MD, { ok: false, reason: "no" }), /only an approved decision/);
  assert.throws(() => applyDecision(MD, null), /only an approved decision/);
});

test("apply: an edit that would break the record is refused, and nothing is returned", () => {
  // 1.2 is being executed and rests on 1.1 being done. Reopening 1.1 would leave a Start card with an open dependency.
  const d = owner({ verb: "card.move", card: "1.1", to: "BACKLOG" }, STARTED);
  assert.equal(d.mode, "apply", "the gateway alone lets this through");
  assert.throws(() => applyDecision(STARTED, d), /the edit would break the record: card 1\.2 is in START but waits on 1\.1/);
});

test("apply: only the one row changes, and the file's line endings survive", () => {
  const d = owner({ verb: "card.move", card: "1.2", to: "DOING" });
  const out = applyDecision(MD, d, { date: "2026-10-05", by: "a contributor" }).md;
  const a = MD.split("\n"), b = out.split("\n");
  assert.equal(a.length, b.length);
  const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i != null);
  assert.equal(changed.length, 1);
  assert.match(b[changed[0]], /^\| 1\.2 \| DOING \| .* • Moved to DOING by a contributor from the browser on \*\*2026-10-05\*\*\. \| The feature works in a local run \|$/);
  const crlf = MD.replace(/\r?\n/g, "\r\n");
  const out2 = applyDecision(crlf, d).md;
  assert.ok(out2.includes("\r\n") && !/[^\r]\n/.test(out2), "a CRLF record stays CRLF on every line");
  assert.deepEqual(parseLaunch(out2).errors, []);
});

test("apply: a confirmed card closes with the owner's name on it; a gate approval clears the gate", () => {
  const verified = withRow(MD, "1.2", (c) => { c[7] += " • Verified: ran it locally, 12 of 12 passed."; });
  const d = owner({ verb: "card.move", card: "1.2", to: "DONE" }, verified);
  assert.equal(d.mode, "apply");
  const r = applyDecision(verified, d, { date: "2026-10-05" });
  assert.match(r.md, /\| 1\.2 \| DONE \|.*Marked done by the owner from the browser on \*\*2026-10-05\*\*/);
  assert.deepEqual(r.change, { type: "card.moved", card: "1.2", from: "BACKLOG", to: "DONE" });
  const g = applyDecision(MD, owner({ verb: "gate.approve", card: "1.3" }), { date: "2026-10-05" });
  assert.match(g.md, /\| 1\.3 \| BACKLOG \| human \| account \| Q \| - \| 1\.1 \|.*Approved by the owner from the browser on \*\*2026-10-05\*\*\./);
  assert.deepEqual(g.change, { type: "gate.approved", card: "1.3" });
});

test("apply: a new card takes the next free number and lands under its goal's last row", () => {
  const add = { verb: "card.add", goal: 1, owner: "agent", title: "Write the changelog" };
  const r = applyDecision(MD, owner(add), { date: "2026-10-05" });
  assert.equal(r.change.card, "1.6");
  const L = r.md.split("\n"), i = L.findIndex((l) => l.startsWith("| 1.6 | "));
  assert.ok(L[i - 1].startsWith("| 1.5 | "), "inserted straight after the goal's last card");
  assert.equal(L[i], "| 1.6 | BACKLOG | agent | content | S | - | - | **Write the changelog.** Added from the browser. • Note: Added by the owner on **2026-10-05**. | The owner confirms it is done |");
  // A gap in the numbers: the next id is one past the highest, never a reused number.
  const gappy = MD.replace("| 1.5 | BACKLOG | agent | verify | Q | approval | 1.4 |", "| 1.9 | BACKLOG | agent | verify | Q | approval | 1.4 |");
  assert.equal(applyDecision(gappy, owner(add, gappy)).change.card, "1.10");
  // A second add after the first keeps counting.
  assert.equal(applyDecision(r.md, owner(add, r.md)).change.card, "1.7");
});

test("apply: a card or goal that is not in the text is an error, not a silent no-op", () => {
  const d = { ok: true, verb: "card.note", mode: "apply", args: { card: "7.7", text: "x" } };
  assert.throws(() => applyDecision(MD, d), /card 7\.7 not found in the record/);
  assert.throws(() => applyDecision(MD, { ok: true, verb: "card.add", mode: "apply", args: { goal: 4, owner: "agent", title: "T", text: "", deps: [] } }), /goal 4 has no cards to add after/);
  assert.throws(() => applyDecision(MD, { ok: true, verb: "plan.accept", mode: "apply", args: {} }), /no mechanical apply for plan\.accept/);
});

// ── parse ──
test("parse: the same id twice, a record with no goals and a record with no cards are errors", () => {
  const twice = MD.replace("| 1.5 | BACKLOG | agent | verify", "| 1.4 | BACKLOG | agent | verify");
  assert.match(parseLaunch(twice).errors.join("\n"), /card 1\.4 is defined twice \(lines \d+ and \d+\)/);
  assert.deepEqual(parseLaunch("# nothing here\n").errors, ["no GOALS table found", "no cards found"]);
  const noCards = MD.split("\n").filter((l) => !/^\| 1\.\d /.test(l)).join("\n");
  assert.deepEqual(parseLaunch(noCards).errors, ["no cards found"]);
});

test("parse: warnings are warnings (done over an open dependency, blocked without a reason, a wrong count)", () => {
  const r = parseLaunch(withRow(withRow(MD, "1.4", (c) => { c[1] = "DONE"; }), "1.3", (c) => { c[1] = "BLOCKED"; }).replace("| 5 | ACTIVE |", "| 9 | ACTIVE |"));
  assert.deepEqual(r.errors, []);
  const w = r.warnings.join("\n");
  assert.match(w, /card 1\.4 is DONE but its dependency 1\.2 is BACKLOG/);
  assert.match(w, /card 1\.3 is BLOCKED but its text never says what outside the repo blocks it/);
  assert.match(w, /GOALS table says goal 1 has 9 cards; the record has 5/);
});

test("parse: a CRLF record reads the same as an LF one; decisions, watch rows and phase ends are read", () => {
  const strip = (r) => r.cards.map(({ line, ...c }) => c);
  const crlf = parseLaunch(MD.replace(/\r?\n/g, "\r\n")), lf = parseLaunch(MD.replace(/\r\n/g, "\n"));
  assert.deepEqual(strip(crlf), strip(lf));
  assert.deepEqual(lf.decisions, [["D1", "One record file, one generated page", "Two sources of truth drift"]]);
  assert.deepEqual(lf.decGoal, { D1: 1 }); assert.deepEqual(lf.watchGoal, { W1: 1 });
  assert.equal(lf.watch[0][3], "Profile it before adding a card");
  assert.deepEqual(lf.phaseEnd, { "Phase 1 · Build": "Ends with: a build that passes on a clean checkout", "Phase 2 · Release": "Ends with: a public URL a stranger can open" });
  assert.deepEqual(lf.state, [["Live", "Not yet"]]);
  assert.deepEqual(lf.goals, [{ n: 1, title: "Ship v1", sub: "A stranger opens the URL and it works", cards: 5, state: "ACTIVE" }]);
});

test("parse: confirmed means a pointer that begins with Verified:, and nothing else", () => {
  const v = (cell) => isVerified(splitCard(cell));
  assert.equal(v("**T.** Body. • Verified: the page returned 200."), true);
  assert.equal(v("**T.** Body. • verified : seen by the owner."), true);
  assert.equal(v("**T.** Body. • Not verified: nobody looked."), false);
  assert.equal(v("**T.** Verified: this is the description, not a pointer."), false);
  assert.equal(v("**T.** Body. • Why: it matters. • Check: Verified: later."), false);
  assert.equal(v("**T.** Body. • Unverified."), false);
  assert.equal(isVerified({}), false);
});

// ── lint ──
test("lint: a deadlocked goal is an error from the lint itself, as are an empty goal and a card that waits on itself", () => {
  const stuck = parseLaunch(withRow(MD, "1.1", (c) => { c[1] = "BACKLOG"; c[6] = "1.5"; }));
  assert.ok(planLint(stuck).some((f) => f.level === "error" && f.goal === 1 && /Goal 1 cannot start/.test(f.text)));
  const two = MD.replace("| **1** | **Ship v1** | A stranger opens the URL and it works | 5 | ACTIVE |", "| **1** | **Ship v1** | A stranger opens the URL and it works | 5 | ACTIVE |\n| **2** | **Grow** |  | 0 | LATER |");
  assert.ok(planLint(parseLaunch(two)).some((f) => f.level === "error" && /Goal 2 "Grow" has no cards/.test(f.text)));
  const self = { goals: REC.goals, cards: REC.cards.map((c) => (c.id === "1.2" ? { ...c, deps: "1.2" } : c)), phaseEnd: REC.phaseEnd };
  assert.ok(planLint(self).some((f) => f.level === "error" && f.card === "1.2" && /waits on itself/.test(f.text)));
  assert.deepEqual(planLint({}).map((f) => f.text), ["The plan has no goals.", "The plan has no cards."]);
  assert.equal(lintSummary([{ level: "error" }, { level: "warn" }, { level: "warn" }]), "1 error(s), 2 warning(s)");
});

test("lint: a goal of more than 15 cards and a phase with no end are warnings", () => {
  const rows = Array.from({ length: 16 }, (_, i) => `| 1.${i + 1} | BACKLOG | agent | code | S | - | - | **Card ${i + 1}.** It does a thing. • Why: Needed. • Check: Run it. | The thing is seen working |`);
  const md = `## GOALS\n\n| # | Goal | One line | Cards | State |\n|---|---|---|---|---|\n| **1** | **Big** | One line | 16 | ACTIVE |\n\n## GOAL 1 — Big\n\n### Phase A\n\n| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |\n|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
  const f = planLint(parseLaunch(md));
  assert.deepEqual(f.filter((x) => x.level === "error"), []);
  assert.deepEqual(f.map((x) => x.text), ["Goal 1 has 16 cards: split it into two goals, each with its own outcome.", 'Phase "Phase A" has no "Ends with:" line saying what is true when it finishes.']);
});

// ── engine ──
const card = (id, st, own, deps = "-", extra = {}) => ({ id, st, own, deps, type: "code", eff: "S", gate: "-", t: "card " + id, g: 1, ...extra });
test("engine: with no finish card there is no finish path and nobody is being waited on", () => {
  const E = computeBoard([card("1.1", "BACKLOG", "human"), card("1.2", "BACKLOG", "agent", "1.1")]);
  assert.deepEqual([E.critical, E.chain, E.openPath, E.gateCard, E.LAUNCH], [{}, [], [], null, null]);
  assert.deepEqual(E.count, { BACKLOG: 1, ACTIVE: 1, START: 0, BLOCKED: 0, DONE: 0 });
});
test("engine: the queue is capped, ties break by card number, and a money gate waits behind free work", () => {
  const C = [...Array.from({ length: 12 }, (_, i) => card("1." + (i + 1), "BACKLOG", "agent")), card("1.13", "BACKLOG", "agent", "-", { gate: "money", eff: "Q" })];
  const E = computeBoard(C, { WIP: { human: 2, agent: 3 } });
  assert.deepEqual(C.filter((c) => E.phase[c.id] === "ACTIVE").map((c) => c.id), ["1.1", "1.2", "1.3"]);
  assert.deepEqual(E.queued, ["1.4", "1.5", "1.6", "1.7", "1.8", "1.9"], "numeric order (1.10 is after 1.9), six at most");
  assert.equal(computeBoard(C, { WIP: { human: 2, agent: 3 }, QUEUE_MAX: 0 }).queued.length, 0);
  assert.ok(E.score(C[12]) < E.score(C[0]), "money gate: -25 outweighs a quick card's +9");
});
test("engine: a dependency that does not exist never counts as done; Start cards take no lane slot", () => {
  const E = computeBoard([card("1.1", "BACKLOG", "agent", "9.9"), card("1.2", "START", "agent"), card("1.3", "DOING", "agent"), card("1.4", "DOING", "agent"), card("1.5", "DOING", "agent"), card("1.6", "DOING", "agent")], { WIP: { human: 2, agent: 3 } });
  assert.equal(E.phase["1.1"], "BACKLOG"); assert.equal(E.stuck, 1);
  assert.equal(E.phase["1.2"], "START");
  assert.equal(E.used.agent, 4, "pinned work is shown even past the limit; it is never dropped");
  assert.deepEqual(E.unblocks, { "1.1": 0, "1.2": 0, "1.3": 0, "1.4": 0, "1.5": 0, "1.6": 0 });
});

// ── mirror ──
const E0 = computeBoard(REC.cards, { WIP: { human: 2, agent: 3 }, LAUNCH: "1.5" });
test("mirror: the document for a card, field by field", () => {
  const want = desired(REC, E0);
  assert.deepEqual(Object.keys(want).sort(), ["board/state", "cards/1.1", "cards/1.2", "cards/1.3", "cards/1.4", "cards/1.5"]);
  assert.deepEqual(want["cards/1.4"], { id: "1.4", goal: 1, phase: "Phase 2 · Release", title: "Deploy it", desc: "Connect the repo to the host so a push deploys.",
    pointers: [], status: "BACKLOG", column: "BACKLOG", owner: "agent", type: "config", effort: "S", gate: "-", deps: ["1.2", "1.3"],
    doneWhen: "The host serves the latest commit", auto: false, frees: 1 });
  assert.deepEqual(want["cards/1.1"].deps, []);
  assert.deepEqual(want["board/state"], { goals: [{ n: 1, title: "Ship v1" }], counts: { BACKLOG: 2, ACTIVE: 2, START: 0, BLOCKED: 0, DONE: 1 },
    gateCard: "1.3", cards: 5, lanes: { human: ["1.3"], agent: ["1.2"] } });
});
test("mirror: a removal is pinned to the version it was read at, and left unpinned only when none is known", () => {
  const { writes } = diff({}, { "cards/9.9": { data: { title: "stale" }, version: 4 }, "cards/8.8": { data: {} } });
  assert.deepEqual(writes, [{ op: "delete", collection: "cards", doc_id: "9.9", if_version: 4 }, { op: "delete", collection: "cards", doc_id: "8.8" }]);
  const add = diff({ "cards/1.1": { a: 1 } }, {}).writes;
  assert.deepEqual(add, [{ op: "set", collection: "cards", doc_id: "1.1", data: { a: 1 } }], "a new document has nothing to pin to");
});
test("mirror: the audit names each field that differs, and the order of a list is content", () => {
  const want = { "cards/1.4": { status: "DOING", deps: ["1.2", "1.3"], title: "T" } };
  const have = { "cards/1.4": { data: { status: "BACKLOG", deps: ["1.3", "1.2"], title: "T", extra: 1 }, version: 2 } };
  const { report, writes } = diff(want, have);
  assert.deepEqual(report.changed, [{ path: "cards/1.4", fields: [
    { field: "status", mirror: "BACKLOG", record: "DOING" }, { field: "deps", mirror: ["1.3", "1.2"], record: ["1.2", "1.3"] }, { field: "extra", mirror: 1, record: undefined }] }]);
  assert.equal(writes[0].if_version, 2);
  assert.equal(describe(report), ["Mirror audit: 0 to add, 1 to change, 0 to remove, 0 already in step.",
    '  cards/1.4.status: mirror "BACKLOG" -> record "DOING"', '  cards/1.4.deps: mirror ["1.3","1.2"] -> record ["1.2","1.3"]', "  cards/1.4.extra: mirror 1 -> record undefined"].join("\n"));
  assert.match(describe(diff({}, { "cards/9.9": { data: {} } }).report), /cards\/9\.9: in the mirror but not in the record \(removed\)/);
});
test("mirror: what was written is what is read back, so a second sync has nothing to do", () => {
  const d = tmp(), want = desired(REC, E0);
  for (const [p, doc] of Object.entries(want)) { const f = path.join(d, p + ".json"); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(doc)); }
  const { writes, report } = diff(want, loadActual(d));
  assert.deepEqual([writes, report.unchanged], [[], 6]);
  fs.rmSync(d, { recursive: true, force: true });
});
test("mirror: an export with junk in it is read as far as it can be, and never throws", () => {
  const d = tmp(); fs.mkdirSync(path.join(d, "cards"));
  fs.writeFileSync(path.join(d, "cards", "1.1.json"), JSON.stringify({ title: "ok" }));
  fs.writeFileSync(path.join(d, "cards", "broken.json"), "{ not json");
  fs.writeFileSync(path.join(d, "cards", "notes.txt"), "ignored");
  fs.writeFileSync(path.join(d, "_versions.json"), "also { broken");
  const have = loadActual(d);
  assert.deepEqual(have, { "cards/1.1": { data: { title: "ok" }, version: undefined } });
  assert.deepEqual(loadActual(path.join(d, "nowhere")), {});
  assert.deepEqual(loadActual(d, ["actions"]), {}, "only the collections asked for");
  assert.deepEqual(batches([]), []); assert.deepEqual(batches([1, 2, 3], 2), [[1, 2], [3]]);
  fs.rmSync(d, { recursive: true, force: true });
});

// ── events and feed ──
test("events: a damaged line is skipped and the count carries on; a missing log is empty", () => {
  const f = path.join(tmp(), "e.jsonl");
  assert.equal(ev.lastOffset(f), 0); assert.deepEqual(ev.read({}, f), []);
  ev.append("card.moved", { card: "1.1" }, f);
  fs.appendFileSync(f, "{ torn write\n\n");
  const e = ev.append("card.added", { card: "1.2" }, f);
  assert.equal(e.offset, 2);
  assert.deepEqual(ev.read({}, f).map((x) => x.type), ["card.moved", "card.added"]);
  assert.ok(!Number.isNaN(Date.parse(e.at)));
});
test("events: a type filter matches whole names and whole families; limit stops early", () => {
  const f = path.join(tmp(), "e.jsonl");
  for (const t of ["card.moved", "card.added", "cardboard.moved", "action.done", "card.moved"]) ev.append(t, {}, f);
  assert.deepEqual(ev.read({ types: ["card.*"] }, f).map((e) => e.offset), [1, 2, 5], "card.* is not cardboard.*");
  assert.deepEqual(ev.read({ types: ["card.moved", "action.*"] }, f).map((e) => e.offset), [1, 4, 5]);
  assert.deepEqual(ev.read({ from: 2, limit: 2 }, f).map((e) => e.offset), [2, 3]);
  for (const bad of ["card", "card.", ".moved", "card.Moved", "card moved", "card.moved2", ""]) assert.throws(() => ev.append(bad, {}, f), /dotted lowercase/, bad);
  assert.equal(ev.lastOffset(f), 5, "a refused type writes nothing");
});
test("events: a consumer's filter does not move its cursor, and cursors are kept per name", () => {
  const d = tmp(), files = { events: path.join(d, "e.jsonl"), cursors: path.join(d, "c.json") };
  for (const t of ["card.moved", "note.added", "card.added"]) ev.append(t, {}, files.events);
  assert.deepEqual(ev.poll("page", { types: ["card.*"], limit: 1 }, files).map((e) => e.offset), [1]);
  assert.equal(ev.cursor("page", files.cursors), 0, "poll never commits");
  assert.equal(ev.commit("page", 3, files.cursors), 3); assert.equal(ev.commit("audit", 1, files.cursors), 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(files.cursors, "utf8")), { page: 3, audit: 1 });
  assert.deepEqual(ev.poll("audit", {}, files).map((e) => e.offset), [2, 3]);
});
test("feed: every event type the orchestrator writes reads as a sentence, and an unknown one still shows", () => {
  const say = (type, data) => entryOf({ offset: 1, at: "2026-10-05T00:00:00Z", type, ...data });
  assert.deepEqual(say("card.moved", { id: "1.2", from: "DOING", to: "DONE" }), { offset: 1, at: "2026-10-05T00:00:00Z", kind: "moved", who: "Board", text: "Card 1.2 moved from Ready to Done.", card: "1.2", move: { from: "DOING", to: "DONE" } });
  assert.equal(say("action.received", { verb: "task.start", card: "1.2" }).text, "You asked the agent to start card 1.2.");
  assert.equal(say("action.received", { verb: "card.note", card: "1.2" }).text, "You added a note to card 1.2.");
  assert.equal(say("action.received", { verb: "card.add" }).text, "You asked for a new card.");
  assert.equal(say("action.received", { verb: "card.edit", card: "1.2" }).text, "You asked to edit card 1.2.");
  assert.equal(say("action.received", { verb: "gate.approve", card: "1.3" }).text, "You approved card 1.3.");
  assert.equal(say("action.received", { verb: "plan.accept" }).text, "You accepted the plan.");
  assert.equal(say("action.received", { verb: "x".repeat(90) }).text.length, "You asked for ".length + 40);
  assert.equal(say("action.done", { result: "Applied: card.moved 1.2 -> DOING." }).text, "Request carried out: Applied: card.moved 1.2 -> DOING.");
  assert.equal(say("action.awaiting", { result: "release.push is high risk." }).text, "Waiting for you to confirm: release.push is high risk.");
  assert.equal(say("action.refused", { reason: "no" }).text, "Request refused: no");
  assert.equal(say("action.accepted", {}).text, "Request accepted.");
  assert.equal(say("card.added", { card: "1.6", text: "A title" }).text, "Card 1.6 was added: A title");
  assert.equal(say("card.noted", { card: "1.2" }).text, "A note was added to card 1.2.");
  assert.equal(say("card.edited", { card: "1.2" }).text, "The text of card 1.2 was edited.");
  assert.equal(say("gate.approved", { card: "1.3" }).text, "Card 1.3 was approved by the owner.");
  assert.equal(say("plan.accepted", {}).text, "The plan was accepted. Cards can now start.");
  assert.equal(say("mirror.diffed", { added: 1 }).text, "The board page's data was updated to match the plan file: 1 item changed.");
  assert.deepEqual(["claude.said", "prompt.received", "action.received", "card.moved", "note.added"].map((t) => say(t, { text: "x" }).who), ["Agent", "You", "You", "Board", "Agent"]);
  assert.deepEqual(say("deploy.finished", { card: 7 }), { offset: 1, at: "2026-10-05T00:00:00Z", kind: "deploy", who: "Board", text: "deploy finished" });
  assert.equal(say("note.added", { text: "n".repeat(900) }).text.length, "Note: ".length + 260);
});
test("feed: a limit is honoured and the prompt is redacted in now as well as in the list", () => {
  const f = path.join(tmp(), "e.jsonl");
  ev.append("claude.said", { text: "Working" }, f);
  for (let i = 0; i < 5; i++) ev.append("prompt.received", { text: "PRIVATE-" + i }, f);
  const feed = buildFeed({ file: f, limit: 3 });
  assert.deepEqual(feed.entries.map((e) => e.offset), [6, 5, 4]);
  assert.equal(feed.now.text, "Working", "now is the last thing Claude said, even when it has scrolled out of the list");
  assert.doesNotMatch(JSON.stringify(feed), /PRIVATE/);
});
