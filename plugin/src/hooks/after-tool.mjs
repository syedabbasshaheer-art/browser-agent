// PostToolUse hook (matcher: file edits, shell commands, builder agents, Artifact and ArtifactData calls).
//   - The record was edited  → rebuild now. A record error is fed straight back to
//     the agent (exit 2), so a broken edit is fixed in the same breath.
//   - The board was published → write the publish receipt (hash + url + time), which
//     is what the Stop hook compares against. No agent memory involved.
//   - A card is in progress and the board has heard nothing about it for ten minutes → say so, at most
//     once every five minutes, so the agent posts an update while it works (quiet.mjs).
//   - A card is in progress, the agent's last line about it is auto.pulseGapMin minutes old and this session
//     edited files since → the script writes one factual line itself (a pulse, src/core/pulse.mjs), at most
//     auto.pulsePerHour an hour, and hands the agent ONE instruction: send the prepared batch. A pulse
//     written in a call replaces the reminder in that call, and holds it back for its usual gap: never both.
import { readStdin, guard, writeJSON, boardHash, substanceNow, isRecord, isBoard, recordTouch, readTouched, A, captureReplies } from "./lib.mjs";
import { build, logActivity, FILES } from "../build/build.mjs";
import { ARTIFACT_URL, AUTO, SKIP } from "../build/config.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as events from "../events/events.mjs";
import { quietCards, nudgeText, NUDGE_GAP_MIN, unsentDue } from "./quiet.mjs";
import { cardsInProgress, pulseDecision, pulseEvent } from "../core/pulse.mjs";
import { pushBatch, hasBoard, unsentLines } from "../events/push.mjs";

const NUDGE_STAMP = FILES.local + "/nudge.json";
// Deciding and writing are two steps, and several sessions run this hook at once. One lock makes them one, so
// the cap per hour holds. A lock older than ten seconds belonged to a hook that died.
const PULSE_LOCK = FILES.local + "/pulse.lock";
function pulse(session) {
  let mine = false;
  try {
    if (!session || !hasBoard()) return "";        // no published board: nobody is watching, and nothing could be sent
    const cards = cardsInProgress(fs.readFileSync(FILES.record, "utf8"));
    if (!cards.length) return "";
    fs.mkdirSync(FILES.local, { recursive: true });
    try { if (Date.now() - fs.statSync(PULSE_LOCK).mtimeMs > 10000) fs.rmSync(PULSE_LOCK, { force: true }); } catch { /* no lock */ }
    try { fs.closeSync(fs.openSync(PULSE_LOCK, "wx")); mine = true; } catch { return ""; } // another hook is deciding: it writes the pulse, or none is due
    const d = pulseDecision({ cards, entries: events.read({}), touched: readTouched(session), auto: AUTO, now: Date.now(), skip: SKIP });
    if (!d.pulse) return "";
    const e = events.append("claude.pulse", pulseEvent(d));
    writeJSON(NUDGE_STAMP, { at: Date.now() });    // the reminder waits its usual gap after a pulse
    const b = pushBatch();
    if (!b.file) return "";
    const cli = fileURLToPath(new URL("../cli/cockpit.mjs", import.meta.url));
    return `[board] A pulse was written for card ${d.card} (#${e.offset}): "${d.text}" Send it now: one ArtifactData batch call with the writes in ${b.file}, then run: node "${cli}" push --sent ${b.high}`;
  } catch { return ""; } // a pulse must never break a tool call
  finally { if (mine) { try { fs.rmSync(PULSE_LOCK, { force: true }); } catch { /* it goes stale by itself */ } } }
}

// Lines were logged and never sent: the owner sees nothing until they are. One reminder, with the batch ready.
const SEND_STAMP = FILES.local + "/send-nudge.json";
function sendNudge(tool) {
  try {
    if (tool === "ArtifactData") return "";          // the agent is sending right now
    const due = unsentDue(unsentLines());
    if (!due) return "";
    let last = 0; try { last = JSON.parse(fs.readFileSync(SEND_STAMP, "utf8")).at || 0; } catch {}
    if (Date.now() - last < 3 * 60000) return "";
    const b = pushBatch();
    if (!b.file) return "";
    writeJSON(SEND_STAMP, { at: Date.now() });
    const cli = fileURLToPath(new URL("../cli/cockpit.mjs", import.meta.url));
    return `[board] ${due.count} line${due.count === 1 ? " is" : "s are"} logged but not on the board, the oldest for ${due.minutes} min. The user is watching the board and sees nothing until you send: one ArtifactData batch call with the writes in ${b.file}, then run: node "${cli}" push --sent ${b.high}`;
  } catch { return ""; }
}

function quietNudge() {
  try {
    const list = quietCards(fs.readFileSync(FILES.record, "utf8"), events.read({}));
    if (!list.length) return "";
    const stamp = NUDGE_STAMP;
    let last = 0; try { last = JSON.parse(fs.readFileSync(stamp, "utf8")).at || 0; } catch {}
    if (Date.now() - last < NUDGE_GAP_MIN * 60000) return "";
    writeJSON(stamp, { at: Date.now() });
    return nudgeText(list);
  } catch { return ""; } // a reminder must never break a tool call
}

guard(async () => {
  const e = A.triggers.read(await readStdin());
  if (e.kind === "edit") recordTouch(e.session, e.file);
  captureReplies(e.session, e.transcript);   // the agent's short updates so far ride along with the next push
  const pulsed = pulse(e.session);
  const nudge = pulsed || quietNudge() || sendNudge(e.tool);   // one message at most: a pulse, else the quiet reminder, else unsent lines

  if (e.kind === "edit" && isRecord(e.file)) {
    const r = build({ write: true });
    if (!r.ok) return A.triggers.feedback("The record no longer parses; the board was NOT rebuilt. Fix:\n" + r.rec.errors.join("\n"));
    const moved = (r.moves || []).map((m) => (m.from ? m.id + " " + m.from + "→" + m.to : (m.id || "") + " " + m.kind)).join(", ");
    A.triggers.context("edit", "[board] rebuilt #" + r.hash + (moved ? " · moves: " + moved : " · no card moved") + ". Publish before stopping." + (nudge ? "\n" + nudge : ""));
    return;
  }

  const got = isBoard(e.file) ? A.publish.receipt(e) : null; // a finished publish of the board, or null
  if (got) {
    const hash = boardHash();
    writeJSON(FILES.receipt, { hash, substance: substanceNow(), url: got.url || ARTIFACT_URL, at: new Date().toISOString() });
    logActivity({ kind: "publish", text: "board #" + hash + " published" });
  }
  if (nudge) A.triggers.context("edit", nudge);
});
