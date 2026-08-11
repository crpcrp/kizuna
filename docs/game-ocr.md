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
[runtime binaries](binaries.md) for the bundled PaddleOCR payload, and
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
   shortcut, starts the local PaddleOCR worker, hides its own window, and
   leaves a tray icon behind.
2. Move the mouse onto the display showing the game and press the shortcut
   (**Ctrl+Shift+O** by default; rebind it in the same tab).
3. Kizuna captures **the whole display containing the mouse pointer** and
   immediately covers that display with the captured screenshot. The frozen
   screenshot appears before recognition starts, so the frame the user sees is
   exactly the frame being read.
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
| Click the screenshot background | Closes the whole frozen frame — screenshot, boxes, popups, and selection — revealing the live game. A press that started on a box or popup and ended on the background is a selection drag, not a close |
| Escape | The same, and Game OCR stays armed |
| Press the shortcut again | Recapture (see below) |

Mining a word from a frozen frame uses the existing **text-only** Anki path.
Game OCR adds no screenshot, audio, or timestamp to a card.

### Recapture

Pressing the shortcut while a frozen frame is open must never re-read Kizuna's
own screenshot. The coordinator therefore always:

1. invalidates the old session and drops its boxes, popups, selection,
   indicator, and screenshot references;
2. drops the screenshot from the frozen window and hides it, then waits for
   confirmation that it is no longer visible;
3. allows one bounded compositor-settle step;
4. captures the now-visible live game;
5. moves the window onto the captured display and presents the new screenshot
   immediately;
6. accepts OCR, tokenization, lookup, and translation results only for the new
   session ID.

If a recapture fails after the old frame is gone, the live game stays visible.
The stale screenshot is never restored.

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

OCR is local. The PaddleOCR worker is a bundled subprocess, the models ship
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
| 8 | Click screenshot background | Whole frame closes; live game visible; still armed |
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
