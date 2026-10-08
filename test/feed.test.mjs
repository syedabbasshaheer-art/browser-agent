// node --test test/feed.test.mjs — card 6.8: the live rail. `say` logs Claude's steps, buildFeed turns the
// event log into plain sentences, and every batch the agent sends carries a fresh live/feed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ev from "../plugin/src/events/events.mjs";
import { buildFeed } from "../plugin/src/cli/feed.mjs";

const CLI = fileURLToPath(new URL("../plugin/src/cli/cockpit.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/record-min.md", import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lob-feed-"));

// A project with a cockpit, in a temp dir; the CLI finds it through COCKPIT_ROOT.
function project() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".cockpit"));
  fs.copyFileSync(FIXTURE, path.join(dir, ".cockpit", "BOARD.md"));
  fs.writeFileSync(path.join(dir, ".cockpit", "config.json"), JSON.stringify({ title: "Feed test" }));
  return dir;
}
const cli = (dir, ...args) => {
  const env = { ...process.env, COCKPIT_ROOT: dir }; delete env.COCKPIT_CONFIG; delete env.COCKPIT_RECORD; delete env.COCKPIT_LOCAL;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
};
const eventsOf = (dir) => ev.read({}, path.join(dir, ".claude", "local", "events.jsonl"));
const OUT = (dir) => path.join(dir, ".claude", "local", "cockpit");
const readJSON = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const feedWrites = (dir) => fs.readdirSync(OUT(dir)).filter((f) => /-batch-\d+\.json$/.test(f))
  .flatMap((f) => readJSON(path.join(OUT(dir), f))).filter((w) => w.collection === "live" && w.doc_id === "feed");

