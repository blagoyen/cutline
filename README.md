# YT Cutter

A local-first Windows desktop app for cutting out only the parts of a YouTube video you want. Paste a link, mark in/out points, add as many cuts as you need, and download them as separate MP4 (or MP3) files — no full-video download, no watermark, no account.

Built with **Tauri 2**, **React + TypeScript**, and hand-written CSS. Rust owns every process and all state; the frontend only sends typed commands and listens for progress events.

## Features

- YouTube link validation for `watch`, `youtu.be`, Shorts, embed, and bare 11-character IDs.
- Custom editorial player with a bordered dark frame and a single-row 52px paper/ink control deck: red play/pause, ±5s skips, mute + volume, speed, centered tabular timecode, a buffered scrubber with cut markers and an IN→OUT zone, mark in/out, add cut, loop, fullscreen, plus a custom frameless title bar with minimize/maximize/close.
- Multiple cuts with draggable edges, locked-column rows, numeric `HH:MM:SS.mmm` inputs with ±0.1s / snap-to-playhead buttons, inline overlap badges with a one-click Fix / trim helper, strict validation, reordering, renaming, and deletion.
- Quick `+10s` / `+30s` / `+60s` cuts from the mark-in point or the live playhead, plus chapter-aware navigation and one-click chapter-to-cut conversion when the uploader supplied chapters.
- Real download manager: queue, concurrency limit, per-task progress/speed/ETA, cancel, retry, removal, and verified output paths.
- Direct section downloads with `yt-dlp --download-sections "*HH:MM:SS.mmm-HH:MM:SS.mmm"` — never downloads the whole video first.
- MP4 with video + audio, optional MP3, quality limited to resolutions the source actually offers, and a precise-cutting toggle using `--force-keyframes-at-cuts`.
- Safe output naming, automatic `(2)` suffixes instead of overwriting, and FFprobe verification of every finished file.
- Repo-backed global info in the center of the topbar: every installation polls `src/config/global-info.json` in this repository and shows the latest committed message without an app update. Only repository owners can edit the file; users have no UI to create, edit, time out or dismiss it. Action feedback remains transient in the separate toast stack.
- Synthesised interface sounds are on by default (short local Web Audio cues for notices, cut marks and completed downloads), with a one-click topbar mute and a Settings toggle. No audio files are downloaded or stored.
- Motion throughout — persistent info sweep/pulse, staggered panels and steps, cut/download rows, deck entrance, play pulse, progress sheen, live indicator and subtle button/brand feedback — all transform/opacity based and disabled under `prefers-reduced-motion`.
- Settings for output folder, defaults, concurrency, theme, interface sounds, and explicit yt-dlp / FFmpeg / FFprobe paths with real version detection.
- Browser-based YouTube authentication for Chrome, Edge, Firefox, Brave, and Chromium via `--cookies-from-browser`, with optional profile selection. It is off by default and only reads cookies after the user enables it.
- In-app authentication test that performs a real YouTube metadata request with the selected browser session and reports precise failures.
- Checksum-verified yt-dlp updates from the official GitHub release, installed into the app's own folder; an optional PO Token provider plugin folder for videos that require one.
- Nothing is uploaded, tracked, or installed silently. No cookies or browser data are accessed unless authentication is explicitly enabled.

## Requirements

- Windows 10/11 with WebView2 (present on modern Windows).
- **yt-dlp**, **FFmpeg**, and **FFprobe** installed on PATH or selected manually in Settings.

  ```powershell
  winget install yt-dlp.yt-dlp
  winget install Gyan.FFmpeg
  ```

YT Cutter never installs tools silently. It detects tools, shows their versions, and refuses to save a path that is not executable. The only download it performs is an explicit, SHA-256 verified yt-dlp update requested by the user in Settings.

### Global notice

Edit [`src/config/global-info.json`](src/config/global-info.json) in the repository and commit/push it. Every running app checks the raw file on launch, every 5 minutes, and whenever the window regains focus. A new message appears in the topbar within one poll; no rebuild or reinstall is needed. The last good message is cached for offline use, and the bundled copy is the final fallback.

```json
{
  "enabled": true,
  "label": "NOTICE",
  "message": "Your message for everyone (240 characters max).",
  "tone": "info",
  "updatedAt": "2026-11-24"
}
```

`tone` can be `info`, `success`, or `warning`. Set `enabled` to `false` for a quiet “Ready” indicator. Because the repo is public but only the owner has write access, everyone receives the message and only you can change it.

### YouTube sign-in

If YouTube asks for sign-in confirmation, open Settings → **YouTube Authentication**, enable browser cookies, choose the browser you are signed in to, save, and press **Test**. The test reads that browser's YouTube cookies through yt-dlp and verifies the result by fetching a real video title — it never stores or displays cookies. If the browser's cookie database is locked, close and reopen the browser and test again.

