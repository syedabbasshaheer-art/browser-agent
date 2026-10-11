// node --test test/silent.test.mjs — card 4.5: in a project with no cockpit, the hooks say and write nothing.
// A plugin's hooks run in every project the user opens; only a project with .cockpit/config.json opted in.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.BROWSER_AGENT_UPDATE_CHECK = "off"; // no test asks the network for a version; the update tests name one
const HOOK = (n) => fileURLToPath(new URL(`../plugin/src/hooks/${n}.mjs`, import.meta.url));
const INPUT = {
  prompt: { hook_event_name: "UserPromptSubmit", prompt: "hello", session_id: "silent" },
  "after-tool": { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "x.md" }, session_id: "silent" },
  stop: { hook_event_name: "Stop", stop_hook_active: false, session_id: "silent" },
  "session-start": { hook_event_name: "SessionStart", source: "startup", session_id: "silent" },
};
const run = (name, dir) => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir }; delete env.COCKPIT_ROOT; delete env.COCKPIT_CONFIG; delete env.COCKPIT_RECORD; delete env.CLAUDE_PLUGIN_DATA;
  return spawnSync(process.execPath, [HOOK(name)], { cwd: dir, env, input: JSON.stringify(INPUT[name]), encoding: "utf8" });
};
const filesIn = (dir) => fs.readdirSync(dir, { recursive: true });

