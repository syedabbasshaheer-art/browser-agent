// node --test test/pulse.test.mjs — card 11.6: the capped pulse. A factual line a script makes from what the
// hooks already record; no model writes it. The decision and the sentence are pure (src/core/pulse.mjs); the
// last tests run the real after-tool hook against a scratch project in the OS temp folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pulseDecision, pulseSentence, pulseEvent, shortNames, cardsInProgress, CARD_LINES } from "../plugin/src/core/pulse.mjs";
import { entryOf, isLine } from "../plugin/src/events/feed.mjs";
import { AUTO_DEFAULTS } from "../plugin/src/build/config.mjs";
import { MD, project, hook, cli, rm, P, readJSON, lines, withRow } from "./qa/_helpers.mjs";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ms = (minAgo) => NOW - minAgo * 60000;
const at = (minAgo) => new Date(ms(minAgo)).toISOString();
const AUTO = { ...AUTO_DEFAULTS };                     // pulseGapMin 5, pulsePerHour 8
const card = (id, text = "") => ({ id, text: `| ${id} | START | agent | code | S | - | - | **Card.** ${text} | Seen |` });
const ev = (type, minAgo, data = {}) => ({ type, at: at(minAgo), ...data });
// Card 8.1 started 12 minutes ago; the agent last spoke about it 6 minutes ago.
const LOG = [ev("card.moved", 12.5, { card: "8.1", to: "START" }), ev("claude.said", 6, { card: "8.1", text: "Step one is done." })];
const SIX = { "src/build/template.html": ms(1), "design/proto.css": ms(2), "src/a.mjs": ms(3), "src/b.mjs": ms(4), "test/c.test.mjs": ms(5), "README.md": ms(5.5) };
const decide = (o = {}) => pulseDecision({ cards: [card("8.1")], entries: LOG, touched: SIX, auto: AUTO, now: NOW, ...o });

test("the sentence: the brief's own example, word for word", () => {
  const d = decide();
  assert.equal(d.pulse, true);
  assert.equal(d.text, "Working on 8.1 for 12 minutes: 6 files changed since the last update (template.html, proto.css and 4 more).");
  assert.deepEqual([d.card, d.files, d.minutes, d.names, d.since], ["8.1", 6, 12, ["template.html", "proto.css"], "update"]);
});

test("the sentence: one file, two files, three; names are base names, two at most, then 'and N more'", () => {
  const s = (files, minutes = 7) => pulseSentence({ card: "1.2", minutes, files });
  assert.equal(s(["src/deep/down/app.js"]), "Working on 1.2 for 7 minutes: 1 file changed since the last update (app.js).");
  assert.equal(s(["a/x.js", "b\\y.css"]), "Working on 1.2 for 7 minutes: 2 files changed since the last update (x.js, y.css).");
  assert.equal(s(["a/x.js", "b/y.css", "z.md"]), "Working on 1.2 for 7 minutes: 3 files changed since the last update (x.js, y.css and 1 more).");
  assert.equal(s(Array.from({ length: 40 }, (_, i) => `src/f${i}.js`)), "Working on 1.2 for 7 minutes: 40 files changed since the last update (f0.js, f1.js and 38 more).");
  // Two files with the same base name are told apart by their folder; a name is one short plain word.
  assert.deepEqual(shortNames(["src/a/index.js", "src/b/index.js", "x.md"]), ["a/index.js", "b/index.js", "x.md"]);
  assert.equal(shortNames(["dir/" + "n".repeat(60) + ".js"])[0].length, 40);
  assert.ok(!/[|*\n]/.test(shortNames(["dir/a|b*c\nd.js"])[0]));
});