If YouTube requires a Proof of Origin Token, Settings → YouTube Authentication → **Install provider** downloads the official `bgutil-ytdlp-pot-provider` release, verifies its checksum against the GitHub release digest, verifies the pinned source archive, builds it with the locally installed Node.js (22+), starts the local server on `127.0.0.1:4416`, and points yt-dlp at it. The server auto-starts on app launch and stops on exit; it can also be started/stopped manually in Settings. No tokens are stored by YT Cutter. See the [official PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

Node.js 22 or newer is also required for YouTube downloads: yt-dlp uses it to solve YouTube's JavaScript `n` challenge. YT Cutter passes `--js-runtimes node` automatically on every YouTube request.

## Development

```powershell
npm install
npm run dev          # frontend only in a browser, with a dev-only mock backend
npm run tauri dev    # full app with the Rust backend
```

Production build (produces the NSIS installer):

```powershell
npm run tauri build
```

Installer: `src-tauri/target/release/bundle/nsis/YT Cutter_0.1.7_x64-setup.exe`.

### Toolchain note

This workspace was built with the user-space `stable-x86_64-pc-windows-gnu` Rust toolchain plus winlibs MinGW because MSVC Build Tools are not installed. Add these to `PATH` for any Cargo/Tauri command:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;.\setup\mingw\mingw64\bin;$env:Path"
```

MSVC (`stable-x86_64-pc-windows-msvc` + VS Build Tools) is the officially supported Tauri target and is recommended for a normal development setup. On this GNU toolchain, `cargo test` links the test harness with an incompatible manifest; use MSVC to run the unit tests. The application itself builds, links, and launches correctly with GNU.

## Verification performed

- `npx tsc --noEmit` and `npm run build` pass.
- `cargo check` is warning-free; `npx tauri build` produces a working `yt-cutter.exe` and NSIS installer. The app window launches successfully.
- Unit tests cover URL canonicalization, `HH:MM:SS.mmm` formatting, filename sanitization, non-overwriting paths, progress-line parsing, browser auth argument construction (including `BROWSER:PROFILE` and plugin dirs), error-code mapping, and yt-dlp release version comparison.
- UI flows were checked in a browser against a dev-only mock backend: loading a video, adding/editing multiple cuts, live queue progress, cancellation, the settings drawer, browser authentication controls, and the authentication test result.
- Browser cookie arguments were verified against the real yt-dlp binary for Chrome, Edge and Firefox, including profile and nonexistent-profile cases. The official GitHub release metadata and SHA-256 checksum format used by the updater were verified directly.
- The PO Token provider installer flow was verified against the official release archives: checksums, extraction layout, `npm ci`, `npx tsc`, server startup, and yt-dlp actually loading `bgutil:http-2.0.2` and generating a token.
- The real section-download and MP3 pipelines were exercised end-to-end with a public MP4 source.
- The YouTube `n` challenge was diagnosed as a missing JavaScript runtime. yt-dlp now receives `--js-runtimes node` on every YouTube request; the CLI and packaged app were verified with Firefox cookies, a generated PO Token, 18 returned formats, and a real authenticated 3-second section download.
- The 0.1.7 custom player, timeline and export refactor was verified in the packaged app with UI Automation: a signed-in YouTube section was previewed, two cuts were marked, merged into one file, and saved as `Me at the zoo - Clip 01 (merged).mp4` with both video and audio streams and a duration of 3.75s. yt-dlp only applies the first range when multiple `--download-sections` are supplied, so merged cuts are now downloaded one section at a time and joined with ffmpeg's concat demuxer (stream copy). The provider auto-started on port 4416 and stopped cleanly when the app closed.
- The persistent topbar info and sound defaults were verified in the packaged app with UI Automation: the centered notice is present on launch with no composer or dismiss control, and the sound toggle starts on ("Mute interface sounds") and persists changes to `soundEffects` in settings.
- The player scrubber playhead is positioned in pixels cached by a `ResizeObserver` (a percentage translate moved it relative to its own 2px box, so it appeared frozen). Verified in the rebuilt app: the red line moved from x=2 to x=411 over 8s of a 19s video. The dark theme now resolves to pure `#000000` for the app background and surfaces (`getComputedStyle(document.body).backgroundColor` returns `rgb(0, 0, 0)`).
- The final editorial deck and cut-grid pass was verified in the rebuilt packaged app with UI Automation: a signed-in `Me at the zoo` video loaded with its chapter metadata, the 52px single-row deck exposed skip/rendered buffered scrubber controls, `+10s` created a cut from the playhead, overlapping cuts showed inline `OVERLAP` badges and `Fix / trim` trimmed the later cut to the previous end, and `+ Chapter cut` added the `Intro` chapter as a cut. Downloading that chapter cut completed as `Me at the zoo - Clip 03.mp4` with AV1 video + AAC audio and a duration of 5.02s. All cut-row controls stayed inside the 943px studio column (last action button ended at x=1626 inside a x=1634 frame).

Browser cookie access remains opt-in and cookies are never stored or displayed. If a browser's cookie database is locked, close and reopen that browser and test again. Node.js 22+ is required so yt-dlp can solve YouTube's JavaScript challenge.

## Notes and limits

- Without `--force-keyframes-at-cuts`, section boundaries may include a small amount of extra video near keyframes. Enable **Precise cutting** for frame-accurate starts (slower).
- If an embedded player is blocked by the uploader or network, the UI shows the thumbnail and an "Open on YouTube" fallback. Cuts can still be created with the **Add cut** button and typed timestamps.
- Use the app only for videos you own or have permission to download.
