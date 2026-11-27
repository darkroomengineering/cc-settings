# X

`x read`, `x thread`, `x replies` and `x timeline` work without a login. `x search` needs the user's own X session while FxTwitter's public search is down.

X posts identify their source as `fxtwitter`, `x-graphql`, `x-browser`, `x-chrome` or `syndication`. Signed-in results expand links when X provides a destination. Syndication reads expose only likes, and they cut long posts short: then `raw.text_truncated` is true and `meta.notes` says so. Say so when you quote one, or rerun later for the full text. When both public sources confirm a missing post, the read returns `not_found`. An ID dated more than a day in the future returns `not_found` without a request.

## One post or article

`x read` accepts a post ID or a status or article URL on x.com or twitter.com. Use `x.com/HANDLE/article/POST_ID` for an article URL. If you have an `x.com/i/article/ARTICLE_ID` link, pass the post that links to the article instead.

For a post with an article from FxTwitter, `title` and `text` contain the article title and body as Markdown: headings, lists, quotes, code fences, bold and italic, links in place as `[text](URL)`, the cover and inline images as `![image](URL)`, and embedded posts as `[post: URL]`. `raw.article.links` and `raw.article.images` list the addresses. An embed FxTwitter does not resolve shows as a marker such as `[image]`. The item ID and URL identify the publishing post, and `raw.text` keeps the post text. When the source supplies a poll, `text` adds its choices and reported vote counts or percentages. `raw.text` has the post text without the result, and `raw.poll` holds the poll separately. Supplied polls on quoted posts are in `raw.quoted.poll`. The syndication fallback can report counts without percentages. For ordinary posts, `text` contains the post text.

The post's photos, videos and GIFs are in `raw.media`, with `type`, `url` and `duration` in seconds. A quoted post's media are in `raw.quoted.media`. Open every entry before you explain, summarize or quote a post.

- `photo`: download it and view it.
- `video`: if `vidscribe` is installed (optional, Apple Silicon only), run `vidscribe URL` and read the transcript. Then view frames from the video file whose path it prints (`ffmpeg -i FILE -vf fps=1/5 f%02d.jpg`).
- `gif`, or a video that vidscribe rejects for having no sound: download it and view frames from it with the same `ffmpeg` command.

Done when every entry is opened, or named in your answer as unopened with the reason.

`x search`, `x thread`, `x replies` and `x timeline` items carry the same `raw.media`.

## One self-thread

`rsrc x thread URL_OR_ID` takes the status URL or ID of any post in a self-thread. FxTwitter returns the author's posts starting with the first one, in the same item format as `x read`. A standalone post returns one item with a note in `meta.notes`. When FxTwitter has no thread for the ID, the command spends up to four more requests, the ones `x read` makes, to tell a missing post (`not_found`) from a FxTwitter failure (`upstream_error`).

FxTwitter can cut long threads short without warning. `meta.notes` gives the number returned and flags a likely cut when first lines carry consistent counters like `(1/6)` that indicate more posts. To check for more, run `rsrc x replies LAST_POST_ID --rank recency` on the last returned post and look for replies by the same author.

## One account

`x timeline` takes a handle, `@handle` or an x.com account URL. It returns the account first, then its timeline: posts, reposts and its replies to itself, newest first.

- On the account item, `title` is the display name, `text` the bio and `published_at` the join date. `engagement` has `followers`, `following` and `posts`. `raw` has `location`, `website` and `verification`.
- A repost sits where the account reposted it and keeps the original post's date. Its `author` is the account that wrote it, and the reposting handle is in `raw.reposted_by`.
- When `meta.notes` says none of the posts is by the handle, there is no account item.

Timeline follows the search order below. Without an explicit backend, a single route that fails setup before making a request can fall back to FxTwitter. Override the route with `--backend`, or set `--max-requests` (1 to 5, including the account lookup). The browser timeline needs at least three requests: navigation, account lookup and the feed. `--limit` counts posts, up to 200. Check `meta.truncated`.

For posts on one topic, replies to others or a date range, use `rsrc x search 'from:HANDLE …' --since YYYY-MM-DD`.

FxTwitter's timeline also answers 404 for real accounts. Its `upstream_error` cannot establish that the account is missing.

## Which backend answers a search

Read `backend`, `meta.attempts` and `meta.notes` to see what answered or failed.