test("the sentence: minutes are rounded down, and a time that is not known is not said", () => {
  const s = (minutes) => pulseSentence({ card: "1.2", minutes, files: ["a.js"] });
  assert.match(s(12.99), /^Working on 1\.2 for 12 minutes: /);
  assert.match(s(1), /^Working on 1\.2 for 1 minute: /);
  assert.match(s(0.9), /^Working on 1\.2 for less than a minute: /);
  assert.equal(s(null), "Working on 1.2: 1 file changed since the last update (a.js).");
  assert.equal(s(undefined), s(null));
  // From the log: started 12 minutes and 59 seconds ago is "12 minutes".
  const log = [ev("card.moved", 12 + 59 / 60, { card: "8.1", to: "START" }), ev("claude.said", 6, { card: "8.1", text: "x" })];
  assert.equal(decide({ entries: log }).minutes, 12);
  // A card the log never saw start: the line is known, the duration is not, so it is left out.
  const noStart = decide({ entries: [ev("claude.said", 6, { card: "8.1", text: "x" })] });
  assert.equal(noStart.text, "Working on 8.1: 6 files changed since the last update (template.html, proto.css and 4 more).");
  assert.equal(noStart.minutes, null);
  assert.ok(!("minutes" in pulseEvent(noStart)));
  // Started and never spoken about: the count is "since it started".
  const quiet = decide({ entries: [ev("card.moved", 9, { card: "8.1", to: "START" })] });
  assert.equal(quiet.text, "Working on 8.1 for 9 minutes: 6 files changed since it started (template.html, proto.css and 4 more).");
  // Neither a start nor a line in the log: nothing can be counted, so there is no pulse at all.
  const blind = decide({ entries: [ev("claude.said", 6, { card: "9.9", text: "another card" })] });
  assert.deepEqual(blind, { pulse: false, why: "The log does not say when 8.1 started or was last spoken about, so nothing can be counted." });
});

test("the gap: no pulse until the agent's last line about the card is pulseGapMin minutes old", () => {
  const said = (minAgo) => [ev("card.moved", 30, { card: "8.1", to: "START" }), ev("claude.said", minAgo, { card: "8.1", text: "x" })];
  const touched = { "a.js": ms(0.5) };
  const young = decide({ entries: said(4.9), touched });
  assert.deepEqual(young, { pulse: false, why: "The agent's last line about 8.1 is 4 minutes old; a pulse waits for 5." });
  assert.equal(decide({ entries: said(5), touched }).pulse, true, "five minutes exactly is old enough");
  assert.equal(decide({ entries: said(1), touched }).pulse, false);
  assert.equal(decide({ entries: said(9), touched, auto: { ...AUTO, pulseGapMin: 10 } }).pulse, false, "the setting is the gap");
  assert.equal(decide({ entries: said(10), touched, auto: { ...AUTO, pulseGapMin: 10 } }).pulse, true);
  // Every kind of line about the card resets the gap, a pulse included; a line about another card does not.
  assert.deepEqual([...CARD_LINES], ["claude.said", "claude.asked", "claude.auto", "claude.pulse", "turn.ended"]);
  for (const type of CARD_LINES) assert.equal(decide({ entries: [...said(20), ev(type, 2, { card: "8.1", text: "x" })], touched }).pulse, false, type);
  assert.equal(decide({ entries: [...said(20), ev("claude.said", 2, { card: "8.2", text: "x" }), ev("claude.said", 1, { text: "no card" }), ev("mirror.diffed", 1, { card: "8.1" })], touched }).pulse, true);
});

test("the cap: fewer than pulsePerHour pulses in the last hour, and 0 turns pulses off", () => {
  const base = [ev("card.moved", 200, { card: "8.1", to: "START" })];
  const pulses = (n, firstAgo = 59) => Array.from({ length: n }, (_, i) => ev("claude.pulse", firstAgo - i * 6, { card: "8.1", text: "p" }));
  // Eight in the last hour (59, 53, ... 17 minutes ago): the ninth is refused.
  const full = decide({ entries: [...base, ...pulses(8)], touched: { "a.js": ms(1) } });
  assert.deepEqual(full, { pulse: false, why: "8 pulses were written in the last hour, which is the limit (8)." });
  // Seven in the hour is under the cap.
  assert.equal(decide({ entries: [...base, ...pulses(7)], touched: { "a.js": ms(1) } }).pulse, true);
  // A pulse older than an hour no longer counts: eight written, the first 61 minutes ago.
  assert.equal(decide({ entries: [...base, ...pulses(8, 61)], touched: { "a.js": ms(1) } }).pulse, true);
  // The cap counts every pulse in the project, whichever card it named.
  const other = pulses(8).map((e) => ({ ...e, card: "7.7" }));
  assert.equal(decide({ entries: [...base, ...other], touched: { "a.js": ms(1) } }).pulse, false);
  assert.match(decide({ entries: [...base, ...pulses(1)], touched: { "a.js": ms(1) }, auto: { ...AUTO, pulsePerHour: 1 } }).why, /1 pulse was written in the last hour, which is the limit \(1\)/);
  assert.deepEqual(decide({ auto: { ...AUTO, pulsePerHour: 0 } }), { pulse: false, why: "Pulses are off (auto.pulsePerHour is 0)." });
  // A setting that is missing or of the wrong type never becomes a guess.
  for (const auto of [null, {}, { pulseGapMin: "5", pulsePerHour: 8 }, { pulseGapMin: 5 }, { pulseGapMin: 0, pulsePerHour: 8 }, { pulseGapMin: 5, pulsePerHour: -1 }])
    assert.match(decide({ auto }).why, /missing or not valid, so no pulse is written/);
});

