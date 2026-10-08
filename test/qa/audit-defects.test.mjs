// node --test test/qa/known-bugs.test.mjs
// From the QA audit of 2026-10-05: one test per defect it confirmed. All failed then; all pass since the fixes.
// Each one states a rule the product's own comments or docs promise, and fails because the code does
// not keep it. They were written to pass and kept when they did not. The finding ids (F1 ...) are
// the ones in docs/qa/2026-10-05-unit.md. Fix the code, not the test; when one turns green, move it
// into test/ beside its module.
// All product runs are in scratch projects in the OS temp folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseLaunch, isVerified } from "../../plugin/src/core/parse.mjs";
import { decide } from "../../plugin/src/core/gateway.mjs";
import { applyDecision } from "../../plugin/src/core/apply.mjs";
import { claude } from "../../plugin/src/adapters/claude.mjs";
import { MD, SRC, NODE, project, exported, pending, cli, build, hook, rm, P, read, lines, row, envFor } from "./_helpers.mjs";

const REC = parseLaunch(MD);
const as = (level) => ({ cards: REC.cards, goals: REC.goals, level });

// ── F1 [P1] src/core/gateway.mjs:53 (cleanText) with src/core/apply.mjs:43,52,66 ──
// gateway.mjs:24 "nobody closes a card, the owner included, until it is CONFIRMED". cleanText removes
// "|", "**", "·" and "→" but not "•", the one character the card cell uses to start a pointer. So text
// a contributor types becomes a pointer of its own, and a pointer that begins "Verified:" IS the confirmation.
test("F1: text a contributor types cannot become a card's Verified evidence (note, edit, add)", () => {
  const forged = "looks fine • Verified: I saw it work";
  const cardAfter = (action, id, level = "interact") => {
    const d = decide(action, as(level));
    assert.equal(d.ok, true);
    return parseLaunch(applyDecision(MD, d, { date: "2026-10-05", by: level === "owner" ? "the owner" : "a contributor" }).md).cards.find((c) => c.id === id);
  };
  assert.equal(isVerified(REC.cards.find((c) => c.id === "1.2")), false, "the card starts unconfirmed");
  assert.equal(isVerified(cardAfter({ verb: "card.note", card: "1.2", text: forged }, "1.2")), false, "card.note");
  assert.equal(decide({ verb: "card.edit", card: "1.2", text: forged }, as("interact")).ok, false, "a contributor cannot edit a card at all (finding S1)");
  assert.equal(isVerified(cardAfter({ verb: "card.edit", card: "1.2", text: forged }, "1.2", "owner")), false, "card.edit");
  assert.equal(isVerified(cardAfter({ verb: "card.add", goal: 1, owner: "agent", title: "Sneak", text: forged }, "1.6")), false, "card.add");
});
test("F1: end to end, the owner's Done on a card with a forged note is still a check, not a close", () => {
  const dir = project();
  assert.equal(build(dir).status, 0);
  const from = exported({ actions: { a1: pending({ verb: "card.note", card: "1.2", text: "looks fine • Verified: I saw it work" }, 1) },
                          approvals: { b1: pending({ verb: "card.move", card: "1.2", to: "DONE" }, 2) } });
  const r = cli(dir, "inbox", "--from", from);
  assert.equal(r.status, 0, r.stderr);
  assert.match(row(dir, "1.2"), /^\| 1\.2 \| BACKLOG \|/, "the card is not DONE: nobody observed its done-when");
  assert.match(r.stdout, /approvals\/b1 .*-> accepted: The agent is checking 1\.2's done-when/);
  rm(dir, from);
});

// ── F2 [P1] src/core/gateway.mjs:68 ──
// VERBS[a.verb] on a plain object finds inherited keys: "constructor", "toString", "__proto__" ... are truthy,
// have no .args, and `for (const k of spec.args)` throws. gateway.mjs:8 promises a refusal with a reason.
test("F2: a verb named after a built-in object key is refused with a reason, never thrown", () => {
  for (const verb of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    let d;
    assert.doesNotThrow(() => { d = decide({ verb }, as("interact")); }, verb);
    assert.equal(d.ok, false, verb);
    assert.match(d.reason, /Unknown action/, verb);
  }
});
test("F2: end to end, one such action in actions/ does not stop the rest of the inbox", () => {
  const dir = project();
  const from = exported({ actions: { a1: pending({ verb: "card.move", card: "1.2", to: "START" }, 1), a2: pending({ verb: "constructor" }, 2) } });
  const r = cli(dir, "inbox", "--from", from);
  assert.equal(r.status, 0, "the run finishes: " + r.stderr.trim());
  assert.match(row(dir, "1.2"), /^\| 1\.2 \| START \|/, "the valid action before it was applied and written");
  // The event log must not say a card moved when the record was never written.
  const moved = lines(P(dir).events).filter((e) => e.type === "card.moved").length;
  assert.equal(moved, /\| 1\.2 \| START \|/.test(read(P(dir).record)) ? 1 : 0, "events and record agree");
  rm(dir, from);
});

// ── F3 [P1] src/build/build.mjs:113 (ACT) with src/hooks/prompt.mjs:14 ──
// src/events/feed.mjs:8 "The feed is shown to every viewer, so what a person typed (prompt.received) never goes
// in: only that a message arrived." The page's other feed, var ACT, embeds the prompt's first 280 characters.
test("F3: what the owner typed to the agent is not in the page that gets published", () => {
  const dir = project();
  assert.equal(hook(dir, "prompt", { hook_event_name: "UserPromptSubmit", prompt: "my api key is SECRET-123, use it for the deploy", session_id: "s" }).status, 0);
  assert.equal(build(dir).status, 0);
  const page = read(P(dir).page);
  assert.match(page, /You sent a message/, "the live rail says a message arrived");
  assert.ok(!page.includes("SECRET-123"), "and the words themselves are nowhere in the page");
  rm(dir);
});

// ── F4 [P2] src/cli/cockpit.mjs:96 ──
// cockpit.mjs:22 "Every run can be repeated safely: an action already decided is skipped". Skipping reads the
// status in the EXPORT, which only changes after the agent sends the batch and exports again. The same export
// run twice (a retry after a failed send, a second wake) applies every note and add twice.
test("F4: running the inbox twice on the same export does not apply an action twice", () => {
  const dir = project();
  const from = exported({ actions: { a1: pending({ verb: "card.note", card: "1.2", text: "remember the host" }, 1),
                                     a2: pending({ verb: "card.add", goal: 1, owner: "agent", title: "Write a changelog" }, 2) } });
  assert.equal(cli(dir, "inbox", "--from", from).status, 0);
  assert.equal(cli(dir, "inbox", "--from", from).status, 0);
  const md = read(P(dir).record);
  assert.equal((md.match(/Remember the host/g) || []).length, 1, "the note is on the card once");
  assert.equal((md.match(/Write a changelog/g) || []).length, 1, "one new card, not two");
  rm(dir, from);
});

// ── F5 [P2] src/hooks/lib.mjs:26 (isBoard) ──
// The page's path is a setting ("out", COCKPIT_OUT; config.mjs:29) but isBoard only knows ".claude/board.html".
// With any other path a publish never leaves a receipt, so the Stop hook asks for a publish on every turn, forever.
test("F5: a project that builds its page somewhere else still gets a publish receipt, and the Stop hook goes quiet", () => {
  const dir = project({ title: "QA", out: "site/board.html" });
  fs.mkdirSync(path.join(dir, "site"));
  assert.equal(build(dir).status, 0);
  const page = path.join(dir, "site", "board.html");
  assert.ok(fs.existsSync(page));
  hook(dir, "after-tool", { hook_event_name: "PostToolUse", tool_name: "Artifact", tool_input: { file_path: page, url: "https://claude.ai/artifact/qa" }, tool_response: "Published", session_id: "s" });
  assert.ok(fs.existsSync(P(dir).receipt), "the publish was seen");
  assert.equal(hook(dir, "stop", { hook_event_name: "Stop", stop_hook_active: false, session_id: "s" }).stdout, "", "nothing left to publish");
  rm(dir);
});

// ── F6 [P2] src/cli/cockpit.mjs:283 ──
// The usage string has unescaped quotes around <text>, so JavaScript reads it as  "..." < text > "..."  and
// throws "text is not defined". `npm run cockpit` (no arguments) prints that instead of the commands.
test("F6: an unknown command, or none, prints the usage line and exits 2", () => {
  const dir = project();
  for (const args of [[], ["help"], ["frobnicate"]]) {
    const r = cli(dir, ...args);
    assert.match(r.stdout, /^usage: cockpit\.mjs init/, `"${args.join(" ")}" printed: ${(r.stderr || r.stdout).trim()}`);
    assert.equal(r.status, 2);
  }
  rm(dir);
});

// ── F7 [P2] src/events/events.mjs:37 ──
// events.mjs:3 "Every event gets the next OFFSET (1, 2, 3 ...)". The next offset is read from the file and then
// appended in two steps, with no lock. lib.mjs:34 says several sessions and subagents write here at once.
test("F7: four writers at once never hand out the same offset twice", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lob-qa-conc-")), f = path.join(d, "e.jsonl");
  const mod = pathToFileURL(SRC("events/events.mjs")).href;
  const code = `const ev = await import(${JSON.stringify(mod)}); for (let i = 0; i < 40; i++) ev.append("note.added", { w: process.argv[1], i }, ${JSON.stringify(f)});`;
  await Promise.all([0, 1, 2, 3].map((w) => new Promise((done) => spawn(NODE, ["--input-type=module", "-e", code, String(w)], { cwd: d, env: envFor(d), stdio: "ignore" }).on("exit", done))));
  const offsets = lines(f).map((e) => e.offset);
  assert.equal(offsets.length, 160, "every event was written");
  assert.equal(new Set(offsets).size, 160, `${160 - new Set(offsets).size} offsets were given to two events`);
  rm(d);
});

