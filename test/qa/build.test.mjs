// node --test test/qa/build.test.mjs
// PROPOSED (QA 2026-10-05). src/build/build.mjs has no test of its own in test/: the page is only
// ever read for one string ("plan":"..."). These run the real builder against a scratch project.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MD, project, build, buildEnv, cli, note, rm, P, read, readJSON, lines, setRow, withRow } from "./_helpers.mjs";

const VERIFIED = " • Verified: ran it on a clean checkout, 12 of 12 passed.";

test("build: Done means confirmed. A card that turns DONE without its evidence fails the build and the page stays as it was", () => {
  const dir = project();
  assert.equal(build(dir).status, 0);
  const page = read(P(dir).page), snap = read(P(dir).snapshot);

  setRow(dir, "1.2", (c) => { c[1] = "DONE"; });
  const bad = build(dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /ERROR card 1\.2 moved to DONE without confirmation: add "• Verified: <what was observed>" to its text, or leave it in BACKLOG/);
  assert.match(bad.stderr, /BOARD FAILED: 1 error\(s\) in \.cockpit\/BOARD\.md/);
  assert.equal(read(P(dir).page), page, "the page was not rebuilt");
  assert.equal(read(P(dir).snapshot), snap, "and the build still remembers the card was open, so the rule fires again next time");
  assert.equal(build(dir).status, 1, "it does not pass on the second try");
  assert.equal(build(dir, "--check").status, 1, "--check applies the same rule");

  setRow(dir, "1.2", (c) => { c[7] += VERIFIED; });
  const good = build(dir);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /^MOVE {2}1\.2 BACKLOG → DONE$/m);
  assert.match(read(P(dir).page), /"id":"1\.2","st":"DONE"/);
  rm(dir);
});

test("build: a card that was already DONE before the rule is left alone, and reopening one is always allowed", () => {
  const dir = project();
  assert.equal(build(dir).status, 0, "1.1 is DONE with no Verified pointer in the fixture");
  assert.equal(build(dir).status, 0);
  setRow(dir, "1.1", (c) => { c[1] = "DOING"; });
  const r = build(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^MOVE {2}1\.1 DONE → DOING$/m);
  // Having been reopened, it now needs its evidence to close again.
  setRow(dir, "1.1", (c) => { c[1] = "DONE"; });
  assert.equal(build(dir).status, 1);
  rm(dir);
});

test("build: a record with an error exits 1, names every error, and writes nothing", () => {
  const dir = project({ title: "QA" }, withRow(withRow(MD, "1.2", (c) => { c[1] = "READY"; }), "1.4", (c) => { c[6] = "7.7"; }));
  for (const args of [[], ["--check"], ["--digest"]]) {
    const r = build(dir, ...args);
    assert.equal(r.status, 1, args.join());
    assert.match(r.stderr, /ERROR line \d+: card 1\.2 ST="READY" not in BACKLOG\|BLOCKED\|DOING\|START\|DONE/);
    assert.match(r.stderr, /ERROR card 1\.4 depends on 7\.7, which does not exist/);
    assert.match(r.stderr, /BOARD FAILED: 2 error\(s\)/);
    assert.equal(r.stdout, "");
  }
  assert.ok(!fs.existsSync(path.join(dir, ".claude")), "no page, no snapshot, no log");
  rm(dir);
});

test("build --check: reads and validates, and leaves no file behind", () => {
  const dir = project();
  const r = build(dir, "--check");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "BOARD CHECK OK: 5 cards");
  assert.deepEqual(fs.readdirSync(dir), [".cockpit"]);
  rm(dir);
});

