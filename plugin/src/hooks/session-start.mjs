// SessionStart hook. Fires once when a session opens. It answers the question a new user is left with after
// an install: "what do I type now?"
//   - A project that has a board: one line with the board's address and the command.
//   - A project with no board: a welcome, shown ONCE per project, that says how to make one. The "shown" mark is
//     kept in the plugin's own data folder (CLAUDE_PLUGIN_DATA), never in the project: a project that did not opt
//     in still gets no file written (card 4.5). With no data folder (the code run outside a plugin), it says nothing.
// Only a new session speaks. A resumed, cleared, compacted or forked one already had its line.
// It never throws and never blocks: a session must start whether or not this hook works.
import { readStdin } from "./lib.mjs";
import { HAS_CONFIG, TITLE, ARTIFACT_URL } from "../build/config.mjs";
import { COMMAND, WELCOME, WELCOME_CONTEXT, claimWelcome } from "./welcome.mjs";
export { COMMAND, WELCOME, WELCOME_CONTEXT };

const say = (systemMessage, additionalContext) =>
  process.stdout.write(JSON.stringify({ systemMessage, ...(additionalContext ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } } : {}) }));

try {
  const e = await readStdin();
  if ((e.source || "startup") !== "startup") process.exit(0);
  if (HAS_CONFIG) {
    const url = /^https?:\/\//.test(ARTIFACT_URL) && !ARTIFACT_URL.includes("<") ? ARTIFACT_URL : "";
    say(url ? `Agent on Browser: the ${TITLE} board is at ${url}. Type ${COMMAND} for its commands.`
            : `Agent on Browser: the ${TITLE} board is not published yet. Type ${COMMAND} publish, or say "publish my board".`);
    process.exit(0);
  }
  if (claimWelcome()) say(WELCOME, WELCOME_CONTEXT);
} catch { /* a session starts regardless */ }
