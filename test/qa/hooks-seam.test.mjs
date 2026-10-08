// node --test test/qa/hooks-seam.test.mjs
// PROPOSED (QA 2026-10-05). The three hooks have one behaviour tested in test/ (silence without a config)
// and one smoke test (the prompt hook prints a protocol). Nothing tests what they are FOR:
//   after-tool: rebuild on a record edit, push a broken record back, write the publish receipt
//   stop:       block once, for a broken record, unexplained work, or an unpublished board
// Each run is the real hook script, fed the JSON the harness sends, in a scratch project.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MD, project, build, note, hook, rm, P, read, readJSON, lines, setRow, withRow, hasGit, SRC, NODE, envFor } from "./_helpers.mjs";

// A hook fed raw text rather than JSON.
const spawnSyncRaw = (dir, name, input) => spawnSync(NODE, [SRC(`hooks/${name}.mjs`)], { cwd: dir, env: envFor(dir), input, encoding: "utf8" });

const S = "qa-session";
const edit = (file, session = S) => ({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file }, session_id: session });
const publish = (dir, response = "Published version 3", extra = {}) => ({ hook_event_name: "PostToolUse", tool_name: "Artifact",
  tool_input: { file_path: P(dir).page, url: "https://claude.ai/artifact/qa-board", ...extra }, tool_response: response, session_id: S });
const stop = (again = false, session = S) => ({ hook_event_name: "Stop", stop_hook_active: again, session_id: session });
const prompt = (text, session = S) => ({ hook_event_name: "UserPromptSubmit", prompt: text, session_id: session });
const silent = (r, what) => { assert.equal(r.status, 0, what + ": " + r.stderr); assert.equal(r.stdout, "", what); assert.equal(r.stderr, "", what); };
const blocked = (r) => { assert.equal(r.status, 0, r.stderr); const j = JSON.parse(r.stdout); assert.equal(j.decision, "block"); return j.reason; };

test("after-tool: an edit of the record rebuilds the board and tells the agent what moved", () => {
  const dir = project();
  const first = hook(dir, "after-tool", edit(P(dir).record));
  assert.equal(first.status, 0, first.stderr);
  const out = JSON.parse(first.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "PostToolUse");
  assert.match(out.additionalContext, /^\[board\] rebuilt #[0-9a-f]{12} · no card moved\. Publish before stopping\.$/);
  assert.ok(fs.existsSync(P(dir).page));

  setRow(dir, "1.2", (c) => { c[1] = "DOING"; });
  // Windows hands the drive letter and the path over in either case; elsewhere the path is exact.
  const asGiven = process.platform === "win32" ? P(dir).record.toUpperCase() : P(dir).record;
  const second = hook(dir, "after-tool", edit(asGiven));
  assert.match(JSON.parse(second.stdout).hookSpecificOutput.additionalContext, /moves: 1\.2 BACKLOG→DOING\. Publish before stopping\.$/);
  rm(dir);
});

test("after-tool: a record edit that breaks the record is pushed straight back (exit 2) and the page is not rebuilt", () => {
  const dir = project();
  assert.equal(hook(dir, "after-tool", edit(P(dir).record)).status, 0);
  const page = read(P(dir).page);

  setRow(dir, "1.2", (c) => { c[1] = "READY"; });
  const bad = hook(dir, "after-tool", edit(P(dir).record));
  assert.equal(bad.status, 2, "exit 2 is what makes the harness hand stderr to the agent");
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /The record no longer parses; the board was NOT rebuilt\. Fix:\nline \d+: card 1\.2 ST="READY"/);
  assert.equal(read(P(dir).page), page);

  // The same door enforces "Done means confirmed": the agent cannot close a card by editing ST alone.
  setRow(dir, "1.2", (c) => { c[1] = "DONE"; });
  const unconfirmed = hook(dir, "after-tool", edit(P(dir).record));
  assert.equal(unconfirmed.status, 2);
  assert.match(unconfirmed.stderr, /card 1\.2 moved to DONE without confirmation/);
  assert.equal(read(P(dir).page), page);
  rm(dir);
});

test("after-tool: an edit of any other file says nothing and is remembered for this session only", () => {
  const dir = project();
  const f = path.join(dir, "src", "app.js");
  silent(hook(dir, "after-tool", edit(f)), "a work file");
  silent(hook(dir, "after-tool", edit(path.join(path.dirname(dir), "outside.txt"))), "a file outside the project");
  silent(hook(dir, "after-tool", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, session_id: S }), "another tool");
  const touched = readJSON(path.join(P(dir).local, `touched-${S}.json`));
  assert.deepEqual(Object.keys(touched), ["src/app.js"], "repo-relative, forward slashes, nothing from outside");
  assert.ok(!fs.existsSync(P(dir).page), "no build for a file that is not the record");
  assert.ok(!fs.existsSync(path.join(P(dir).local, "touched-other.json")));
  rm(dir);
});