test("silent: no config, so every hook prints nothing, exits 0 and writes no file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-empty-"));
  for (const name of Object.keys(INPUT)) {
    const r = run(name, dir);
    assert.equal(r.status, 0, `${name} exit`);
    assert.equal(r.stdout, "", `${name} stdout`);
    assert.equal(r.stderr, "", `${name} stderr`);
  }
  assert.deepEqual(filesIn(dir), [], "no file written");
  fs.rmSync(dir, { recursive: true, force: true });
});
test("silent: add .cockpit/config.json and the same hook speaks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-opted-"));
  fs.mkdirSync(path.join(dir, ".cockpit"));
  fs.copyFileSync(fileURLToPath(new URL("./fixtures/record-min.md", import.meta.url)), path.join(dir, ".cockpit", "BOARD.md"));
  fs.writeFileSync(path.join(dir, ".cockpit", "config.json"), JSON.stringify({ title: "Opted in" }));
  const r = run("prompt", dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /\[Opted in board\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── card 5.5: the first session after an install says what to type, once, and writes nothing in the project ──
const start = (dir, data, source = "startup", latest = "") => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, ...(data ? { CLAUDE_PLUGIN_DATA: data } : {}), BROWSER_AGENT_UPDATE_CHECK: latest ? "on" : "off" }; delete env.COCKPIT_ROOT; delete env.COCKPIT_CONFIG; delete env.COCKPIT_RECORD;
  delete env.BROWSER_AGENT_LATEST; if (latest) env.BROWSER_AGENT_LATEST = latest;
  if (!data) delete env.CLAUDE_PLUGIN_DATA;
  return spawnSync(process.execPath, [HOOK("session-start")], { cwd: dir, env, input: JSON.stringify({ hook_event_name: "SessionStart", source, session_id: "s" }), encoding: "utf8" });
};
test("welcome: a new project gets the welcome once, with the command and the plain words, and no file in the project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-new-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  const a = start(dir, data); assert.equal(a.status, 0, a.stderr);
  const j = JSON.parse(a.stdout);
  assert.match(j.systemMessage, /^Agent on Browser is installed\./);
  assert.match(j.systemMessage, /type  \/browser-agent\n\s+or say "set up my board"/);
  assert.match(j.systemMessage, /terminal  -->  board in your browser  -->  you steer there/, "it says where the work moves to");
  assert.match(j.systemMessage, /opens in your browser in about a minute\.$/);
  assert.ok(j.systemMessage.split("\n").every((l) => l.length <= 60), "every line fits a narrow terminal");
  assert.equal(j.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(j.hookSpecificOutput.additionalContext, /Do nothing about the board unless they ask\.$/);
  assert.deepEqual(filesIn(dir), [], "nothing written in the project");
  assert.deepEqual(fs.readdirSync(data), ["welcomed.json"]);
  const b = start(dir, data); assert.equal(b.status, 0);
  const r = JSON.parse(b.stdout);
  assert.equal(r.systemMessage, "Agent on Browser: this project has no board yet. Type /browser-agent to see it in your browser.", "a later new session gets one short reminder");
  assert.equal(r.hookSpecificOutput, undefined, "the reminder adds nothing to the agent's context");
  for (let i = 0; i < 4; i++) assert.match(start(dir, data).stdout, /has no board yet/);
  assert.equal(start(dir, data).stdout, "", "after five reminders it stays quiet");
  assert.deepEqual(filesIn(dir), [], "still nothing written in the project");
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "lob-new2-"));
  assert.match(JSON.parse(start(other, data).stdout).systemMessage, /is installed/, "another project gets its own welcome");
  for (const d of [dir, data, other]) fs.rmSync(d, { recursive: true, force: true });
});
test("welcome: a resumed, cleared or compacted session says nothing, and leaves the welcome for a new one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-new-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  for (const source of ["resume", "clear", "compact", "fork"]) assert.equal(start(dir, data, source).stdout, "", source);
  assert.deepEqual(fs.readdirSync(data), []);
  assert.match(start(dir, data).stdout, /is installed/);
  for (const d of [dir, data]) fs.rmSync(d, { recursive: true, force: true });
});
test("welcome: a data folder that cannot be written means silence, never a welcome in every session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-new-")), blocker = path.join(os.tmpdir(), "lob-file-" + process.pid);
  fs.writeFileSync(blocker, "a file where a folder is expected");
  const r = start(dir, path.join(blocker, "data")); assert.equal(r.status, 0); assert.equal(r.stdout, ""); assert.equal(r.stderr, "");
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(blocker, { force: true });
});
test("welcome: a project that has a board gets its address and the command, every new session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-opted-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  fs.mkdirSync(path.join(dir, ".cockpit"));
  fs.copyFileSync(fileURLToPath(new URL("./fixtures/record-min.md", import.meta.url)), path.join(dir, ".cockpit", "BOARD.md"));
  const cfg = path.join(dir, ".cockpit", "config.json");
  fs.writeFileSync(cfg, JSON.stringify({ title: "Opted in" }));
  assert.equal(JSON.parse(start(dir, data).stdout).systemMessage, 'Agent on Browser: the Opted in board is not published yet. Type /browser-agent publish, or say "publish my board".');
  fs.writeFileSync(cfg, JSON.stringify({ title: "Opted in", artifact: "https://claude.ai/artifact/abc" }));
  for (let i = 0; i < 2; i++) assert.equal(JSON.parse(start(dir, data).stdout).systemMessage, "Agent on Browser: the Opted in board is at https://claude.ai/artifact/abc. Type /browser-agent for its commands.");
  assert.deepEqual(fs.readdirSync(data), [], "no welcome mark for a project that has a board");
  for (const d of [dir, data]) fs.rmSync(d, { recursive: true, force: true });
});
test("welcome: the plugin registers the hook for new sessions only, through its own folder", () => {
  const hk = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../plugin/hooks/hooks.json", import.meta.url)), "utf8")).hooks.SessionStart;
  assert.equal(hk.length, 1); assert.equal(hk[0].matcher, "startup");
  assert.equal(hk[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/src/hooks/session-start.mjs"');
});

// ── an install made inside a running session sees no session start: the first message gives the welcome ──
const firstMessage = (dir, data, prompt) => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, ...(data ? { CLAUDE_PLUGIN_DATA: data } : {}) }; delete env.COCKPIT_ROOT; delete env.COCKPIT_CONFIG; delete env.COCKPIT_RECORD;
  if (!data) delete env.CLAUDE_PLUGIN_DATA;
  return spawnSync(process.execPath, [HOOK("prompt")], { cwd: dir, env, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, session_id: "s" }), encoding: "utf8" });
};
test("welcome: with no session start seen, the first message gets the welcome once, and nothing is written in the project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-new-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  const a = firstMessage(dir, data, "what does this project do?"); assert.equal(a.status, 0, a.stderr);
  const j = JSON.parse(a.stdout);
  assert.match(j.systemMessage, /^Agent on Browser is installed\./);
  assert.equal(j.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(j.hookSpecificOutput.additionalContext, /Do nothing about the board unless they ask\.$/);
  assert.deepEqual(filesIn(dir), [], "nothing written in the project");
  assert.equal(firstMessage(dir, data, "and now?").stdout, "", "the second message is silent");
  assert.match(start(dir, data).stdout, /has no board yet/, "the next new session gets the short reminder, not the welcome again");
  for (const d of [dir, data]) fs.rmSync(d, { recursive: true, force: true });
});
test("welcome: a first message that is already the command gets no welcome, now or later", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-new-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  assert.equal(firstMessage(dir, data, "/browser-agent").stdout, "");
  assert.equal(firstMessage(dir, data, "hello").stdout, "", "the mark was written, so it does not come later");
  assert.equal(firstMessage(dir, null, "hello").stdout, "", "with no data folder the hook stays silent");
  assert.deepEqual(filesIn(dir), []);
  for (const d of [dir, data]) fs.rmSync(d, { recursive: true, force: true });
});

