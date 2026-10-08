// The agent's own replies, read from the session's transcript, for the Live feed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repliesIn, cleanReply, readTail, REPLY_MAX } from "../plugin/src/hooks/replies.mjs";
import { entryOf } from "../plugin/src/events/feed.mjs";
import { NOT_NEWS } from "../plugin/src/core/pack.mjs";

const L = (o) => JSON.stringify(o);
const asst = (uuid, block, extra = {}) => L({ type: "assistant", uuid, timestamp: "2026-10-06T03:00:00.000Z", message: { content: [block] }, ...extra });
const text = (t) => ({ type: "text", text: t });
const T = [
  L({ type: "user", uuid: "u0", message: { content: "an old question" } }),
  asst("a0", text("An old answer.")),
  L({ type: "user", uuid: "u1", message: { content: "start card 8.1" } }),
  asst("a1", { type: "thinking", thinking: "private reasoning" }),
  asst("a2", text("Starting card 8.1 now.")),
  asst("a3", { type: "tool_use", name: "Bash", input: { command: "ls" } }),
  L({ type: "user", uuid: "u2", message: { content: [{ type: "tool_result", content: "file list" }] } }),
  asst("s1", text("A subagent talking to its parent."), { isSidechain: true }),
  asst("a4", text("Card 8.1 is started.\n\n| A | B |\n|---|---|\n| 1 | 2 |")),
].join("\n");

test("it takes the agent's words since the user's last prompt: not its thinking, not tool calls, not a subagent, not an older turn", () => {
  const r = repliesIn(T, null);
  assert.deepEqual(r.map((x) => x.uuid), ["a2", "a4"]);
  assert.equal(r[0].text, "Starting card 8.1 now.");
  assert.match(r[1].text, /\n\n\| A \| B \|/, "line breaks are kept");
  assert.equal(r[0].at, "2026-10-06T03:00:00.000Z");
});

test("after one was taken, only newer ones come back; a tool result is not a new prompt", () => {
  assert.deepEqual(repliesIn(T, "a2").map((x) => x.uuid), ["a4"]);
  assert.deepEqual(repliesIn(T, "a4"), []);
  assert.deepEqual(repliesIn(T, "gone-from-the-tail").map((x) => x.uuid), ["a2", "a4"], "an unknown mark falls back to the last prompt, never to the whole history");
});

test("a cut first line, blank lines and broken JSON in the tail are skipped", () => {
  const cut = 'd":"x"}}\n\n{not json\n' + T;
  assert.deepEqual(repliesIn(cut, null).map((x) => x.uuid), ["a2", "a4"]);
  assert.deepEqual(repliesIn("", null), []);
});

test("a reply is cleaned for storing and showing: control characters go, line breaks stay, a long one is cut with a note", () => {
  assert.equal(cleanReply("a\u0000b\r\nc\n\n\n\nd  \n"), "a b\nc\n\nd");
  const long = cleanReply("x".repeat(REPLY_MAX + 500));
  assert.ok(long.length <= REPLY_MAX);
  assert.match(long, /cut here: the full reply is in the terminal\)$/);
});

test("the tail reader returns the end of a large file", () => {
  const f = path.join(os.tmpdir(), "lob-replies-" + process.pid + ".jsonl");
  fs.writeFileSync(f, "x".repeat(50000) + "\n" + T);
  assert.deepEqual(repliesIn(readTail(f, 4000), null).map((x) => x.uuid), ["a2", "a4"]);
  fs.rmSync(f);
});

test("in the feed a reply is the agent's line of kind reply, whole, and it is not news for the wake-up pack", () => {
  const e = entryOf({ offset: 9, at: "2026-10-06T03:00:00Z", type: "claude.reply", text: "Line one.\n\nLine two.", final: true });
  assert.deepEqual({ kind: e.kind, who: e.who, say: e.say, text: e.text, final: e.final }, { kind: "reply", who: "Agent", say: "reply", text: "Line one.\n\nLine two.", final: true });
  assert.ok(NOT_NEWS.includes("claude.reply"));
});
