// node --test test/qa/inbox-seam.test.mjs
// PROPOSED (QA 2026-10-05). The seam nothing in test/ crosses end to end:
//   export on disk -> orchestrator (cockpit inbox) -> gateway -> apply -> record -> rebuild -> event log -> mirror batch.
// Every run is a real `node src/cli/cockpit.mjs` against a scratch project in the OS temp folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MD, project, exported, pending, cli, build, rm, P, read, readJSON, lines, row, withRow, batchWrites } from "./_helpers.mjs";

const inbox = (dir, from, ...more) => cli(dir, "inbox", "--from", from, ...more);
const resultOf = (r, id) => (r.stdout.split("\n").find((l) => l.includes("/" + id + " ")) || "").trim();

test("inbox: where an action was written decides what it may do (actions/ = contributor, approvals/ = owner)", () => {
  const dir = project();
  const from = exported({
    actions: { a1: pending({ verb: "card.move", card: "1.2", to: "DONE" }, 1), a2: pending({ verb: "gate.approve", card: "1.3" }, 2),
               a3: pending({ verb: "release.push", confirmed: true }, 3), a4: pending({ verb: "card.move", card: "1.2", to: "DONE", level: "owner" }, 4) },
    approvals: { b1: pending({ verb: "card.move", card: "1.2", to: "DONE" }, 5), b2: pending({ verb: "gate.approve", card: "1.3" }, 6),
                 b3: pending({ verb: "release.push" }, 7), b4: pending({ verb: "release.push", confirmed: true }, 8) },
  });
  const r = inbox(dir, from);
  assert.equal(r.status, 0, r.stderr);
  assert.match(resultOf(r, "a1"), /-> refused: Only the owner can mark a card done/);
  assert.match(resultOf(r, "a2"), /-> refused: gate\.approve needs owner access; this came from interact/);
  assert.match(resultOf(r, "a3"), /-> refused: release\.push needs owner access; this came from interact/);
  assert.match(resultOf(r, "a4"), /-> refused: Only the owner/, "an action cannot name its own level");
  assert.match(resultOf(r, "b1"), /-> accepted: The agent is checking 1\.2's done-when/);
  assert.match(resultOf(r, "b2"), /-> done: Applied: gate\.approved 1\.3/);
  assert.match(resultOf(r, "b3"), /-> awaiting-confirmation: release\.push is high risk/);
  assert.match(resultOf(r, "b4"), /-> accepted: Accepted. The agent does release\.push now/);
  assert.match(row(dir, "1.2"), /^\| 1\.2 \| BACKLOG \|/, "an unconfirmed card stays where it was");
  assert.match(row(dir, "1.3"), /^\| 1\.3 \| BACKLOG \| human \| account \| Q \| - \| .*Approved by the owner from the browser/);
  assert.match(r.stdout, /CONFIRM, THEN CLOSE[^\n]*\n\s+1\.2\s+Write the core feature/);
  rm(dir, from);
});

test("inbox: a contributor cannot accept the plan; the config stays a draft", () => {
  const dir = project({ title: "QA", plan: "draft" });
  const from = exported({ actions: { a1: pending({ verb: "plan.accept" }, 1), a2: pending({ verb: "task.start", card: "1.2" }, 2) } });
  const r = inbox(dir, from);
  assert.equal(r.status, 0, r.stderr);
  assert.match(resultOf(r, "a1"), /-> refused: plan\.accept needs owner access/);
  assert.match(resultOf(r, "a2"), /-> refused: The plan is a draft/);
  assert.equal(readJSON(P(dir).config).plan, "draft");
  assert.equal(read(P(dir).record), MD, "the record is untouched");
  assert.ok(!lines(P(dir).events).some((e) => e.type === "plan.accepted"));
  rm(dir, from);
});

test("inbox: an action already decided is skipped, whatever its verdict was", () => {
  const dir = project();
  const move = { verb: "card.move", card: "1.2", to: "DOING" };
  const from = exported({ actions: { a1: { ...pending(move, 1), status: "done" }, a2: { ...pending(move, 2), status: "refused" },
    a3: { ...pending(move, 3), status: "accepted" }, a4: { ...pending(move, 4), status: "awaiting-confirmation" } } });
  const r = inbox(dir, from);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Inbox: 0 action\(s\) decided\.$/m);
  assert.equal(read(P(dir).record), MD);
  assert.deepEqual(lines(P(dir).events).map((e) => e.type), ["mirror.diffed"], "nothing was received, only the audit ran");
  assert.deepEqual(batchWrites(dir).filter((w) => w.collection === "actions"), []);
  rm(dir, from);
});

