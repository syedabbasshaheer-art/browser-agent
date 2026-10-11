// Version 0.0.12: the small opening page of a first run, the board's name, the faster reminder to send,
// the time the agent was told of a request, and the count of results that end with the owner's next move.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unsentDue, UNSENT_MIN, SEND_GAP_SEC } from "../plugin/src/hooks/quiet.mjs";
import { loopClock, clockLines } from "../plugin/src/core/clock.mjs";

const CLI = fileURLToPath(new URL("../plugin/src/cli/cockpit.mjs", import.meta.url));
const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...process.env, COCKPIT_ROOT: dir, CLAUDE_PROJECT_DIR: "" }, encoding: "utf8" });
const folder = (name) => { const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lob-r12-")), name); fs.mkdirSync(d); return d; };

test("a first run writes a small opening page, names the board after the folder, and says to publish the small page first", () => {
  const d = folder("my-video_project"), r = run(d, "init", "--planning");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const opening = path.join(d, ".claude/local/opening.html"), full = path.join(d, ".claude/board.html");
  assert.ok(fs.statSync(opening).size < 12000, "the opening page is a few kilobytes");
  assert.ok(fs.statSync(full).size > 20 * fs.statSync(opening).size);
  const html = fs.readFileSync(opening, "utf8");
  assert.match(html, /<title>My Video Project<\/title>/);
  assert.doesNotMatch(html, /__[A-Z_]+__/);
  assert.doesNotMatch(html, /innerHTML/, "lines from the board are shown as text only");
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, ".cockpit/config.json"), "utf8")).title, "My Video Project");
  assert.match(r.stdout, /publish \.claude\/local\/opening\.html/);
});

test("a board that is not on a first run gets no opening page, and a title given by hand is kept", () => {
  const d = folder("x"), r = run(d, "init", "--title", "Maya's films");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(path.join(d, ".claude/local/opening.html")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, ".cockpit/config.json"), "utf8")).title, "Maya's films");
  assert.match(r.stdout, /publish \.claude\/board\.html/);
});

test("a folder whose name is already a name keeps it", () => {
  const d = folder("Maya Films"); run(d, "init");
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, ".cockpit/config.json"), "utf8")).title, "Maya Films");
  for (const [name, want] of [["notes.v2", "notes.v2"], ["iOS-app", "iOS App"], ["next.js-blog", "Next.js Blog"]]) {
    const x = folder(name); run(x, "init");
    assert.equal(JSON.parse(fs.readFileSync(path.join(x, ".cockpit/config.json"), "utf8")).title, want);
  }
  const y = folder("t"); run(y, "init", "--title", "iPhone repairs | Maya");
  assert.equal(JSON.parse(fs.readFileSync(path.join(y, ".cockpit/config.json"), "utf8")).title, "iPhone repairs | Maya", "a title typed by hand is kept as typed");
  const z = folder("u"), long = run(z, "init", "--title", "x".repeat(90));
  assert.notEqual(long.status, 0); assert.match(long.stderr + long.stdout, /limit is 80/);
});

test("a logged line earns its reminder after half a minute, and the reminder may repeat within a minute", () => {
  const now = Date.parse("2026-10-11T10:00:00Z"), at = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(UNSENT_MIN, 0.5);
  assert.ok(SEND_GAP_SEC <= 60);
  assert.equal(unsentDue([{ at: at(20) }], now), null);
  assert.deepEqual(unsentDue([{ at: at(40) }], now), { count: 1, minutes: 0 });
  assert.deepEqual(unsentDue([{ at: at(40) }, { at: at(130) }], now), { count: 2, minutes: 2 });
});

test("the clock counts the results on a card that offered a reply to press", () => {
  const at = "2026-10-11T10:00:00Z";
  const c = loopClock({ events: [
    { type: "claude.said", say: "result", card: "1.1", replies: ["Start 1.2"], at },
    { type: "claude.said", say: "result", card: "1.2", at },
    { type: "claude.said", say: "result", at },            // no card: not counted
    { type: "claude.said", card: "1.2", at },              // a step, not a result
  ] });
  assert.deepEqual(c.results, { n: 2, led: 1 });
  assert.match(clockLines(c)[3], /1 of 2 results on a card offered a reply to press/);
  assert.match(clockLines(loopClock({}))[3], /no result on a card yet/);
});

test("say prints the batch's writes on one line, and a result with no next move says so", () => {
  const d = folder("p"); run(d, "init");
  const f = path.join(d, ".cockpit/config.json"), cfg = JSON.parse(fs.readFileSync(f, "utf8"));
  cfg.artifact = "https://claude.ai/artifact/AAAAAAAAAAAAAAAAAAAAAA"; fs.writeFileSync(f, JSON.stringify(cfg));
  const id = (fs.readFileSync(path.join(d, ".cockpit/BOARD.md"), "utf8").match(/^\| (\d+\.\d+) \|/m) || [])[1];
  const r = run(d, "say", "The first card is finished.", "--kind", "result", "--card", id);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /offers the owner no next move/);
  const line = r.stdout.split("\n").find((l) => l.startsWith("Its writes: "));
  assert.ok(line, r.stdout);
  const writes = JSON.parse(line.slice("Its writes: ".length));
  assert.ok(writes.some((w) => w.op === "set" && w.collection === "live" && /^u\d+$/.test(w.doc_id)));
  const r2 = run(d, "say", "The second is finished.", "--kind", "result", "--card", id, "--next", "Start the next card");
  assert.doesNotMatch(r2.stdout, /no next move/);
});
