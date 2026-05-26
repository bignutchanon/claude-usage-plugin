# Claude Usage Monitor

A local realtime dashboard for your Claude Code (CLI) usage, with an optional
panel that pulls org-wide spend from the Anthropic Admin API.

- Reads `~/.claude/projects/**/*.jsonl` directly — no agent, no upload.
- Watches the directory and pushes updates over Server-Sent Events.
- Computes cost from token counts using current Claude pricing.
- Plain HTML + Express. No build step.

## Run

```bash
cd ~/Projects/claude-usage-monitor
npm install
cp .env.example .env   # optional, only if you want the API panel
npm start
```

Open http://localhost:4000.

## Org-wide API panel (optional)

Create an **Admin API key** in the Anthropic console and put it in `.env`:

```
ANTHROPIC_ADMIN_KEY=sk-ant-admin01-...
```

The panel calls `/v1/organizations/usage_report/messages` for the last 30 days
in daily buckets. It is hidden when no key is configured.

## What's tracked

- **Last 5 hours / Last 7 days windows** — raw token + request counts for the
  two rolling windows Anthropic uses for Max plan rate limiting. The dashboard
  intentionally does **not** display "% of limit" because Anthropic does not
  expose plan caps to any client; you'll see absolute numbers and a countdown
  to when the oldest message in the window ages out.
- Total cost, request count, input/output/cache token totals
- Daily cost chart (last 30 days, derived from session timestamps)
- Per-model breakdown (Opus / Sonnet / Haiku)
- Top projects by spend
- Recent sessions
- Live activity feed (assistant turns as they happen)

## Pricing

Edit `lib/pricing.js` if Anthropic publishes new rates. The defaults cover
the Claude 4.x family.

## Privacy

Everything stays on this machine. The server binds to `localhost` only and
makes no outbound calls unless you set `ANTHROPIC_ADMIN_KEY`.
