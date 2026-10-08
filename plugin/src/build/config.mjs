// Board config. Facts live in the record; this file says where things are and how to label them.
//
// The PROJECT is where the agent works, never where this code lives: a plugin's code sits in a
// cache folder shared by every project. Claude Code gives hooks CLAUDE_PROJECT_DIR; everything
// else runs from the project, so the working directory is the fallback. COCKPIT_ROOT overrides both.
//
// Resolution order for each setting: environment (COCKPIT_<NAME>), then the project's
// .cockpit/config.json, then the default below. The defaults are neutral: they name no project.
// To build another record, run with COCKPIT_RECORD=<path to a record>.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(process.env.COCKPIT_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());
let J = {};
// A project opts in by having a config file. Without one, the hooks stay completely silent (card 4.5):
// a plugin's hooks run in every project the user opens, and most of those have no cockpit.
export const CONFIG_FILE = path.join(ROOT, process.env.COCKPIT_CONFIG || ".cockpit/config.json");
export const HAS_CONFIG = fs.existsSync(CONFIG_FILE);
// A config that exists but does not parse must not fall back to defaults: the default plan is "accepted",
// so a stray comma would silently unlock a draft. It is reported, and the plan is treated as a draft.
export let CONFIG_ERROR = "";
if (HAS_CONFIG) {
  try { J = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) { CONFIG_ERROR = String(e && e.message || e).slice(0, 160); J = {}; }
  // Valid JSON that is not an object (a list, a number, null) holds no settings either.
  if (!CONFIG_ERROR && (!J || typeof J !== "object" || Array.isArray(J))) { CONFIG_ERROR = "it does not hold a JSON object"; J = {}; }
}
const pick = (key, dflt) => process.env["COCKPIT_" + key.toUpperCase()] ?? J[key] ?? dflt;
export const PROJECT_CONFIG = J;
// "draft": a plan the owner has not accepted yet. Cards cannot start or close until they accept it on the board.
export const PLAN = CONFIG_ERROR || pick("plan", "accepted") === "draft" ? "draft" : "accepted";
// The owner's prompts are private. Only when this is true does the page's feed carry their words.
export const LOG_PROMPTS = !!(J.hooks && J.hooks.logPrompts === true);
// The agent's own replies go to the Live feed only when the project says so: they are written for the owner,
// and everyone the board is shared with can read the feed.
export const LOG_REPLIES = !!(J.hooks && J.hooks.logReplies === true);
export const HARNESS = pick("harness", "claude"); // which adapter (src/adapters/) speaks to the agent

export const ARTIFACT_URL = pick("artifact", "https://claude.ai/artifact/<your-board-id>");
// A path from the config FILE must stay inside the project: someone who opens a cloned repository runs these
// hooks on its config, and "out": "../x.html" would write outside it. Such a value is not used (the default is),
// and the build fails with PATH_ERROR until it is fixed. The environment is the user's own and is not checked.
export let PATH_ERROR = "";
const inside = (key, dflt) => {
  const env = process.env["COCKPIT_" + key.toUpperCase()];
  if (env != null) return env;
  const v = J[key];
  if (v == null) return dflt;
  const abs = typeof v === "string" && v ? path.resolve(ROOT, v) : "";
  const rel = abs ? path.relative(ROOT, abs) : "..";
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    PATH_ERROR = PATH_ERROR || `"${key}" must be a path inside the project, not ${JSON.stringify(v).slice(0, 80)}: the default ${dflt} is used until it is fixed`;
    return dflt;
  }
  return v;
};
export const RECORD = inside("record", ".cockpit/BOARD.md");
export const TITLE = pick("title", "Project Cockpit");
export const OUT = inside("out", ".claude/board.html");
export const LOCAL = inside("local", ".claude/local"); // gitignored: activity log, event stream, snapshot, receipt

export const WIP = J.wip || { human: 2, agent: 3 }; // cards each owner can run at once
export const LAUNCH = pick("finish", null);          // the card whose dependency tree is the finish path; none by default
export const ACTIVITY_ON_PAGE = 40;         // newest entries embedded in the page
export const THEME = "linen";              // production theme (proto/themes.mjs), picked 2026-09-27

// A decision or watch row names its goal in the record's Goal column; these only override it.
export const DEC_GOAL = J.decisionGoals || {};
export const WATCH_GOAL = J.watchGoals || {};
// An optional sixth tile on the page: a number read from the record's "Where this stands" table.
// e.g. { "label": "Users", "row": "Signed-up users" }. None by default.
export const TILE = J.tile || null;
// Paths the Stop hook never counts as unaccounted work.
export const SKIP = (J.hooks && J.hooks.skip) || [".claude/", ".cockpit/", "node_modules/"];

