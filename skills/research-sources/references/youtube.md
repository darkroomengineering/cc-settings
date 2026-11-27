# YouTube

`youtube` runs `yt-dlp` on this machine, with no login and no key. Per question, run at most 2 `youtube search` and 5 `youtube read`.

## Search

`youtube search` takes a few seconds. It returns what YouTube's results page shows, in YouTube's relevance order and unfiltered (at most 20): title, channel, a description snippet in `text`, and views.

- Search has no likes, no transcript and no date filter. Run `youtube read` on the videos that matter.
- Treat `published_at` as an approximate calendar date derived from the displayed age, or null if unavailable. Read the video for its exact date.
- When YouTube's results omit channel names, search looks them up. `meta.notes` says how many it recovered and how many stayed unavailable.

## Read

`youtube read` takes one video and a few seconds. Pass a URL or the 11-character ID. For an ID that starts with `-`, pass the URL.

It returns views, likes and comment count, and the whole description in `raw.description`. `text` holds the transcript and nothing else, cut to `--words` words (default 5,000). Each line covers about 20 seconds and starts with the time it begins, as `[MM:SS]` (`[H:MM:SS]` from an hour on). Cite that time with a quote: `https://youtu.be/ID?t=MmSs`.

The transcript is in the language the video was spoken in. On a dubbed video, that is the audio track YouTube marks as original. It is never a translated caption track. Translate it yourself and say you did.

Exit `0` does not mean there is a transcript. Before you quote transcript words, read `raw.transcript`:

| `status` | Meaning |
|---|---|
| `ok` | Whole transcript in `text`. `source` says where it came from: `youtube-uploaded` (captions the uploader supplied), `youtube-automatic` (YouTube's speech recognition) or `local-qwen-asr` (on-device speech recognition, experimental: needs vidscribe's model already downloaded). The last two are machine recognition and get names and terms wrong. Say so when you quote them. `local-qwen-asr` is rare: it runs only for a video of at most 10 minutes with no captions at all whose language YouTube states, and it can add up to a minute and a half. `language` is the original language. |
| `partial` | Transcript present but cut off after `words` words. The same `source` and `language` rules apply. A `meta.notes` line `transcript cut to N of M words (--words)` gives the full length. Rerun with a larger `--words` (at most 40000) to read further. If `inference_truncated` is true, recognition itself stopped early and a larger `--words` will not help. |
| anything else | No transcript. `text` is `null` and the value is the reason (`original_caption_unavailable`, `ambiguous_original_language`, `media_duration_limit`, `vidscribe_missing`, …), repeated in `meta.notes`. The video's details are still valid, and the video may still contain speech. Cite the video, not its words. |

Two of the other statuses need an action:

- `incomplete_metadata` means yt-dlp printed a warning, quoted in `meta.notes`. It is usually a setup fault that repeats on every video. Run `rsrc check youtube` once and pass the result to the user.
- `source_blocked`, `timeout` and `upstream_error` come with `error` set. Act on `error.code`.

## Errors on YouTube

`upstream_error` whose message contains `age-restricted video` will not fix itself. That video needs a login, which `rsrc` never uses. Report it and do not rerun.
