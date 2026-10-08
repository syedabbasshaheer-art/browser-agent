// claude.mjs - the Claude Code adapter.
//
//   instructions  the protocol, handed over at every prompt (the plugin's skill later)
//   triggers      Claude Code hooks: UserPromptSubmit, PostToolUse, Stop, JSON on stdin and stdout
//   publish       a claude.ai artifact, published by the agent with the Artifact tool
//   channel       the artifact's page database (actions/, approvals/) and its comments (the doorbell)
import { protocolText } from "./contract.mjs";

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit"];
const realUrl = (u) => !!u && /^https?:\/\//.test(u) && !u.includes("<"); // "" or the placeholder = not published yet

export const claude = {
  name: "claude",

  instructions: {
    protocol: ({ title, record, digest, url, out, note, plan }) => [
      `[${title} board] The record ${record} drives the board ${realUrl(url) ? "at " + url : "(not published yet: /browser-agent publish)"}.`,
      digest,
      protocolText({ record, plan, note: note || "node src/cli/note.mjs",
        publishLine: `Publish ${out} to the artifact URL only when cards changed; the Stop hook says so when it is needed, once, at the end of the turn.` }),
    ].join("\n"),
  },

  triggers: {
    read(raw = {}) {
      const ev = raw.hook_event_name || "";
      const inp = raw.tool_input || {};
      const tool = raw.tool_name || "";
      const kind = ev === "UserPromptSubmit" || "prompt" in raw ? "prompt"
        : ev === "Stop" || "stop_hook_active" in raw ? "stop"
        : EDIT_TOOLS.includes(tool) ? "edit"
        : tool === "Artifact" && (!inp.action || inp.action === "publish") ? "publish"
        : "other";
      return { kind, session: raw.session_id, text: raw.prompt || "", file: inp.file_path || "", tool,
        url: inp.url || "", response: raw.tool_response, again: !!raw.stop_hook_active,
        transcript: typeof raw.transcript_path === "string" ? raw.transcript_path : "" };
    },
    context(kind, text) {
      const hookEventName = kind === "prompt" ? "UserPromptSubmit" : "PostToolUse";
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } }));
    },
    feedback(text) { process.stderr.write(text + "\n"); process.exit(2); },
    block(reasons) {
      process.stdout.write(JSON.stringify({ decision: "block", reason: "[board] " + reasons.join(" ALSO: ") }));
      process.exit(0);
    },
  },

  publish: {
    target: "artifact",
    instructions: (file, url) => realUrl(url) ? `Publish ${file} with the Artifact tool to url ${url}.`
      : `Publish ${file} with the Artifact tool (first publish: no url), then save the link in .cockpit/config.json "artifact".`,
    receipt(e) {
      if (e.kind !== "publish") return null;
      const text = typeof e.response === "string" ? e.response : JSON.stringify(e.response || "");
      // A failed publish leaves no receipt. A success starts with "Published"; a failure can still contain the
      // word ("could not be published"), so the failure words win unless the text opens with the success word.
      if (/error|refused|conflict|not published|could not/i.test(text) && !/^\W*Published\b/.test(text)) return null;
      return { url: e.url };
    },
  },

  channel: {
    inboxes: { actions: "interact", approvals: "owner" },  // the db rules: approvals/ is owner-only
    wakeText: (n) => `${n} board action${n === 1 ? "" : "s"} waiting. Run the cockpit inbox: export actions and approvals, apply, rebuild and republish this board.`,
  },
};
