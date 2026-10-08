// node --test test/lint.test.mjs — card 10.2: the plan check catches what a reader of the plan would trip on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseLaunch } from "../plugin/src/core/parse.mjs";
import { planLint } from "../plugin/src/core/lint.mjs";

const MD = fs.readFileSync(fileURLToPath(new URL("./fixtures/record-min.md", import.meta.url)), "utf8");
const CLI = fileURLToPath(new URL("../plugin/src/cli/cockpit.mjs", import.meta.url));
// Rewrite one card row: fn gets the nine cells and may change them.
const withRow = (id, fn) => MD.split(/\r?\n/).map((l) => {
  if (!l.startsWith(`| ${id} | `)) return l;
  const c = l.split(" | "); fn(c); return c.join(" | ");
}).join("\n");
const texts = (md, extra = {}) => planLint({ ...parseLaunch(md), ...extra }).map((f) => f.level + ": " + f.text);

test("lint: a card must say why it exists and how to finish it", () => {
  const t = texts(MD);
  assert.ok(t.some((x) => /^warn: Card 1\.2 does not say why/.test(x)), "the fixture's cards have no Why");
  const good = withRow("1.2", (c) => { c[7] += " • Why: Users come for it. • Check: It runs locally."; });
  assert.ok(!texts(good).some((x) => /Card 1\.2 (does not say why|has neither)/.test(x)));
  const noDone = withRow("1.2", (c) => { c[8] = "- |"; });
  assert.ok(texts(noDone).some((x) => /^error: Card 1\.2 has no done-when/.test(x)));
});
test("lint: a card for a person needs steps", () => {
  assert.ok(texts(MD).some((x) => /Card 1\.3 is for a person but has no steps/.test(x)));
  const stepped = withRow("1.3", (c) => { c[7] += " • Step: Open the host's site and click Sign up."; });
  assert.ok(!texts(stepped).some((x) => /Card 1\.3 is for a person/.test(x)));
});
test("lint: a goal that cannot start, and a finish card that does not exist, are errors", () => {
  // Every open card now waits on another open card in the same goal: nothing can begin.
  const stuck = withRow("1.1", (c) => { c[1] = "BACKLOG"; c[6] = "1.5"; });
  assert.ok(planLint(parseLaunch(stuck)).some((f) => f.level === "error" && /Goal 1 cannot start/.test(f.text)), "a deadlocked goal is an error from the lint itself");
  assert.ok(texts(MD, { finish: "9.9" }).some((x) => /^error: The finish card 9\.9 does not exist/.test(x)));
  assert.ok(!texts(MD, { finish: "1.5" }).some((x) => /finish card/.test(x)));
});
test("lint: the command prints findings and exits 1 only on errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-lint-"));
  fs.mkdirSync(path.join(dir, ".cockpit"));
  fs.writeFileSync(path.join(dir, ".cockpit", "config.json"), "{}");
  const run = (md) => { fs.writeFileSync(path.join(dir, ".cockpit", "BOARD.md"), md);
    const env = { ...process.env, COCKPIT_ROOT: dir }; delete env.COCKPIT_RECORD;
    return spawnSync(process.execPath, [CLI, "lint"], { cwd: dir, env, encoding: "utf8" }); };
  const warned = run(MD);
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stdout, /Plan check: 1 goals, 5 cards; 0 error\(s\), \d+ warning\(s\)/);
  const broken = run(withRow("1.2", (c) => { c[8] = "- |"; }));
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /ERROR  Card 1\.2 has no done-when/);
  fs.rmSync(dir, { recursive: true, force: true });
});