test("no files changed since the last line: no pulse, because silence is not news", () => {
  assert.deepEqual(decide({ touched: {} }), { pulse: false, why: "No file was edited since the last line about 8.1: silence is not news." });
  // Edits from before the agent's last line were already covered by that line.
  assert.equal(decide({ touched: { "a.js": ms(7), "b.js": ms(30) } }).pulse, false);
  const one = decide({ touched: { "a.js": ms(7), "b.js": ms(5.9) } });
  assert.equal(one.text, "Working on 8.1 for 12 minutes: 1 file changed since the last update (b.js).");
  // After a pulse, only what was edited since that pulse is counted next time.
  const after = [...LOG, ev("claude.pulse", 5.5, { card: "8.1", text: "p" })];
  assert.equal(decide({ entries: after, touched: { "a.js": ms(5.8), "b.js": ms(5.6) } }).pulse, false);
  assert.equal(decide({ entries: after, touched: { "a.js": ms(5.8), "b.js": ms(5.6), "c.js": ms(1) } }).files, 1);
  // The board's own folders are not work on a card; a time that cannot be right is not counted either.
  const own = decide({ touched: { ".cockpit/BOARD.md": ms(1), ".claude/board.html": ms(1), "src/x.js": ms(1) }, skip: [".claude/", ".cockpit/"] });
  assert.equal(own.text, "Working on 8.1 for 12 minutes: 1 file changed since the last update (x.js).");
  assert.equal(decide({ touched: { ".cockpit/BOARD.md": ms(1) }, skip: [".claude/", ".cockpit/"] }).pulse, false);
  assert.equal(decide({ touched: { "a.js": NOW + 60000, "b.js": "soon", "c.js": 0 } }).pulse, false);
  for (const junk of [null, [], "x", 7]) assert.equal(decide({ touched: junk }).pulse, false);
  assert.deepEqual(decide({ cards: [] }), { pulse: false, why: "No card is in progress." });
});

test("more than one card in progress: one pulse, for the card whose text names the changed files, or else the oldest", () => {
  const log = [
    ev("card.moved", 40, { card: "8.1", to: "START" }), ev("claude.said", 20, { card: "8.1", text: "x" }),
    ev("card.moved", 30, { card: "8.2", to: "START" }), ev("claude.said", 10, { card: "8.2", text: "y" }),
  ];
  const two = [card("8.1", "Build the page."), card("8.2", "Change `proto.css` and the template.")];
  // 8.2's own text names proto.css, so the pulse is about 8.2, although 8.1 is older.
  const named = pulseDecision({ cards: two, entries: log, touched: { "design/proto.css": ms(2), "src/other.js": ms(3) }, auto: AUTO, now: NOW });
  assert.equal(named.card, "8.2");
  assert.equal(named.text, "Working on 8.2 for 30 minutes: 2 files changed since the last update (proto.css, other.js).");
  // A stem of five letters or more counts as a name ("the template" for template.html); a short one does not.
  const stem = pulseDecision({ cards: [card("8.1", "Fix app."), card("8.2", "Rework the template.")], entries: log, touched: { "src/template.html": ms(2), "src/app.js": ms(1) }, auto: AUTO, now: NOW });
  assert.equal(stem.card, "8.2", "app.js is not named by 'app.', template.html is named by 'template'");
  // No card names any changed file: the card in progress longest.
  const oldest = pulseDecision({ cards: two.slice().reverse(), entries: log, touched: { "src/other.js": ms(3) }, auto: AUTO, now: NOW });
  assert.equal(oldest.card, "8.1");
  assert.match(oldest.text, /^Working on 8\.1 for 40 minutes: 1 file changed since the last update \(other\.js\)\.$/);
  // Only a card that is due can be named: 8.1 spoke a minute ago, so the one pulse is about 8.2.
  const fresh = [...log, ev("claude.said", 1, { card: "8.1", text: "z" })];
  assert.equal(pulseDecision({ cards: two, entries: fresh, touched: { "src/other.js": ms(0.5) }, auto: AUTO, now: NOW }).card, "8.2");
  // It is always one decision, never a list.
  assert.equal(typeof named.text, "string"); assert.ok(!Array.isArray(named));
});

