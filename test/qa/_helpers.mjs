// Shared by the proposed tests. Every command that runs the product runs it against a scratch
// project in the OS temp folder, selected with COCKPIT_ROOT. Nothing here can touch the repo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const SRC = (p) => path.join(REPO, "plugin", "src", p);
export const MD = fs.readFileSync(path.join(REPO, "test", "fixtures", "record-min.md"), "utf8");
export const NODE = process.execPath;

const TMP = fs.realpathSync(os.tmpdir());
const inTmp = (dir) => {
  const d = fs.realpathSync(dir);
  if (!d.toLowerCase().startsWith(TMP.toLowerCase())) throw new Error("refusing to run the product outside the temp folder: " + d);
  return dir;
};

// A project with a cockpit, in a temp folder.
export function project(config = { title: "QA" }, md = MD) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-qa-"));
  if (config) { fs.mkdirSync(path.join(dir, ".cockpit")); fs.writeFileSync(path.join(dir, ".cockpit", "config.json"), JSON.stringify(config)); }
  if (md != null) { fs.mkdirSync(path.join(dir, ".cockpit"), { recursive: true }); fs.writeFileSync(path.join(dir, ".cockpit", "BOARD.md"), md); }
  return dir;
}
export const rm = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

// The environment a child gets: this project, and none of the caller's cockpit settings.
export function envFor(dir, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^COCKPIT_/i.test(k) || k === "CLAUDE_PROJECT_DIR") delete env[k];
  return { ...env, COCKPIT_ROOT: inTmp(dir), ...extra };
}
const run = (file, dir, args, opts = {}) => spawnSync(NODE, [SRC(file), ...args], { cwd: dir, env: envFor(dir, opts.env), encoding: "utf8", input: opts.input });
export const cli = (dir, ...args) => run("cli/cockpit.mjs", dir, args);
export const cliEnv = (dir, env, ...args) => run("cli/cockpit.mjs", dir, args, { env });
export const build = (dir, ...args) => run("build/build.mjs", dir, args);
export const buildEnv = (dir, env, ...args) => run("build/build.mjs", dir, args, { env });
export const note = (dir, ...args) => run("cli/note.mjs", dir, args);
export const hook = (dir, name, input, env) => run(`hooks/${name}.mjs`, dir, [], { input: JSON.stringify(input), env });

// Paths inside a project.
export const P = (dir) => ({
  record: path.join(dir, ".cockpit", "BOARD.md"), config: path.join(dir, ".cockpit", "config.json"),
  page: path.join(dir, ".claude", "board.html"), local: path.join(dir, ".claude", "local"),
  events: path.join(dir, ".claude", "local", "events.jsonl"), activity: path.join(dir, ".claude", "local", "activity.jsonl"),
  receipt: path.join(dir, ".claude", "local", "published.json"), substance: path.join(dir, ".claude", "local", "substance.txt"),
  snapshot: path.join(dir, ".claude", "local", "snapshot.json"), out: path.join(dir, ".claude", "local", "cockpit"),
});
export const read = (f) => fs.readFileSync(f, "utf8");
export const readJSON = (f) => JSON.parse(read(f));
export const lines = (f) => { try { return read(f).split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
export const row = (dir, id) => read(P(dir).record).split(/\r?\n/).find((l) => l.startsWith(`| ${id} | `)) || "";

// Rewrite one card row of a record: fn gets the nine cells and may change them.
export const withRow = (md, id, fn) => md.split(/\r?\n/).map((l) => {
  if (!l.startsWith(`| ${id} | `)) return l;
  const c = l.split(" | "); fn(c); return c.join(" | ");
}).join("\n");
export const setRow = (dir, id, fn) => fs.writeFileSync(P(dir).record, withRow(read(P(dir).record), id, fn));

// An ArtifactData export: { actions: { a1: {...} }, approvals: {...}, cards: {...} }, plus _versions.json.
export function exported(collections = {}, versions = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lob-qa-export-"));
  for (const [col, docs] of Object.entries(collections)) {
    fs.mkdirSync(path.join(dir, col), { recursive: true });
    for (const [id, doc] of Object.entries(docs)) fs.writeFileSync(path.join(dir, col, id + ".json"), JSON.stringify(doc));
  }
  if (versions) fs.writeFileSync(path.join(dir, "_versions.json"), JSON.stringify(versions));
  return dir;
}
// A pending action as the page writes it. n orders them: the inbox works oldest first.
export const pending = (a, n = 0) => ({ status: "pending", askedAt: `2026-10-05T00:00:${String(n).padStart(2, "0")}Z`, ...a });

// The writes the orchestrator prepared, across every batch file, with each document body read back in.
export function batchWrites(dir) {
  const out = P(dir).out;
  return fs.readdirSync(out).filter((f) => /-batch-\d+\.json$/.test(f)).sort()
    .flatMap((f) => readJSON(path.join(out, f)))
    .map((w) => (w.file_path ? { ...w, data: readJSON(w.file_path) } : w));
}
export const hasGit = () => spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
