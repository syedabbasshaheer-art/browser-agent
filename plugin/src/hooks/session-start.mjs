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
import { VERSION, newer, latestKnown, updateLine } from "../core/update.mjs";
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
  // A newer version: one line here, and a note for the board to show under Needs you (read by the next build).
  const latest = await latestKnown({ data: process.env.CLAUDE_PLUGIN_DATA }), ready = (!HAS_CONFIG || UPDATES) && newer(latest, VERSION);
  if (ready) lines.push(updateLine(latest));
  if (HAS_CONFIG) {
    const note = path.join(ROOT, LOCAL, "update.json");
    try {
      if (ready) { fs.mkdirSync(path.dirname(note), { recursive: true }); fs.writeFileSync(note, JSON.stringify({ latest, at: new Date().toISOString() })); }
      else if (fs.existsSync(note)) fs.rmSync(note);
    } catch { /* the line above was still said */ }
  }
  if (lines.length) say(lines.join("\n\n"), context);
} catch { /* a session starts regardless */ }
