// SessionStart hook. Fires once when a session opens. It answers the question a new user is left with after
// an install: "what do I type now?"
//   - A project that has a board: one line with the board's address and the command.
//   - A project with no board: a welcome, shown ONCE per project, that says how to make one. The "shown" mark is
//     kept in the plugin's own data folder (CLAUDE_PLUGIN_DATA), never in the project: a project that did not opt
//     in still gets no file written (card 4.5). With no data folder (the code run outside a plugin), it says nothing.
// Only a new session speaks. A resumed, cleared, compacted or forked one already had its line.
// It never throws and never blocks: a session must start whether or not this hook works.
import fs from "node:fs";
import path from "node:path";
import { readStdin } from "./lib.mjs";
import { HAS_CONFIG, TITLE, ARTIFACT_URL, ROOT, LOCAL, UPDATES } from "../build/config.mjs";
import { COMMAND, WELCOME, WELCOME_CONTEXT, REMINDER, claimWelcome, claimReminder } from "./welcome.mjs";
import { updateLine } from "../core/update.mjs";
import { noteUpdate } from "./update-note.mjs";
export { COMMAND, WELCOME, WELCOME_CONTEXT };

const say = (systemMessage, additionalContext) =>
  process.stdout.write(JSON.stringify({ systemMessage, ...(additionalContext ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } } : {}) }));

try {
  const e = await readStdin();
  if ((e.source || "startup") !== "startup") process.exit(0);
  const lines = []; let context = "";
  if (HAS_CONFIG) {
    const url = /^https?:\/\//.test(ARTIFACT_URL) && !ARTIFACT_URL.includes("<") ? ARTIFACT_URL : "";
    lines.push(url ? `Agent on Browser: the ${TITLE} board is at ${url}. Type ${COMMAND} for its commands.`
                   : `Agent on Browser: the ${TITLE} board is not published yet. Type ${COMMAND} publish, or say "publish my board".`);
  } else if (claimWelcome()) { lines.push(WELCOME); context = WELCOME_CONTEXT; }
  else if (claimReminder()) lines.push(REMINDER);
  // A newer version: one line here, a note the build reads, and one line for the open board's Inbox.
  const up = await noteUpdate();
  if (up) lines.push(updateLine(up.latest, undefined, up.command) + (HAS_CONFIG ? " Or press Update now in the board's Inbox." : ""));
  if (lines.length) say(lines.join("\n\n"), context);
} catch { /* a session starts regardless */ }