test("the event: the contract's fields, the last step when there is one, and it reads as a pulse line", () => {
  const log = [ev("card.moved", 12.5, { card: "8.1", to: "START" }), ev("claude.said", 9, { card: "8.1", text: "a", step: 2, of: 6 }), ev("claude.said", 6, { card: "8.1", text: "b", step: 3, of: 6 })];
  const d = decide({ entries: log });
  assert.deepEqual(pulseEvent(d), { text: "Working on 8.1 for 12 minutes: 6 files changed since the last update (template.html, proto.css and 4 more).", say: "pulse", card: "8.1", files: 6, minutes: 12, step: 3, of: 6 });
  const e = entryOf({ offset: 9, at: at(0), type: "claude.pulse", ...pulseEvent(d) });
  assert.deepEqual(e, { offset: 9, at: at(0), kind: "pulse", who: "Agent", text: d.text, card: "8.1", step: 3, of: 6, say: "pulse" });
  assert.ok(isLine({ type: "claude.pulse" }), "a pulse is a line on the board");
  assert.ok(d.text.length <= 280);
  // A step from before the card's current start is not this run's step; no step at all is no field.
  const restarted = [ev("claude.said", 50, { card: "8.1", text: "old", step: 5, of: 6 }), ...LOG];
  assert.ok(!("step" in pulseEvent(decide({ entries: restarted }))));
  assert.ok(!("step" in pulseEvent(decide())));
});

test("cardsInProgress: the rows in START, each with its own text", () => {
  const md = withRow(withRow(MD, "1.2", (c) => { c[1] = "START"; }), "1.4", (c) => { c[1] = "START"; });
  const list = cardsInProgress(md);
  assert.deepEqual(list.map((c) => c.id), ["1.2", "1.4"]);
  assert.match(list[0].text, /Write the core feature/);
  assert.deepEqual(cardsInProgress(MD), []);
  assert.deepEqual(cardsInProgress(null), []);
});

// ── The hook: the real after-tool script, fed what the harness sends. ──

const S = "pulse-session";
const edit = (file, session = S) => ({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file }, session_id: session });
const context = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "");
const STARTED = withRow(MD, "1.2", (c) => { c[1] = "START"; });
const BOARD = { title: "Pulse", artifact: "https://claude.ai/artifact/pulse-test" };
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const writeLog = (dir, list) => { fs.mkdirSync(P(dir).local, { recursive: true }); fs.writeFileSync(P(dir).events, list.map((e, i) => JSON.stringify({ offset: i + 1, ...e })).join("\n") + "\n"); };
const touch = (dir, files, session = S) => fs.writeFileSync(path.join(P(dir).local, `touched-${session}.json`), JSON.stringify(Object.fromEntries(Object.entries(files).map(([p, min]) => [p, Date.now() - min * 60000]))));
// 1.2 started 20 minutes ago; the agent's last line about it is 12 minutes old (so the ten-minute reminder is due too).
const quietLog = () => [{ type: "card.moved", at: ago(20.5), card: "1.2", from: "BACKLOG", to: "START" }, { type: "claude.said", at: ago(12.5), card: "1.2", text: "Step one is done." }];