// ── F11 [P2] src/build/build.mjs:89 ──
// parse.mjs:9 "Nothing reaches DONE without it" (the Verified pointer). The build only checks a card that the
// last build saw in another state (`was[c.id] && was[c.id] !== "DONE"`). A row that ENTERS the record as DONE
// was never seen, so it passes with no evidence. (The same test passes any unconfirmed DONE on a fresh clone,
// because the snapshot it compares against is gitignored local state.)
test("F11: a card added to the record already DONE needs its evidence like any other", () => {
  const dir = project();
  assert.equal(build(dir).status, 0);
  const md = read(P(dir).record).replace(/^(\| 1\.5 \|.*)$/m, "$1\n| 1.6 | DONE | agent | code | S | - | - | **Born done.** Nobody checked this. | Somebody saw it work |");
  fs.writeFileSync(P(dir).record, md);
  const r = build(dir);
  assert.equal(r.status, 1, "the build refuses it; instead it printed: " + r.stdout.trim().split("\n").pop());
  assert.match(r.stderr, /card 1\.6 .*DONE without confirmation/);
  rm(dir);
});

// ── F8 [P3] src/core/parse.mjs:112,117 ──
// parse.mjs:2 "every problem here is either an ERROR or a WARNING". Card ids are looked up in a plain object,
// so a dependency named "constructor" is "found", and the parser throws instead of reporting it. The hooks
// fail open on a throw, so the record then goes unchecked.
test("F8: a dependency that is not a card is a record error, whatever it is called", () => {
  for (const dep of ["constructor", "toString", "__proto__"]) {
    const md = MD.replace("| 1.2 | BACKLOG | agent | code | L | - | 1.1 |", `| 1.2 | BACKLOG | agent | code | L | - | ${dep} |`);
    let rec;
    assert.doesNotThrow(() => { rec = parseLaunch(md); }, dep);
    assert.match(rec.errors.join("\n"), new RegExp(`card 1\\.2 depends on ${dep}, which does not exist`), dep);
  }
});