// ── goal 12: a newer version is said in the terminal and left for the board; the first run's small commands ──
test("update: a new session says a newer version is ready, with the command, and leaves a note for the board", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-upd-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  fs.mkdirSync(path.join(dir, ".cockpit")); fs.writeFileSync(path.join(dir, ".cockpit/config.json"), JSON.stringify({ title: "Trailhead" }));
  const j = JSON.parse(start(dir, data, "startup", "99.0.0").stdout);
  assert.match(j.systemMessage, /^Agent on Browser: the Trailhead board is not published yet\./);
  assert.match(j.systemMessage, /\n\nAgent on Browser 99\.0\.0 is ready \(you have \d+\.\d+\.\d+\)\. To update: claude plugin update browser-agent@browser-agent  then restart Claude Code\.$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".claude/local/update.json"), "utf8")).latest, "99.0.0");
  assert.doesNotMatch(start(dir, data, "startup", "0.0.1").stdout, /is ready/, "an older version is not an update");
  assert.equal(fs.existsSync(path.join(dir, ".claude/local/update.json")), false, "and the note for the board is removed");
  fs.writeFileSync(path.join(dir, ".cockpit/config.json"), JSON.stringify({ title: "Trailhead", updates: false }));
  assert.doesNotMatch(start(dir, data, "startup", "99.0.0").stdout, /is ready/, "a project can turn the notice off");
  for (const d of [dir, data]) fs.rmSync(d, { recursive: true, force: true });
});
test("update: a project with no board hears of a newer version too, and nothing is written in it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-upd-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  const j = JSON.parse(start(dir, data, "startup", "99.0.0").stdout);
  assert.match(j.systemMessage, /^Agent on Browser is installed\.[\s\S]*\n\nAgent on Browser 99\.0\.0 is ready/);
  assert.deepEqual(filesIn(dir), []);
  assert.equal(start(dir, data, "resume", "99.0.0").stdout, "", "a resumed session says nothing");
  for (const d of [dir, data]) fs.rmSync(d, { recursive: true, force: true });
});
test("update: newer() compares three numbers and nothing else", async () => {
  const { newer } = await import("../plugin/src/core/update.mjs");
  assert.equal(newer("0.0.8", "0.0.7"), true); assert.equal(newer("0.1.0", "0.0.9"), true); assert.equal(newer("1.0.0", "0.9.9"), true);
  assert.equal(newer("0.0.7", "0.0.7"), false); assert.equal(newer("0.0.6", "0.0.7"), false);
  for (const bad of ["", "latest", "1.2", "1.2.3-beta", "9.9.9; rm -rf", null]) assert.equal(newer(bad, "0.0.1"), false, String(bad));
});
const CLI = fileURLToPath(new URL("../plugin/src/cli/cockpit.mjs", import.meta.url));
const cli = (dir, ...a) => { const env = { ...process.env, COCKPIT_ROOT: dir, CLAUDE_PROJECT_DIR: "", COCKPIT_NO_OPEN: "1" }; delete env.COCKPIT_CONFIG; delete env.COCKPIT_RECORD; return spawnSync(process.execPath, [CLI, ...a], { cwd: dir, env, encoding: "utf8" }); };
test("first run: init --planning writes a placeholder plan that builds, as a draft marked as being written", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-first-"));
  const r = cli(dir, "init", "--planning"); assert.equal(r.status, 0, r.stderr + r.stdout);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".cockpit/config.json"), "utf8"));
  assert.deepEqual([cfg.plan, cfg.planning], ["draft", true]);
  assert.match(fs.readFileSync(path.join(dir, ".cockpit/BOARD.md"), "utf8"), /Your plan is being written/);
  assert.match(fs.readFileSync(path.join(dir, ".claude/board.html"), "utf8"), /"planning":true/);
  assert.equal(cli(dir, "lint").status, 0, "the placeholder passes the plan check");
  const p = cli(dir, "planned"); assert.equal(p.status, 1);
  assert.match(p.stderr, /still holds the placeholder/, "planned refuses while the placeholder is the plan");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".cockpit/config.json"), "utf8")).planning, true, "and changes nothing");
  fs.rmSync(dir, { recursive: true, force: true });
});
test("first run: planned ends the being-written state and keeps the plan a draft", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-first-"));
  assert.equal(cli(dir, "init", "--planning").status, 0);
  fs.copyFileSync(fileURLToPath(new URL("../plugin/templates/BOARD.md", import.meta.url)), path.join(dir, ".cockpit/BOARD.md"));
  // work the agent found already finished is written as DONE with its evidence, on an id the placeholder used
  const rec = path.join(dir, ".cockpit/BOARD.md");
  fs.writeFileSync(rec, fs.readFileSync(rec, "utf8").replace("| 1.1 | BACKLOG | agent | code | S | - | - | **The build passes.** One command builds the project from a clean checkout.", "| 1.1 | DONE | agent | code | S | - | - | **The build passes.** One command builds the project from a clean checkout. • Verified: the build ran clean in the folder."));
  const b0 = cli(dir, "build"); assert.equal(b0.status, 0, "a card found finished may be DONE while the plan is being written: " + b0.stderr);
  const p = cli(dir, "planned"); assert.equal(p.status, 0, p.stderr + p.stdout);
  fs.writeFileSync(rec, fs.readFileSync(rec, "utf8").replace("| 1.2 | BACKLOG | agent | code | L | - | 1.1 | **Write the core feature.** The one thing a user comes for.", "| 1.2 | DONE | agent | code | L | - | 1.1 | **Write the core feature.** The one thing a user comes for. • Verified: used once."));
  const b1 = cli(dir, "build"); assert.equal(b1.status, 1); assert.match(b1.stderr, /card 1.2 moved to DONE but the plan is a draft/, "once the plan is written, a draft closes nothing");
  fs.writeFileSync(rec, fs.readFileSync(rec, "utf8").replace("| 1.2 | DONE |", "| 1.2 | BACKLOG |").replace(" • Verified: used once.", ""));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".cockpit/config.json"), "utf8"));
  assert.deepEqual([cfg.plan, "planning" in cfg], ["draft", false]);
  assert.match(fs.readFileSync(path.join(dir, ".claude/board.html"), "utf8"), /"planning":false/);
  fs.rmSync(dir, { recursive: true, force: true });
});
test("first run: link saves only a claude.ai artifact address, and open refuses when nothing is published", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-first-"));
  assert.equal(cli(dir, "init").status, 0);
  assert.equal(cli(dir, "open").status, 1, "nothing to open yet");
  for (const bad of ["http://claude.ai/artifact/AbCdEf123456", "https://evil.example/artifact/AbCdEf123456", "https://claude.ai/artifact/x\"&calc", "file:///c:/x"]) {
    assert.equal(cli(dir, "link", bad, "--open").status, 1, bad);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".cockpit/config.json"), "utf8")).artifact, "", "nothing saved for " + bad);
  }
  const ok = cli(dir, "link", "https://claude.ai/artifact/AbCdEf123456", "--open"); assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /address is saved[\s\S]*Not opened \(COCKPIT_NO_OPEN is set\): https:\/\/claude\.ai\/artifact\/AbCdEf123456/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".cockpit/config.json"), "utf8")).artifact, "https://claude.ai/artifact/AbCdEf123456");
  fs.rmSync(dir, { recursive: true, force: true });
});
