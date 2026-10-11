// The welcome a new user gets, and the mark that makes it appear once per project. Two hooks share it: a new
// session (session-start.mjs) and, for an install made inside a running session, the first message after it
// (prompt.mjs). The mark is kept in the plugin's own data folder (CLAUDE_PLUGIN_DATA), never in the project.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "../build/config.mjs";

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

// True once per project, and only when the mark was written: if it cannot be written, say nothing, or the welcome
// would repeat in every session. With no data folder (the code run outside a plugin) it is always false.
export function claimWelcome() {
  try {
    const data = process.env.CLAUDE_PLUGIN_DATA;
    if (!data) return false;
    const file = path.join(data, "welcomed.json");
    const key = crypto.createHash("sha256").update(path.resolve(ROOT).toLowerCase()).digest("hex").slice(0, 16);
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { /* first time */ }
    if (seen[key]) return false;
    seen[key] = new Date().toISOString();
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(seen, null, 2));
    return true;
  } catch { return false; }
}
