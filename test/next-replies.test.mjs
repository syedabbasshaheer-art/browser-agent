// node --test test/next-replies.test.mjs — a result may carry up to two replies the owner is likely to send next.
import test from "node:test";
import assert from "node:assert/strict";
import { project, cli, build, rm, P, lines } from "./qa/_helpers.mjs";
import { entryOf } from "../plugin/src/events/feed.mjs";

const said = (d) => lines(P(d).events).filter((e) => e.type === "claude.said");

test("say --next: a result about a card stores up to two replies, and the feed carries them", () => {
  const d = project({ title: "QA" }); build(d);
  const r = cli(d, "say", "The parser is written and 12 tests pass.", "--card", "1.2", "--kind", "result", "--next", "Start card 1.3 | Show me the tests");
  assert.equal(r.status, 0, r.stderr);
  const e = said(d).pop();
  assert.deepEqual(e.replies, ["Start card 1.3", "Show me the tests"]);
  const x = entryOf(e);
  assert.deepEqual([x.say, x.card, x.replies], ["result", "1.2", ["Start card 1.3", "Show me the tests"]]);
  rm(d);
});

test("say --next: refused, with nothing written, when it is not a result about a card, has too many, or one is too long", () => {
  const d = project({ title: "QA" }); build(d);
  const before = said(d).length;
  const bad = [
    [["--card", "1.2", "--next", "Go on"], /--next goes with --kind result and --card/],
    [["--kind", "result", "--next", "Go on"], /--next goes with --kind result and --card/],
    [["--card", "1.2", "--kind", "result", "--next", "One | Two | Three"], /give 2 replies or fewer; this has 3/],
    [["--card", "1.2", "--kind", "result", "--next", "x".repeat(61)], /a reply is 60 characters at most; this one has 61/],
    [["--card", "1.2", "--kind", "result", "--next"], /--next needs the replies/],
    [["--card", "1.2", "--kind", "result", "--next", " | "], /--next needs at least one reply/],
  ];
  for (const [args, why] of bad) { const r = cli(d, "say", "Done.", ...args); assert.notEqual(r.status, 0, args.join(" ")); assert.match(r.stderr, why); }
  assert.equal(said(d).length, before, "no line was written by a refused command");
  rm(d);
});

test("say --next: the same reply twice is offered once; a result with no --next carries none", () => {
  const d = project({ title: "QA" }); build(d);
  cli(d, "say", "Done.", "--card", "1.2", "--kind", "result", "--next", "Go on | Go on");
  assert.deepEqual(said(d).pop().replies, ["Go on"]);
  cli(d, "say", "Done again.", "--card", "1.2", "--kind", "result");
  const e = said(d).pop();
  assert.equal(e.replies, undefined); assert.equal(entryOf(e).replies, undefined);
  rm(d);
});

test("the feed never passes on replies from a line that is not a card's result, and never more than two", () => {
  const base = { offset: 5, at: "2026-10-08T10:00:00.000Z", type: "claude.said", text: "x" };
  assert.equal(entryOf({ ...base, card: "1.2", replies: ["A"] }).replies, undefined, "a milestone");
  assert.equal(entryOf({ ...base, say: "result", replies: ["A"] }).replies, undefined, "no card");
  assert.deepEqual(entryOf({ ...base, say: "result", card: "1.2", replies: ["A", "", 7, "B", "C"] }).replies, ["A", "B"]);
});