test("after-tool: a finished publish of the board leaves a receipt; a failed one, or a publish of something else, does not", () => {
  const dir = project();
  assert.equal(build(dir).status, 0);
  silent(hook(dir, "after-tool", publish(dir, "Error: version conflict, the artifact was changed elsewhere")), "a failed publish");
  silent(hook(dir, "after-tool", publish(dir, { error: "refused" })), "a refused publish");
  silent(hook(dir, "after-tool", publish(dir, "ok", { action: "list" })), "an Artifact call that is not a publish");
  silent(hook(dir, "after-tool", { ...publish(dir), tool_input: { file_path: path.join(dir, "notes.html"), url: "https://x" } }), "a publish of another page");
  assert.ok(!fs.existsSync(P(dir).receipt));

  silent(hook(dir, "after-tool", publish(dir)), "a real publish");
  const rc = readJSON(P(dir).receipt);
  assert.deepEqual(Object.keys(rc).sort(), ["at", "hash", "substance", "url"]);
  assert.equal(rc.url, "https://claude.ai/artifact/qa-board");
  assert.equal(rc.substance, read(P(dir).substance));
  assert.match(rc.hash, /^[0-9a-f]{12}$/);
  assert.deepEqual(lines(P(dir).events).map((e) => e.type), ["board.published"]);
  rm(dir);
});

test("stop: silent before a first publish and when nothing changed; one block when the published page is behind; never a second block in the same turn", () => {
  const dir = project();
  // A board that was never published is not "changed since the last publish": Stop stays quiet (audit 2026-10-05).
  silent(hook(dir, "stop", stop()), "never published");

  silent(hook(dir, "after-tool", publish(dir)), "publish");
  silent(hook(dir, "stop", stop()), "published and unchanged");

  // The feed alone never forces a publish: a prompt and a note change the page but not its substance.
  assert.equal(hook(dir, "prompt", prompt("what is next?")).status, 0);
  assert.equal(note(dir, "Answered a question; no card moved").status, 0);
  silent(hook(dir, "stop", stop()), "only the feed changed");

  // A card moves: the published page is now behind, and the block names the page to republish to.
  setRow(dir, "1.2", (c) => { c[1] = "DOING"; });
  const behind = blocked(hook(dir, "stop", stop()));
  assert.match(behind, /cards changed since the last publish\. Publish \.claude\/board\.html with the Artifact tool to url https:\/\/claude\.ai\/artifact\/qa-board\./);
  silent(hook(dir, "stop", stop(true)), "and still only once");
  rm(dir);
});

test("stop: a record that does not parse blocks the stop and says how to fix it; it is the only reason given", () => {
  const dir = project({ title: "QA" }, withRow(MD, "1.4", (c) => { c[6] = "1.2, 7.7"; }));
  const reason = blocked(hook(dir, "stop", stop()));
  assert.match(reason, /^\[board\] \.cockpit\/BOARD\.md does not parse, so the board is stale\. Fix: card 1\.4 depends on 7\.7, which does not exist$/);
  silent(hook(dir, "stop", stop(true)), "even a broken record blocks only once");
  rm(dir);
});

test("stop: this session's unexplained edits block, with the card that names the file; other sessions' edits and explained ones do not", { skip: !hasGit() && "git is not installed" }, () => {
  const dir = project({ title: "QA" }, withRow(MD, "1.4", (c) => { c[7] += " • Edit `deploy.yml` to add the push trigger."; }));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir }).status, 0);
  assert.equal(build(dir).status, 0);
  silent(hook(dir, "after-tool", publish(dir)), "publish");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(P(dir).record, past, past);                           // the record was last touched a minute ago

  assert.equal(hook(dir, "prompt", prompt("add the deploy trigger")).status, 0);   // the turn starts here
  for (const f of ["deploy.yml", "scratch.txt", "logo.png"]) { fs.writeFileSync(path.join(dir, f), "x"); silent(hook(dir, "after-tool", edit(path.join(dir, f))), f); }
  fs.writeFileSync(path.join(dir, "theirs.txt"), "x");
  silent(hook(dir, "after-tool", edit(path.join(dir, "theirs.txt"), "another-session")), "another session's edit");

  const reason = blocked(hook(dir, "stop", stop()));
  assert.match(reason, /^\[board\] this turn changed 2 file\(s\) the record does not account for: /);
  assert.match(reason, /deploy\.yml \(cards 1\.4\)/);
  assert.match(reason, /scratch\.txt \(no card names it\)/);
  assert.doesNotMatch(reason, /theirs\.txt|logo\.png/, "not another session's file, and not an image");
  assert.doesNotMatch(reason, /ALSO|since the last publish/, "the prompt alone did not make the board stale");
  assert.match(reason, /note\.mjs" "<what changed and why no card moved>"/);

  silent(hook(dir, "stop", stop(false, "a-third-session")), "a session that edited nothing is not blamed");
  assert.equal(note(dir, "Added the push trigger; 1.4 stays open until the host is picked").status, 0);
  silent(hook(dir, "stop", stop()), "a note explains the work");
  rm(dir);
});

