// local.mjs - the plain-files adapter: any harness, or none.
//
//   instructions  the same protocol, as a block for AGENTS.md (Codex, Cursor, Pi and others read it)
//   triggers      no hooks: the CLI, a git hook or a file watcher calls in. Output is plain text;
//                 a block exits 1 so a git hook refuses the commit
//   publish       the built page stays a file; open it in a browser (a local server comes in Phase 8)
//   channel       requests are JSON files dropped in .cockpit/inbox/<collection>/; nothing can wake the agent,
//                 so the protocol tells it to check the inbox at the start of each turn
import { protocolText } from "./contract.mjs";

export const local = {
  name: "local",

  instructions: {
    protocol: ({ title, record, digest, out, note, plan }) => [
      `## ${title} board`,
      `The record ${record} drives the board page ${out}.`,
      digest,
      protocolText({ record, plan, note: note || "node src/cli/note.mjs",
        publishLine: `After cards change, rebuild with node src/build/build.mjs. At the start of each turn, run node src/cli/cockpit.mjs inbox --from .cockpit/inbox.` }),
    ].join("\n"),
  },

  triggers: {
    read(raw = {}) {
      return { kind: raw.kind || "other", session: raw.session || "local", text: raw.text || "", file: raw.file || "",
        tool: raw.tool || "", url: raw.url || "", response: raw.response, again: !!raw.again };
    },
    context(kind, text) { process.stdout.write(text + "\n"); },
    feedback(text) { process.stderr.write(text + "\n"); process.exit(1); },
    block(reasons) { process.stderr.write("[board] " + reasons.join("\n[board] ") + "\n"); process.exit(1); },
  },

  publish: {
    target: "file",
    instructions: (file) => `Open ${file} in a browser; the local adapter has no hosted page.`,
    receipt: () => null,
  },

  channel: {
    inboxes: { actions: "interact", approvals: "owner" },
    wakeText: () => "",
  },
};