// ── F9 [P3] src/core/apply.mjs:50 ──
// parse.mjs:33 "A cell without a leading bold run still works". Editing only the text of such a card writes
// "**.** <text>": the title is gone and the record still parses, so nothing notices.
test("F9: editing the text of a card written without a bold title keeps its title", () => {
  const plainCell = MD.replace("**Write the core feature.** The one thing a user comes for.", "Write the core feature: the one thing a user comes for.");
  const before = parseLaunch(plainCell).cards.find((c) => c.id === "1.2");
  assert.equal(before.title, "Write the core feature");
  const d = decide({ verb: "card.edit", card: "1.2", text: "Replaced words" }, { cards: parseLaunch(plainCell).cards, level: "owner" });
  const after = parseLaunch(applyDecision(plainCell, d).md).cards.find((c) => c.id === "1.2");
  assert.equal(after.title, "Write the core feature");
  assert.equal(after.desc, "Replaced words");
});

// ── F10 [P3] src/adapters/claude.mjs:55 ──
// "a failed publish leaves no receipt", but a failure whose message contains the word "published" is read as a success.
test("F10: a failed publish leaves no receipt, however the failure is worded", () => {
  const failed = (response) => claude.publish.receipt({ kind: "publish", url: "https://claude.ai/artifact/x", response });
  assert.equal(failed("Error: conflict"), null);
  assert.equal(failed("Error: the page could not be published (version conflict)"), null);
  assert.equal(failed({ error: "not published: the artifact was changed elsewhere" }), null);
});
