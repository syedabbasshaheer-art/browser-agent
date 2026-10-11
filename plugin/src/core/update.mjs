// Is a newer version of the plugin published? Asked at most once in twenty hours, by a new session, with one
// plain GET for the public version file. Nothing about the user or the project is sent. The answer is kept in the
// plugin's own data folder. It never throws: with no network, no data folder, or the check turned off, the answer
// is "nothing newer is known".
//   BROWSER_AGENT_UPDATE_CHECK=off   turns the check off for this user.
//   "updates": false in a project's .cockpit/config.json turns the notice off for that project.
//   BROWSER_AGENT_LATEST=1.2.3       stands in for the network (tests).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE = "https://raw.githubusercontent.com/syedabbasshaheer-art/browser-agent/main/plugin/.claude-plugin/plugin.json";
export const UPDATE_COMMAND = "claude plugin update browser-agent@browser-agent";
const EVERY_MS = 20 * 60 * 60 * 1000, WAIT_MS = 2500;
const clean = (v) => (/^\d+\.\d+\.\d+$/.test(String(v || "")) ? String(v) : "");

// The version of the code that is running, from its own manifest.
export const VERSION = (() => {
  try { return clean(JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../.claude-plugin/plugin.json", import.meta.url)), "utf8")).version); } catch { return ""; }
})();

// newer("0.0.8", "0.0.7") is true. Anything that is not three numbers is never newer.
export function newer(a, b) {
  const x = clean(a).split(".").map(Number), y = clean(b).split(".").map(Number);
  if (x.length !== 3 || y.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// latestKnown({ data }) -> the newest published version this machine has heard of, or "".
// `data` is the folder the answer is kept in; the caller (a hook) names it, so this file reads no harness variable.
export async function latestKnown({ data = "", now = Date.now() } = {}) {
  try {
    if (String(process.env.BROWSER_AGENT_UPDATE_CHECK || "").toLowerCase() === "off") return "";
    if (process.env.BROWSER_AGENT_LATEST) return clean(process.env.BROWSER_AGENT_LATEST);
    if (!data) return "";
    const file = path.join(data, "update.json");
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { /* never checked */ }
    if (seen.checkedAt && now - Date.parse(seen.checkedAt) < EVERY_MS) return clean(seen.latest);
    let latest = clean(seen.latest);
    try {
      const stop = new AbortController(), timer = setTimeout(() => stop.abort(), WAIT_MS);
      const r = await fetch(SOURCE, { signal: stop.signal, redirect: "error" });
      clearTimeout(timer);
      if (r.ok) latest = clean((await r.json()).version) || latest;
    } catch { /* offline: keep what was known, and do not ask again for twenty hours */ }
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ checkedAt: new Date(now).toISOString(), latest }, null, 2));
    return latest;
  } catch { return ""; }
}

// What a person is told, in one line, when `latest` is newer than the running version.
export const updateLine = (latest, have = VERSION) =>
  `Agent on Browser ${latest} is ready (you have ${have}). To update: ${UPDATE_COMMAND}  then restart Claude Code.`;
