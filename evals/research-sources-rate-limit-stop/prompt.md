---
tags: [research-sources]
max_turns: 10
allowed_tools: [Skill, Read, Glob, Grep]
---

I want to know what people on X and Hacker News think of Bun's new built-in SQL client this month. I already ran rsrc for both, here is what came back. You don't have a shell here, so work from these. What's next, and what do people think so far?

`rsrc x search '"Bun" SQL -filter:replies lang:en' --since 2026-11-01` exited 1:

```json
{"ok": false, "backend": "fxtwitter", "error": {"code": "rate_limited", "message": "FxTwitter search answered 429 Too Many Requests"}, "items": [], "meta": {"attempts": [{"backend": "fxtwitter", "code": "rate_limited"}], "notes": []}}
```

`rsrc hn search "Bun SQL" --since 2026-11-01` exited 0:

```json
{"ok": true, "error": null, "items": [{"id": "46120931", "url": "https://news.ycombinator.com/item?id=46120931", "title": "Bun's built-in SQL client now supports MySQL and SQLite", "author": "example_author", "published_at": "2026-11-12T16:04:00Z", "text": null, "source": "hn", "engagement": {"points": 412, "comments": 187}, "raw": {"url": "https://bun.sh/blog/bun-sql"}}, {"id": "46188410", "url": "https://news.ycombinator.com/item?id=46188410", "title": "Ask HN: Anyone moved from Drizzle to Bun.sql in production?", "author": "example_user", "published_at": "2026-11-19T09:31:00Z", "text": "We are weighing it for a new service. Pooling and migrations are what worry me.", "source": "hn", "engagement": {"points": 96, "comments": 64}, "raw": {}}], "meta": {"notes": []}}
```
