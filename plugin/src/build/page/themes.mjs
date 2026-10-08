// Five calm themes for the launch board. Same components, same markup; only tokens differ.
// Every theme defines the SAME token set, for light and dark. build-proto.mjs checks the
// contrast pairs below for every theme and mode, and refuses a theme that fails.
//
// Status hues are fixed by meaning across all five, only their shade changes:
//   backlog = neutral · in progress = blue · blocked = red · done = green.
// Owner (you / agent) uses two hues that are NOT status hues, shown as small marks only.

const common = {
  "--r-lg": "16px", "--r-md": "12px", "--r-sm": "8px",
};

export const THEMES = [
  {
    id: "linen", name: "Linen", font: "Source Sans 3",
    idea: "Warm paper, ink-blue accent. A printed planning sheet.",
    why: "Warm off-white lowers glare against a white card, so a card reads as lifted without a heavy shadow. One accent (ink blue) carries every interactive state. Source Sans 3 was drawn for UI text and has a true 500 weight, so hierarchy comes from size and weight 500/600, never 900.",
    bench: "Material 3 tonal surfaces (canvas, container, container-high); Jira's neutral-first status lozenges.",
    light: {
      "--bg": "#f5f3ef", "--surface": "#ffffff", "--surface-2": "#f0ede7", "--surface-3": "#e7e3db",
      "--line": "#e4dfd6", "--line-2": "#cfc8bb", "--ink": "#23211d", "--ink-2": "#4a453d", "--ink-3": "#655f55",
      "--accent": "#33518a", "--accent-ink": "#ffffff", "--accent-soft": "#e8edf6",
      "--st-backlog": "#9a9283", "--st-active": "#3a6db0", "--st-blocked": "#b5463b", "--st-done": "#3c7a57",
      "--st-backlog-bg": "#efece6", "--st-backlog-fg": "#57514a", "--st-active-bg": "#e6eef8", "--st-active-fg": "#2b5890",
      "--st-blocked-bg": "#f8e8e5", "--st-blocked-fg": "#97362c", "--st-done-bg": "#e4f0e8", "--st-done-fg": "#2d6446",
      "--own-human": "#7d4f92", "--own-agent": "#2a7479",
      "--own-human-bg": "#f2e9f7", "--own-human-fg": "#5c3472", "--own-human-line": "#d6bfe4",
      "--own-agent-bg": "#e1f1f1", "--own-agent-fg": "#134f53", "--own-agent-line": "#b3d9da",
      "--accent-line": "#c3d0e8", "--st-backlog-line": "#d4cdc0", "--st-done-line": "#b9d8c5", "--st-blocked-line": "#e9c2bc", "--st-active-line": "#bfd3ee",
      "--sh-1": "0 1px 2px rgba(40,30,20,.06), 0 1px 1px rgba(40,30,20,.03)", "--sh-2": "0 6px 16px -6px rgba(40,30,20,.14), 0 2px 4px rgba(40,30,20,.05)", "--sh-3": "0 18px 48px -12px rgba(40,30,20,.28)",
    },
    dark: {
      "--bg": "#1a1917", "--surface": "#24221f", "--surface-2": "#1e1d1a", "--surface-3": "#2e2c28",
      "--line": "#35322d", "--line-2": "#48443d", "--ink": "#ede9e2", "--ink-2": "#cbc5ba", "--ink-3": "#a49d91",
      "--accent": "#93acde", "--accent-ink": "#141a26", "--accent-soft": "#27303f",
      "--st-backlog": "#7a746a", "--st-active": "#6fa0d9", "--st-blocked": "#df7a6e", "--st-done": "#72b48e",
      "--st-backlog-bg": "#2b2926", "--st-backlog-fg": "#c4beb3", "--st-active-bg": "#1f2a38", "--st-active-fg": "#a2c3ec",
      "--st-blocked-bg": "#3a2320", "--st-blocked-fg": "#f1a69c", "--st-done-bg": "#1d2f25", "--st-done-fg": "#a1d3b3",
      "--own-human": "#cda7de", "--own-agent": "#80c6ca",
      "--sh-1": "0 1px 2px rgba(0,0,0,.35)", "--sh-2": "0 8px 20px -8px rgba(0,0,0,.6)", "--sh-3": "0 20px 50px -12px rgba(0,0,0,.7)",
    },
  },
  {
    id: "harbor", name: "Harbor", font: "Manrope",
    idea: "Cool grey grouped lists, indigo accent. A settings screen you trust.",
    why: "The grouped-list pattern (grey canvas, white groups, hairline rows) is the most familiar calm layout on phones and desktops, so the board needs no learning. Cool neutrals keep status colour the only warm thing on screen. Manrope's open counters stay clear at 12px.",
    bench: "Apple HIG grouped lists and materials; GitHub Primer's neutral scale and status colours.",
    light: {
      "--bg": "#f1f3f6", "--surface": "#ffffff", "--surface-2": "#f5f7fa", "--surface-3": "#e8ecf1",
      "--line": "#e2e6ec", "--line-2": "#cbd3dd", "--ink": "#1b2330", "--ink-2": "#435064", "--ink-3": "#5b687a",
      "--accent": "#4a4fc4", "--accent-ink": "#ffffff", "--accent-soft": "#ebebfb",
      "--st-backlog": "#94a0b0", "--st-active": "#2a78d4", "--st-blocked": "#cf463b", "--st-done": "#2a944f",
      "--st-backlog-bg": "#eef1f5", "--st-backlog-fg": "#4c5869", "--st-active-bg": "#e5f0fc", "--st-active-fg": "#1d5ca6",
      "--st-blocked-bg": "#fcebe9", "--st-blocked-fg": "#a3312a", "--st-done-bg": "#e2f4ea", "--st-done-fg": "#15744a",
      "--own-human": "#a4468a", "--own-agent": "#0e7f82",
      "--sh-1": "0 1px 2px rgba(16,24,40,.06), 0 1px 1px rgba(16,24,40,.03)", "--sh-2": "0 8px 18px -6px rgba(16,24,40,.12), 0 2px 4px rgba(16,24,40,.05)", "--sh-3": "0 20px 48px -12px rgba(16,24,40,.26)",
    },
    dark: {
      "--bg": "#0f141b", "--surface": "#18202a", "--surface-2": "#141a22", "--surface-3": "#212a36",
      "--line": "#263141", "--line-2": "#344152", "--ink": "#e6ebf2", "--ink-2": "#b9c3d0", "--ink-3": "#909cad",
      "--accent": "#9a9af8", "--accent-ink": "#15152e", "--accent-soft": "#24254a",
      "--st-backlog": "#5e6a7c", "--st-active": "#5aa5ef", "--st-blocked": "#ef7a70", "--st-done": "#55c47a",
      "--st-backlog-bg": "#1d242e", "--st-backlog-fg": "#b9c3d0", "--st-active-bg": "#16283b", "--st-active-fg": "#9fcbf6",
      "--st-blocked-bg": "#3a1e1d", "--st-blocked-fg": "#f7aca5", "--st-done-bg": "#13301f", "--st-done-fg": "#91deb5",
      "--own-human": "#e49ccf", "--own-agent": "#5fcfd1",
      "--sh-1": "0 1px 2px rgba(0,0,0,.4)", "--sh-2": "0 8px 20px -8px rgba(0,0,0,.65)", "--sh-3": "0 20px 50px -12px rgba(0,0,0,.75)",
    },
  },
  {
    id: "sage", name: "Sage", font: "Hanken Grotesk",
    idea: "Grey-green canvas, slate-teal accent. The quietest of the five.",
    why: "Low-chroma green-grey is the least fatiguing neutral for long sessions; every surface sits within a few lightness steps of the next, so the page feels like one material. The accent is slate teal, far from the leaf green used for done, so 'selected' never reads as 'finished'.",
    bench: "Material 3 low-chroma tonal palettes; calm-technology principle of peripheral information (Weiser and Brown).",
    light: {
      "--bg": "#f0f2ed", "--surface": "#fdfdfb", "--surface-2": "#eef1ea", "--surface-3": "#e3e8dd",
      "--line": "#dee3d7", "--line-2": "#c7cfbe", "--ink": "#1f261f", "--ink-2": "#445044", "--ink-3": "#5a665a",
      "--accent": "#2f5f6f", "--accent-ink": "#ffffff", "--accent-soft": "#e3edf0",
      "--st-backlog": "#9ca594", "--st-active": "#3b6ea3", "--st-blocked": "#b3523b", "--st-done": "#4c8a3c",
      "--st-backlog-bg": "#eaede5", "--st-backlog-fg": "#525c4d", "--st-active-bg": "#e5edf5", "--st-active-fg": "#2d5884",
      "--st-blocked-bg": "#f6e7e1", "--st-blocked-fg": "#92402d", "--st-done-bg": "#e6f0e0", "--st-done-fg": "#3b6a2e",
      "--own-human": "#865784", "--own-agent": "#2c6d73",
      "--sh-1": "0 1px 2px rgba(30,40,30,.06), 0 1px 1px rgba(30,40,30,.03)", "--sh-2": "0 6px 16px -6px rgba(30,40,30,.13), 0 2px 4px rgba(30,40,30,.05)", "--sh-3": "0 18px 48px -12px rgba(30,40,30,.26)",
    },
    dark: {
      "--bg": "#141813", "--surface": "#1d221c", "--surface-2": "#181c17", "--surface-3": "#262c25",
      "--line": "#2d352c", "--line-2": "#3c463b", "--ink": "#e5ebe2", "--ink-2": "#bdc7b9", "--ink-3": "#96a292",
      "--accent": "#90c2d0", "--accent-ink": "#11201f", "--accent-soft": "#1f2f33",
      "--st-backlog": "#636e5f", "--st-active": "#7eaad8", "--st-blocked": "#e08a70", "--st-done": "#8bc279",
      "--st-backlog-bg": "#21261f", "--st-backlog-fg": "#bdc7b9", "--st-active-bg": "#1c2835", "--st-active-fg": "#a9c8e8",
      "--st-blocked-bg": "#36231d", "--st-blocked-fg": "#f0ae98", "--st-done-bg": "#1f2f1b", "--st-done-fg": "#addc9e",
      "--own-human": "#d4a5d0", "--own-agent": "#84c8cd",
      "--sh-1": "0 1px 2px rgba(0,0,0,.35)", "--sh-2": "0 8px 20px -8px rgba(0,0,0,.6)", "--sh-3": "0 20px 50px -12px rgba(0,0,0,.7)",
    },
  },
  {
    id: "fjord", name: "Fjord", font: "IBM Plex Sans",
    idea: "Arctic frost palette, near-black accent. Nordic and monochrome.",
    why: "Built on the Nord palette's polar-night and snow-storm steps, which were designed as an even ladder, so each surface level is one visible step apart. The accent is the darkest ink itself: selected chips turn solid dark, which is unmistakable without adding a new colour.",
    bench: "Nord colour palette (polar night / snow storm / frost / aurora); IBM Carbon's layering model (layer-01, layer-02).",
    light: {
      "--bg": "#eceff4", "--surface": "#ffffff", "--surface-2": "#f3f5f8", "--surface-3": "#e5e9f0",
      "--line": "#dde2ea", "--line-2": "#c7cfdb", "--ink": "#2e3440", "--ink-2": "#434c5e", "--ink-3": "#566079",
      "--accent": "#3b4252", "--accent-ink": "#eceff4", "--accent-soft": "#e5e9f0",
      "--st-backlog": "#98a2b3", "--st-active": "#4f79a8", "--st-blocked": "#b04f5a", "--st-done": "#5f8f4a",
      "--st-backlog-bg": "#edf0f4", "--st-backlog-fg": "#4c566a", "--st-active-bg": "#e4ecf5", "--st-active-fg": "#3b6190",
      "--st-blocked-bg": "#f5e4e6", "--st-blocked-fg": "#963f49", "--st-done-bg": "#e7f0e2", "--st-done-fg": "#4a7437",
      "--own-human": "#8e5f86", "--own-agent": "#377e7d",
      "--sh-1": "0 1px 2px rgba(46,52,64,.07), 0 1px 1px rgba(46,52,64,.03)", "--sh-2": "0 8px 18px -6px rgba(46,52,64,.14), 0 2px 4px rgba(46,52,64,.05)", "--sh-3": "0 20px 48px -12px rgba(46,52,64,.3)",
    },
    dark: {
      "--bg": "#2e3440", "--surface": "#3b4252", "--surface-2": "#353c4a", "--surface-3": "#434c5e",
      "--line": "#434c5e", "--line-2": "#58637b", "--ink": "#eceff4", "--ink-2": "#d8dee9", "--ink-3": "#b2bccd",
      "--accent": "#88c0d0", "--accent-ink": "#2e3440", "--accent-soft": "#33404d",
      "--st-backlog": "#7b869b", "--st-active": "#81a1c1", "--st-blocked": "#e2868d", "--st-done": "#a3be8c",
      "--st-backlog-bg": "#3b4252", "--st-backlog-fg": "#d8dee9", "--st-active-bg": "#3a4859", "--st-active-fg": "#b5cde4",
      "--st-blocked-bg": "#4b3c46", "--st-blocked-fg": "#ebb3b8", "--st-done-bg": "#404b43", "--st-done-fg": "#c8dcb6",
      "--own-human": "#c9a6c3", "--own-agent": "#9fcfce",
      "--sh-1": "0 1px 2px rgba(0,0,0,.25)", "--sh-2": "0 8px 20px -8px rgba(0,0,0,.45)", "--sh-3": "0 20px 50px -12px rgba(0,0,0,.55)",
    },
  },
  {
    id: "porcelain", name: "Porcelain", font: "Plus Jakarta Sans",
    idea: "Near-white and airy, graphite accent. The lightest of the five.",
    why: "Almost no tint anywhere: the canvas is one step off white and cards are separated by hairlines rather than shadow, so the page feels like clean paper. The accent is graphite ink, so colour on the page means status and nothing else. Plus Jakarta Sans has wide, open letterforms that stay calm at 13px.",
    bench: "Swiss / International typographic style (grid, hairlines, one ink); Vercel Geist and Stripe dashboard neutrals (colour reserved for state).",
    light: {
      "--bg": "#fafaf9", "--surface": "#ffffff", "--surface-2": "#f6f6f4", "--surface-3": "#ececea",
      "--line": "#e7e7e4", "--line-2": "#d4d4cf", "--ink": "#1a1a19", "--ink-2": "#454542", "--ink-3": "#62625e",
      "--accent": "#262624", "--accent-ink": "#ffffff", "--accent-soft": "#efefed",
      "--st-backlog": "#a09f97", "--st-active": "#2f6fcf", "--st-blocked": "#c8473d", "--st-done": "#2b8a55",
      "--st-backlog-bg": "#f0f0ed", "--st-backlog-fg": "#52524d", "--st-active-bg": "#e8f0fb", "--st-active-fg": "#23589f",
      "--st-blocked-bg": "#fbeae8", "--st-blocked-fg": "#a3362d", "--st-done-bg": "#e4f3ea", "--st-done-fg": "#1f6e43",
      "--own-human": "#9a4b86", "--own-agent": "#177a7d",
      "--sh-1": "0 1px 1px rgba(20,20,20,.04)", "--sh-2": "0 6px 16px -8px rgba(20,20,20,.12), 0 1px 2px rgba(20,20,20,.05)", "--sh-3": "0 20px 48px -12px rgba(20,20,20,.22)",
    },
  },
];

