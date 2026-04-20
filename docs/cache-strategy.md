# Cache Strategy

> KV-cache hit rates depend on prompt prefix stability. Claude Code handles ordering automatically — this doc explains why, for anyone writing custom prompts or skill content.

## Prefix Ordering

For maximum prefix cache reuse:

1. **Stable elements first** — system prompt, tool definitions, AGENTS.md rules
2. **Semi-stable next** — skill content, project context, loaded rules
3. **Dynamic elements last** — user messages, tool outputs, timestamps

Placing dynamic content (timestamps, user-specific data) early in context invalidates the cache prefix for everything after it.

## TTL

- Default: 5 minutes.
- `ENABLE_PROMPT_CACHING_1H=1` → 1 hour. Available on API key, Bedrock, Vertex, Foundry. Set in `settings.json`.
- `FORCE_PROMPT_CACHING_5M=1` → override back to 5 minutes.
- `DISABLE_PROMPT_CACHING=1` → disable entirely (warns at startup).

## Session Wake-Up Budget

When a background agent sleeps:

- **< 5 min (60-270s)** — cache stays warm. Use for active polling.
- **5 min-1 hour (300s-3600s)** — pay the cache miss. Use when there's no point checking sooner.
- **Avoid 300s exactly** — worst of both: cache miss without amortizing it. Pick 270s (warm) or 1200s+ (long wait).

Default for idle ticks with no specific signal: **1200-1800s** (20-30 min).

## See Also

- [Anthropic prompt caching docs](https://docs.anthropic.com/en/docs/prompt-caching)
- `settings.json` → `env.ENABLE_PROMPT_CACHING_1H`
