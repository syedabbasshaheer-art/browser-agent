// update-note.mjs (src/hooks) - a newer version of the plugin, noticed and passed on.
// Called by the session-start hook and by the prompt hook, so a session left open for days still hears of one.
// It asks the network at most once in six hours (src/core/update.mjs keeps the answer). When a newer version is
// known and the project has a board it:
//   - writes <project>/.claude/local/update.json  { latest, command, at, told }  (the build reads it), and
//   - logs one `update.ready` event per version, which travels to the open board as a line, so the Inbox shows
//     "Update ready" without a rebuild and without anybody typing anything.
// It never throws and never blocks: a hook goes on regardless.
import fs from "node:fs";
import path from "node:path";
import { ROOT, LOCAL, HAS_CONFIG, UPDATES } from "../build/config.mjs";
import { VERSION, newer, latestKnown, UPDATE_COMMAND } from "../core/update.mjs";
import * as events from "../events/events.mjs";

const NOTE = path.join(ROOT, LOCAL, "update.json");
const KEY = "browser-agent@browser-agent";
// The command that updates THIS install: a plugin turned on in the project's own settings is updated in that scope.
export function updateCommand(root = ROOT) {
  const on = (file) => { try { const s = JSON.parse(fs.readFileSync(path.join(root, ".claude", file), "utf8")); return !!(s && s.enabledPlugins && s.enabledPlugins[KEY]); } catch { return false; } };
  return UPDATE_COMMAND + (on("settings.json") ? " --scope project" : on("settings.local.json") ? " --scope local" : "");
}
// -> { latest, command } when a newer version is known and this project wants to hear of it, else null.
export async function noteUpdate() {
  try {
    const latest = await latestKnown({ data: process.env.CLAUDE_PLUGIN_DATA });
    const ready = (!HAS_CONFIG || UPDATES) && newer(latest, VERSION);
    if (!HAS_CONFIG) return ready ? { latest, command: updateCommand() } : null;
    if (!ready) { try { if (fs.existsSync(NOTE)) fs.rmSync(NOTE); } catch { /* it is read as stale next build */ } return null; }
    const command = updateCommand();
    let was = {}; try { was = JSON.parse(fs.readFileSync(NOTE, "utf8")) || {}; } catch { /* the first note */ }
    let told = was.told === latest;
    if (!told) { try { events.append("update.ready", { latest, have: VERSION, command }); told = true; } catch { /* said next time */ } }
    try { fs.mkdirSync(path.dirname(NOTE), { recursive: true }); fs.writeFileSync(NOTE, JSON.stringify({ latest, command, at: was.at || new Date().toISOString(), told: told ? latest : "" })); } catch { /* the terminal line is still said */ }
    return { latest, command, fresh: was.latest !== latest };
  } catch { return null; }
}
