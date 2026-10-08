// node --test test/adapters.test.mjs — the seam: every adapter fills the contract, and swapping
// the adapter changes how the hooks speak without any change to the core.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { project, rm, envFor } from "./qa/_helpers.mjs";
import { ADAPTERS, adapterFor } from "../plugin/src/adapters/index.mjs";
import { checkAdapter } from "../plugin/src/adapters/contract.mjs";

const HOOK = (n) => fileURLToPath(new URL(`../plugin/src/hooks/${n}.mjs`, import.meta.url));
// Every hook here runs against a scratch project in the temp folder, never against the folder the tests start in.
const DIR = project({ title: "Adapters" });
process.on("exit", () => rm(DIR));
const run = (name, harness, stdin) => spawnSync(process.execPath, [HOOK(name)], {
  input: JSON.stringify(stdin), encoding: "utf8", cwd: DIR, env: envFor(DIR, { COCKPIT_HARNESS: harness }),
});

test("adapters: each fills all four interfaces", () => {
  for (const [name, a] of Object.entries(ADAPTERS)) assert.deepEqual(checkAdapter(a), [], name);
  assert.deepEqual(checkAdapter({ name: "half", instructions: { protocol: () => "" } }).slice(0, 2), ["triggers", "publish"]);
  assert.throws(() => adapterFor("nope"), /no adapter "nope"/);
  // Not only that the key is there: what it says is the trust model. actions/ is a contributor's, approvals/ the owner's.
  assert.deepEqual(ADAPTERS.claude.channel.inboxes, { actions: "interact", approvals: "owner" });
});
test("adapters: both speak the same protocol, each in its own words", () => {
  const ctx = { title: "T", record: ".cockpit/BOARD.md", digest: "BOARD 1/2 done", url: "https://x", out: ".claude/board.html" };
  for (const a of Object.values(ADAPTERS)) {
    const p = a.instructions.protocol(ctx);
    assert.match(p, /Verified/); assert.match(p, /BOARD 1\/2 done/);
  }
  assert.match(ADAPTERS.claude.instructions.protocol(ctx), /artifact URL/);
  assert.match(ADAPTERS.local.instructions.protocol(ctx), /cockpit\.mjs inbox/);
});
test("adapters: claude reads hook JSON into the same events the local adapter takes plainly", () => {
  const c = ADAPTERS.claude.triggers.read;
  assert.equal(c({ hook_event_name: "UserPromptSubmit", prompt: "hi", session_id: "s" }).kind, "prompt");
  assert.equal(c({ tool_name: "Edit", tool_input: { file_path: "a.md" } }).file, "a.md");
  assert.equal(c({ tool_name: "Artifact", tool_input: { file_path: "b.html", url: "u" } }).kind, "publish");
  assert.equal(c({ hook_event_name: "Stop", stop_hook_active: true }).again, true);
  assert.deepEqual(ADAPTERS.claude.publish.receipt({ kind: "publish", url: "u", response: "Published b.html" }), { url: "u" });
  assert.equal(ADAPTERS.claude.publish.receipt({ kind: "publish", url: "u", response: "error: conflict" }), null);
  assert.equal(ADAPTERS.local.triggers.read({ kind: "stop", again: true }).again, true);
});
test("adapters: swap them under the same, unchanged hook script", () => {
  const cl = run("prompt", "claude", { hook_event_name: "UserPromptSubmit", prompt: "", session_id: "adapter-test" });
  assert.equal(cl.status, 0, cl.stderr);
  assert.match(JSON.parse(cl.stdout).hookSpecificOutput.additionalContext, /Protocol:/);
  const lo = run("prompt", "local", { kind: "prompt", text: "", session: "adapter-test" });
  assert.equal(lo.status, 0, lo.stderr);
  assert.match(lo.stdout, /^## .* board/); assert.throws(() => JSON.parse(lo.stdout));
});