test("say: appends claude.said with cleaned text, at most 280 characters, and an optional card", () => {
  const dir = project();
  const r = cli(dir, "say", "moved **4.4** | to start\nnow", "--card", "1.2");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 1, "one confirmation line");
  const [e] = eventsOf(dir);
  assert.equal(e.type, "claude.said");
  assert.equal(e.card, "1.2");
  assert.ok(!/[|*\n]/.test(e.text), e.text);
  // Changed on 2026-10-06: a line over 280 characters used to be cut to 280 with an ellipsis and exit 0.
  // It is now refused with its length, and nothing is written, so a line is never silently cut.
  const long = cli(dir, "say", "x".repeat(400));
  assert.equal(long.status, 1);
  assert.match(long.stderr, /the line is 400 characters and the limit is 280\. Nothing was written/);
  assert.equal(eventsOf(dir).length, 1, "the long line wrote no event");
  assert.ok(cli(dir, "say", "x".repeat(280)).status === 0, "exactly 280 is a whole line");
  assert.equal(eventsOf(dir)[1].text.length, 280);
  assert.ok(!eventsOf(dir)[1].text.includes("…"));
  assert.equal(eventsOf(dir)[1].card, undefined);
  assert.notEqual(cli(dir, "say").status, 0, "no text is an error");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("say, ask and turn-end: text over 280 characters is refused with its length, and nothing is written or cut", () => {
  const dir = project();
  const LONG = "A sentence that goes on. ".repeat(12).trim();   // 299 characters
  assert.equal(LONG.length, 299);
  const refused = [
    [["say", LONG, "--card", "1.2"], /^cockpit: the line is 299 characters and the limit is 280\. Nothing was written: shorten it and run the command again\.$/m],
    [["ask", LONG, "--card", "1.2"], /^cockpit: the question is 299 characters and the limit is 280\. Nothing was written/m],
    [["turn-end", LONG, "--next", "Short."], /^cockpit: the turn-end line is 299 characters and the limit is 280\. Nothing was written/m],
    [["turn-end", "Short.", "--next", LONG], /^cockpit: the --next text is 299 characters and the limit is 280\. Nothing was written/m],
  ];
  for (const [args, re] of refused) {
    const r = cli(dir, ...args);
    assert.equal(r.status, 1, args[0]);
    assert.match(r.stderr, re, args[0]);
    assert.equal(r.stdout, "", args[0] + " printed nothing else");
  }
  assert.deepEqual(eventsOf(dir), [], "no event was written by any of them");
  assert.ok(!fs.existsSync(path.join(dir, ".cockpit", "memory", "QUESTIONS.md")), "and no question was noted");
  // The length that counts is the cleaned line's: what would be stored.
  const padded = cli(dir, "say", "  " + "y".repeat(280) + "  \n ");
  assert.equal(padded.status, 0, padded.stderr);
  // At the limit every one of them is written whole.
  const EXACT = "z".repeat(279) + ".";
  assert.equal(cli(dir, "ask", EXACT.slice(0, 279) + "?", "--card", "1.2", "--topic", "long").status, 0);
  assert.equal(cli(dir, "turn-end", EXACT, "--next", EXACT).status, 0);
  const all = eventsOf(dir);
  assert.deepEqual(all.map((e) => e.type), ["claude.said", "claude.asked", "turn.ended"]);
  assert.deepEqual([all[0].text.length, all[1].text.length, all[2].text.length, all[2].next.length], [280, 280, 280, 280]);
  assert.ok(all.every((e) => !JSON.stringify(e).includes("…")), "nothing was shortened");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildFeed: newest first, capped at 60, and now is the latest claude.said", () => {
  const f = path.join(tmp(), "e.jsonl");
  assert.deepEqual([buildFeed({ file: f }).now, buildFeed({ file: f }).entries], [null, []], "an empty log");
  for (let i = 0; i < 40; i++) ev.append("note.added", { text: "note " + i }, f);
  ev.append("claude.said", { text: "Working on 1.2", card: "1.2" }, f);
  for (let i = 0; i < 34; i++) ev.append("card.moved", { card: "1.2", from: "BACKLOG", to: "START" }, f);
  const feed = buildFeed({ file: f });
  assert.equal(feed.entries.length, 60);
  assert.equal(feed.entries[0].offset, 75);
  assert.deepEqual(feed.entries.map((e) => e.offset), [...feed.entries.map((e) => e.offset)].sort((a, b) => b - a));
  assert.equal(feed.entries[0].text, "Card 1.2 moved from Backlog to In progress.");
  assert.equal(feed.entries[0].card, "1.2");
  assert.deepEqual({ text: feed.now.text, card: feed.now.card }, { text: "Working on 1.2", card: "1.2" });
  assert.ok(!Number.isNaN(Date.parse(feed.updatedAt)));
});

test("buildFeed: with no claude.said, now is the latest event; each type reads as a sentence", () => {
  const f = path.join(tmp(), "e.jsonl");
  ev.append("action.received", { action: "a", inbox: "actions", verb: "card.move", card: "4.4", to: "START" }, f);
  ev.append("action.accepted", { action: "a", result: "Accepted. 4.4 is in progress and the agent is working on it." }, f);
  ev.append("action.refused", { action: "b", result: "no card 9.9" }, f);
  ev.append("mirror.diffed", { added: 2, changed: 1, removed: 0 }, f);
  ev.append("board.published", {}, f);
  const feed = buildFeed({ file: f });
  assert.deepEqual(feed.entries.map((e) => e.text).reverse(), [
    "You asked to move card 4.4 to In progress.", "Request accepted: 4.4 is in progress and the agent is working on it.",
    "Request refused: no card 9.9", "The board page's data was updated to match the plan file: 3 items changed.", "A new version of the board page was published."]);
  assert.equal(feed.now.text, "A new version of the board page was published.");
});

test("buildFeed: prompt.received never carries what the person typed", () => {
  const f = path.join(tmp(), "e.jsonl");
  ev.append("prompt.received", { text: "my api key is SECRET-123" }, f);
  const feed = buildFeed({ file: f });
  assert.equal(feed.entries[0].text, "You sent a message");
  assert.equal(feed.now.text, "You sent a message");
  assert.ok(!JSON.stringify(feed).includes("SECRET"));
});

test("feed: writes the live/feed doc and a one-entry batch, unpinned", () => {
  const dir = project();
  cli(dir, "say", "Checking 1.2", "--card", "1.2");
  ev.append("prompt.received", { text: "SECRET-456" }, path.join(dir, ".claude", "local", "events.jsonl"));
  const r = cli(dir, "feed");
  assert.equal(r.status, 0, r.stderr);
  const batch = r.stdout.trim();
  assert.match(batch, /feed-batch-1\.json$/);
  const b = readJSON(batch);
  assert.equal(b.length, 1);
  assert.deepEqual({ ...b[0], file_path: undefined }, { op: "set", collection: "live", doc_id: "feed", file_path: undefined });
  assert.ok(!("if_version" in b[0]));
  assert.match(b[0].file_path, /docs\/live__feed\.json$/);
  const doc = readJSON(b[0].file_path);
  assert.equal(doc.now.text, "Checking 1.2");
  assert.equal(doc.entries.length, 2);
  assert.ok(!fs.readFileSync(b[0].file_path, "utf8").includes("SECRET"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("inbox and sync: every batch set includes a live/feed write, unpinned while the export does not know it", () => {
  const dir = project(), from = tmp();
  for (const cmd of ["sync", "inbox"]) {
    const r = cli(dir, cmd, "--from", from);
    assert.equal(r.status, 0, cmd + ": " + r.stderr);
    const w = feedWrites(dir);
    assert.equal(w.length, 1, cmd);
    assert.equal(w[0].op, "set");
    assert.ok(!("if_version" in w[0]), cmd);
    assert.ok(readJSON(w[0].file_path).entries.some((e) => e.kind === "mirror"), cmd + ": the feed includes this run's audit");
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// Found live 2026-09-30: inside a pinned batch the database refuses an unpinned write to an existing
// document, so once live/feed exists its write must carry the exported version.
test("inbox and sync: the live/feed write is pinned when the export knows its version", () => {
  const dir = project(), from = tmp();
  fs.writeFileSync(path.join(from, "_versions.json"), JSON.stringify({ "live/feed": 3 }));
  for (const cmd of ["sync", "inbox"]) {
    const r = cli(dir, cmd, "--from", from);
    assert.equal(r.status, 0, cmd + ": " + r.stderr);
    assert.equal(feedWrites(dir)[0].if_version, 3, cmd);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("say --step: the step is recorded, shown in the feed, and kept as the card's latest progress", () => {
  const dir = project();
  assert.equal(cli(dir, "say", "Tokens ported", "--card", "1.2", "--step", "2/8").status, 0);
  assert.equal(cli(dir, "say", "Components ported", "--card", "1.2", "--step", "3/8").status, 0);
  assert.equal(cli(dir, "say", "A line about another card", "--card", "1.3").status, 0);
  const [a] = eventsOf(dir);
  assert.deepEqual([a.step, a.of], [2, 8]);
  const feed = buildFeed({ file: path.join(dir, ".claude", "local", "events.jsonl") });
  assert.deepEqual(feed.progress["1.2"].step + "/" + feed.progress["1.2"].of, "3/8");
  assert.equal(feed.progress["1.2"].text, "Components ported");
  assert.equal(feed.progress["1.3"].step, undefined);
  assert.equal(feed.entries.find((e) => e.text === "Tokens ported").of, 8);
});

test("say --step refuses a step that is not done/total", () => {
  const dir = project();
  for (const bad of ["3", "9/8", "a/b", "1/0"]) assert.notEqual(cli(dir, "say", "x", "--card", "1.2", "--step", bad).status, 0, bad);
  assert.equal(eventsOf(dir).length, 0, "nothing was logged for a refused step");
});

test("say: with a board address, the line is also written as its own document, ready to send in one call", () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, ".cockpit", "config.json"), JSON.stringify({ title: "Feed test", artifact: "https://claude.ai/artifact/abc" }));
  const r = cli(dir, "say", "Half way", "--card", "1.2", "--step", "4/8");
  assert.equal(r.status, 0, r.stderr);
  const [e] = eventsOf(dir);
  const doc = readJSON(path.join(OUT(dir), "docs", "live__u" + e.offset + ".json"));
  assert.deepEqual({ who: doc.who, card: doc.card, text: doc.text, step: doc.step, of: doc.of, offset: doc.offset }, { who: "Agent", card: "1.2", text: "Half way", step: 4, of: 8, offset: e.offset });
  // The single-document hint became one batch (card 11.2): the batch names the same document, and the
  // follow-up command records it as sent.
  const batch = readJSON(path.join(OUT(dir), "push-batch-1.json"));
  assert.deepEqual(batch.map((w) => [w.op, w.collection, w.doc_id]), [["set", "live", "u" + e.offset]]);
  assert.match(batch[0].file_path, new RegExp("docs/live__u" + e.offset + "\\.json$"));
  assert.match(r.stdout, new RegExp("cockpit push --sent " + e.offset + "\\b"));
});