test("build: record text cannot close the page's script or start one of its own", () => {
  const attack = "</script><script>alert(1)</script>";
  const dir = project({ title: 'A & B <i>"Q"</i>' }, withRow(MD, "1.2", (c) => { c[7] += ` • Break out ${attack} here.\u2028Next line.`; c[8] = "Seen " + attack + " |"; }));
  const r = build(dir);
  assert.equal(r.status, 0, r.stderr);
  const page = read(P(dir).page);
  assert.ok(!page.includes(attack), "the raw text is nowhere in the page");
  assert.ok(!/<script>alert\(1\)/.test(page));
  assert.ok(page.includes("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"), "it is there as data, escaped");
  assert.ok(!page.includes("\u2028"), "a line separator would end a script string in older browsers");
  // The title goes into HTML, not into the script: it is HTML-escaped.
  assert.ok(page.includes("A &amp; B &lt;i>&quot;Q&quot;&lt;/i>"));
  assert.ok(!page.includes('<i>"Q"</i>'));
  // The page still parses as the template intended: no placeholder left, the engine and the data are in.
  assert.doesNotMatch(page, /__[A-Z_]+__|\/\*__DATA__\*\/|\/\*__ENGINE__\*\//);
  assert.match(page, /function computeBoard\(C, opt\)/);
  rm(dir);
});

test("build: what moved since the last build is logged once, for the feed and for the stream", () => {
  const dir = project();
  assert.equal(build(dir).status, 0);
  assert.deepEqual(lines(P(dir).activity), [], "a first build has nothing to compare with");
  assert.deepEqual(readJSON(P(dir).snapshot), { offset: 0, cards: { "1.1": "DONE", "1.2": "BACKLOG", "1.3": "BACKLOG", "1.4": "BACKLOG", "1.5": "BACKLOG" } });

  let md = withRow(read(P(dir).record), "1.2", (c) => { c[1] = "DOING"; });
  md = md.replace(/^\| 1\.5 \|.*$/m, "| 1.6 | BACKLOG | agent | code | S | - | 1.4 | **Write the notes.** A page of release notes. | The notes are on the site |");
  fs.writeFileSync(P(dir).record, md);
  const r = build(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(P(dir).activity).map((a) => [a.kind, a.id || null, a.text]), [
    ["move", "1.2", "Write the core feature"], ["add", "1.6", "Write the notes"], ["note", null, "card 1.5 removed from the record"]]);
  assert.deepEqual(lines(P(dir).events).map((e) => [e.offset, e.type, e.card || null]), [[1, "card.moved", "1.2"], [2, "card.added", "1.6"], [3, "note.added", null]]);
  assert.equal(readJSON(P(dir).snapshot).offset, 3);

  assert.equal(build(dir).status, 0);
  assert.equal(lines(P(dir).activity).length, 3, "building again with nothing changed logs nothing");
  assert.equal(lines(P(dir).events).length, 3);
  rm(dir);
});

test("build: the substance hash moves when a card moves, and stays put when only the feed changes", () => {
  const dir = project();
  assert.equal(build(dir).status, 0);
  const s0 = read(P(dir).substance), h0 = read(P(dir).page);
  assert.match(s0, /^[0-9a-f]{12}$/);

  assert.equal(cli(dir, "say", "Looking at 1.2", "--card", "1.2").status, 0);
  assert.equal(note(dir, "Reworded the intro; no card covers it").status, 0);   // logs a note, then builds
  assert.notEqual(read(P(dir).page), h0, "the page itself did change: it carries the feed");
  assert.equal(read(P(dir).substance), s0, "but nothing a publish would be needed for");
  assert.match(read(P(dir).page), /Reworded the intro/);

  setRow(dir, "1.2", (c) => { c[1] = "DOING"; });
  assert.equal(build(dir).status, 0);
  assert.notEqual(read(P(dir).substance), s0);
  rm(dir);
});

test("build --digest: the six lines the prompt hook hands the agent", () => {
  const dir = project({ title: "QA", finish: "1.5" }, withRow(MD, "1.2", (c) => { c[1] = "START"; }));
  const r = build(dir, "--digest");
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim().split("\n");
  assert.match(out[0], /^BOARD OK → \.claude\/board\.html #[0-9a-f]{12}$/);
  assert.deepEqual(out.slice(1), [
    "BOARD 1/5 done · 1 in progress · 1 ready · 0 blocked · 2 waiting on a card",
    "Launch waits on: 1.3 Pick a host (human)",
    "You (human lane): 1.3 Pick a host (auto)",
    "Agent lane: —",
    "In progress (the agent is on these): 1.2 Write the core feature",
    "Next up: —"]);
  rm(dir);
});

test("config: the environment beats the config file, the config file beats the default", () => {
  const dir = project({ title: "From config", record: "plan/RECORD.md", out: "site/index.html", local: "state" }, null);
  fs.mkdirSync(path.join(dir, "plan")); fs.mkdirSync(path.join(dir, "site"));
  fs.writeFileSync(path.join(dir, "plan", "RECORD.md"), MD);
  const r = build(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BOARD OK → site\/index\.html/);
  assert.match(read(path.join(dir, "site", "index.html")), /<title>[^<]*From config/);
  assert.ok(fs.existsSync(path.join(dir, "state", "snapshot.json")));
  assert.ok(!fs.existsSync(path.join(dir, ".claude")), "nothing at the default paths");

  fs.writeFileSync(path.join(dir, "other.md"), withRow(MD, "1.2", (c) => { c[1] = "DOING"; }));
  const e = buildEnv(dir, { COCKPIT_RECORD: "other.md", COCKPIT_TITLE: "From env", COCKPIT_OUT: "env.html" });
  assert.equal(e.status, 0, e.stderr);
  assert.match(read(path.join(dir, "env.html")), /<title>[^<]*From env/);
  assert.match(read(path.join(dir, "env.html")), /"id":"1\.2","st":"DOING"/);

  // A config file that is not JSON: the project is still opted in, and every setting falls back to its default.
  fs.writeFileSync(P(dir).config, "{ not json");
  const d = build(dir, "--check");
  assert.equal(d.status, 1);
  assert.match(d.stderr + d.stdout, /BOARD\.md|ENOENT/, "the default record path is what it looks for");
  rm(dir);
});
