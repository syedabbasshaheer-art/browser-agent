// The clock: how fast the three loops between the board and the agent turn, measured from what was logged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loopClock, clockLines, stat, span } from "../plugin/src/core/clock.mjs";

const CLI = fileURLToPath(new URL("../plugin/src/cli/cockpit.mjs", import.meta.url));
const T = (s) => new Date(Date.UTC(2026, 9, 11, 6, 0, s)).toISOString();

test("a click is timed from the press to the moment the agent took it", () => {
  const c = loopClock({ events: [
    { offset: 1, at: T(50), type: "action.received", askedAt: T(0) },
    { offset: 2, at: T(80), type: "action.received", askedAt: T(60) },
    { offset: 3, at: T(90), type: "action.received" },                       // no press time: not measured
  ] });
  assert.deepEqual(c.click, { n: 2, median: 35, worst: 50 });
});

test("a question is timed from the asking to its own answer, and an open one is counted", () => {
  const c = loopClock({ events: [
    { offset: 5, at: T(0), type: "claude.asked" },
    { offset: 6, at: T(10), type: "claude.asked" },
    { offset: 7, at: T(120), type: "question.answered", qid: "q5" },
    { offset: 8, at: T(130), type: "question.answered", qid: "q99" },         // an answer to nothing asked here
  ] });
  assert.deepEqual(c.answer, { n: 1, median: 120, worst: 120 });
  assert.equal(c.open, 1);
});

test("a line is timed by the send that carried it; since leaves out what is older", () => {
  const sends = [{ at: T(0), lags: [600] }, { at: T(3000), lags: [20, 40, 90] }];
  assert.deepEqual(loopClock({ sends }).feed, { n: 4, median: 65, worst: 600 });
  assert.deepEqual(loopClock({ sends, since: new Date(T(100)).getTime() }).feed, { n: 3, median: 40, worst: 90 });
});

test("nothing measured is said as such, never as zero", () => {
  const lines = clockLines(loopClock({}));
  assert.equal(lines.length, 4);
  lines.slice(0, 3).forEach((l) => assert.match(l, /nothing measured yet\./));
  assert.deepEqual(stat([NaN, -3]), { n: 0, median: null, worst: null });
  assert.equal(span(1), "1 second"); assert.equal(span(49), "49 seconds"); assert.equal(span(240), "4 minutes"); assert.equal(span(7200), "2 hours");
});

test("push --sent records how long each line waited, and clock reports it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-clock-"));
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: dir, env: { ...process.env, COCKPIT_ROOT: dir, CLAUDE_PROJECT_DIR: "", COCKPIT_NO_OPEN: "1" }, encoding: "utf8" });
  assert.equal(run("init", "--title", "Clock").status, 0);
  const cfgF = path.join(dir, ".cockpit/config.json"), cfg = JSON.parse(fs.readFileSync(cfgF, "utf8"));
  cfg.artifact = "https://claude.ai/artifact/abcDEF123"; fs.writeFileSync(cfgF, JSON.stringify(cfg));
  assert.equal(run("say", "The first line.").status, 0);
  const high = (run("push").stdout.match(/Highest offset: (\d+)/) || [])[1];
  assert.ok(high, "push names the highest offset");
  assert.equal(run("push", "--sent", high).status, 0);
  const rows = fs.readFileSync(path.join(dir, ".claude/local/sends.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].lags.length >= 1 && rows[0].lags.every((s) => s >= 0 && s < 120));
  const c = JSON.parse(run("clock", "--json").stdout);
  assert.equal(c.feed.n, rows[0].lags.length);
  assert.match(run("clock").stdout, /2\. The agent to the board\..*usually \d+ seconds?/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("goals prints the plan for the terminal: each goal, what it ends in, and its cards under it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-goals-"));
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: dir, env: { ...process.env, COCKPIT_ROOT: dir, CLAUDE_PROJECT_DIR: "", COCKPIT_NO_OPEN: "1" }, encoding: "utf8" });
  assert.equal(run("init", "--title", "Goals").status, 0);
  const full = run("goals").stdout, brief = run("goals", "--brief").stdout;
  assert.match(full, /^Your plan: \d+ goals?, \d+ cards?/);
  assert.match(full, /^  GOAL 1  .+\d+ of \d+ done$/m);
  assert.match(full, /^ {12}1\.1 {3}\S/m, "a card is listed under its goal");
  assert.doesNotMatch(brief, /^ {12}1\.1/m, "--brief leaves the cards out");
  assert.match(brief, /^  GOAL 1  /m);
  full.split("\n").forEach((l) => { assert.ok(l.length <= 78, "no line is wider than 78: " + l); assert.equal(l, l.trimEnd()); });
  fs.rmSync(dir, { recursive: true, force: true });
});
