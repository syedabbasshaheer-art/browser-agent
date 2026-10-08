# 12 · Installing the plugin

How to install Agent on Browser into Claude Code, what each part does in the background, what it can and cannot do,
and what has been tested. The short version is in the [README](../README.md).

## 1. The names, once

| Name | What it is | Where you meet it |
|---|---|---|
| **Agent on Browser** | The product | The page, the welcome line |
| `syedabbasshaheer-art/browser-agent` | The GitHub repository: owner, then repository | The install command |
| `browser-agent` | The plugin, and also the catalogue that lists it | `claude plugin list`, update, remove |
| `/browser-agent` | The one command | Typed in a Claude Code session |
| `.cockpit/` | The folder a project gets (the product's first name, kept so existing boards keep working) | In your project |

The owner part of a GitHub address is always the account or organization that holds the repository. It changes only
by moving the repository to another account or an organization, or by renaming the account. GitHub redirects the old
address after either.

## 2. Install

### 2.1 One command (the normal way)

In a terminal, in the project's folder:

```
claude plugin install browser-agent --marketplace syedabbasshaheer-art/browser-agent --scope project
```

Then start `claude`. Needs Claude Code 2.1.275 or newer.

What that one command does, in order:

| Step | What happens | Why |
|---|---|---|
| 1 | Claude Code clones the repository with the git sign-in already on the computer | A plugin always comes from a **catalogue** (Claude Code calls it a marketplace): a file that lists plugins and where their files are. This repository is its own catalogue with one entry |
| 2 | It remembers the catalogue under the name `browser-agent` | So that update and remove work later without the address |
| 3 | It copies the repository's `plugin/` folder, and only that folder, into `~/.claude/plugins/cache/browser-agent/browser-agent/<version>/` | Sessions run the plugin from this copy, never from your project |
| 4 | It writes `"browser-agent@browser-agent": true` into the project's `.claude/settings.json` | `--scope project`: the plugin is on in this project only. Without the option it is on in every project (`~/.claude/settings.json`) |

### 2.2 The same thing in two commands

Older versions of Claude Code, and anyone who prefers to see both steps:

```
claude plugin marketplace add syedabbasshaheer-art/browser-agent
claude plugin install browser-agent@browser-agent --scope project
```

The first adds the catalogue. The second installs "the plugin `browser-agent` from the catalogue `browser-agent`".

### 2.3 From inside an open session

```
/plugin install browser-agent --marketplace syedabbasshaheer-art/browser-agent
```

It shows what the plugin adds, asks for the scope, and loads it. If it says "Run /reload-plugins to apply", it runs
that for you. No restart.

### 2.4 Why a restart was ever needed, and when it is not

A session reads its plugins when it starts. So:

| When you install | What makes it load |
|---|---|
| In a terminal, before starting `claude` (2.1) | Nothing: the next `claude` has it |
| Inside the session with `/plugin install` (2.3) | Nothing: it reloads itself |
| In a second terminal while a session is open | Type `/reload-plugins` in that session, or reopen it |

### 2.5 For one session, nothing installed (developers)

```
claude --plugin-dir "<path to a copy of this repository>"
```

### 2.6 A team

Commit the project's `.claude/settings.json` (step 4 above wrote it). A teammate who opens the project is told the
plugin is enabled there but not installed, and installs it with the same command.

## 3. The first session: how a user learns what to type

A plugin cannot run anything at install time: Claude Code has no install script, on purpose. What a plugin can do is
speak when a session starts. So:

| Moment | What the user sees | What makes it happen |
|---|---|---|
| First new session in a project with no board | "Agent on Browser is installed. To see this project as a board in your browser, type /browser-agent or just say "set up my board". This line is shown once." | The session-start hook. The "shown" mark is kept in the plugin's own data folder (`~/.claude/plugins/data/`), never in the project |
| The user types `/browser-agent`, or says "set up my board" | The agent creates `.cockpit/`, reads the project, asks what it could not find, writes the plan, publishes, and gives the link | The skill's `start` step. Plain words work because the skill's description lists them |
| Every later new session in that project | "Agent on Browser: the <project> board is at <link>. Type /browser-agent for its commands." | The same hook |
| Every message | Nothing visible. The agent is handed the board's summary and the owner's notes | The prompt hook |
| Typing `/` | `/browser-agent` is in the list (Claude Code shows it as `browser-agent:browser-agent`; the short form works) | The skill |

A resumed, cleared or compacted session says nothing: it already had its line.

## 4. What is in the plugin

| File | What it is |
|---|---|
| `.claude-plugin/marketplace.json` | The catalogue, at the top of the repository: one entry, with `"source": "./plugin"` |
| `plugin/` | **The plugin. Only this folder is copied to a user's computer**: about 50 files. The repository's documents, tests, examples and its own board are not installed |
| `plugin/.claude-plugin/plugin.json` | The plugin's identity: name `browser-agent`, version, description, author, repository, licence. No code |
| `plugin/hooks/hooks.json` | Four hooks, each run as `node "${CLAUDE_PLUGIN_ROOT}/src/hooks/<name>.mjs"` |
| `plugin/skills/browser-agent/SKILL.md` | The `/browser-agent` command and the rules the agent follows |
| `plugin/src/` | The code the hooks and the command run. Plain Node 18+, no dependencies |
| `plugin/templates/` | The starter plan, settings and notes a new project gets |

| Hook | Fires | Does |
|---|---|---|
| session-start | When a new session opens | The welcome, or the board's link (section 3) |
| prompt | On every message | Hands the agent the board summary, the protocol and the owner's notes |
| after-tool | After an edit, a shell command or a publish | Rebuilds the page when the plan changed; reminds the agent when lines were not sent |
| stop | At the end of a turn | Holds the turn once if work or cards are unaccounted for |

The three version numbers (`plugin.json`, the catalogue entry, `package.json`) always agree. A user stays on the
version they installed until they update.

## 5. Manage it later

| Want to | Command |
|---|---|
| See what is installed | `claude plugin list` |
| See what it adds to a session | `claude plugin details browser-agent` |
| Turn it off without removing it | `claude plugin disable browser-agent@browser-agent` (and `enable`) |
| Get a newer version | `claude plugin update browser-agent@browser-agent`. Updates are never silent |
| Remove it | `claude plugin uninstall browser-agent@browser-agent --scope project` |
| Remove the catalogue too | `claude plugin marketplace remove browser-agent` |

## 6. Controls: what it can and cannot do

| Control | How it holds |
|---|---|
| Nothing installs by itself | You run the install. `/plugin` disables or removes it at any time |
| Silent where it is not wanted | In a project with no `.cockpit/config.json` the prompt, after-tool and stop hooks do nothing at all, and the session-start hook shows its welcome once and writes nothing in the project (`test/silent.test.mjs`) |
| No network, no servers, no install scripts | Plain Node files. No MCP server, no dependencies, nothing runs at install time |
| Stays inside the project | Hooks read and write only the record, `.claude/board.html` and `.claude/local/` in the project Claude Code is working in. A settings path that points outside the project is refused |
| Hooks notice, they never act | A hook cannot publish a page, write the page's database or call a model. It can only add context, show a line, or hold the end of a turn at most once |
| Every browser request passes the gateway | Only allowed actions, on real cards, from the right person. No Start while a card's dependencies are open. No Done without `• Verified:` proof |
| Small token cost | The only text added is the board summary, the protocol and the owner's notes at each message, and only in projects that have a board |

## 7. Claude Code only, or any agent tool?

**The install described here is Claude Code only.** `.claude-plugin/` is Claude Code's own packaging format.

**The product is built to work with any tool.** The core (record, rules, board, event log) is plain Node and names no
agent tool (`test/harness-free.test.mjs` fails if it ever does). Everything tool-specific lives in `plugin/src/adapters/`.
Other tools would come through their own adapters, never a fork of the core.

## 8. What is tested

| Step | How |
|---|---|
| The manifests are valid | `claude plugin validate --strict` on the catalogue and on `plugin/` |
| The one command installs from GitHub, and a real session then lists and runs `/browser-agent` | Run by hand before each release, in an empty folder |
| An install carries only the product | A check counts the files in `plugin/` and scans them for anything that is not the product's |
| The welcome is shown once per project; a resumed session is silent; nothing is written in a project with no board | `test/silent.test.mjs` |
| The core names no agent tool | `test/harness-free.test.mjs` |
| Everything else: the parser, the scheduler, the gatekeeper, the hooks, the build | `npm test`, on Linux, macOS and Windows, Node 18 and 22 |
