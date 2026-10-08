// Stop hook. Fires when the agent is about to end its turn: the moment a batch of
// work is finished, which is the one moment it is worth checking. It stays SILENT
// unless this turn actually left the board behind, and blocks at most once per turn
// (stop_hook_active), with every reason in one message:
//   1. The record does not parse.
//   2. Files THIS session edited DURING THIS TURN are uncommitted, newer than the
//      record, and no note explains them. Named with the cards they likely belong to.
//      Other sessions' and subagents' edits are theirs to account for; committed work
//      has its commit message as the explanation.
//   3. The board's substance (cards, decisions, design) differs from what was last
//      published. The activity feed alone never forces a publish.
//   4. A card is in progress (START) and no turn-end line was written since this turn began: the board
//      would go quiet with nobody knowing what happened or what is next.
// It rebuilds first, so a record edited through Bash (no PostToolUse) is caught too.
import { readStdin, guard, readJSON, mtime, boardHash, changedWork, touchedThisTurn, cardsMentioning, substanceNow, turnStart, captureReplies, ACK, A } from "./lib.mjs";
import * as events from "../events/events.mjs";
import { build, FILES } from "../build/build.mjs";
import { fileURLToPath } from "node:url";
import { ARTIFACT_URL, RECORD, OUT as CFG_OUT } from "../build/config.mjs";
import { idleCards, keepText, KEEP_MAX } from "./idle.mjs";
import { openQuestionCards } from "../events/feed.mjs";
import { writeJSON } from "./lib.mjs";

// 6. A card of the agent's sits in progress and nothing says it is finished or waiting: the agent is sent back
//    to work, even after the one nudge above, at most KEEP_MAX times in a turn. After that it may stop, and
//    this hook writes the truth on the board itself, once: the card is in progress and nobody is working on it.
function keepWorking(e, cards) {
  try {
    const log = events.read({});
    const idle = idleCards(cards, log, openQuestionCards(log));
    if (!idle.length) return "";
    const f = FILES.local + "/keep-" + String(e.session || "x").replace(/[^\w-]/g, "") + ".json";
    const since = turnStart(e.session), st = readJSON(f, {});
    const n = st.turn === since ? (st.n || 0) : 0;
    const cli = fileURLToPath(new URL("../cli/cockpit.mjs", import.meta.url));
    if (n < KEEP_MAX) { writeJSON(f, { turn: since, n: n + 1 }); return keepText(idle, n + 1, cli); }
    if (!st.said) { events.append("agent.stopped", { cards: idle }); writeJSON(f, { turn: since, n, said: true }); }
    return "";
  } catch { return ""; }   // this rule must never trap a turn
}

const block = (reasons) => A.triggers.block(reasons);

guard(async () => {
  const e = A.triggers.read(await readStdin());
  if (e.again) {   // already nudged once this turn: only a card left in progress with nobody on it holds the turn
    const rec = build({ write: true });
    const keep = rec.ok ? keepWorking(e, rec.rec.cards) : "";
    if (keep) block([keep]);
    return;
  }

  const r = build({ write: true });
  if (!r.ok) return block([RECORD + " does not parse, so the board is stale. Fix: " + r.rec.errors.slice(0, 5).join(" | ")]);

  const reasons = [];

  // 5. The agent's replies of this turn go to the Live feed (when the project turned that on): they are logged
  //    here, and the agent is asked once to send them, so the owner reads on the board what was said in the terminal.
  const said = captureReplies(e.session, e.transcript, { final: true });
  if (said && ARTIFACT_URL && !ARTIFACT_URL.includes("<")) reasons.push("your " + (said === 1 ? "reply is" : said + " replies are") +
    " logged for the Live feed but not on the board yet. Run: node \"" + fileURLToPath(new URL("../cli/cockpit.mjs", import.meta.url)) +
    "\" push, send the batch file it prints with one ArtifactData batch call, then run push --sent with the number it gives. Say nothing more afterwards.");

  const recordAt = Math.max(mtime(FILES.record), (readJSON(ACK, {}).at || 0));
  const mine = new Set(touchedThisTurn(e.session));
  const drift = mine.size ? changedWork().filter((w) => mine.has(w.p) && w.t > recordAt + 2000) : [];
  if (drift.length) {
    const impact = drift.slice(0, 8).map((w) => {
      const ids = cardsMentioning(r.rec.cards, w.p);
      return w.p + (ids.length ? " (cards " + ids.slice(0, 4).join(", ") + ")" : " (no card names it)");
    });
    reasons.push("this turn changed " + drift.length + " file(s) the record does not account for: " + impact.join("; ") +
      ". Update those cards in " + RECORD + " (ST, or a new row), or if no card moves run: " +
      "node \"" + fileURLToPath(new URL("../cli/note.mjs", import.meta.url)) + "\" \"<what changed and why no card moved>\".");
  }

  const receipt = readJSON(FILES.receipt, {});
  const now = substanceNow();
  const stale = receipt.substance ? receipt.substance !== now : (boardHash() && receipt.hash !== boardHash());
  // Only a harness that publishes somewhere can be behind on a publish; and a board that was never published
  // is not "changed since the last publish" (the prompt hook already says it is unpublished).
  const publishes = A.publish.target !== "file" && (receipt.substance || receipt.hash);
  if (stale && publishes) {
    reasons.push("the board's cards changed since the last publish. " + A.publish.instructions(CFG_OUT, receipt.url || ARTIFACT_URL));
  }

  // The turn-end rule. Only when a card is in progress; the one-nudge-per-turn guard above keeps it to once.
  const doing = r.rec.cards.filter((c) => c.st === "START").map((c) => c.id);
  if (doing.length) {
    const since = turnStart(e.session);
    let ended = false;
    try { ended = events.read({ types: ["turn.ended", "heartbeat.done"] }).some((x) => Date.parse(x.at) >= since); } catch { ended = true; /* an unreadable log never blocks */ }
    if (!ended) reasons.push((doing.length === 1 ? "card " + doing[0] + " is" : "cards " + doing.slice(0, 4).join(", ") + " are") +
      " in progress and this turn wrote no turn-end line, so the board cannot say what happened or what is next. Run: node \"" +
      fileURLToPath(new URL("../cli/cockpit.mjs", import.meta.url)) + "\" turn-end \"<what happened>\" --next \"<what is next>\" and send the batch file it prints.");
  }

  const keep = keepWorking(e, r.rec.cards);
  if (keep) reasons.unshift(keep);
  if (reasons.length) block(reasons);
});
