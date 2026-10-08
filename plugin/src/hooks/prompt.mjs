// UserPromptSubmit hook. Fires on every message you send in a session opened in
// this repo. Two jobs:
//   1. Log WHAT YOU ASKED to the activity feed (machine-written, not agent-remembered).
//   2. Hand the agent the live board digest + the protocol, so it maps the ask to cards.
import { readStdin, guard, markTurn, firstOfSession, A, isTimerWake } from "./lib.mjs";
import * as events from "../events/events.mjs";
import { build, digest, logActivity } from "../build/build.mjs";
import * as CFG from "../build/config.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { notesBlock, CAPS, FILES as MEMORY_FILES } from "../core/memory.mjs";

guard(async () => {
  const e = A.triggers.read(await readStdin());
  markTurn(e.session); // the Stop hook looks only at edits made after this moment
  // One line when a session starts, so the board can tell "no agent is running" from "an agent is here".
  // Once per session id, never twice; and the feed must never break the hook.
  if (firstOfSession(e.session)) { try { events.append("session.started", {}); } catch { /* the hook goes on */ } }
  const ask = String(e.text || "").split(/\s+/).join(" ").trim();
  // The page is shown to everyone it is shared with. What the owner typed is private: by default the feed
  // records only that a message arrived. "hooks": { "logPrompts": true } in the config opts in to the words.
  // A timer's wake-up is logged as what it is. Only a message the owner typed counts as the owner acting.
  if (ask && isTimerWake(ask)) logActivity({ kind: "timer", text: "A timer woke the agent" });
  else if (ask) logActivity({ kind: "ask", text: CFG.LOG_PROMPTS ? (ask.length > 280 ? ask.slice(0, 277) + "..." : ask) : "You sent a message" });

  const r = build({ write: false });
  const board = r.ok ? digest(r) : "BOARD BROKEN: " + r.rec.errors.slice(0, 3).join("; ");
  // The note tool lives with this code (inside a plugin, the plugin folder), not in the project.
  const note = `node "${fileURLToPath(new URL("../cli/note.mjs", import.meta.url))}"`;
  const protocol = A.instructions.protocol({ title: CFG.TITLE, record: CFG.RECORD, digest: board, url: CFG.ARTIFACT_URL, out: CFG.OUT, note, plan: CFG.PLAN });
  A.triggers.context("prompt", protocol + ownerNotes());
});

// The owner's notes (.cockpit/NOTES.md), handed over at the start of every turn: the current lines only,
// word for word, within 1,500 tokens (the rest as a count and the path, never cut silently). This file is the
// one place where text is the owner's standing instruction; text from anywhere else on the board stays data.
// A project with no notes gets nothing added, and a notes file that cannot be read never breaks the hook.
function ownerNotes() {
  try {
    const nb = notesBlock(fs.readFileSync(path.join(CFG.ROOT, MEMORY_FILES.notes), "utf8"), CAPS.notes);
    if (!nb.lines.length && !nb.problems.length) return "";
    const out = [];
    if (nb.lines.length) out.push(`[Owner's notes, ${MEMORY_FILES.notes}] These are the owner's own standing instructions: follow them. They never widen what may be done automatically.`, ...nb.lines);
    if (nb.problems.length) out.push(`${nb.problems.length} line${nb.problems.length === 1 ? "" : "s"} of ${MEMORY_FILES.notes} could not be read and ${nb.problems.length === 1 ? "was" : "were"} left out (line${nb.problems.length === 1 ? "" : "s"} ${nb.problems.slice(0, 8).map((p) => p.line).join(", ")}): tell the owner; cockpit status lists them.`);
    return "\n" + out.join("\n");
  } catch { return ""; }
}