test("inbox: actions are worked oldest first, not in file-name order; one with no status counts as pending", () => {
  const dir = project();
  const from = exported({ approvals: {
    "a-late": pending({ verb: "card.move", card: "1.2", to: "BLOCKED" }, 9),
    "z-early": pending({ verb: "card.move", card: "1.2", to: "DOING" }, 1),
    "m-nostatus": { verb: "card.note", card: "1.2", text: "no status field", askedAt: "2026-10-05T00:00:05Z" } } });
  const r = inbox(dir, from);
  assert.equal(r.status, 0, r.stderr);
  const order = r.stdout.split("\n").filter((l) => /^\s+approvals\//.test(l)).map((l) => l.trim().split(/\s+/)[0]);
  assert.deepEqual(order, ["approvals/z-early", "approvals/m-nostatus", "approvals/a-late"]);
  assert.match(row(dir, "1.2"), /^\| 1\.2 \| BLOCKED \|.*Moved to DOING.*No status field.*Moved to BLOCKED/, "the trail is in the order asked");
  rm(dir, from);
});

test("inbox: an applied move reaches the record, the page, the event log and the mirror batch, once each", () => {
  const dir = project();
  assert.equal(build(dir).status, 0);                                  // a first build, so the next one can see what moved
  const from = exported({ approvals: { a1: pending({ verb: "card.move", card: "1.2", to: "DOING" }, 1), a2: pending({ verb: "card.note", card: "9.9", text: "x" }, 2) } },
    { "approvals/a1": 7 });
  const before = read(P(dir).page);
  const r = inbox(dir, from);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Inbox: 2 action\(s\) decided; the record changed and the board was rebuilt\.$/m);

  // the record
  assert.match(row(dir, "1.2"), /^\| 1\.2 \| DOING \|.*Moved to DOING by the owner from the browser on \*\*\d{4}-\d\d-\d\d\*\*\./);
  // the page
  const page = read(P(dir).page);
  assert.notEqual(page, before);
  assert.match(page, /"id":"1\.2","st":"DOING"/);
  // the event log: received, moved, done, then the refused one, then the audit. The move is logged once.
  const ev = lines(P(dir).events);
  assert.deepEqual(ev.map((e) => e.type), ["action.received", "card.moved", "action.done", "action.received", "action.refused", "mirror.diffed"]);
  assert.deepEqual(ev.map((e) => e.offset), [1, 2, 3, 4, 5, 6]);
  const { offset, at, ...moved } = ev[1];
  assert.deepEqual(moved, { type: "card.moved", card: "1.2", from: "BACKLOG", to: "DOING", via: "browser", action: "a1" });
  assert.match(ev[4].result, /There is no card 9\.9/);
  // the activity feed has the move too, and the build did not log it to the stream a second time
  assert.deepEqual(lines(P(dir).activity).map((a) => [a.kind, a.id, a.from, a.to]), [["move", "1.2", "BACKLOG", "DOING"]]);

  // the batch: one result per action (pinned when the export knew its version), every card (the mirror is empty), the live rail last
  const w = batchWrites(dir);
  const a1 = w.find((x) => x.collection === "approvals" && x.doc_id === "a1"), a2 = w.find((x) => x.doc_id === "a2");
  assert.deepEqual([a1.op, a1.if_version, a1.data.status], ["update", 7, "done"]);
  assert.match(a1.data.result, /Applied: card\.moved 1\.2 -> DOING\./);
  assert.ok(!Number.isNaN(Date.parse(a1.data.decidedAt)));
  assert.deepEqual([a2.op, "if_version" in a2, a2.data.status], ["update", false, "refused"]);
  assert.deepEqual(w.filter((x) => x.collection === "cards").map((x) => x.doc_id).sort(), ["1.1", "1.2", "1.3", "1.4", "1.5"]);
  assert.equal(w.find((x) => x.collection === "cards" && x.doc_id === "1.2").data.status, "DOING", "the mirror is computed after the edit");
  assert.deepEqual([w.at(-1).collection, w.at(-1).doc_id], ["live", "feed"]);
  assert.ok(w.at(-1).data.entries.some((e) => e.text === "Card 1.2 moved from Backlog to Ready."));
  rm(dir, from);
});

