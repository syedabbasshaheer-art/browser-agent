# Private and paid plugins: what a plugin's user can see

A plugin is installed from a repository. Can its code be hidden? How are closed, paid or enterprise plugins made?
This page answers both, for anyone building a plugin, and says which choice this project made.

## 1. The one fact everything follows from

**A plugin is files copied onto the user's computer.** Whatever is in the plugin (the hooks, the command's
instructions, every script) sits in `~/.claude/plugins/cache/` in plain text, and the user can open it. This is true
of every Claude Code plugin, of every npm package, and of every browser extension. Code that runs on someone's
machine can be read on that machine.

So there are only two real choices: **control who may get the files**, or **do not ship the valuable part at all**.

## 2. Does a plugin need GitHub?

No. GitHub is one of several places a catalogue can live.

| Where the catalogue or plugin can come from | Who can install |
|---|---|
| A public GitHub repository | Anyone, no account needed |
| A private GitHub repository | Only accounts given access, with git signed in on that computer |
| A git repository on any host (GitLab, a company server) | Whoever that host lets in |
| A catalogue file at a web address | Whoever can fetch that address |
| An npm package, public or from a private registry | Whoever the registry lets in |
| A folder on disk | Whoever has the folder |
| A company's managed settings | Every employee, installed for them, with other catalogues blocked if the company wants |

## 3. The four ways it is done

| Way | How it works | What it protects | What it costs | Who uses it |
|---|---|---|---|---|
| **A. Private repository** | The repository stays private; you add each user as a collaborator, or use an organization with teams | Strangers cannot get the files | Every user needs a GitHub account and your invitation. A user who has the files can still read and copy them | Companies sharing internal plugins; small paid betas |
| **B. Thin plugin, hosted service** | The plugin holds almost nothing: a few instructions and the address of a server you run (an MCP server over HTTPS, with a sign-in or a key). The real logic runs on your server | The logic itself: it never leaves your server. Access can be sold, limited and switched off per user | You run a server, accounts and billing. The user's data travels to you, so you owe them privacy and uptime | Almost every commercial plugin: Figma, Vercel, Linear, Notion, Slack. Their plugins are small and open; their product is the service |
| **C. Bundled or compiled code** | Ship one minified file, or a compiled program, in place of readable source | Casual reading only | Harder to debug and to trust. A determined person still unpacks it. Users are right to be wary of a plugin they cannot read, since its hooks run on their machine | Some command-line tools. Rare for plugins |
| **D. A licence, not a lock** | The source stays readable, and a licence says what may be done with it: open (MIT), or "source available" (free to use, not to resell or host as a competing service) | Your legal position, not the text | Enforcement is by law, not by technology | Many developer tools: the code is public, the business is the hosted or supported version |

There is no fifth way. A licence key checked by code on the user's machine is way C: whoever can read the check can
remove it. A key is only real when a server checks it, which is way B.

## 4. The choice this project made

Agent on Browser is open source under the MIT licence (way D, with nothing held back). Everything runs on your own
computer: the parser, the rules, the page builder, the hooks. There is no server, and nothing is sent anywhere except
the page you publish from your own account. That is why it costs nothing to run, and why every user can read all of it.

The repository holds the product, its tests and its user documents. An install copies only the `plugin/` folder.

## 5. What must never be in the repository, whatever is chosen

| Never ship | Why |
|---|---|
| Keys, tokens, passwords | A plugin's files are readable by every user, and a public repository by everyone, forever (history keeps them) |
| A user's board link or project data | Each project's link and plan live in that project, not in the plugin. The templates carry a placeholder only |
| Anything that is not the product | An install should carry the product and nothing else. Here, a check before each release counts the files in `plugin/` and scans them |
