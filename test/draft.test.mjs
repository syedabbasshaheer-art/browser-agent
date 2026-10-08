// node --test test/draft.test.mjs — card 10.3: a draft plan starts nothing until the owner accepts it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseLaunch } from "../plugin/src/core/parse.mjs";
import { decide, DRAFT_REASON } from "../plugin/src/core/gateway.mjs";

const MD = fs.readFileSync(fileURLToPath(new URL("./fixtures/record-min.md", import.meta.url)), "utf8");
const REC = parseLaunch(MD);
const CLI = fileURLToPath(new URL("../plugin/src/cli/cockpit.mjs", import.meta.url));
const ctx = (plan, level = "owner") => ({ cards: REC.cards, goals: REC.goals, level, plan });

test("draft: nothing starts or closes, and the reason is given", () => {
  for (const a of [{ verb: "task.start", card: "1.2" }, { verb: "card.move", card: "1.2", to: "START" },
                   { verb: "card.move", card: "1.3", to: "DOING" }, { verb: "card.move", card: "1.2", to: "DONE" }])
    assert.equal(decide(a, ctx("draft")).reason, DRAFT_REASON, JSON.stringify(a));
});
test("draft: reading, noting, editing and adding still work", () => {
  assert.equal(decide({ verb: "card.note", card: "1.2", text: "split this" }, ctx("draft")).ok, true);
  assert.equal(decide({ verb: "card.edit", card: "1.2", title: "Write the core" }, ctx("draft")).ok, true);
  assert.equal(decide({ verb: "card.add", goal: 1, title: "Add a changelog", owner: "agent" }, ctx("draft")).ok, true);
  assert.equal(decide({ verb: "card.move", card: "1.2", to: "BLOCKED" }, ctx("draft")).ok, true);
});
test("plan.accept: the owner only, and only while it is a draft", () => {
  assert.equal(decide({ verb: "plan.accept" }, ctx("draft")).mode, "work");
  assert.match(decide({ verb: "plan.accept" }, ctx("draft", "interact")).reason, /needs owner/);
  assert.match(decide({ verb: "plan.accept" }, ctx("accepted")).reason, /already accepted/);
  assert.equal(decide({ verb: "task.start", card: "1.2" }, ctx("accepted")).ok, true, "an accepted plan starts cards");
});

// End to end through the orchestrator, in a scratch project.
function project(plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-draft-"));
  fs.mkdirSync(path.join(dir, ".cockpit"));
  fs.writeFileSync(path.join(dir, ".cockpit", "BOARD.md"), MD);
  fs.writeFileSync(path.join(dir, ".cockpit", "config.json"), JSON.stringify({ title: "Draft test", plan }));
  return dir;
}
function inbox(dir, actions) {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), "lob-export-"));
  fs.mkdirSync(path.join(from, "approvals"));
  actions.forEach((a, i) => fs.writeFileSync(path.join(from, "approvals", "a" + i + ".json"), JSON.stringify({ status: "pending", askedAt: "2026-10-04T00:00:0" + i + "Z", ...a })));
  const env = { ...process.env, COCKPIT_ROOT: dir }; delete env.COCKPIT_RECORD; delete env.COCKPIT_PLAN;
  return spawnSync(process.execPath, [CLI, "inbox", "--from", from], { cwd: dir, env, encoding: "utf8" });
}
const planOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".cockpit", "config.json"), "utf8")).plan;

test("orchestrator: a Start request on a draft is refused; after Accept plan it is allowed", () => {
  const dir = project("draft");
  const refused = inbox(dir, [{ verb: "card.move", card: "1.2", to: "START" }]);
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout, /refused: The plan is a draft/);
  assert.equal(planOf(dir), "draft");
  assert.match(fs.readFileSync(path.join(dir, ".cockpit", "BOARD.md"), "utf8"), /\| 1\.2 \| BACKLOG \|/);

  const accepted = inbox(dir, [{ verb: "plan.accept" }, { verb: "card.move", card: "1.2", to: "START" }]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /plan\.accept\s+-> accepted: Plan accepted/);
  assert.match(accepted.stdout, /card\.move 1\.2\s+-> accepted: Accepted. 1\.2 is in progress/);
  assert.equal(planOf(dir), "accepted");
  assert.match(fs.readFileSync(path.join(dir, ".cockpit", "BOARD.md"), "utf8"), /\| 1\.2 \| START \|/);
  assert.match(fs.readFileSync(path.join(dir, ".claude", "board.html"), "utf8"), /"plan":"accepted"/, "the rebuilt page knows the plan is accepted");
  fs.rmSync(dir, { recursive: true, force: true });
});
test("init: a new project's plan is a draft, and status says so", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-init-"));
  const env = { ...process.env, COCKPIT_ROOT: dir }; delete env.COCKPIT_RECORD;
  const r = spawnSync(process.execPath, [CLI, "init"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(planOf(dir), "draft");
  assert.match(fs.readFileSync(path.join(dir, ".claude", "board.html"), "utf8"), /"plan":"draft"/);
  assert.match(spawnSync(process.execPath, [CLI, "status"], { cwd: dir, env, encoding: "utf8" }).stdout, /plan draft/);
  fs.rmSync(dir, { recursive: true, force: true });
});