test("sync: a mirror that already holds what the record says gets no card writes; one stale card gets one pinned write", () => {
  const dir = project();
  const empty = exported({});
  assert.equal(cli(dir, "sync", "--from", empty).status, 0);
  // Play the database: store exactly what the first sync prepared, at version 2.
  const first = batchWrites(dir).filter((w) => w.collection !== "live");
  assert.equal(first.length, 6);
  const mirror = { cards: {}, board: {} }, versions = {};
  for (const w of first) { mirror[w.collection][w.doc_id] = w.data; versions[w.collection + "/" + w.doc_id] = 2; }
  const from = exported(mirror, versions);

  const again = cli(dir, "sync", "--from", from);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Mirror audit: 0 to add, 0 to change, 0 to remove, 6 already in step\./);
  assert.match(again.stdout, /The mirror is in step with the record\./);
  assert.deepEqual(batchWrites(dir).map((w) => w.collection + "/" + w.doc_id), ["live/feed"]);

  // Now the record moves on: only the documents that differ are written, pinned to the version they were read at.
  const moved = exported({ ...mirror, approvals: { a1: pending({ verb: "card.move", card: "1.3", to: "BLOCKED" }, 1) } }, versions);
  const r = cli(dir, "inbox", "--from", moved);
  assert.equal(r.status, 0, r.stderr);
  const w = batchWrites(dir).filter((x) => x.collection === "cards" || x.collection === "board");
  assert.deepEqual(w.map((x) => [x.op, x.collection + "/" + x.doc_id, x.if_version]), [["set", "cards/1.3", 2], ["set", "board/state", 2]]);
  assert.match(r.stdout, /cards\/1\.3\.status: mirror "BACKLOG" -> record "BLOCKED"/);
  rm(dir, empty, from, moved);
});

test("inbox: a Start request moves the card and hands it over; a change that would break the record is refused and nothing is written", () => {
  const dir = project();
  const from = exported({ approvals: { b1: pending({ verb: "task.start", card: "1.2" }, 1) }, actions: { a1: pending({ verb: "card.move", card: "1.1", to: "BACKLOG" }, 2) } });
  // The reopen is the owner's to ask for (finding S3). It is put in a second run so it meets a started card.
  const first = inbox(dir, exported({ approvals: { b1: pending({ verb: "task.start", card: "1.2" }, 1) } }));
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /-> accepted: Accepted\. 1.2 is in progress and the agent is working on it/);
  assert.match(first.stdout, /WORK TO START NOW[^\n]*\n\s+1\.2\s+Write the core feature/);
  assert.match(row(dir, "1.2"), /^\| 1\.2 \| START \|.*Handed to Claude by the owner from the browser/);
  const started = read(P(dir).record);

  const second = inbox(dir, exported({ approvals: { a1: pending({ verb: "card.move", card: "1.1", to: "BACKLOG" }, 2), a2: pending({ verb: "card.move", card: "1.2", to: "BACKLOG" }, 3) } }));
  assert.equal(second.status, 0, second.stderr);
  assert.match(resultOf(second, "a1"), /-> refused: Could not apply: the edit would break the record: card 1\.2 is in START but waits on 1\.1/);
  assert.match(resultOf(second, "a2"), /-> refused: 1\.2 is being executed/);
  assert.equal(read(P(dir).record), started, "a refused edit leaves the record byte for byte");
  assert.ok(!/record changed/.test(second.stdout));
  rm(dir, from);
});

