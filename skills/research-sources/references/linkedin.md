# LinkedIn

`rsrc linkedin read URL` reads a public post permalink or feed update URL. It works without setup and makes one logged-out HTTPS request. LinkedIn's terms restrict automated access. Never switch to a signed-in route.

Item one contains the post text and available counts. Later items are public comments.

- Quote the page's `published_at` when present.
- Check `meta.notes` for a missing publication time and for the number of comments returned out of the reported total.
- Video transcripts and durations, when supplied, are in `raw`.
- Media links from the public page are in `raw` when supplied. Use `raw.image.url` for a post image and `raw.contentUrl`, `raw.embedUrl`, `raw.thumbnailUrl`, and `raw.caption.contentUrl` for video media. Signed links can expire.

## Errors on LinkedIn

- `usage`: check the post address.
- `not_found`: report that LinkedIn has no public post with that ID. The post is missing or not public.
- `url_mismatch`: discard the answer and verify the address.
- `blocked`, `rate_limited` or `auth_failed`: stop LinkedIn access for the session and wait.
- `network_error` or `upstream_error`: report the read failure.
