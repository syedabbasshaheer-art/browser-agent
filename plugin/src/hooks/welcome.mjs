// The welcome a new user gets, and the mark that makes it appear once per project. Two hooks share it: a new
// session (session-start.mjs) and, for an install made inside a running session, the first message after it
// (prompt.mjs). The mark is kept in the plugin's own data folder (CLAUDE_PLUGIN_DATA), never in the project.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "../build/config.mjs";

export const COMMAND = "/browser-agent";
// What it gives, where the work moves to, and how to start. Every line fits a narrow terminal.
export const WELCOME = [
  "Agent on Browser is installed.",
  "",
  "  Your project becomes a board in your browser:",
  "    - every goal and card, at a glance",
  "    - the agent's work, live, as it happens",
  "    - start, steer and answer with a click",
  "",
  "  terminal  -->  board in your browser  -->  you steer there",
  "",
  `  Start now:  type  ${COMMAND}`,
  `              or say "set up my board"`,
  "  The board opens in your browser in about a minute.",
].join("\n");
// The short line a later new session gets while the project still has no board.
export const REMINDER = `Agent on Browser: this project has no board yet. Type ${COMMAND} to see it in your browser.`;
export const REMINDERS = 5;   // new sessions that get the reminder, per project; after that it stays quiet
export const WELCOME_CONTEXT = `[Agent on Browser] The plugin is installed and this project has no board yet. The user has just been shown a welcome that says: type ${COMMAND}, or say "set up my board". If they type ${COMMAND} with no board, or ask in plain words to set up, create or show the board, use the browser-agent skill: follow its "start" steps: a placeholder board is published and opened first, and the plan is written after. Do nothing about the board unless they ask.`;

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

// True in a later new session of a project that has had its welcome and still has no board, up to REMINDERS times.
export function claimReminder() {
  try {
    const data = process.env.CLAUDE_PLUGIN_DATA;
    if (!data) return false;
    const file = path.join(data, "reminded.json");
    const key = crypto.createHash("sha256").update(path.resolve(ROOT).toLowerCase()).digest("hex").slice(0, 16);
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { /* first time */ }
    const n = Number(seen[key]) || 0;
    if (n >= REMINDERS) return false;
    seen[key] = n + 1;
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(seen, null, 2));
    return true;
  } catch { return false; }
}
