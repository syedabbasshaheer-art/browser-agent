// A timed wake-up is not the owner typing: it must never reset the ceiling on automatic starts.
import test from "node:test";
import assert from "node:assert/strict";
import { isTimerWake } from "../plugin/src/hooks/lib.mjs";
import { isOwnerAction } from "../plugin/src/core/auto.mjs";
import { SILENT, entryOf } from "../plugin/src/events/feed.mjs";

test("the timer's own wake-ups are recognised; what the owner types is not", () => {
  for (const t of ["/loop 30m /cockpit heartbeat", "/loop 30m /browser-agent heartbeat", "/browser-agent heartbeat", "/browser-agent:browser-agent heartbeat", "  /loop Build Goal 11 end to end", "<<autonomous-loop-dynamic>>", "/cockpit heartbeat",
    "node src/cli/cockpit.mjs heartbeat", "Run: cockpit heartbeat", "/cockpit:heartbeat", "/heartbeat"]) assert.equal(isTimerWake(t), true, t);
  for (const t of ["continue", "start card 8.1", "what is the heartbeat?", "loop over the cards and tell me", "", null, undefined])
    assert.equal(isTimerWake(t), false, String(t));
});

test("a timer wake is not the owner acting, and it is not a line on the board", () => {
  const e = { offset: 5, at: "2026-10-06T00:00:00Z", type: "timer.woke", text: "A timer woke the agent" };
  assert.equal(isOwnerAction(e), false);
  assert.equal(isOwnerAction({ ...e, type: "prompt.received" }), true);
  assert.ok(SILENT.includes("timer.woke"));
  assert.equal(entryOf(e).who, "Board");
});

test("a heartbeat with no news can end silently: the checklist says how, and the quiet event is not a line", async () => {
  const { heartbeatChecklist } = await import("../plugin/src/core/heartbeat.mjs");
  const head = heartbeatChecklist({ n: 1, of: 24 })[0];
  assert.match(head, /If steps 1 to 3 changed nothing, skip steps 4 to 6, post nothing, and run: cockpit heartbeat --done/);
  assert.ok(SILENT.includes("heartbeat.done"));
});
