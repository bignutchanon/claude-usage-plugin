# Security & Privacy

This project is **local-first**. The goal is that you can `git clone`, run
`./scripts/install.sh`, and trust that nothing leaves your Mac except what's
documented here.

## What goes where

| Direction | Endpoint | Purpose | Triggered by |
|---|---|---|---|
| **outbound HTTPS** | `https://claude.ai/api/organizations/{org}/usage` | Reads your Max plan 5-hour / 7-day utilization. Uses your `sessionKey` cookie. | Server polls every 30 s |
| **outbound HTTPS** | `https://claude.ai/api/organizations/{org}` | One-shot validation when you submit credentials in the setup wizard. | `POST /api/setup/save` |
| **outbound HTTPS** | `https://api.anthropic.com/v1/organizations/usage_report/messages` | Org-wide paid API usage report. **OFF by default** — only fires if you set `ANTHROPIC_ADMIN_KEY` in `.env`. | `GET /api/usage/api` |
| **inbound HTTP** | `http://127.0.0.1:4000` | Dashboard + widget + setup wizard. Bound to localhost only — no LAN access. | Your browser / SwiftBar |
| **filesystem read** | `~/.claude/projects/**/*.jsonl` | Reconstructs your lifetime token / cost ledger from Claude Code session logs. Streamed line-by-line, never uploaded. | chokidar watcher |
| **filesystem write** | `~/Library/Logs/claude-usage-plugin{,.error}.log` | launchd stdout / stderr. May contain timestamps and error messages — never the `sessionKey`. | launchd |
| **Keychain write** | service `claude-usage-monitor` | Your `sessionKey` + `orgId` + optional fingerprint headers. ACL-scoped to your user account. | Setup wizard |

That's the complete network and storage surface. Verify yourself:

```bash
# what's the server's outbound socket activity right now?
lsof -p $(lsof -ti:4000 | head -1) -a -nP -iTCP | grep -v 127.0.0.1
# (you should see only connections to claude.ai or api.anthropic.com)
```

## What's NOT in here

- No telemetry, no analytics, no error-reporting service (no Sentry, no
  Datadog, nothing).
- No third-party CDNs at runtime. Google Fonts and Chart.js are vendored into
  `public/vendor/` and served from `127.0.0.1`.
- No background uploaders, no "phone home" on update check.
- No remote-control endpoints. The server only accepts requests from itself.

## Where the `sessionKey` lives

The `sessionKey` is treated as a password. It exists in exactly these places:

1. **macOS Keychain**, service name `claude-usage-monitor`, account
   `sessionKey`. Inspect with:
   ```bash
   security find-generic-password -s claude-usage-monitor -a sessionKey
   ```
2. **In RAM** of the Node server process while it's running (when it makes
   the request to `claude.ai`).
3. **In the `Cookie:` header** of the HTTPS request to `claude.ai` (TLS
   protects this in transit).

It is **never**:

- Written to disk in plaintext (no `.env`, no log file, no cache file)
- Sent to the browser (`/api/limits` returns the utilization numbers, not the
  cookie)
- Sent to any host other than `claude.ai`
- Echoed in error messages

## Threat model

| Threat | Mitigation |
|---|---|
| Someone on your wifi reads your usage | Server binds `127.0.0.1` only; LAN connections refused |
| A malicious npm dependency exfiltrates credentials | We use 3 runtime deps (`express`, `chokidar`, `dotenv`), version-pinned. Run `npm audit` periodically. |
| A page on `claude.ai` reads our local server via CORS | Server has no CORS headers; browser blocks cross-origin reads |
| Someone with shell access on your Mac grabs the cookie | Keychain entries are user-scoped; an attacker with your user shell already wins anyway |
| A stale cookie value sits in shell history | We never echo the cookie. The wizard receives it via HTTPS POST body. |

## Rotating credentials

If you think your `sessionKey` may have leaked (committed it, pasted it
somewhere, mentioned it in a chat):

1. Open <https://claude.ai/settings/account>
2. **Log out of all sessions**
3. Sign back in
4. Open <http://127.0.0.1:4000/setup> and paste the new cookie

The old cookie becomes invalid the moment you log out everywhere.

## Reporting issues

Please open an issue at
<https://github.com/bignutchanon/claude-usage-plugin/issues>. For anything
security-sensitive, contact the maintainer privately first.
