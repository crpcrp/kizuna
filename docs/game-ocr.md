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
2. With the game in front, press the shortcut (**Ctrl+Shift+O** by default;
   rebind it in the same tab).
3. Kizuna freezes **the foreground application's window** and immediately
   covers exactly that window with the frozen frame. When the focused window
   cannot be captured safely it freezes **the display containing the mouse
   pointer** instead — see [Choosing what is
   captured](#choosing-what-is-captured). The screenshot appears before
   recognition starts, so the frame the user sees is exactly the frame being
   read.
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

### Choosing what is captured

A windowed game is a small part of a large desktop. Reading the whole display
sends PP-OCR several times the pixels it needs and lets unrelated desktop
content — a browser, a chat window, the taskbar — become word boxes. So the
default target is the foreground window: a 1024×768 game on a 2560×1440
monitor produces a 1024×768 image, roughly a ninth of the pixels.

Windows itself has to be asked which window that is. Electron enumerates
capturable windows but does not expose another process's foreground window,
`BrowserWindow.getFocusedWindow()` only covers Kizuna's own, and titles are not
identities — they duplicate, come back empty, and change while a game runs.
`src/main/services/gameOcr/foregroundWindow.ts` is the whole native boundary
and is described in [architecture](architecture-plan.md#the-one-in-process-native-boundary).

The window is rejected, and the display under the pointer captured instead,
when:

| Reason | Why |
|---|---|
| `unsupported` | Not Windows |
| `query-failed` | The native boundary could not load or answer |
| `no-foreground` | Nothing holds the foreground |
| `own-process` | Kizuna is in front. Its frozen frame is excluded from capture, so capturing it would produce a black image |
| `minimized` | `IsIconic`; there are no pixels |
| `invisible` | `IsWindowVisible` is false |
| `cloaked` | `DWMWA_CLOAKED`. The dangerous one: background UWP windows and virtual-desktop residents look entirely valid, with real bounds and a real title, and capture as nothing |
| `invalid-window` | No process, or a window that has never been laid out |
| `no-display-match` | No display owns the window's rectangle |
| `window-capture-failed` | The stream refused to open. Exclusive fullscreen, protected surfaces, and anti-cheat all arrive here |

Falling back is never an error the user sees: Game OCR stays armed, a frame
still appears, and only the development diagnostic says what happened. A
failed window capture is retried once against the display under a fresh
capture identity, so the abandoned window capture's late reply cannot be
mistaken for the frame that replaced it.

Development runs log one line per capture:

```
[game-ocr] target window game.exe (pid 4321) 1024x768
[game-ocr] target display 2560x1440 (fallback: the foreground window is cloaked)
```

The executable basename and PID are there because "which window did it pick?"
is otherwise unanswerable; the full path deliberately is not.

#### Measured runtime facts this rests on

Recorded against Electron 43.3.0 on Windows 11 26200, because each one
decided a design choice and none of them is documented behavior:

- **Window source ids encode the HWND.** Electron documents the form as
  `window:XX:YY`; enumeration confirms it exactly, with foreground HWND
  `1902762` appearing as `window:1902762:0`. Identity is the handle, never the
  title.
- **Enumerating window sources costs ~3.2 seconds, every call.**
  `desktopCapturer.getSources({ types: ['window'] })` measured 3152–3217 ms
  across five consecutive calls with a 1×1 thumbnail and does not warm up,
  against ~304 ms for `['screen']`. That is unusable on the shortcut path, and
  it cannot be cached across presses either, because the user may alt-tab
  between them.
- **A synthesized source id works.** Opening `window:<hwnd>:0` with no
  preceding `getSources` call at all produced a live stream of that window in
  ~430 ms. So the id is constructed from the handle rather than looked up. A
  handle Chromium will not capture simply fails to open, which is already a
  fallback branch — one failed stream open instead of 3.2 seconds on every
  capture.
- **The captured frame is the extended frame bounds.** For a maximized window
  the stream delivered 2560×1392, matching `DWMWA_EXTENDED_FRAME_BOUNDS`
  exactly and not `GetWindowRect` (2576×1408, which includes the invisible
  8-pixel resize border). The overlay uses the DWM rectangle, so no guessed
  offset is applied anywhere.

Window bounds arrive in physical desktop pixels and are converted to logical
coordinates using the owning display's scale factor and its *physical* origin,
read with `screen.dipToScreenPoint`. A display's physical origin is not its
logical origin times its scale factor in a mixed-DPI layout, and negative
origins are carried through unchanged — a monitor left of the primary has a
negative x, and clamping it would put the overlay on the wrong screen. A window
straddling two monitors is placed on the one showing most of it.

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

**The frozen frame holds open desktop capture streams** for what it covers, for
as long as Game OCR is armed and its window is retained. A capture is then one
`drawImage` from a frame the renderer already has. The expensive setup —
opening the stream — is paid on the first capture of a given window or display
and reused afterwards.

Streams are keyed by capture-source id, which covers windows and displays
alike; only how many are retained differs, and the freeze request carries the
target kind rather than the renderer interpreting the source id's shape.
Display streams stay open, because there are only ever a handful and reopening
one is the cost a warm capture exists to avoid. **At most one window stream is
retained**, so alt-tabbing through a dozen programs does not leave Kizuna
holding desktop capture access to all twelve. A stream whose track ends is
evicted when it says so, not on the next capture that would have drawn from it.

Switching to a window Kizuna has not captured before therefore costs one stream
open, measured at ~430 ms, before that frame appears; returning to a window it
already holds does not.

The retained renderer deliberately does **not** set `backgroundThrottling:
false`. Electron implements that by setting Chromium's `disable_hidden_`, so
the widget never makes the hidden→shown transition this window performs on
every frame, and nothing on the capture path is throttled regardless: opening a
stream and encoding a canvas are promises, not timers.

Measured on a 2560×1440 display, Ryzen 7 5800X3D:

| Step | On demand (old) | From the stream |
|---|---:|---:|
| getting the pixels | ~300 ms | 12–44 ms |
| encoding them | 85 ms | ~25 ms, *after* the frame is shown |
| base64, IPC | under 1 ms | binary IPC after presentation; base64 only at worker stdin |

`desktopCapturer.getSources` was ~75% of the old path and none of it was
recoverable: it charges roughly the same ~300 ms whether the requested
thumbnail is 1×1 or the full display, and it does not warm up, so calling it
early to prime the pipeline only pays it twice. For screen sources it is still
used once per armed run — with a 1×1 thumbnail, for source ids only. For window
sources it is not used at all, because there it costs ~3.2 seconds a call; the
source id is constructed from the handle instead. The current display target is
also cached while the pointer remains inside its bounds, avoiding Electron's
display lookup on the hot path. A warm target is returned synchronously, so the
freeze IPC reaches the renderer before the global-shortcut callback yields to
Electron. Only real source enumeration uses a Promise, so a window target never
yields at all: the native foreground query costs ~40 µs and its source id needs
no lookup. Both caches are cleared when Game OCR stops or the application shuts
down; neither contains screenshot pixels.

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
The capture field is split by what was actually consulted. A window capture
reports `foreground` (the native query) and `source constructed`, because it
consults neither the cursor, nor Electron's display lookup, nor source
enumeration. A display capture reports `cursor`, `display`, `source`
cached-or-enumerated, and `target cached/resolved` as before. Both report
`event-loop`, the time lost between the adapter's measured work and the
controller continuation; neither a window target nor a warm display target
crosses an asynchronous boundary, so that remainder should stay effectively
zero, while cold source enumeration can still yield.
`KIZUNA_GAME_OCR_TIMING=1` additionally enables the frozen frame's detailed
input trace.

### Detection input size

`--det-side-len` **sets** the detection input; it does not cap it. The worker
resamples every capture so its longest side is exactly that many pixels —
upwards as well as downwards — and detection then costs roughly the square of
it. The previous value of 4000 was chosen believing it meant "native size on
ordinary displays". It did not: it upscaled every capture, a 1920-wide one by
2.1x and a 1026-wide one by 3.9x.

That is why shrinking the capture to the focused window did not make
recognition faster on its own. Detection was pinned to the same tensor
whatever the capture measured, and *worse* for a tall window: a 1026x795
capture became 4000x3099, more pixels than a 2560x1440 capture's 4000x2250.

Measured against the vendor fixture, p50 of one recognition, Ryzen 7 5800X3D:

| capture | at 4000 | at 2560 | at its own longest side |
|---|---:|---:|---:|
| 2560x1440 | 1661 ms | 595 ms | 599 ms |
| 1920x1080 | 1635 ms | 573 ms | 264 ms |
| 1280x720 | 1711 ms | 607 ms | 119 ms |
| 960x540 | 1632 ms | — | 78 ms |

A 960x540 capture costing the same as a 2560x1440 one at 4000 is the tell: at
that setting the source resolution is irrelevant.

The recall this was supposed to protect is not real. On the fixture, 4000
returns one extra region over native — a single `C` at 0.88 confidence — and
loses trailing punctuation the native run keeps. Detection at 960 does drop a
region on a 1080p capture, so downscaling below native is still the thing to
avoid; upscaling past it simply costs.

An armed run therefore uses the **largest display's physical longest side**,
which leaves a fullscreen or maximized game unscaled and bounds how far a
smaller window is scaled up. The genuinely correct value is each capture's own
longest side, worth another 2-5x for windowed games, but `--det-side-len` is a
worker startup argument and the capture size is not known until the shortcut is
pressed. The worker computes its scale per request
(`getScaleParam(image, options_.detection_side_length)`) with no session state,
so accepting a per-request override is a small vendor change and is the next
thing worth doing here.

`--rec-batch-size` is **not** a lever, measured 383-408 ms across batch sizes
1 to 64 on a 20-region capture, which is inside the noise. The vendor's
batching patch already took the win there (89.6 -> 83.2 ms); raising the batch
further does nothing. `--cpu-threads` defaults to physical cores — 8 on this
machine — and the vendor measured 16 threads as a 2x *loss*, so it stays.

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
- Kizuna captures the foreground window, or one display when that window
  cannot be captured. Choosing a specific game process by hand, capturing a
  background window, or capturing several windows or displays at once is out of
  scope.
- Switching to a window Kizuna has not captured before costs one stream open
  (~430 ms measured) before that first frame appears. Returning to a window it
  is already streaming does not.
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
| 5 | Single monitor | The focused window is captured and covered |
| 6 | Two monitors | Only the focused window is captured and covered; a display fallback covers only the display under the pointer |
| 7 | Display at negative desktop coordinates | Frozen window lands on the correct display |
| 7a | 1024×768 windowed game on a 2560×1440 monitor | Overlay and OCR image cover only the game window; the development log reports `target window <exe> (pid …) 1024x768` |
| 7b | Resize or move the game window, then press again | The next capture uses its new size and location |
| 7c | Borderless fullscreen | The whole game area is captured |
| 7d | Alt-tab between two games | Each press captures the one currently in front |
| 7e | Two windows with the same title | The focused instance is chosen; identity is the HWND |
| 7f | Game on a 125%/150% secondary monitor, including negative coordinates | No offset or crop; boxes sit over their source text |
| 7g | Minimized, cloaked, protected, or exclusive-fullscreen target | Display fallback captures normally, Game OCR stays armed, and the development log names the reason |
| 7h | Kizuna focused when the shortcut is pressed | Display fallback; Kizuna's own window is never captured |
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
| 18 | Recognition timing, full 2560×1440 display vs a 1024×768 window | Record both; the window should be substantially faster |

### Recorded run

No Windows manual run has been recorded yet. Rows 1–18 are **unverified**; the
integration matrix is expected to be filled in on a machine with a packaged
build and a real game, and the results recorded in this section with the build
version, Windows version, DPI scale, and monitor layout used.

Four runtime facts *have* been measured directly, on Electron 43.3.0 /
Windows 11 Pro 26200 / single 2560×1440 display at 100%, and are recorded under
[Measured runtime facts](#measured-runtime-facts-this-rests-on): the
`window:<hwnd>:0` id format, the ~3.2 s window-enumeration cost, that a
synthesized source id opens a stream without enumeration, and that the captured
frame matches `DWMWA_EXTENDED_FRAME_BOUNDS` rather than `GetWindowRect`. These
were taken with probe programs against the pinned runtime, not against a game,
so they establish the contracts the matrix above still has to confirm in
practice.