// Automatic work (docs/16-live-feed-contract.md, section 5). Each value is checked on its own: a wrong type
// or a value out of range falls back to the default and is listed in AUTO_PROBLEMS (`cockpit status` prints
// them). Nothing here is ever changed by a verb except `paused` (the gateway's auto.set).
export const AUTO_DEFAULTS = Object.freeze({
  start: false, inARow: 3, perDay: 12, pauseOnQuestion: true, paused: false,
  quietMin: 10, pulseGapMin: 5, pulsePerHour: 8,
  holdGoals: Object.freeze([]),   // goal numbers the owner put on hold: no card in them starts automatically
  heartbeat: Object.freeze({ installed: false, everyMin: 30, from: "09:00", to: "22:00", perDay: 24 }),
});
const isBool = (v) => typeof v === "boolean";
const whole = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const clock = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// [check, what a person is told it must be]
const AUTO_RULES = {
  start: [isBool, "true or false"], pauseOnQuestion: [isBool, "true or false"], paused: [isBool, "true or false"],
  inARow: [whole(1, 20), "a whole number from 1 to 20"], perDay: [whole(1, 200), "a whole number from 1 to 200"],
  quietMin: [whole(1, 1440), "a whole number of minutes from 1 to 1440"], pulseGapMin: [whole(1, 1440), "a whole number of minutes from 1 to 1440"],
  pulsePerHour: [whole(0, 60), "a whole number from 0 to 60"],
  holdGoals: [(v) => Array.isArray(v) && v.length <= 50 && v.every(whole(1, 999)), "a list of goal numbers, for example [5, 8]"],
};
const HEARTBEAT_RULES = {
  installed: [isBool, "true or false"], everyMin: [whole(5, 1440), "a whole number of minutes from 5 to 1440"],
  from: [clock, "a time like 09:00"], to: [clock, "a time like 22:00"], perDay: [whole(1, 288), "a whole number from 1 to 288"],
};
const shown = (v) => { let s; try { s = JSON.stringify(v); } catch { s = String(v); } return String(s).slice(0, 40); };
// readAuto(raw) -> { auto, problems }. Pure: the value of the config's "auto" key in, the settings to use out.
//
// It fails closed. `paused` is not paused only when it is exactly false: any other value written there means
// paused. And when the block is not an object, or a setting that governs starts (start, inARow, perDay,
// pauseOnQuestion) is wrong, or the block holds a key that is no setting (a misspelt "paused", say), automatic
// starts are off until the file is fixed. `off` then says why, and `cockpit status` prints it.
export const AUTO_OFF = "automatic starts are off until this is fixed";
const GOVERNS_STARTS = ["start", "inARow", "perDay", "pauseOnQuestion", "holdGoals"];   // a hold that cannot be read must not be read as "no hold"
export function readAuto(raw, { broken = "" } = {}) {
  const problems = [];
  const auto = { ...AUTO_DEFAULTS, heartbeat: { ...AUTO_DEFAULTS.heartbeat } };
  const off = (why) => { auto.start = false; return { auto, problems, off: why }; };
  if (broken) { problems.push(`the settings file could not be read (${broken}): ${AUTO_OFF}`); return off("the settings file could not be read"); }
  if (raw === undefined) return { auto, problems };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { problems.push(`"auto" must be an object, not ${shown(raw)}: every automatic-work setting is at its default, and ${AUTO_OFF}`); return off('"auto" is not an object'); }
  const wrong = [];
  const take = (src, rules, into, prefix) => {
    for (const k of Object.keys(src)) {
      if (prefix === "auto." && k === "heartbeat") continue;
      if (!Object.hasOwn(rules, k)) { problems.push(`${prefix}${k} is not a setting and is ignored`); if (prefix === "auto.") wrong.push(prefix + k); continue; }
      if (rules[k][0](src[k])) { into[k] = src[k]; continue; }
      if (prefix === "auto." && k === "paused") { into[k] = true; problems.push(`auto.paused must be true or false, not ${shown(src[k])}: read as paused`); }
      else problems.push(`${prefix}${k} must be ${rules[k][1]}, not ${shown(src[k])}: using the default ${shown(into[k])}`);
      if (prefix === "auto." && GOVERNS_STARTS.includes(k)) wrong.push(prefix + k);
    }
  };
  take(raw, AUTO_RULES, auto, "auto.");
  if (raw.heartbeat !== undefined) {
    if (!raw.heartbeat || typeof raw.heartbeat !== "object" || Array.isArray(raw.heartbeat)) problems.push(`auto.heartbeat must be an object, not ${shown(raw.heartbeat)}: using the defaults`);
    else take(raw.heartbeat, HEARTBEAT_RULES, auto.heartbeat, "auto.heartbeat.");
  }
  return wrong.length ? off(`${wrong.slice(0, 4).join(", ")} ${wrong.length === 1 ? "is" : "are"} wrong`) : { auto, problems };
}
const AUTO_READ = readAuto(J.auto, { broken: CONFIG_ERROR });
// Why automatic starts were turned off by the reader, or "" when the settings read cleanly.
export const AUTO_OFF_WHY = AUTO_READ.off || "";
export const AUTO = AUTO_READ.auto;
export const AUTO_PROBLEMS = AUTO_READ.problems;

// A phase is not a label, it is a promise about the end state. The record says it, as an
// "Ends with: …" line under each phase heading; config.json "phaseEnd" can override one.
export const PHASE_END = J.phaseEnd || {};
