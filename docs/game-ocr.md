# Game OCR (experimental, Windows only)

Game OCR freezes the foreground game, reads Japanese text locally, and overlays
interactive text boxes. Windows only; the Options tab and runtime are unavailable
on Linux/macOS. Use windowed or borderless mode. Experimental behavior may change.

## Using it

1. Choose **Options → Game OCR → Start** or **Settings → Start Game OCR**.
   Kizuna registers the shortcut, starts PP-OCR, hides the player, and adds a tray icon.
2. With the game in front, press **Ctrl+Shift+O** (rebind in the same tab).
3. The foreground window is frozen and covered; an unsafe/unavailable target falls
   back to the display under the mouse. The displayed screenshot is the OCR input.
4. **Recognizing text…** appears at bottom right until interactive boxes arrive.
   Nearby fragments join into lines, stacked lines retain their spacing, and
   separated rows get separate boxes.

| Action | Result |
|---|---|
| Hover/click a word | Dictionary popup, knowledge coloring, Anki mining |
| Select inside a box, Ctrl+C | Copies selected text |
| Right-click a selection | Translation if enabled; frame stays open |
| Left-click screenshot background | Dismisses on release; neither half of the click reaches the game |
| Escape | Dismisses the frame, leaving OCR armed |
| Capture shortcut again | Replaces the frame with a fresh capture |

A press starting in a box/popup remains a selection drag; right-click never dismisses.
Escape and Ctrl+C are global only while a frame is visible. The frame requests
focus to prevent games polling input; Windows may refuse activation, so normal
mouse activation remains enabled. Games may pause on focus loss. Validate native
first-click behavior with the manual matrix below.
Anki mining is text-only: no screenshot, audio, or timestamp.

### Tray and updates

- **Options** opens settings while OCR stays armed; closing them returns to the tray.
- **Video player** opens/reuses the player and preserves its session while armed.
- **Quit Kizuna** releases shortcuts, worker, frozen window, screenshot, and tray.

Closing the player while armed hides it. A no-file second launch opens Options
when hidden for OCR. Stop OCR from the in-app controls. An enabled startup update
check runs in every mode; an update offer opens Options over the tray session.
Downloads and installation require confirmation. Closing Options leaves OCR armed.

## Capture and lifetime decisions

