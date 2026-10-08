// mirror.mjs - keep the page database a faithful mirror of the record, and audit the difference.
//
// The record is the source of truth. The page database (artifact db) is a MIRROR of it that
// open pages watch live. This module is pure:
//
//   desired(rec, E)          -> { "cards/<id>": doc, "board/state": doc }   what the mirror should hold
//   loadActual(dir)          -> { "cards/<id>": {data, version} }           what an ArtifactData export holds
//   diff(want, have)         -> { writes, report }                          the audit, and the fix
//   batches(writes, size=50) -> [[...], ...]                                ArtifactData batch-sized chunks
//
// Writes are pinned with if_version whenever the current version is known, so a mirror sync
// never overwrites a change made after the export it was computed from.
// Only the agent can carry the writes to the database (hooks have no credentials).

import fs from "node:fs";
import path from "node:path";

const pick = (c, E) => ({
  id: c.id, goal: c.g, phase: c.ph || "", title: c.title, desc: c.desc || "", pointers: c.pts || [],
  status: c.st, column: E.phase[c.id], owner: c.own, type: c.type, effort: c.eff, gate: c.gate,
  deps: String(c.deps || "-").split(/,\s*/).filter((d) => d && d !== "-"),
  doneWhen: c.dw || "", auto: !!E.autoset[c.id], frees: E.unblocks[c.id] || 0,
});

export function desired(rec, E) {
  const docs = {};
  rec.cards.forEach((c) => { docs["cards/" + c.id] = pick(c, E); });
  docs["board/state"] = {
    goals: rec.goals.map((g) => ({ n: g.n, title: g.title })),
    counts: E.count, gateCard: E.gateCard || null, cards: rec.cards.length,
    lanes: { human: rec.cards.filter((c) => E.phase[c.id] === "ACTIVE" && c.own === "human").map((c) => c.id),
             agent: rec.cards.filter((c) => E.phase[c.id] === "ACTIVE" && c.own === "agent").map((c) => c.id) },
  };
  return docs;
}

// ArtifactData `out_dir` writes <dir>/<collection>/<doc_id>.json. Accept either the bare
// document or an envelope carrying { data, version }.
// Found live, 2026-09-28: `out_dir` files hold the bare document WITHOUT its version (the
// version appears only in the tool's listing). The agent writes those versions to
// <dir>/_versions.json as { "cards/T1": 2, ... } so writes can still be pinned.
export function loadActual(dir, collections = ["cards", "board"]) {
  const have = {};
  let versions = {};
  try { versions = JSON.parse(fs.readFileSync(path.join(dir, "_versions.json"), "utf8")); } catch { /* none: writes go unpinned */ }
  for (const col of collections) {
    const d = path.join(dir, col);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); } catch { continue; }
      const env = j && typeof j === "object" && "data" in j && typeof j.data === "object";
      const key = col + "/" + f.slice(0, -5);
      have[key] = { data: env ? j.data : j, version: env ? j.version : versions[key] };
    }
  }
  return have;
}

// Compare by content, not key order: the database returns keys sorted, the record builds them in
// its own order. Found live on 2026-09-28 as a false "changed" on a document that was identical.
const stable = (v) => Array.isArray(v) ? "[" + v.map(stable).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}"
  : JSON.stringify(v);
const same = (a, b) => stable(a) === stable(b);

export function diff(want, have) {
  const writes = [], report = { added: [], changed: [], removed: [], unchanged: 0 };
  for (const [p, doc] of Object.entries(want)) {
    const [collection, doc_id] = p.split("/");
    const h = have[p];
    if (!h) { writes.push({ op: "set", collection, doc_id, data: doc }); report.added.push(p); continue; }
    const fields = Object.keys({ ...doc, ...h.data }).filter((k) => !same(doc[k], h.data[k]));
    if (!fields.length) { report.unchanged++; continue; }
    const w = { op: "set", collection, doc_id, data: doc };
    if (Number.isInteger(h.version)) w.if_version = h.version;
    writes.push(w);
    report.changed.push({ path: p, fields: fields.map((k) => ({ field: k, mirror: h.data[k], record: doc[k] })) });
  }
  for (const [p, h] of Object.entries(have)) {
    if (want[p]) continue;
    const [collection, doc_id] = p.split("/");
    const w = { op: "delete", collection, doc_id };
    if (Number.isInteger(h.version)) w.if_version = h.version;
    writes.push(w); report.removed.push(p);
  }
  return { writes, report };
}

export const batches = (writes, size = 50) => {
  const out = [];
  for (let i = 0; i < writes.length; i += size) out.push(writes.slice(i, i + size));
  return out;
};

export function describe(report) {
  const lines = [`Mirror audit: ${report.added.length} to add, ${report.changed.length} to change, ${report.removed.length} to remove, ${report.unchanged} already in step.`];
  report.changed.slice(0, 20).forEach((c) => c.fields.slice(0, 4).forEach((f) =>
    lines.push(`  ${c.path}.${f.field}: mirror ${JSON.stringify(f.mirror)?.slice(0, 40)} -> record ${JSON.stringify(f.record)?.slice(0, 40)}`)));
  report.removed.slice(0, 10).forEach((p) => lines.push(`  ${p}: in the mirror but not in the record (removed)`));
  return lines.join("\n");
}
