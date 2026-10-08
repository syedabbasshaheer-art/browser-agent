// node --test test/answer.test.mjs — a message the owner types on the board, and the agent's answer to it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { project, exported, pending, cli, build, rm, P, lines, readJSON } from "./qa/_helpers.mjs";
import { decide } from "../plugin/src/core/gateway.mjs";
import { parseLaunch } from "../plugin/src/core/parse.mjs";
import { MD } from "./qa/_helpers.mjs";
import { entryOf } from "../plugin/src/events/feed.mjs";

const REC = parseLaunch(MD);

test("a message may name the card it was typed on; a card that does not exist is refused; only the owner may send one", () => {
  const ctx = { cards: REC.cards, level: "owner" };
  assert.equal(decide({ verb: "message.send", text: "What do I do here?", card: "1.2" }, ctx).args.card, "1.2");
  assert.equal(decide({ verb: "message.send", text: "Hello" }, ctx).args.card, undefined);
  assert.match(decide({ verb: "message.send", text: "Hello", card: "9.9" }, ctx).reason, /There is no card 9\.9/);
  assert.match(decide({ verb: "message.send", text: "Hello", card: "1.2" }, { cards: REC.cards, level: "interact" }).reason, /needs owner/);
});

test("answer: the newest unanswered message gets the answer on its own request, once, and the feed has the line", () => {
  const d = project({ title: "QA", artifact: "https://claude.ai/artifact/x" });
  build(d);
  const ex = exported({ approvals: { m1: pending({ verb: "message.send", text: "What do you want me to do in 1.2?", card: "1.2" }, 1) } });
  const inbox = cli(d, "inbox", "--from", ex);
  assert.match(inbox.stdout, /MESSAGE FROM THE OWNER/);
  assert.match(inbox.stdout, /> \[typed on card 1\.2\] What do you want me to do in 1\.2\?/);
  assert.match(inbox.stdout, /Answer each one FIRST/);
  const receipt = path.join(P(d).out, "docs", "approvals__m1.json");
  assert.equal(readJSON(receipt).status, "accepted", "before the answer, the receipt says the agent has it");

  const a = cli(d, "answer", "Nothing yet: it waits on 1.1.");
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /^Answered #\d+ on card 1\.2: Nothing yet: it waits on 1\.1\.$/m);
  assert.match(a.stdout, /The answer replaced the waiting receipt of that request: send the inbox batch as it is\./);
  const doc = readJSON(receipt);
  assert.deepEqual([doc.status, doc.result, doc.answered, doc.card], ["done", "Nothing yet: it waits on 1.1.", true, "1.2"]);

  const ev = lines(P(d).events).filter((e) => e.type === "claude.answered");
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].action, ev[0].card, ev[0].inbox, ev[0].origin], ["m1", "1.2", "approvals", "card"]);
  const line = entryOf(ev[0]);
  assert.deepEqual([line.kind, line.who, line.text, line.re, line.msg, line.origin, line.card], ["answer", "Agent", "Nothing yet: it waits on 1.1.", "m1", true, "card", "1.2"]);

  const again = cli(d, "answer", "A second answer.");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /there is no message from the owner without an answer/);
  const named = cli(d, "answer", "A second answer.", "--to", "m1");
  assert.match(named.stderr, /the message m1 already has an answer/);
  assert.equal(lines(P(d).events).filter((e) => e.type === "claude.answered").length, 1, "nothing was logged for either refusal");
  rm(d, ex);
});

test("a message typed in the message box is about a card only when its words name exactly one card", () => {
  const d = project({ title: "QA" });
  build(d);
  const ex = exported({ approvals: {
    g1: pending({ verb: "message.send", text: "How is the whole project going?" }, 1),
    g2: pending({ verb: "message.send", text: "What is left on 1.3?" }, 2),
    g3: pending({ verb: "message.send", text: "Compare 1.2 and 1.3 for me, and 9.9 too." }, 3),
  } });
  const r = cli(d, "inbox", "--from", ex);
  assert.match(r.stdout, /> \[typed in the message box\] How is the whole project going\?/);
  assert.match(r.stdout, /> \[typed in the message box, about card 1\.3\] What is left on 1\.3\?/);
  assert.match(r.stdout, /> \[typed in the message box\] Compare 1\.2 and 1\.3/);
  const ev = Object.fromEntries(lines(P(d).events).filter((e) => e.type === "owner.message").map((e) => [e.action, e]));
  assert.deepEqual([ev.g1.origin, ev.g1.card, ev.g2.origin, ev.g2.card, ev.g3.origin, ev.g3.card], ["board", undefined, "board", "1.3", "board", undefined]);
  // the newest unanswered one is answered first; --to reaches an older one
  assert.match(cli(d, "answer", "Both are waiting.").stdout, /^Answered #\d+: Both are waiting\.$/m);
  assert.match(cli(d, "answer", "It waits on 1.2.", "--to", "g2").stdout, /^Answered #\d+ on card 1\.3: It waits on 1\.2\.$/m);
  rm(d, ex);
});

test("answer: with no message, or no text, it refuses and writes nothing", () => {
  const d = project({ title: "QA" });
  build(d);
  assert.match(cli(d, "answer", "Hello").stderr, /there is no message from the owner without an answer/);
  assert.match(cli(d, "answer").stderr, /answer needs the answer/);
  assert.equal(lines(P(d).events).filter((e) => e.type === "claude.answered").length, 0);
  assert.equal(fs.existsSync(path.join(P(d).out, "docs")), false);
  rm(d);
});
