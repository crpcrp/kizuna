# Jimaku subtitles

Jimaku subtitle discovery is optional and starts only when you ask Kizuna to
find subtitles for the open video. Playback, opening and closing media, and
application startup do not contact Jimaku.

## Set up

1. Create or use a Jimaku account and obtain a personal API key.
2. Open `Settings > Subtitles > Jimaku subtitle downloads`.
3. Choose `Open Jimaku account`, paste the key, and choose `Save key`.
4. Choose `Test connection` to run the read-only connection check.

Saving the key changes local settings only. Kizuna stores it through the
operating-system secret store when available. Removing the key does not remove
already-downloaded subtitles; those remain usable offline.

## Find and use a subtitle

Open a video, then choose `Subtitle > Find Japanese subtitles…`. Kizuna shows
the detected title, season, and episode when available. Edit the title,
category, or episode before choosing `Search` when the filename was ambiguous
or wrong.

`All` searches anime and live-action results. A partial-result warning names a
category that failed while keeping the results that did arrive. Select a title
to list its files. Use `Show all files` to browse unknown or mismatched names,
then choose a specific subtitle.

Kizuna never guesses between ZIP members. Select the required SRT, ASS, or SSA
member explicitly. `Timing unknown` means Kizuna could not infer an episode;
it does not change the subtitle's original timings.

After a subtitle is applied:

- `Try another` returns to the available files.
- `Revert to previous subtitles` restores the previous embedded, local, or
  downloaded selection once.
- Timing offsets are kept per downloaded content version. Reusing the same
  downloaded bytes restores that version's offset; a different version starts
  with its own offset.
- `Save subtitle as…` writes the original downloaded bytes to your chosen
  destination and does not change playback or rewrite cue timings.

## Folder hints and offline restore

After choosing a title, enable `Remember this title for this folder` only when
you want that explicit choice reused. The hint is used on the next explicit
`Find` action; it does not trigger a search on startup or while opening media.
Kizuna re-derives the episode from the current filename, so episode corrections
remain available.

Downloaded subtitles and their version offsets are restored from local history
when a video is reopened, including while offline. If a cached file is missing
or no longer parses, Kizuna keeps the video usable and falls back to its local
subtitle choices. A provider, download, parser, disk, or history error keeps
the old subtitles when possible; a history-save warning is reported separately
when the subtitle itself was loaded successfully.

## What is sent to Jimaku

The main process uses the saved key only for explicit Jimaku actions. Search
requests contain the edited title query and category; file requests contain the
selected Jimaku entry. Kizuna does not upload the video, its subtitle track, or
the full local video path to Jimaku. Downloaded subtitle bytes are kept in the
local managed cache.