If `x search` or `x timeline` stops at its request cap, the CLI puts a `warning` before `items` and prints it on stderr. Report that the results are partial and give the returned post count, even if `ok` is true. Zero posts on a capped run does not establish that none matched. A limit is a maximum, not a count of all matches.

- With a Chrome connection, `x search` and `x timeline` use `x-chrome`.
- Without a Chrome connection or a search order, a configured cookie pair selects `x-graphql`. With neither cookie, search uses public `fxtwitter`, a third party that sees the query. A partial pair is `config`.
- The cookie pair belongs only in the mode-600 `~/.config/rsrc/x.env` file, never in exported environment variables. rsrc reads `AUTH_TOKEN` and `CT0` from the environment first, so values exported for another tool would be sent to x.com as cookies or break default search. Run every X command as `env -u AUTH_TOKEN -u CT0 rsrc x …`, so rsrc reads only `x.env`. The examples below leave the prefix out.
- When public search fails and the user has already signed in to X in Ego Lite, use `rsrc x search --backend x-browser "Claude Code" --limit 10`. It searches inside that browser without exporting cookies. It needs at least two requests and runs one browser X command at a time. The user can set `RSRC_X_SEARCH=x-browser` to make it the default. Select it alone.
- Otherwise the user's `RSRC_X_SEARCH` can order FxTwitter and x-graphql. Only upstream and network errors permit fallback, within the shared request cap.

The Google Chrome route is experimental, because X can refuse a first sign-in in the dedicated window. Suggest it only when the user has no Ego Lite and no cookie pair. To set it up, the user runs `rsrc x connect` and signs in to X in the dedicated window. Never run it for them. `rsrc x search` and `rsrc x timeline` then reopen the dedicated browser if needed. The Chrome that `rsrc x connect` manages keeps an unauthenticated loopback debug port open until the user quits it, so the user should use that window only for X. Never suggest `rsrc x connect --cdp` against the user's everyday Chrome. `rsrc check x` checks the local endpoint without trying an X login.

Stop on authentication errors, verification pages and rate limits. If X hands a verification page to the user, pass on the message.

## Sentiment loop

Keep signed-in volume low. Per question, use one windowed Latest search and at most one Top pass (default 25 requests each).

1. **Search the whole period in windows.** Use `--limit N` for a total across windows. Each window defaults to that limit, or 20 without it. Set a smaller `--per-window` to sample more windows. On success with fewer than N posts, check `meta.notes` for the reason.
   ```
   rsrc x search '"Claude Code" Codex -filter:replies lang:en' --since 2026-10-06 --per-window 20
   ```
   `--since` splits the range into 7-day windows (`--window-days`), newest first, ending today unless `--until` is given. When Latest is thin or noisy, run one `--top` pass with the same query and the same `--since` and `--until`. It is a separate command with its own `--max-requests` budget, and it returns higher-engagement posts.
2. **Sort the signal.** A post is an opinion only when it states a view or an experience. Announcements, release bots, link roundups, giveaways and bare "which is better?" questions are context.
3. **Expand the conversations that matter.** Replies carry most of the disagreement. `x replies` returns direct replies only, ranked by likes (`--rank recency` for newest), up to `--limit`.
4. **Quote from tool output only.**

Done when every claim traces to a post URL from `items`, and each window searched is represented or noted as empty.

Query operators pass through to X: `"exact phrase"`, `from:`, `to:`, `@handle`, `filter:replies`, `-filter:replies`, `min_faves:10`, `min_replies:5`, `min_retweets:5`, `lang:en`, `url:github.com`, `A OR B`, `-word`.

Give dates only through `--since` and `--until` (YYYY-MM-DD, UTC). `--until` is exclusive, so `--until 2026-11-01` covers October 31. A query that combines date flags with `since:` or `until:` returns `usage`.

## Errors on X

- `auth_failed`: for `x-graphql`, ask the user to refresh the cookie pair. For `x-browser`, ask the user to check the signed-in X session in Ego Lite. For `x-chrome`, ask the user to check it in the connected Chrome profile.
- `upstream_error` or `network_error` on `x search`: after the one rerun, try the other backend with `--backend` only if it is absent from `meta.attempts`. If every SearchTimeline query ID was rejected, stop using that backend and pass the user the printed fix.
- `config` that says another browser X command is running: wait for it to finish and rerun.
