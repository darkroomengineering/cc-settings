# App Store

`appstore` searches Apple's catalog by storefront (US by default). A URL supplies its country unless `--country` overrides it.

A read by ID or URL supports both iOS and Mac apps. It returns the listing first. Its `text` has price, genre, version, first release date, minimum OS, description and release notes when available. Written reviews follow (default 30), newest first. Use `--sort helpful` for helpfulness.

- The app's `engagement.ratings` counts star ratings, including ones without written reviews.
- Each review has title, body, author, UTC time, `engagement.rating`, helpful votes and `raw.version`. `raw.version` is null when Apple omits the reviewed version, including on the fallback feed.
- A name read with ambiguous matches returns `usage` with candidate listings in `items`. Rerun with the intended ID.
- A listing with no written reviews still exits 0, with a note in `meta.notes`.
- A name search with no matches exits 66.
- An ID lookup can establish absence in a storefront, not worldwide.

Apple's feeds can lag a day or two, and completeness is unknown. Cite dated customer examples. Do not estimate complaint rates or track changes in real time from them.
