// contract.mjs - the seam between the core and any agent harness.
//
// The core (parse, engine, gateway, apply, mirror, events, build) is plain Node and never names
// a harness. Everything a harness does differently sits behind four small interfaces. A new
// harness means a new adapter object that fills these four in, never a change to the core.
//
//   instructions  tell the agent the protocol
//     protocol(ctx) -> string                 ctx: { title, record, digest, url }
//
//   triggers      turn the harness's moments into events, and answer back
//     read(raw) -> { kind, session, text, file, tool, url, response, again }
//                  kind: "prompt" | "edit" | "publish" | "stop" | "other"
//     context(kind, text)  give the agent extra context for this moment
//     feedback(text)       push an error back at the agent now (it must fix it)
//     block(reasons)       stop the agent ending its turn, once, with the reasons
//
//   publish       put the board where a browser can open it
//     target                  a word: "artifact", "file", ...
//     instructions(file, url) -> string   what the agent must do to publish
//     receipt(event) -> { url } | null    a finished publish seen in an event, or null
//
//   channel       carry the mirror out and the requests and wake-ups in
//     inboxes                 { <collection>: <level> }  where requests arrive, and at what trust level
//     wakeText(n) -> string   what a wake-up says, or "" when this harness cannot be woken
//
// checkAdapter(a) lists what an adapter is missing, so a broken one fails loudly at load time.

export const INTERFACES = {
  instructions: ["protocol"],
  triggers: ["read", "context", "feedback", "block"],
  publish: ["target", "instructions", "receipt"],
  channel: ["inboxes", "wakeText"],
};

export function checkAdapter(a) {
  const missing = [];
  if (!a || typeof a !== "object") return ["the adapter itself"];
  if (typeof a.name !== "string" || !a.name) missing.push("name");
  for (const [part, keys] of Object.entries(INTERFACES)) {
    if (!a[part]) { missing.push(part); continue; }
    for (const k of keys) if (a[part][k] == null) missing.push(`${part}.${k}`);
  }
  return missing;
}

// The protocol is one text for every harness. Each adapter only says how to publish and
// how to leave a note, in its own words.
export const DRAFT_LINE = "The plan is a DRAFT: the owner has not accepted it. Do not set any card to START, DOING or DONE, however the request is worded; " +
  "notes, edits and new cards are fine. Work starts after the owner presses Accept plan on the board. ";
export function protocolText({ record, note, publishLine, plan }) {
  return (plan === "draft" ? DRAFT_LINE : "") + "Protocol: map this request to card ids. If work starts, set that card ST=DOING (ST=START when it was handed over from the board); " +
    "a card becomes DONE only when its DONE-WHEN is observed AND its text says • Verified: <what was observed>; " +
    `new work not on the board = a new card row in ${record}. Work that moves no card: ${note} "<what was done>". ` +
    publishLine;
}