- **Target identity:** Win32 foreground handles, never titles, select the window;
  see [the native boundary](architecture.md#the-one-in-process-native-boundary).
  Window source IDs are constructed as `window:<hwnd>:0` to avoid costly enumeration.
- **Display fallback:** native query failure, no foreground, own process, minimized,
  invisible, cloaked, invalid, unmatched-display, or refused window capture all use
  the pointer's display. A failed window stream retries once with a fresh capture
  identity; late replies cannot replace it. Development logs identify the executable
  basename/PID and dimensions or fallback reason, never the full executable path.
- **Geometry:** DWM extended frame bounds exclude invisible resize borders. Convert
  physical pixels through the owning display's physical origin and scale factor;
  preserve negative coordinates. A straddling window belongs to its largest overlap.
- **Retained streams:** keep display streams and at most one window stream while
  armed; evict ended tracks. A new target pays one stream open. Source/target caches
  contain no screenshot pixels and clear on stop/shutdown.
- **Retained window:** dismissal drops screenshot/boxes and hides. Stop, display
  changes, or a dead renderer destroy it; the next capture creates a replacement.
  Re-read preferences and clear selection per frame, retaining lookup caches.
- **Recapture:** content protection (`WDA_EXCLUDEFROMCAPTURE`) excludes the overlay
  from capture. Invalidate old boxes/popups/selection, draw over the previous canvas,
  then encode and recognize. Latest session wins even across overlapping requests;
  held-shortcut repeats coalesce. Reuse the target when OCR owns focus; alt-tab
  selects the newly focused game. A failed recapture hides the overlay.
- **Presentation:** draw before PNG encoding, register main's byte waiter before
  drawing, and send binary IPC. Base64 exists only at sidecar stdin; main releases
  image references before inference. Dismissal requests native hide before renderer
  cleanup. Keep Chromium's normal background throttling for hidden/shown transitions.
- **PNG required:** the vendored OpenCV has no JPEG codec. Changing media type
  requires rebuilding the vendor payload; worker rejection details reach Options.
- **Detection:** `--det-side-len` resamples to an exact longest side, not a cap.
  Use the largest display's physical longest side to avoid below-native detection;
  per-capture sizing needs a vendor protocol change. Recognition uses width 480;
  batch size is not a useful tuning lever and CPU threads default to physical cores.

## Privacy and translation

### Translation setup

OCR is local. The PP-OCR worker and CPU-only ONNX Runtime are bundled, the models ship
with the application, and nothing about a capture leaves the machine.

The one exception is explicit: right-clicking a selection with experimental
translation enabled sends **that selected text** to the official Microsoft Azure
Translator service. Translation is opt-in and off by default; no text is sent
when it is disabled. Kizuna supports Global and regional single-service Azure
Translator resources, plus multi-service resources, using standard NMT text
translation on the F0 or paid tier. Regional and multi-service resources require
their Azure resource region in Options so Kizuna can send the required
authentication header. Quota, billing, and provider availability belong to the
user's Azure subscription.

Configure translation under **Options → Subtitles → Experimental translation**:

1. Copy Key 1 or Key 2 from the Azure Translator resource's **Keys and Endpoint** page.
2. For a regional Translator or multi-service resource, enter the Azure **region identifier**,
   not the portal's display name. The identifier is lowercase with no spaces—for example,
   enter `northeurope` when the portal shows **North Europe**.
3. Leave the region blank only for a single-service resource whose location is **Global**.

Kizuna sends the key in `Ocp-Apim-Subscription-Key` and, when configured, the region identifier
in `Ocp-Apim-Subscription-Region`. The key and region must belong to the same Azure resource;
otherwise Azure rejects the request with HTTP 401.

## Limitations

- Exclusive fullscreen is unsupported; use borderless/windowed mode.
- Protected or anti-cheat surfaces can be black/refused; Kizuna does not bypass them.
- DPI conversion supports mixed scaling, but extreme scales can alter replacement text size.
- Stylized/outlined/gradient/decorative text is less reliable; vertical text becomes horizontal.
- No manual process picker, background-window capture, or simultaneous multi-target capture.
- First capture of a new stream is slower; there is no continuous OCR, automatic
  capture, frame polling, or capture history. Streams remain local while armed.

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
| 7h | Kizuna player focused when the shortcut is pressed | Display fallback; Kizuna's own window is never captured |
| 8 | Press screenshot background once | Whole frame closes on the first release; the game receives neither button-down nor button-up and dialogue does not advance; still armed |
| 9 | Escape | Same as row 8 |
| 10 | Rapid recapture with changing game content | The second screenshot shows newer live-game content, never Kizuna's previous frozen frame |
| 11 | Recognition indicator | Appears with the screenshot, disappears when boxes appear |
| 12 | Nearby text regions | Boxes are separated and individually readable |
| 12a | Numbered dialogue menu (several options stacked) | Each marker sits in its option's line, no box overlaps another's text, and the lines keep the game's spacing |
| 13 | Hover/click lookup | Dictionary popup opens with knowledge coloring |
| 14 | Selection and Ctrl+C | Selected OCR text reaches the clipboard |
| 15 | Right-click translation (enabled) | Translation popup opens for the selection; frame stays visible and game receives neither right-button event |
| 15a | Regional Translator configured with its identifier (for example, `northeurope`) | Translation succeeds; a portal display name containing spaces is not used as the header value |
| 16 | Worker failure and Retry | Error is reported in Options; Retry recovers without restarting Kizuna |
| 17 | Quit Kizuna from tray | Shortcut, worker process, frozen window, screenshot, and tray are all released |

### Recorded run

The packaged Windows/game matrix remains **unverified**. Record every row,
including unavailable cases, with build/Windows version, DPI, and monitor layout.
Historical probes established runtime contracts, not game-level verification.

### Measurements (historical)

Electron 43.3.0, Windows 11 26200, Ryzen 7 5800X3D, 2560×1440 at 100%:
window enumeration took ~3.2 s, screen enumeration ~304 ms, and a synthesized
window source opened in ~430 ms without enumeration. Capture matched DWM extended
frame bounds. Retained-stream drawing measured 12–44 ms and PNG encoding ~25 ms
after presentation. These are historical observations, not current guarantees;
benchmark traces belong with the PRs that produced them.
