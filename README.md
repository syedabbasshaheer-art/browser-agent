<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
  <img src="docs/images/logo-light.svg" alt="Agent on Browser" width="420">
</picture>

### See your project as a board in your browser. Steer your AI agent from it.

A plugin for [Claude Code](https://claude.com/claude-code) &nbsp;·&nbsp; one command to install &nbsp;·&nbsp; no server, no account, no dependencies

<br>

<img src="docs/images/demo.gif" alt="The board in use: steps arrive one by one, the agent asks a question, one press answers it, the work goes on; then the board and a card's chat" width="100%">

</div>

<br>

## An hour into a build

You asked your agent to build something. An hour later the terminal holds four hundred lines, and you are scrolling
to answer three questions:

> **What is finished? &nbsp; What is it doing right now? &nbsp; Is it waiting for me?**

The answers are in there, somewhere between a test log and a diff. Tomorrow, in a new session, they will be gone.

Agent on Browser puts those three answers on one page, and keeps them there.

| Before | After |
|---|---|
| The plan lives in a long conversation | The plan is one page: every goal and card, and what each waits on |
| You scroll to find out what happened | Each step arrives as one sentence, under its card, with the number that proves it |
| The agent's question is buried in its output | The question is at the top of the page, with answer buttons |
| You steer by typing | You move a card, press a button, or type. All three end in the same place |
| "Done" is taken on trust | A card closes only with a written line saying what was observed |

## What you get

<table>
<tr>
<td colspan="2" valign="top">

**A live feed of the work**

Every step the agent takes arrives as one sentence, filed under its card, with the number that proves it.

<img src="docs/images/live.png" alt="The Live page: what the agent is doing right now, step by step, with its question to you and the cards in play">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Everything that needs you, in one place**

The agent's questions with their answer buttons, the steps that wait for your approval, your own cards, and what is blocked. Nothing else competes for the space.

<img src="docs/images/actions.png" alt="The Actions tab: everything that needs you, each as its own card with its buttons">

</td>
<td width="50%" valign="top">

**A board that knows what is next**

Cards are sorted by what they wait on. Your cards and the agent's cards sit in separate lanes, with the hand-overs drawn between them.

<img src="docs/images/board.png" alt="The Board: your lane and the agent's lane, with done, ready and in-progress cards joined by lines">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**A conversation on every card**

Ask about a card and the answer stays with that card. A note is stored; a question is answered.

<img src="docs/images/chat.png" alt="A card's Chat tab: your question and the agent's answer as two bubbles">

</td>
<td width="50%" valign="top">

**The whole card, in plain words**

What it is, why it matters, the steps, the check, and the proof once it is done.

<img src="docs/images/card.png" alt="A card's window: what, why, steps and the done-when line">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Light and dark**

<img src="docs/images/live-dark.png" alt="The Live page in dark mode">

</td>
<td width="50%" valign="top">

**On your phone**

<p align="center">
<img src="docs/images/phone-live.png" alt="The Live page on a phone" width="45%">
&nbsp;
<img src="docs/images/phone-board.png" alt="The Board on a phone" width="45%">
</p>

</td>
</tr>
</table>

<sub>The pictures show a made-up project, a trip planner called Trailhead. Its plan is in [`examples/demo/`](examples/demo/).</sub>

## Install

**One line.** Open a terminal in your project's folder and paste:

```bash
claude plugin install browser-agent --marketplace syedabbasshaheer-art/browser-agent --scope project; claude "set up my board"
```

It installs the plugin, starts Claude Code and asks for your board. **Your board opens in your browser in about a minute**, and the plan fills in behind it. The only thing you are asked for is to accept the plan.

Nothing to restart, nothing to configure. You need [Claude Code](https://claude.com/claude-code) 2.1.275 or newer and Node 18 or newer. In the old Windows Command Prompt, write `&&` in place of `;`.

<details>
<summary><b>Already inside Claude Code?</b> &nbsp;Other ways to install</summary>

<br>

| Situation | Do this |
|---|---|
| A session is already open | Type `/plugin install browser-agent --marketplace syedabbasshaheer-art/browser-agent`, choose a scope, and it loads without a restart. Then type `/browser-agent` |
| You would rather do it in two steps | Paste the line up to the `;`, start `claude`, and type `/browser-agent` when the welcome appears |
| You want it in every project on this computer | Leave out `--scope project` |
| An older Claude Code | Two commands: `claude plugin marketplace add syedabbasshaheer-art/browser-agent`, then `claude plugin install browser-agent@browser-agent --scope project` |
| You only want to try it | `git clone` this repository, then `claude --plugin-dir <the folder>`: loaded for that one session, nothing installed |

</details>

## Start

The pasted line already asked for your board. This is what happens next, and you only watch:

```text
Setting up your board
  [x] 1  A board opens in your browser          about a minute
  [ ] 2  The agent reads your project
  [ ] 3  It writes the plan: goals and cards    a few minutes
  [ ] 4  You accept the plan on the board       the only thing it needs from you
```

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Agent as Agent (Claude Code)
    participant Page as Your page (claude.ai)
    You->>Agent: "set up my board"
    Agent->>Page: publishes a placeholder board, and opens it in your browser
    Note over Page: "Your plan is being written"
    Agent->>Agent: reads your project folder
    Agent->>Page: each step appears on the Live page
    Agent->>Page: the plan: goals, cards, what waits on what
    Agent->>Page: what it had to assume, as questions with one-click answers
    You->>Page: read the plan, press Accept plan
    Note over You,Page: Nothing starts before you accept.
```

If you installed without starting, the first session greets you with what the plugin gives and the one thing to type, `/browser-agent`. Later sessions remind you in one line until the project has a board. You never have to remember the command: "set up my board" does the same.

**One thing to know:** the page cannot do work by itself. Your requests wait until a Claude Code session is open in the project, and the page always tells you whether one is.

## What it touches

```mermaid
flowchart TB
    subgraph proj["Your project"]
        c[".cockpit/<br/>the plan, the settings, your notes<br/><i>plain text, yours to commit</i>"]
        l[".claude/<br/>the built page and a local log<br/><i>ignored by git</i>"]
    end
    subgraph home["Your home folder"]
        p["~/.claude/plugins/<br/>the plugin's own files"]
    end
    subgraph web["claude.ai, your account"]
        a["one private page<br/><i>seen by nobody unless you share it</i>"]
    end
```

- **No server and no account of its own.** It is plain files run by Node. Nothing is sent anywhere except the page you publish from your own Claude account.
- **One question to GitHub a day.** A new session reads this repository's public version number, at most once in twenty hours, to tell you when a newer version is ready. Nothing about you or your project is sent. Turn it off with the environment variable `BROWSER_AGENT_UPDATE_CHECK=off`.
- **Nothing runs at install time.** A Claude Code plugin has no install script.
- **Silent where you did not ask for it.** In a project with no board, it writes nothing.
- **It stays inside the project.** A setting that points outside the project's folder is refused.
- **Text from the page is never an instruction** unless it is your own message, sent from your own inbox.

## Update or remove

| Want to | Command |
|---|---|
| Get the newest version | `claude plugin update browser-agent@browser-agent`, then restart Claude Code. You are told when one is ready: one line when a session starts, and an "Update ready" item in the board's Inbox |
| Turn it off for a while | `claude plugin disable browser-agent@browser-agent` |
| Remove it | `claude plugin uninstall browser-agent@browser-agent --scope project` |
| Remove a project's board | Delete the project's `.cockpit/` folder, and the page from your claude.ai artifacts |

## Questions

<details>
<summary><b>Do I need to know any commands?</b></summary>
<br>
No. <code>/browser-agent</code> exists for people who like commands. "Set up my board", "show my board", "publish my board" and "what is on the board" do the same things.
</details>

<details>
<summary><b>Who can see my page?</b></summary>
<br>
Only you. It is published as a private page on your own Claude account. You can share it from the page's Share menu; a person you share it with can look, add a note or a card, and ask for a ready card to be started, and nothing else.
</details>

<details>
<summary><b>Can the agent start work by itself?</b></summary>
<br>
Only if you allow it in Settings, and then only a ready card of its own that needs no approval, with a limit on how many in a row and per day. It never approves, never marks a card Done without proof, and never starts one of your cards.
</details>

<details>
<summary><b>What does it cost?</b></summary>
<br>
Nothing beyond your normal Claude Code use. Each message to the agent carries a short summary of the board. Two optional buttons on the page, Summarise and the quick answer, ask a model from your own Claude account and are capped per hour and per day.
</details>

<details>
<summary><b>Something is not working</b></summary>
<br>

| What you see | What to do |
|---|---|
| `/browser-agent` is not in the list | The plugin is not loaded in this session. Type `/reload-plugins`, or close and reopen `claude` |
| No welcome line | The full welcome is shown once per project, then a one-line reminder in the next five new sessions. Type `/browser-agent` anyway |
| The repository cannot be found or cloned | Git on this computer is not signed in to an account that can read it. Run `gh auth login`, then try again |
| The page says no agent is running | Open `claude` in the project. Requests made on the page are applied then |
| The page looks out of date | Say "publish my board" |
| You want to start over | Delete `.cockpit/` and say "set up my board" again |

</details>

## Go deeper

| Read | For |
|---|---|
| [Installing](docs/12-install.md) | Every way to install, what each part of the plugin does, and what is tested |
| [Private and paid plugins](docs/19-private-code.md) | What a plugin's user can see, and how closed plugins are built |
| [A demo plan](examples/demo/) | The made-up project in the pictures |

<details>
<summary><b>For developers</b></summary>

<br>

```bash
npm test          # the unit tests: core rules, hooks, adapters, the build
npm run verbs     # the list of requests the page may make
```

| Path | What it is |
|---|---|
| `plugin/` | **The product: everything an install copies to your computer, and nothing else** |
| `plugin/hooks/hooks.json` | Four hooks: session start, each message, after a tool, end of turn |
| `plugin/skills/browser-agent/` | The `/browser-agent` command and the rules the agent follows |
| `plugin/src/` | `core/` (parser, scheduler, gatekeeper), `events/`, `build/` (the page), `hooks/`, `cli/`, `adapters/` |
| `plugin/templates/` | The starter plan, settings and notes a new project gets |
| `.claude-plugin/marketplace.json` | The one-entry catalogue that points at `plugin/` |
| `test/` | The unit tests |
| `docs/`, `examples/` | The install guide, the pictures and a demo plan. Not installed |

The core names no agent tool: everything specific to Claude Code lives in `plugin/src/adapters/`, so other tools can be added beside it. The folder a project gets is called `.cockpit/`, the product's first name, kept so existing boards keep working.

</details>

<br>

<div align="center">
<sub>MIT licence &nbsp;·&nbsp; plain Node, no dependencies</sub>
</div>
