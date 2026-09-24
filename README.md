# SquashForge

Fast, lightweight tool to compress and optimise images and videos without visible quality loss.

SquashForge is a Windows desktop app that puts Caesium-style image compression and HandBrake-style video encoding in one queue. Drop in photos and videos together, compare the original with the result in a split view, then compress the lot.

## Features

**Photos (sharp / libvips)**
- JPEG, PNG, WebP, AVIF, TIFF and BMP in; JPEG, PNG, WebP, AVIF or the same format out
- Quality mode (MozJPEG, palette-quantised PNG, WebP, AVIF), lossless mode, and "max file size" mode that searches for the best quality that fits and shrinks the image if it has to
- Lossless JPEG slimming that strips metadata at the byte level, so the pixels stay bit-for-bit identical (orientation is kept)
- Resize by percentage or to fit a box, with Lanczos, Mitchell or nearest-neighbour resampling
- Strip EXIF, GPS and XMP metadata

**Videos (FFmpeg)**
- H.264, H.265, AV1 and VP9 in MP4, MKV or WebM
- CPU encoders (x264, x265, SVT-AV1, libvpx) plus NVIDIA NVENC, Intel Quick Sync and AMD AMF, each checked with a real test encode at start-up
- Constant quality (CRF/RF with the sweet spot marked), average bitrate, or target file size with two-pass encoding and automatic re-encode if it overshoots. Presets for Discord and email limits
- Scale to 2160p/1440p/1080p/720p/480p (never upscales, portrait aware), frame rate cap, audio passthrough, AAC or Opus, stereo downmix
- Preview sample: encodes 4 seconds with your settings, shows the same frame before and after, and measures real size and speed

**Queue and ETA**
- Mixed photo and video queue with thumbnails, per-file progress, fps, speed and time left
- Time estimates start from a hardware model (CPU threads and clock, GPU encoders), switch to live measurements weighted towards the last few seconds, and learn from every finished job on your PC
- Save beside the original with a suffix, into a folder, or replace the original (originals go to the Recycle Bin)
- Keeps the original when the result would be bigger; keeps modified dates
- Live CPU, GPU, video encoder and memory use in the status bar

## Download

Every push builds a Windows installer and a portable `.exe` in GitHub Actions (the **Windows installer** job, artifact `SquashForge-windows`). Tagging a commit `v*` attaches both to a GitHub release.

The builds are not code-signed, so Windows SmartScreen will warn on first launch. Choose **More info** then **Run anyway**.

## Building it yourself

Requirements: Node.js 22 or newer.

```bash
npm install
npm run fetch:ffmpeg      # downloads static ffmpeg.exe and ffprobe.exe into binaries/win
npm run dist:win          # release/<version>/SquashForge-Setup-*.exe and SquashForge-Portable-*.exe
```

Build the Windows packages on Windows. sharp installs the native libvips binaries for the machine you run `npm install` on.

### Development

```bash
npm run fetch:ffmpeg -- linux   # only on Linux; on Windows use the command above
npm run dev                     # Electron with hot reload
npm test                        # vitest: engines, queue, ETA model and real encodes
npm run typecheck
```

Without fetched binaries the app looks for `ffmpeg` and `ffprobe` on your `PATH`. You can also point it at a folder with `SQUASHFORGE_FFMPEG_DIR`.

Keyboard: `Ctrl+O` add files, `Ctrl+Enter` start, arrow keys move through the queue, `Delete` removes the selected file. In the comparison view, scroll to zoom, drag to move the divider (or pan when zoomed in), double-click for 100%.

## How it fits together

```text
src/
├── main/                      Electron main process
│   ├── index.ts               window, single instance, app lifecycle
│   ├── hardware.ts            CPU/GPU/RAM detection and encoder test encodes
│   ├── systemMonitor.ts       live CPU, GPU and encoder load
│   ├── binaries.ts            finds the bundled ffmpeg/ffprobe
│   ├── services/
│   │   ├── imageProcessor.ts  sharp pipelines, target-size search, previews
│   │   ├── jpegStrip.ts       lossless JPEG metadata removal
│   │   ├── bmp.ts             BMP decoder (libvips in sharp has none)
│   │   ├── videoProcessor.ts  ffprobe, ffmpeg arguments, passes, previews
│   │   ├── etaCalculator.ts   hardware model, live ETA tracker, calibration
│   │   ├── jobQueue.ts        image and video lanes, safe output handling
│   │   ├── mediaResolver.ts   expands dropped folders, reads media info
│   │   └── outputPaths.ts     output naming rules
│   └── ipc/handlers.ts        IPC between main and UI
├── preload/index.ts           contextBridge API (window.api)
├── renderer/src/              React 19 + Tailwind CSS + Zustand UI
│   ├── components/queue/      queue list and drop target
│   ├── components/preview/    split comparison view, image and video previews
│   ├── components/settings/   photo, video and output settings
│   ├── components/hardware/   status bar and hardware details
│   ├── components/presets/    preset picker
│   └── store/                 Zustand stores
└── shared/                    types, codec tables, presets, formatting
```

The build uses [electron-vite](https://electron-vite.org), so its config lives in `electron.vite.config.ts` rather than `vite.config.ts`. Packaging is in `electron-builder.json5`.

## Licences

SquashForge is MIT licensed. The bundled FFmpeg is the GPL build from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), shipped as separate executables with its licence in `resources/bin/FFMPEG-LICENSE.txt`. Source for FFmpeg is available from that project and from [ffmpeg.org](https://ffmpeg.org).
