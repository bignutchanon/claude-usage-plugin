# claude-usage-plugin

A local-first dashboard + macOS menu-bar widget that tracks your Claude usage in
realtime — both your **Max plan rate-limit windows** (5-hour / 7-day) and a
**lifetime ledger** reconstructed from your local Claude Code session logs.

- All data stays on your Mac. The server binds to `127.0.0.1` only.
- The only outbound HTTP is to `claude.ai` for the rate-limit endpoint.
- Credentials are stored in the **macOS Keychain**, not on disk.

```
┌──────────── menu bar ─────────────┐    ┌────────── dashboard ───────────┐
│  ✱ 5h:47% 7d:76%                  │    │  CASE 52E99C7C / MOST WATCHED  │
│  ────────────────                 │    │                                │
│  [+] LINK ESTABLISHED             │    │   5H  ████████░░░░ 47%         │
│  > RATE_LIMITS                    │    │   7D  ████████████ 76%         │
│  > PAYLOAD_LOG                    │    │                                │
│  > PROC_STATS                     │    │   $26,019  ·  42.7K requests   │
│  > EXEC ▸ ...                     │    │   in 113K · out 44.3M tokens   │
└────────────────────────────────────┘    └────────────────────────────────┘
```

## Install

Requires macOS, [Node.js 20+](https://nodejs.org), and (for the menu-bar widget)
[SwiftBar](https://github.com/swiftbar/SwiftBar):

```bash
brew install node
brew install --cask swiftbar
```

Then clone and run the installer:

```bash
git clone https://github.com/bignutchanon/claude-usage-plugin.git
cd claude-usage-plugin
./scripts/install.sh
```

This will:

1. Install npm deps
2. Render a launchd plist for your user + paths and bootstrap it (so the
   server auto-starts on login)
3. Point SwiftBar at this repo's `menubar/` folder
4. Open the dashboard at <http://127.0.0.1:4000>

The first time you open the dashboard you'll be redirected to **`/setup`** —
follow the 4-step wizard there. You'll need to paste your `sessionKey` cookie
from `claude.ai` once; after that, it's in your Keychain and you never see it
again.

## How to get your `sessionKey`

1. Open <https://claude.ai> in your browser and sign in.
2. Open DevTools (Cmd + Option + I).
3. **Application** tab → **Cookies** → `https://claude.ai`.
4. Find the row named `sessionKey` and copy its full value (it starts with
   `sk-ant-sid01-`).
5. Paste into the wizard at <http://127.0.0.1:4000/setup>.

The wizard tests the cookie against `claude.ai` *before* saving — if it
doesn't work, you'll know immediately.

> **`sessionKey` is equivalent to a password.** Anyone with it can act as
> you on `claude.ai`. Never commit it, never share it, never paste it into
> Discord. If it leaks, log out of all sessions on `claude.ai` and grab a
> fresh one.

## What it tracks

| Section | Source | Refresh |
|---|---|---|
| **5-hour window** utilization | `claude.ai/api/organizations/{org}/usage` | every 30s |
| **7-day window** utilization | same endpoint | every 30s |
| **Lifetime ledger** (cost, tokens, requests) | `~/.claude/projects/**/*.jsonl` parsed line by line | watched, sub-second |
| **Per-model cost share** | same JSONL parse | sub-second |
| **Recent sessions / activity feed** | same | sub-second |

The menu-bar widget polls the dashboard every 5 seconds, so it reflects the
same state with at most 5 seconds of lag.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Mac (everything below runs on YOUR machine)                        │
│                                                                     │
│   ~/.claude/projects/**/*.jsonl                                     │
│        │  (chokidar watches, line-by-line stream parse)             │
│        ▼                                                            │
│   Express server (server.js)                                        │
│        │   ─ binds 127.0.0.1:4000 only                              │
│        │   ─ reads sessionKey from Keychain                         │
│        │   ─ polls claude.ai every 30s                              │
│        │   ─ broadcasts SSE on /api/stream                          │
│        │                                                            │
│        ├──→ public/ (vendored fonts + Chart.js, no CDNs)            │
│        │       served at http://127.0.0.1:4000                      │
│        │                                                            │
│        ├──→ /api/limits      (5h / 7d utilization)                  │
│        ├──→ /api/usage/local (lifetime aggregate)                   │
│        ├──→ /api/stream      (SSE live updates)                     │
│        └──→ /api/setup/*     (wizard endpoints)                     │
│                                                                     │
│   menubar/claude-usage.5s.sh  ←──── SwiftBar runs every 5s          │
│        │                                                            │
│        └─→ menubar/lib/render.js  fetches /api/limits + renders     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
       │                                          ▲
       │ outbound (claude.ai only)                │ no inbound from
       ▼                                          │ outside this Mac
┌──────────────────┐
│  claude.ai/api/  │
└──────────────────┘
```

## File map

```
claude-usage-plugin/
├── server.js                      Express server, SSE, setup endpoints
├── lib/
│   ├── parser.js                  JSONL → aggregated usage (streaming)
│   ├── pricing.js                 per-model $/token tables
│   ├── claude-ai.js               unofficial claude.ai client
│   ├── api-usage.js               (optional) Anthropic Admin API client
│   └── keychain.js                read/write secrets via `security` CLI
├── public/
│   ├── index.html                 dashboard (hacker / phosphor theme)
│   ├── app.js                     dashboard logic + SSE subscription
│   ├── styles.css                 dashboard styles
│   ├── setup/                     first-run wizard (paste cookie, validate)
│   └── vendor/                    Google Fonts + Chart.js (vendored, no CDNs)
├── menubar/
│   ├── claude-usage.5s.sh         SwiftBar wrapper (5-second polling)
│   └── lib/render.js              menu rendering logic
└── scripts/
    ├── install.sh                 detect node, render plist, bootstrap
    ├── uninstall.sh               stop service, remove plist, forget Keychain
    └── launchd.plist.template     templated LaunchAgent
```

## Uninstall

```bash
./scripts/uninstall.sh
```

This stops the LaunchAgent, removes the plist, and forgets the Keychain
credentials. The repo and `node_modules/` stay so you can re-install later.
To fully remove, also delete the folder.

## Security

See [`SECURITY.md`](SECURITY.md) for a full network-egress audit, where the
`sessionKey` lives, and how to verify with `lsof`.

## Troubleshooting

| Symptom | Try |
|---|---|
| Dashboard shows "STREAM RECONNECTING" forever | Server not running — `launchctl kickstart -k gui/$(id -u)/dev.claude-usage-plugin` |
| Menu bar empty / shows OFFLINE | Same — also check `tail -f ~/Library/Logs/claude-usage-plugin.log` |
| Wizard says "sessionKey invalid" | Cookie expired. Log out of `claude.ai` and back in, then re-paste. |
| Want to switch accounts | `/setup` page works any time; click the form and submit a new cookie. Or `./scripts/uninstall.sh` then re-install. |

## License

MIT.