test("stop: edits from an earlier turn are not this turn's to explain", { skip: !hasGit() && "git is not installed" }, () => {
  const dir = project();
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir }).status, 0);
  assert.equal(build(dir).status, 0);
  silent(hook(dir, "after-tool", publish(dir)), "publish");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(P(dir).record, past, past);
  fs.writeFileSync(path.join(dir, "old.txt"), "x");
  silent(hook(dir, "after-tool", edit(path.join(dir, "old.txt"))), "an edit in the last turn");
  // Move the remembered edit time back, as if it happened a while ago, then start a new turn.
  const tf = path.join(P(dir).local, `touched-${S}.json`);
  fs.writeFileSync(tf, JSON.stringify({ "old.txt": Date.now() - 30_000 }));
  assert.equal(hook(dir, "prompt", prompt("something else")).status, 0);
  silent(hook(dir, "stop", stop()), "nothing was edited since the prompt");
  rm(dir);
});

test("prompt: logs the ask once (trimmed and capped), marks the turn, and hands over the digest and the rules", () => {
  const dir = project({ title: "QA", artifact: "https://claude.ai/artifact/qa-board" });
  const long = "please   do\n\n" + "this ".repeat(100);
  const r = hook(dir, "prompt", prompt(long));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "UserPromptSubmit");
  const ctx = out.additionalContext.split("\n");
  assert.equal(ctx[0], "[QA board] The record .cockpit/BOARD.md drives the board at https://claude.ai/artifact/qa-board.");
  assert.equal(ctx[1], "BOARD 1/5 done · 0 in progress · 2 ready · 0 blocked · 2 waiting on a card");
  assert.match(ctx.at(-1), /^Protocol: map this request to card ids\..*• Verified: <what was observed>.*note\.mjs" "<what was done>"\. Publish \.claude\/board\.html to the artifact URL only when cards changed/);
  const [a] = lines(P(dir).activity);
  assert.equal(a.kind, "ask"); assert.equal(a.text, "You sent a message", "the owner's words are private by default (audit 2026-10-05)");
  assert.deepEqual(lines(P(dir).events).map((e) => e.type), ["session.started", "prompt.received"]);
  assert.ok(readJSON(path.join(P(dir).local, `turn-${S}.json`)).at <= Date.now());
  assert.ok(!fs.existsSync(P(dir).page), "the prompt hook reads the board; it does not build it");

  const blank = hook(dir, "prompt", prompt("   "));
  assert.equal(blank.status, 0, blank.stderr);
  assert.match(JSON.parse(blank.stdout).hookSpecificOutput.additionalContext, /Protocol:/, "a blank prompt still gets the board");
  assert.equal(lines(P(dir).activity).length, 1, "and logs nothing");
  rm(dir);
});

test("prompt: a broken record is reported to the agent instead of a digest, and the hook still exits 0", () => {
  const dir = project({ title: "QA" }, withRow(MD, "1.2", (c) => { c[1] = "READY"; }));
  const r = hook(dir, "prompt", prompt("hello"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /\nBOARD BROKEN: line \d+: card 1\.2 ST="READY"/);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /\(not published yet: \/browser-agent publish\)/);
  rm(dir);
});

test("local adapter: the same hooks answer in plain text, and a block is a non-zero exit a git hook can act on", () => {
  const dir = project({ title: "QA", harness: "local" }, withRow(MD, "1.2", (c) => { c[1] = "READY"; }));
  const s = hook(dir, "stop", { kind: "stop", session: "local" });
  assert.equal(s.status, 1);
  assert.equal(s.stdout, "");
  assert.match(s.stderr, /^\[board\] \.cockpit\/BOARD\.md does not parse/);
  silent(hook(dir, "stop", { kind: "stop", session: "local", again: true }), "already told once");
  const e = hook(dir, "after-tool", { kind: "edit", session: "local", file: P(dir).record });
  assert.equal(e.status, 1);
  assert.match(e.stderr, /The record no longer parses/);
  rm(dir);
});

test("hooks: a hook that throws lets the session carry on (exit 0), and says so on stderr only", () => {
  const dir = project({ title: "QA" }, null);            // opted in, but the record file is missing
  for (const [name, input] of [["prompt", prompt("hi")], ["stop", stop()], ["after-tool", edit(P(dir).record)]]) {
    const r = hook(dir, name, input);
    assert.equal(r.status, 0, name);
    assert.equal(r.stdout, "", name + " must not emit half a JSON answer");
    assert.match(r.stderr, /^board hook error \(ignored\): ENOENT/, name);
  }
  // Input that is not JSON at all is read as an empty event, not a crash.
  const r = spawnSyncRaw(dir, "stop", "this is not json");
  assert.equal(r.status, 0);
  rm(dir);
});

test("prompt: with hooks.logPrompts true, the feed carries the words, capped at 280", () => {
  const dir = project({ title: "QA", hooks: { logPrompts: true } });
  assert.equal(hook(dir, "prompt", prompt("please   do\n\n" + "this ".repeat(100))).status, 0);
  const [a] = lines(P(dir).activity);
  assert.equal(a.text.length, 280); assert.ok(a.text.startsWith("please do this this") && a.text.endsWith("..."));
  rm(dir);
});
