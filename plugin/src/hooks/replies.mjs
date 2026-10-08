// replies.mjs - the agent's own replies, read from the session's transcript, for the Live feed.
//
// The agent already writes to the user in plain language all day: short updates between steps and a full reply
// at the end of each turn. Those words live in the session's transcript on the user's computer, where the board
// cannot see them. This reads the newest ones so a hook can log them as events; the next push carries them.
//
//   repliesIn(text, sinceUuid)  pure: transcript text in, [{ uuid, at, text }] out, oldest first
//   readTail(file, bytes)       the end of a transcript file (it can be tens of megabytes)
//   cleanReply(text)            safe to store and show: control characters gone, line breaks kept, capped
//
// A transcript line is one JSON object. An assistant line carries ONE content block (thinking, tool_use or
// text). A user line carries the prompt as a string, or tool results as a list. Lines from a subagent are
// marked isSidechain and are never the agent's words to the user.
import fs from "node:fs";

export const REPLY_MAX = 6000;       // characters kept of one reply; the rest stays in the terminal
export const TAIL_BYTES = 1500000;   // how much of the transcript's end is read

export function cleanReply(text, max = REPLY_MAX) {
  let t = String(text == null ? "" : text)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")   // control characters, but not the line break
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length > max) t = t.slice(0, max - 60).trimEnd() + "\n\n… (cut here: the full reply is in the terminal)";
  return t;
}

const isPrompt = (j) => j && j.type === "user" && !j.isSidechain && j.message
  && (typeof j.message.content === "string" || (Array.isArray(j.message.content) && j.message.content.some((b) => b && b.type === "text")));

export function repliesIn(text, sinceUuid) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (!line || line[0] !== "{") continue;
    let j; try { j = JSON.parse(line); } catch { continue; }   // the first line of a tail is usually cut: skip it
    if (j && typeof j === "object") rows.push(j);
  }
  // Start after the last reply already taken; failing that, after the newest prompt the user typed, so an old
  // conversation is never replayed into the feed.
  let from = 0, found = false;
  if (sinceUuid) for (let i = rows.length - 1; i >= 0; i--) if (rows[i].uuid === sinceUuid) { from = i + 1; found = true; break; }
  if (!found) for (let i = rows.length - 1; i >= 0; i--) if (isPrompt(rows[i])) { from = i + 1; break; }
  const out = [];
  for (let i = from; i < rows.length; i++) {
    const j = rows[i];
    if (j.type !== "assistant" || j.isSidechain || !j.message || !Array.isArray(j.message.content)) continue;
    const t = j.message.content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n").trim();
    if (!t || typeof j.uuid !== "string") continue;
    const text2 = cleanReply(t);
    if (text2) out.push({ uuid: j.uuid, at: typeof j.timestamp === "string" ? j.timestamp : null, text: text2 });
  }
  return out;
}

export function readTail(file, bytes = TAIL_BYTES) {
  const st = fs.statSync(file), n = Math.min(bytes, st.size), b = Buffer.alloc(n), fd = fs.openSync(file, "r");
  try { fs.readSync(fd, b, 0, n, st.size - n); } finally { fs.closeSync(fd); }
  return b.toString("utf8");
}