test("hook: a pulse is written by the script, replaces the ten-minute reminder, and hands over one instruction", () => {
  const dir = project(BOARD, STARTED);
  writeLog(dir, quietLog());
  touch(dir, { "src/a.js": 3, "src/b.css": 2, "src/old.js": 15 });
  const r = hook(dir, "after-tool", edit(path.join(dir, "src", "app.js")));
  assert.equal(r.status, 0, r.stderr);
  const said = context(r);
  const log = lines(P(dir).events);
  assert.equal(log.length, 3, "one event was appended");
  const p = log[2];
  assert.deepEqual([p.type, p.say, p.card, p.files, p.minutes], ["claude.pulse", "pulse", "1.2", 3, 20]);
  assert.equal(p.text, "Working on 1.2 for 20 minutes: 3 files changed since the last update (app.js, b.css and 1 more).");
  // ONE instruction: send the prepared batch, then record it. The batch file exists and carries the pulse.
  const m = said.match(/^\[board\] A pulse was written for card 1\.2 \(#3\): "Working on 1\.2 for 20 minutes: 3 files changed since the last update \(app\.js, b\.css and 1 more\)\." Send it now: one ArtifactData batch call with the writes in (\S+push-batch-1\.json), then run: node "([^"]+cockpit\.mjs)" push --sent 3$/);
  assert.ok(m, said);
  const writes = readJSON(m[1]);
  assert.deepEqual(writes.map((w) => [w.op, w.collection, w.doc_id]), [["set", "live", "u1"], ["set", "live", "u2"], ["set", "live", "u3"]]);
  assert.deepEqual(readJSON(writes[2].file_path), { offset: 3, at: p.at, kind: "pulse", who: "Agent", text: p.text, card: "1.2", say: "pulse" });
  // Never both: the card has been quiet for 12 minutes, and the reminder is not in this message.
  assert.ok(!/no update for/.test(said) && !/Post one now/.test(said), said);
  assert.equal(said.split("\n").length, 1);
  // The command it names works: the lines are recorded as sent.
  assert.equal(cli(dir, "push", "--sent", "3").status, 0);
  // The very next call: no second pulse (the pulse is the newest line), and no reminder on its heels either.
  const again = hook(dir, "after-tool", edit(path.join(dir, "src", "more.js")));
  assert.equal(again.status, 0); assert.equal(again.stdout, "");
  assert.equal(lines(P(dir).events).length, 3);
  rm(dir);
});

test("hook: with pulses off, or nothing edited by this session, the ten-minute reminder comes as it did before", () => {
  // Pulses off in the settings.
  let dir = project({ ...BOARD, auto: { pulsePerHour: 0 } }, STARTED);
  writeLog(dir, quietLog());
  let r = hook(dir, "after-tool", edit(path.join(dir, "src", "app.js")));
  assert.match(context(r), /^\[board\] Card 1\.2 is in progress and the board has had no update for 12 min\./);
  assert.equal(lines(P(dir).events).length, 2, "no pulse was written");
  rm(dir);
  // Another tool, nothing edited: no file changed, so no pulse; the reminder still speaks.
  dir = project(BOARD, STARTED);
  writeLog(dir, quietLog());
  r = hook(dir, "after-tool", { hook_event_name: "PostToolUse", tool_name: "Artifact", tool_input: { action: "read" }, session_id: S });
  assert.match(context(r), /no update for 12 min/);
  assert.equal(lines(P(dir).events).length, 2);
  rm(dir);
  // No published board: nothing could be sent, so no pulse is written.
  dir = project({ title: "No board yet" }, STARTED);
  writeLog(dir, quietLog());
  r = hook(dir, "after-tool", edit(path.join(dir, "src", "app.js")));
  assert.match(context(r), /no update for 12 min/);
  assert.ok(lines(P(dir).events).every((e) => e.type !== "claude.pulse"));
  rm(dir);
});

// every line so far is on the board, so the reminder to send is not what these calls are about
const allSent = (dir) => fs.writeFileSync(path.join(P(dir).local, "pushed.json"), JSON.stringify({ last: lines(P(dir).events).length, have: [], pending: {} }));

test("hook: lines logged and not sent for two minutes earn one reminder with the batch ready; a fresh line or a sent one earns none", () => {
  let dir = project(BOARD, STARTED);
  writeLog(dir, [{ type: "card.moved", at: ago(9), card: "1.2", to: "START" }, { type: "claude.said", at: ago(4), card: "1.2", text: "Step one is done." }]);
  const bash = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, session_id: S };
  let r = hook(dir, "after-tool", bash);
  const said = context(r);
  assert.match(said, /^\[board\] 2 lines are logged but not on the board, the oldest for 9 min\. .*one ArtifactData batch call with the writes in (.+push-batch-1\.json), then run: node ".+cockpit\.mjs" push --sent 2$/);
  assert.equal(context(hook(dir, "after-tool", bash)), "", "not twice in three minutes");
  rm(dir);
  dir = project(BOARD, STARTED);
  writeLog(dir, [{ type: "card.moved", at: ago(1), card: "1.2", to: "START" }, { type: "claude.said", at: ago(1), card: "1.2", text: "x" }]);
  assert.equal(hook(dir, "after-tool", bash).stdout, "", "a line one minute old is not late yet");
  rm(dir);
  dir = project(BOARD, STARTED);
  writeLog(dir, [{ type: "card.moved", at: ago(5), card: "1.2", to: "START" }, { type: "claude.said", at: ago(4), card: "1.2", text: "x" }]);
  allSent(dir);
  assert.equal(hook(dir, "after-tool", bash).stdout, "", "everything is on the board");
  assert.equal(hook(dir, "after-tool", { ...bash, tool_name: "ArtifactData" }).stdout, "");
  rm(dir);
});

test("hook: the gap and the cap hold across calls, and a card that is not in progress never pulses", () => {
  // The agent spoke 3 minutes ago: nothing is due, and nothing is said.
  let dir = project(BOARD, STARTED);
  writeLog(dir, [{ type: "card.moved", at: ago(20), card: "1.2", to: "START" }, { type: "claude.said", at: ago(3), card: "1.2", text: "x" }]);
  allSent(dir);
  let r = hook(dir, "after-tool", edit(path.join(dir, "src", "app.js")));
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  assert.equal(lines(P(dir).events).length, 2);
  rm(dir);
  // Two pulses already in the last hour and a cap of two: no third.
  dir = project({ ...BOARD, auto: { pulsePerHour: 2 } }, STARTED);
  writeLog(dir, [{ type: "card.moved", at: ago(50), card: "1.2", to: "START" }, { type: "claude.pulse", at: ago(40), card: "1.2", text: "p" }, { type: "claude.pulse", at: ago(7), card: "1.2", text: "p" }]);
  fs.writeFileSync(path.join(P(dir).local, "nudge.json"), JSON.stringify({ at: Date.now() })); // the reminder has just spoken
  allSent(dir);
  r = hook(dir, "after-tool", edit(path.join(dir, "src", "app.js")));
  assert.equal(r.stdout, "");
  assert.equal(lines(P(dir).events).filter((e) => e.type === "claude.pulse").length, 2);
  rm(dir);
  // Nothing in progress: the hook is silent and writes nothing.
  dir = project(BOARD);
  writeLog(dir, [{ type: "claude.said", at: ago(30), card: "1.2", text: "x" }]);
  allSent(dir);
  r = hook(dir, "after-tool", edit(path.join(dir, "src", "app.js")));
  assert.equal(r.stdout, "");
  assert.equal(lines(P(dir).events).length, 1);
  rm(dir);
});

test("hook: only this session's edits are counted, and the board's own files are not", () => {
  const dir = project(BOARD, STARTED);
  writeLog(dir, quietLog());
  touch(dir, { "src/theirs-1.js": 2, "src/theirs-2.js": 2 }, "another-session");
  // This session edits a file of the board's own machinery only: nothing to report.
  fs.writeFileSync(path.join(P(dir).local, "nudge.json"), JSON.stringify({ at: Date.now() }));
  let r = hook(dir, "after-tool", edit(path.join(dir, ".cockpit", "NOTES.md")));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines(P(dir).events).every((e) => e.type !== "claude.pulse"), "the notes file is not work on a card");
  // Then one work file: the pulse counts that one, not the other session's two.
  r = hook(dir, "after-tool", edit(path.join(dir, "src", "mine.js")));
  const p = lines(P(dir).events).find((e) => e.type === "claude.pulse");
  assert.equal(p.text, "Working on 1.2 for 20 minutes: 1 file changed since the last update (mine.js).");
  rm(dir);
});

