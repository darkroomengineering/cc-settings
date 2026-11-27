# Hacker News

`hn` sends one request to the Algolia Hacker News API. Reading a poll with option IDs adds one request to its public Hacker News page. Both requests work without a login. Algolia, a third party, sees the query.

## Search

`hn search` returns stories only, in Algolia's order. Use `--sort date` for newest first. `--until` is exclusive. Without `--since` it searches all time.

Search does not drop low-scoring stories. It returns Algolia's first `--limit` matches (default 30, at most 100) whatever their points, and does not say when more matched. Weigh a story by its `engagement` (points, comments), and use `hn read` for the comments on the threads that matter.

An item's `url` is the Hacker News discussion. The linked article is `raw.url` on a search item and `raw.item.url` on a read item. An Ask HN or Tell HN text post has no linked article.

## Read

`hn read` returns the requested item first, then comments depth-first in posting order, with `raw.depth` and `raw.item.parent_id`.

`--comments` defaults to 50 and accepts up to 1000.

- Posting order is not a ranking, and Hacker News publishes no comment scores. Weigh a comment by what it says, whatever its position.
- Comments without text (deleted) are left out.
- `meta.notes` counts how many readable comments were returned out of those in Algolia's fetched tree. The tree can omit branches present on Hacker News, even when all fetched comments fit under `--comments`.

For a poll, the first item's `text` includes the results or says what is unavailable. `raw.poll.options` lists the choices in Algolia's option ID order. Each choice has `id`, `text`, and `points`. Missing labels and scores are `null`. A published zero stays zero. Choices are available even with `--comments 0`.

`raw.poll.status` is `ok` when every choice has a label and score, `partial` when some do, and `unavailable` when none do. If the page request fails, the command reports the error and keeps the Algolia thread in `items`. The command makes no retries or per-choice requests.
