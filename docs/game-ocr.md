# Game OCR (experimental, Windows only)

Game OCR freezes the game display, recognizes the Japanese text on it, and
replaces each detected text region with an interactive box that behaves like a
subtitle line: hover or click a word for the dictionary popup, select text and
copy it, right-click a selection for a translation.

This document is the working reference for the feature while it is
experimental. It is deliberately not linked from the README yet; the workflow,
the surfaces, and the limitations below are expected to change.

Related documents: [codebase map](codebase-map.md) for file ownership,
[architecture](architecture-plan.md) for the process and window boundaries,
[runtime binaries](binaries.md) for the bundled PP-OCR / ONNX Runtime payload, and
[licensing](licensing.md) for redistribution terms.

## Status and scope

- **Windows only.** There is no Linux or macOS implementation, and none is
  planned as part of this feature. The renderer surface, the capture service,
  and the frozen-frame window all refuse to run on any other platform, and the
  Options tab is hidden there.
- **Experimental.** Every surface may change or be withdrawn.
- The supported expectation is a **borderless or windowed** game. See
  [Limitations](#limitations).

## Using it

1. Open **Options → Game OCR** and press **Start** (or use **Settings → Start
   Game OCR** in the menu bar). Kizuna registers the configured global
   shortcut, starts the local PP-OCR worker, hides its own window, and
   leaves a tray icon behind.
2. Move the mouse onto the display showing the game and press the shortcut
   (**Ctrl+Shift+O** by default; rebind it in the same tab).
3. Kizuna freezes **the whole display containing the mouse pointer** and
   immediately covers that display with the frozen frame. The screenshot
   appears before recognition starts, so the frame the user sees is exactly the
   frame being read.
4. A small **"Recognizing text…"** sign sits at a fixed inset in the
   screenshot's bottom-right corner. It is visible only while OCR is running
   and disappears when the boxes appear.
5. Bordered text boxes appear over the original text locations. Nearby boxes
   are separated by a small deterministic pass, so two lines of game text never
   land on top of each other.

### Inside a frozen frame

| Action | Result |
|---|---|
| Hover or click a word | The usual dictionary popup, with knowledge coloring and Anki mining |
| Click inside a box | Native text selection; **Ctrl+C** copies it |
| Right-click a selection | Translation popup, when experimental translation is enabled |
| Press the screenshot background | Closes the whole frozen frame — screenshot, boxes, popups, and selection — revealing the live game. One press is enough: the frame ends on pointer-down, not on the click it would become. A press that started on a box or popup is a selection drag, not a close, and a right-click closes nothing |
| Escape | The same, and Game OCR stays armed. Registered as a global shortcut for exactly as long as a frame is visible (see below), so it is the game's own Escape again the moment the frame closes |
| Press the shortcut again | Recapture (see below) |

Mining a word from a frozen frame uses the existing **text-only** Anki path.
Game OCR adds no screenshot, audio, or timestamp to a card.

### Recapture

Pressing the shortcut while a frozen frame is open must never re-read Kizuna's
own screenshot. The frozen-frame window is marked with Electron content
protection, which maps to `WDA_EXCLUDEFROMCAPTURE` on current Windows. Desktop
capture therefore sees the game beneath the overlay, even while the previous
screenshot and its boxes remain visible. The coordinator:

1. invalidates the old session and drops its boxes, popups, and selection;
2. captures the game directly while leaving the old canvas visible;
3. moves the retained window when necessary and replaces that canvas in place;
4. starts PNG encoding and OCR as soon as the new pixels are drawn; and
5. accepts OCR, tokenization, lookup, and translation results only for the new
   session ID.

There is no native hide event, compositor delay, fresh-frame callback, or stream
reopen on the shortcut path. If recapture fails, the overlay is hidden and the
live game remains visible.

### One retained window

Every capture in an armed run is served by the same frozen-frame window. A
frame ends by dropping its screenshot and boxes and hiding, not by destroying
the window, so only the first capture of a run pays for a renderer boot — every
later frame appears as soon as the screenshot is taken. The window is destroyed
only when Game OCR stops, when a display change invalidates its placement, or
when its renderer becomes unusable; the next capture then builds a replacement.

Because the renderer outlives each frame, it re-reads the player's popup,
theme, and translation preferences for every screenshot, and clears any leftover
text selection at each frame boundary. The dictionary and knowledge caches it
built are deliberately kept: they are what makes a second frame's lookups
faster than the first's.

### The frame never takes focus

The frozen-frame window is created `focusable: false`, so Windows never
activates it and the game keeps the foreground the whole time a frame is up.

That is not a preference. Windows refuses a cross-process foreground steal, and
Electron does not report the refusal: measured against an external application
holding the foreground, it kept the real foreground window for the entire time
the frame was shown while Electron's own `isFocused()` returned `true`. A window
the system has not activated spends the user's first mouse press on activation
rather than delivering it to the page — which is why dismissing a frame took two
presses, and why moving the dismissal from `click` to pointer-down did not help.
Never activating means there is no activation press to spend. It also means the
game keeps rendering behind the frame instead of stalling until it is clicked
back.

Not activating has a second consequence that has to be handled explicitly:
always-on-top is a *band*, not a position, and inside it Windows orders by
which window was activated most recently. A window that never activates
therefore loses to a game that is itself topmost — the frame is shown, behind
the game, and nothing appears to happen at all while OCR runs normally on a
correct screenshot. The frame is put in the higher `screen-saver` band and
raised with `moveTop`, neither of which asks for focus.

The cost is that the page has no keyboard focus and therefore receives no key
events. **Escape** and **Ctrl+C** are registered as global shortcuts for exactly
as long as a frame is visible, and released the moment it goes; Ctrl+C asks the
frame to put its current text selection on the clipboard, and does nothing when
nothing is selected. If another application already owns one of them the
conflict is reported and the frame stays usable — a background press still
closes it, and the box text is still selectable.

### Capture latency

Everything between the hotkey and the visible screenshot is latency the user
feels, so the screenshot is not taken on demand at all.

**The frozen frame holds an open desktop capture stream** for the display it
covers, for as long as Game OCR is armed and its window is retained. A capture
is then one `drawImage` from a frame the renderer already has. The expensive
setup — enumerating capture sources, opening the stream — is paid on the first
capture for a display and reused afterwards.

Measured on a 2560×1440 display, Ryzen 7 5800X3D:

| Step | On demand (old) | From the stream |
|---|---:|---:|
| getting the pixels | ~300 ms | 12–44 ms |
| encoding them | 85 ms | ~25 ms, *after* the frame is shown |
| base64, IPC | under 1 ms | binary IPC after presentation; base64 only at worker stdin |

`desktopCapturer.getSources` was ~75% of the old path and none of it was
recoverable: it charges roughly the same ~300 ms whether the requested
thumbnail is 1×1 or the full display, and it does not warm up, so calling it
early to prime the pipeline only pays it twice. It is still used once per armed
run — with a 1×1 thumbnail, for source ids only. The current display target is
also cached while the pointer remains inside its bounds, avoiding Electron's
display lookup on the hot path. A warm target is returned synchronously, so the
freeze IPC reaches the renderer before the global-shortcut callback yields to
Electron. Only real source enumeration uses a Promise. Both caches are cleared
when Game OCR stops or the application shuts down; neither contains screenshot
pixels.

The screenshot no longer crosses IPC to be displayed. The renderer draws into
its own canvas and shows it; the PNG the OCR worker needs is encoded afterwards
and sent to the main process then, so nothing the user is looking at a blank
display for sits behind an encode.

The encoded PNG crosses renderer IPC as bytes. It is converted to base64 only
at the PP-OCR sidecar's JSONL protocol boundary, immediately before the stdin
write. Main drops its byte and base64 references before waiting for inference,
so a full-resolution screenshot is not retained for the worker's 2–3 second
recognition time.

Three ordering properties this relies on:

- **The native overlay is excluded from desktop capture.** Self-capture safety
  is a property of the window, not an inference from delayed hide events or
  compositor timing.
- **The previous canvas stays visible until `drawImage` replaces it.** The old
  boxes are removed at the freeze boundary, so recapture neither flashes a
  blank overlay nor mixes text from two sessions.
- **Main registers the screenshot-byte waiter before requesting the draw.** PNG
  encoding still starts after the pixels are displayed, but a fast encode can
  no longer arrive before main is ready to hand it to the OCR worker.

The stream runs continuously while Game OCR is armed. It is local, like the
rest of the feature, and stops with the window.

Outside-click dismissal sends the main-process close request first. Main issues
the native `hide()` immediately and lets renderer state, selection, and pending
lookup cleanup finish afterwards. It never waits for Electron's `hide` event,
which can lag the visible transition by seconds on Windows.

Development runs log the complete shortcut-to-word-box time after the renderer
acknowledges a browser paint. The historical `dismiss`, `queue`, and `settle`
fields remain, but are no longer work stages: dismissal and settle are zero,
while queue measures only synchronous shortcut dispatch into capture and should
also be effectively zero. Capture, presentation, recognition, and rendering
remain real stage costs.
The capture field is split further into `cursor`, `display`, `source`, and
`event-loop`: `display` is zero on a cached target, `source` says whether ids
were cached or enumerated, and `event-loop` exposes time lost between the
adapter's measured work and the controller continuation. The accompanying
`target cached/resolved` label makes warm and cold paths distinguishable. Warm
targets do not cross an asynchronous boundary, so their `event-loop` remainder
should stay effectively zero; cold source enumeration can still yield.
`KIZUNA_GAME_OCR_TIMING=1` additionally enables the frozen frame's detailed
input trace.

Detection runs at the screenshot's native size on ordinary displays. A
960-pixel limit was faster on one benchmark, but reduced real-game recall too
much to use as the application default.

### The screenshot must be PNG

`ppocr.exe` links a minimal static OpenCV built `WITH_JPEG=OFF` /
`BUILD_JPEG=OFF`, with only zlib and libpng, so `cv::imdecode` accepts PNG and
nothing else. Confirmed against the staged worker: the same 1920×1080 frame as
PNG returns six regions, and as JPEG returns `request failed: unsupported image
format`. That presents as a recognition failure *after* the screenshot has
already appeared — the frozen frame comes up looking correct and only OCR fails.
PNG is not even the larger payload for game-like content: that frame is 62 KB of
base64 as PNG against 93 KB as JPEG at quality 92.

`DISPLAY_CAPTURE_MEDIA_TYPE` is the single place the format is decided, and
`imageMediaType` travels with the presentation so the renderer's data URL
follows it rather than hardcoding a prefix. Changing it means rebuilding and
republishing the vendor payload with the matching codec first.

When the worker does reject a request it says why on stderr. That line is now
carried into the error the Options tab shows, so a failure reads
"Game OCR recognition failed: PP-OCR worker rejected the request: request
failed: unsupported image format" rather than stopping at the stage name — the
worker's stderr was previously counted against a byte budget and then dropped,
so nothing reached the console either.

### Tray

While Game OCR is armed, the tray icon offers:

- **Show Kizuna** — restores and focuses the player window.
- **Stop Game OCR** — disarms the shortcut, stops the worker, and brings the
  window back.
- **Quit Kizuna** — quits the application.

Closing the player window while armed hides it instead of quitting. Stopping
Game OCR, or quitting, releases the shortcut, the worker process, the frozen
window, the retained screenshot, and the tray icon.

## Privacy

OCR is local. The PP-OCR worker and CPU-only ONNX Runtime are bundled, the models ship
with the application, and nothing about a capture leaves the machine.

The one exception is explicit: right-clicking a selection with experimental
translation enabled sends **that selected text** to the same online Google
endpoint the subtitle sidebar uses. Translation is opt-in and off by default.

## Limitations

- **Exclusive fullscreen** games are not supported. Windows may refuse to
  capture them, or the frozen window may not appear above them. Use borderless
  or windowed mode.
- **Protected or anti-cheat-guarded content** may capture as a black frame or
  be refused outright. Kizuna does not work around either.
- **Unusual DPI scaling** is handled by carrying the display's scale factor
  through capture and layout, but very high scale factors leave the replacement
  text noticeably larger or smaller than the game's own.
- **Stylized text** — heavy outlines, gradients, vertical layout, or decorative
  fonts — recognizes less reliably than plain UI text. Vertical text is
  recognized as its own region and replaced with horizontal text.
- Kizuna captures one display, the one under the pointer. Selecting a specific
  game process or window, or capturing several displays at once, is out of
  scope.
- There is no continuous OCR, no frame polling, no automatic capture, and no
  history of past captures.

## Verification matrix

Automated tests cover the contracts, geometry, session invalidation, worker
protocol, and renderer behavior with fakes and fixtures. They cannot cover
Windows display capture, DPI, multi-monitor placement, or a real game, so the
matrix below is recorded manually against a packaged build.

Record the result of each row, including the ones that cannot be checked in a
given environment.

| # | Case | Expected |
|---|---|---|
| 1 | Packaged build (NSIS install), Start from Options | Worker reports Ready; tray icon appears; window hides |
| 2 | Borderless/windowed GPU-rendered game | Screenshot matches the game frame at capture time |
| 3 | 100% DPI scale | Boxes sit over their source text |
| 4 | Non-100% DPI scale (e.g. 125% or 150%) | Boxes sit over their source text; no offset or crop |
| 5 | Single monitor | The display under the pointer is captured |
| 6 | Two monitors | Only the display under the pointer is captured and covered |
| 7 | Display at negative desktop coordinates | Frozen window lands on the correct display |
| 8 | Press screenshot background once | Whole frame closes on that one press; live game visible; still armed |
| 9 | Escape | Same as row 8 |
| 10 | Rapid recapture with changing game content | The second screenshot shows newer live-game content, never Kizuna's previous frozen frame |
| 11 | Recognition indicator | Appears with the screenshot, disappears when boxes appear |
| 12 | Nearby text regions | Boxes are separated and individually readable |
| 13 | Hover/click lookup | Dictionary popup opens with knowledge coloring |
| 14 | Selection and Ctrl+C | Selected OCR text reaches the clipboard |
| 15 | Right-click translation (enabled) | Translation popup opens for the selection only |
| 16 | Worker failure and Retry | Error is reported in Options; Retry recovers without restarting Kizuna |
| 17 | Stop and Quit | Shortcut, worker process, frozen window, screenshot, and tray are all released |

### Recorded run

No Windows manual run has been recorded yet. Rows 1–17 are **unverified**; the
integration matrix is expected to be filled in on a machine with a packaged
build and a real game, and the results recorded in this section with the build
version, Windows version, DPI scale, and monitor layout used.