test("a queued card earns no pulse: the files edited meanwhile belong to the card being worked on", () => {
  const T0 = Date.parse("2026-10-07T10:00:00Z"), at = (m) => new Date(T0 - m * 60000).toISOString();
  const entries = [{ type: "card.moved", card: "1.1", to: "START", at: at(40) }, { type: "claude.said", card: "1.1", say: "queued", text: "Queued behind 1.2.", at: at(30) },
    { type: "card.moved", card: "1.2", to: "START", at: at(40) }, { type: "claude.said", card: "1.2", text: "Step one.", at: at(20) }];
  const d = pulseDecision({ cards: [{ id: "1.1", text: "" }, { id: "1.2", text: "" }], entries, touched: { "src/a.mjs": T0 - 60000 }, auto: { pulseGapMin: 5, pulsePerHour: 8 }, now: T0 });
  assert.equal(d.pulse, true); assert.equal(d.card, "1.2");
  const only = pulseDecision({ cards: [{ id: "1.1", text: "" }], entries, touched: { "src/a.mjs": T0 - 60000 }, auto: { pulseGapMin: 5, pulsePerHour: 8 }, now: T0 });
  assert.equal(only.pulse, false);
  // a pulse written about it by mistake does not make it a card being worked on
  const again = pulseDecision({ cards: [{ id: "1.1", text: "" }], entries: entries.concat([{ type: "claude.pulse", card: "1.1", text: "Working on 1.1.", at: at(10) }]), touched: { "src/a.mjs": T0 - 60000 }, auto: { pulseGapMin: 5, pulsePerHour: 8 }, now: T0 });
  assert.equal(again.pulse, false);
});
