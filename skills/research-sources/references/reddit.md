# Reddit

`reddit` loads real reddit.com pages in a background tab of the user's own Ego Lite browser. Ego Lite must be running, and only the user opens it or signs in to it. The commands act as the Reddit account signed in to Ego Lite when there is one, so keep volume low: per question, at most 3 searches and 5 thread reads.

Cite thread or comment URLs from `items` only. A comment's `url` is its permalink.

## Search

Search returns what Reddit's own search page shows: title, a snippet, score and comment count. It does not return full post bodies. Use `reddit read` for the full thread. Reddit can hide a score.

For opinions from the leading search results, put `--with-comments` after the query. It spends one thread read on each of the first N hits (default 3, allowed 1 to 5), and the thread pages start together.

- Each search post (`raw.kind: post`) precedes up to three readable top-level comments (`raw.kind: comment`) in Reddit's Best order. Match `raw.attrs.postid` to the post ID.
- A pinned comment is skipped and named in `meta.notes`.
- When fewer than three comments are readable, quote the per-thread reason in `meta.notes`: all comments accounted for, or completeness unconfirmed at the 15 s deadline.
- Check `meta.failed` for missing comment groups even on exit 0. If every selected thread fails, the first error is returned.
- A block, login wall or rate limit ends the batch with exit 1. All search posts and fully read comment groups remain in search order. Check `meta.notes` for the number of thread pages already requested and `meta.attempts` for cancelled reads. Then stop Reddit access for the session.

For handpicked threads, search first and use `reddit read` on your choices.

## Read

`read` returns the post first, then comments in page order with `raw.attrs.depth` and `raw.attrs.parentid`. Post and comment `text` is Markdown that keeps link addresses, images, lists, quotes, code and tables. A post's gallery images, image, video or link address comes first in its `text`, as `![image](URL)`, `[video](URL)` or `[link](URL)`. Replies that Reddit folded behind "more replies" are not included. A pinned comment is kept, marked `raw.pinned: true`.

Pass a comment's `url` to read the post, the linked comment, and its visible ancestors and replies. The linked comment has `raw.linked: true`, its ID is in `input.comment_id`, and `meta.notes` names the focus. `--comments` counts the linked comment. With `--comments 0`, the post and linked comment are still returned.

A missing or removed linked comment returns `not_found`, and one that had not rendered within 15 s returns `timeout`. Both keep the post in `items`. A post/comment mismatch returns `url_mismatch`.

A share link (`reddit.com/r/…/s/…`) costs one extra request, which finds the post it leads to. When that request fails with `upstream_error`, ask the user to open the link and give you the `/comments/` URL it lands on.

Missing threads return `not_found`. Private or banned communities and login walls return `blocked`. A removed thread can still have a post record. Check `meta.notes` for the removal notice.

## Archive reads without Ego Lite

When `ego-browser` is not installed, `reddit read` answers from the public Arctic Shift archive (`backend: arctic-shift`). Search and share links then return `config` or `usage`. `--backend arctic-shift` selects the archive on any machine and sends nothing to Reddit.

An archive answer is a snapshot. Before you quote a score or comment count, read `meta.notes` for the capture time and say the figure is as of then.

- Comments are ranked by archived score, and at most 200 are fetched. The notes say how many the archive supplied against the post's count.
- A comment permalink returns the post, the linked comment, and its archived replies. An empty branch can cost one extra request to check where the comment belongs.
- Deleted or removed items appear as `[deleted]` or `[removed]`.
- A reply whose parent is outside the fetched tree has a null `raw.attrs.depth`.
- Only `--sort top` is accepted.
- `not_found` means the archive has no such post or comment.
- For an `/s/` link, get the `/comments/` URL or post ID first.
- `rate_limited` stops archive reads for the session.

## Errors on Reddit

- `upstream_error` whose message contains `markup may have changed` will not fix itself. Report it and do not rerun.
- `upstream_error` whose message contains `is Ego Lite running?` or `ego-browser exited`: ask the user to open Ego Lite.
