// node --test test/silent.test.mjs — card 4.5: in a project with no cockpit, the hooks say and write nothing.
// A plugin's hooks run in every project the user opens; only a project with .cockpit/config.json opted in.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
const start = (dir, data, source = "startup") => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, ...(data ? { CLAUDE_PLUGIN_DATA: data } : {}) }; delete env.COCKPIT_ROOT; delete env.COCKPIT_CONFIG; delete env.COCKPIT_RECORD;
  if (!data) delete env.CLAUDE_PLUGIN_DATA;
  return spawnSync(process.execPath, [HOOK("session-start")], { cwd: dir, env, input: JSON.stringify({ hook_event_name: "SessionStart", source, session_id: "s" }), encoding: "utf8" });
};
test("welcome: a new project gets the welcome once, with the command and the plain words, and no file in the project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-new-")), data = fs.mkdtempSync(path.join(os.tmpdir(), "lob-data-"));
  const a = start(dir, data); assert.equal(a.status, 0, a.stderr);
  const j = JSON.parse(a.stdout);
  assert.match(j.systemMessage, /^Agent on Browser is installed\./);
  assert.match(j.systemMessage, /type   \/browser-agent\n    or say "set up my board"/);
  assert.match(j.systemMessage, /shown once\.$/);
  assert.ok(j.systemMessage.split("\n").every((l) => l.length <= 60), "every line fits a narrow terminal");
  assert.equal(j.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(j.hookSpecificOutput.additionalContext, /Do nothing about the board unless they ask\.$/);
  assert.deepEqual(filesIn(dir), [], "nothing written in the project");
  assert.deepEqual(fs.readdirSync(data), ["welcomed.json"]);
  const b = start(dir, data); assert.equal(b.status, 0); assert.equal(b.stdout, "", "the second session is silent");
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
