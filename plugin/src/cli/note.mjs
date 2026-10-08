// Record work that moved no card, so the board still says what happened.
//   node src/cli/note.mjs "Reworded the README intro; no card covers copy edits"
// Also acknowledges the Stop hook's "work changed after the record" check.
import fs from "node:fs";
import { logActivity, build, FILES } from "../build/build.mjs";
import { HAS_CONFIG, ROOT } from "../build/config.mjs";

// A note is written into a project's cockpit. In a folder that has none, nothing is written.
if (!HAS_CONFIG) { console.error("note: there is no cockpit in this folder (" + ROOT + " has no .cockpit/config.json). Nothing was written. To turn one on here, run: cockpit init"); process.exit(1); }
const text = process.argv.slice(2).join(" ").trim();
if (!text) { console.error('usage: node src/cli/note.mjs "<what was done>"'); process.exit(1); }
logActivity({ kind: "note", text: text.slice(0, 280) });
fs.mkdirSync(FILES.local, { recursive: true });
fs.writeFileSync(FILES.local + "/ack.json", JSON.stringify({ at: Date.now(), text }));
const r = build({ write: true });
console.log(r.ok ? "noted; board rebuilt #" + r.hash : "noted; board NOT rebuilt (record errors)");
