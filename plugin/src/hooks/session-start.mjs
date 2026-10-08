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
import crypto from "node:crypto";
import { readStdin } from "./lib.mjs";
import { HAS_CONFIG, ROOT, TITLE, ARTIFACT_URL } from "../build/config.mjs";

export const COMMAND = "/browser-agent";
// Four short lines: what it is, the two ways to start, and that it will not come back. The terminal shows it as is.
export const WELCOME = [
  "Agent on Browser is installed.",
  "",
  "  See this project as a board in your browser:",
  `    type   ${COMMAND}`,
  `    or say "set up my board"`,
  "",
  "  This note is shown once.",
].join("\n");
export const WELCOME_CONTEXT = `[Agent on Browser] The plugin is installed and this project has no board yet. The user has just been shown a welcome that says: type ${COMMAND}, or say "set up my board". If they type ${COMMAND} with no board, or ask in plain words to set up, create or show the board, use the browser-agent skill: run its init, then its plan, then publish, and give them the link. Do nothing about the board unless they ask.`;

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
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (!data) process.exit(0);
  const file = path.join(data, "welcomed.json");
  const key = crypto.createHash("sha256").update(path.resolve(ROOT).toLowerCase()).digest("hex").slice(0, 16);
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { /* first time */ }
  if (seen[key]) process.exit(0);
  // Mark first: if the mark cannot be written, say nothing, or the welcome would repeat in every session.
  seen[key] = new Date().toISOString();
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(seen, null, 2));
  say(WELCOME, WELCOME_CONTEXT);
} catch { /* a session starts regardless */ }
