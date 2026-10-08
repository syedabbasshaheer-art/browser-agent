// feed.mjs - the live rail's feed, for the CLI. The builder itself lives in src/events/feed.mjs:
// the page build needs it too, and the core never imports the CLI (test/harness-free.test.mjs).
export { buildFeed, entryOf, FEED_SIZE } from "../events/feed.mjs";