THEMES.forEach((t) => { Object.assign(t.light, common); t.dark = t.light; }); // light-only by decision (2026-09-27)

// The pairs that must pass, per theme per mode. [label, fg, bg, minimum ratio]
export const CHECKS = [
  ["body text", "--ink", "--bg", 7], ["body on card", "--ink", "--surface", 7],
  ["secondary text on card", "--ink-2", "--surface", 4.5], ["muted text on card", "--ink-3", "--surface", 4.5],
  ["muted text in a tray", "--ink-3", "--surface-2", 4.5], ["muted text on canvas", "--ink-3", "--bg", 4.5],
  ["accent text on card", "--accent", "--surface", 4.5], ["text on accent button", "--accent-ink", "--accent", 4.5],
  ["accent text on accent tint", "--accent", "--accent-soft", 4.5],
  ["backlog pill", "--st-backlog-fg", "--st-backlog-bg", 4.5], ["in-progress pill", "--st-active-fg", "--st-active-bg", 4.5],
  ["blocked pill", "--st-blocked-fg", "--st-blocked-bg", 4.5], ["done pill", "--st-done-fg", "--st-done-bg", 4.5],
  ["done segment vs track", "--st-done", "--surface-3", 3], ["in-progress segment vs track", "--st-active", "--surface-3", 3],
  ["blocked segment vs track", "--st-blocked", "--surface-3", 3], ["backlog segment vs track", "--st-backlog", "--surface-3", 1.9],
  ["you mark on card", "--own-human", "--surface", 4.5], ["agent mark on card", "--own-agent", "--surface", 4.5],
  ["card edge vs canvas (hairline)", "--line-2", "--surface", 1.4],
  ["You pill", "--own-human-fg", "--own-human-bg", 7], ["Agent pill", "--own-agent-fg", "--own-agent-bg", 7],
  ["Frees pill", "--accent", "--accent-soft", 4.5], ["Waiting pill", "--st-backlog-fg", "--st-backlog-bg", 4.5], ["Ready pill", "--st-done-fg", "--st-done-bg", 4.5],
];