test("inbox --record: another project's record is edited in place and this project's board is left alone", () => {
  const dir = project();
  const other = path.join(dir, "elsewhere.md"); fs.writeFileSync(other, MD);
  const from = exported({ approvals: { a1: pending({ verb: "card.move", card: "1.2", to: "DOING" }, 1) } });
  const r = inbox(dir, from, "--record", other);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(other), /^\| 1\.2 \| DOING \|/m);
  assert.equal(read(P(dir).record), MD);
  assert.ok(!fs.existsSync(P(dir).page), "no board was built for a record that is not this project's");
  assert.match(r.stdout, /the record changed \(.*elsewhere\.md\)/);
  rm(dir, from);
});

test("cockpit: a broken record and a missing --from fail with exit 1, say why, and write no batch", () => {
  const dir = project({ title: "QA" }, withRow(MD, "1.2", (c) => { c[1] = "READY"; }));
  const from = exported({ actions: { a1: pending({ verb: "card.move", card: "1.3", to: "DOING" }, 1) } });
  const broken = inbox(dir, from);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /cockpit: the record does not parse: line \d+: card 1\.2 ST="READY"/);
  assert.ok(!fs.existsSync(P(dir).out), "no batch for a record that does not parse");
  for (const cmd of ["inbox", "sync"]) { const r = cli(dir, cmd); assert.equal(r.status, 1, cmd); assert.match(r.stderr, new RegExp(`cockpit: ${cmd} needs --from <export dir>`)); }
  // (An unknown command is in known-bugs.test.mjs: today it dies before it can print the usage line.)
  const st = cli(dir, "status");
  assert.equal(st.status, 1); assert.match(st.stdout, /RECORD BROKEN:/);
  const b = cli(dir, "build");
  assert.equal(b.status, 1); assert.match(b.stderr, /ERROR line \d+: card 1\.2 ST="READY"/);
  assert.ok(!fs.existsSync(P(dir).page));
  rm(dir, from);
});

test("cockpit events: a named consumer reads what is new, commits, and is then up to date; verbs lists the whole vocabulary", () => {
  const dir = project();
  for (const t of ["one", "two", "three"]) assert.equal(cli(dir, "say", t).status, 0);
  const all = cli(dir, "events");
  assert.equal(all.stdout.trim().split("\n").length, 3);
  assert.equal(cli(dir, "events", "--since", "3").stdout.trim().split("\n").length, 1);
  const first = cli(dir, "events", "--consumer", "page", "--commit");
  assert.match(first.stdout, /Consumer page committed at offset 3\./);
  assert.match(cli(dir, "events", "--consumer", "page").stdout, /Consumer page is up to date \(offset 3\)\./);
  assert.equal(cli(dir, "events", "--consumer", "audit").stdout.trim().split("\n").length, 3, "another consumer starts from the beginning");
  assert.equal(cli(dir, "say", "four").status, 0);
  assert.match(cli(dir, "events", "--consumer", "page").stdout, /^\s+4\s.*claude\.said/);
  const verbs = cli(dir, "verbs").stdout.trim().split("\n");
  assert.deepEqual(verbs.map((l) => l.split(/\s+/)[0]), ["card.move", "card.note", "card.edit", "card.add", "gate.approve", "task.start", "plan.accept", "release.push", "question.answer", "auto.set", "notes.add", "notes.remove", "message.send"]);
  assert.match(verbs.find((l) => l.startsWith("release.push")), /level owner\s+risk high\s+confirm/);
  rm(dir);
});

test("cockpit init: never overwrites what is there, and adds each .gitignore line once", () => {
  const dir = project({ title: "Mine", plan: "accepted" });
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/");
  const r = cli(dir, "init", "--title", "Other");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kept {4}\.cockpit\/config\.json \(already there, not touched\)/);
  assert.match(r.stdout, /kept {4}\.cockpit\/BOARD\.md/);
  assert.deepEqual(readJSON(P(dir).config), { title: "Mine", plan: "accepted" });
  assert.equal(read(P(dir).record), MD);
  const gi = read(path.join(dir, ".gitignore"));
  assert.match(gi, /^node_modules\/\n/);
  assert.ok(gi.includes(".claude/local/"));
  assert.equal(cli(dir, "init").status, 0);
  assert.equal(read(path.join(dir, ".gitignore")), gi, "a second init adds nothing");
  rm(dir);
});
