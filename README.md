# SquashForge

SquashForge makes photos and videos smaller without making them look worse. You drop files in, check the before and after side by side, and press one button. It runs on Windows 10 and 11.

It does the job of two well-known free tools in one window: Caesium for photos and HandBrake for videos. Nothing is uploaded anywhere. Everything happens on your own PC.

![SquashForge comparing an original photo with the compressed version. The compressed file is 82% smaller.](docs/screenshots/compare.png)

## Contents

- [Install it](#install-it)
- [Compress your first files](#compress-your-first-files)
- [Common jobs, step by step](#common-jobs-step-by-step)
- [What the settings mean](#what-the-settings-mean)
- [Something went wrong](#something-went-wrong)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [For developers](#for-developers)

## Install it

1. Open the [latest release page](https://github.com/joshov13-dev/squash-media/releases/latest).
2. Scroll down to **Assets** and click `SquashForge-Setup-0.1.0-x64.exe` (the version number may be higher). Your browser saves it to your Downloads folder. Ignore the two **Source code** files; those are for programmers. If the Source code files are the only ones you can see, the release is brand new and its download is still being built. Wait five minutes and refresh the page.
3. Open your Downloads folder and double-click the file you just downloaded.
4. Windows will probably show a blue box that says **Windows protected your PC**. This appears for any new program that hasn't paid for a code-signing certificate. Click **More info**, then **Run anyway**.
5. The installer asks a couple of questions. The answers it already has are fine, so keep clicking **Next**, then **Install**, then **Finish**.
6. SquashForge opens. Next time, click the Start button and type `SquashForge`, or use the shortcut on your desktop.

### Would rather not install anything?

Download `SquashForge-Portable-0.1.0-x64.exe` instead and double-click it. It runs straight away without installing. It takes a few seconds longer to open each time, and the right-click menu in File Explorer only comes with the installed version.

### Removing it later

Open **Settings**, then **Apps**, find **SquashForge** in the list and click **Uninstall**. Your photos and videos are not touched.

## Compress your first files

### 1. Add your files

Drag photos or videos from File Explorer onto the SquashForge window. You can drag a whole folder too; SquashForge finds every photo and video inside it, including in subfolders. If you prefer buttons, use **Add files** or **Add folder** at the top left.

![The SquashForge window when it first opens, with an empty queue on the left.](docs/screenshots/first-launch.png)

Your files appear in the list on the left, called the queue. You can mix photos and videos.

### 2. Check what you'll get

Click any photo in the queue. The big picture in the middle is split in two: the left half is your original, the right half is how it will look after compressing. Drag the round handle in the middle left and right to compare.

The numbers under the picture tell you the original size, the new size and how much you save.

To look closely, scroll your mouse wheel over the picture to zoom in, and drag to move around. Double-click to jump to 100% (one screen pixel per photo pixel) and double-click again to go back.

For a video, click **Preview sample**. SquashForge compresses 4 seconds from the middle of the video, shows you the same frame before and after, and estimates the final size and how long the whole video will take.

### 3. Change the settings (optional)

The panel on the right has three tabs: **Photos**, **Videos** and **Output**. It switches to the right tab when you click a file.

The easiest way to change settings is the preset menu at the top of the Photos or Videos tab. Pick one and the rest is set for you. The defaults (**Balanced** for photos, **Standard** for videos) suit most files, so you can skip this step entirely.

| Preset | Use it when |
| --- | --- |
| Balanced | You want smaller photos that look the same. |
| Web (WebP) | Photos are going on a website. |
| Smallest (AVIF) | Every kilobyte counts and you don't mind waiting a bit longer. |
| Lossless | Not a single pixel may change. Saves less space. |
| Under 500 KB, Under 2 MB | A form or website has a file size limit. |
| Standard (H.264) | You want a smaller video that plays on anything. |
| HQ 1080p (H.265) | You want the smallest file at high quality and your devices are less than about 8 years old. |
| Discord (10 MB), Discord (50 MB) | You're posting a video to Discord. |
| Email (20 MB) | You're attaching a video to an email. |

### 4. Press Compress

Click **Compress** at the top right. Each file shows its progress and how long it has left. The bar at the bottom of the window shows the whole queue.

![SquashForge part way through. Each file shows a progress bar and time left.](docs/screenshots/compressing.png)

You can keep using your PC while it works, but it will be slower than usual because SquashForge uses the whole processor. Your PC won't go to sleep on its own until the queue is finished.

### 5. Find your new files

When everything is done, an **All done** box appears under the queue. Click **Open the folder** to see your new files.

![The All done box, showing that 81 MB was saved across 7 files.](docs/screenshots/done.png)

Unless you change it, each new file is saved next to its original with `_compressed` added to the name. So `holiday.jpg` becomes `holiday_compressed.jpg`. Your originals are left alone.

If a compressed file would come out bigger than the original (it happens with files that were already squeezed hard), SquashForge keeps the original and says so.

## Common jobs, step by step

### Make a video small enough for Discord

Click the video, open the **Videos** tab, choose **Discord (10 MB)** from the preset menu and press **Compress**. SquashForge works out the right quality for the length of your video. If the result still comes out too big, it tries again automatically.

For a different limit, change **Quality** to **Target size** and type the size in MB.

### Cut the start or end off a video

Click the video and open the **Videos** tab. Under **Trim**, drag the two dots on the slider, or type the start and end times (for example `0:02` and `1:15`). The trim only applies to that one video.

![The Trim section, keeping 9.5 seconds from the middle of a 14 second video.](docs/screenshots/trim-video.png)

### Get photos under a size limit

Choose **Under 500 KB** or **Under 2 MB** from the Photos preset menu. For any other size, choose **Max size** under **Compression** and type the limit. SquashForge picks the best quality that fits. If even the lowest quality is too big, it shrinks the photo until it fits.

### Give one file different settings

Click the file, then choose **This photo only** (or **This video only**) at the top of the settings. Anything you change now only affects that file, and the queue marks it with "own settings". Choose **All photos** to put it back on the shared settings.

### Save everything into one folder

Open the **Output** tab, choose **Folder** and pick where the files should go. If you added a whole folder, **Keep subfolders** recreates its layout inside the destination, so two files called `IMG_0001.jpg` from different days won't clash.

![The Output tab with the save options.](docs/screenshots/output-settings.png)

### Replace the originals

Open the **Output** tab and choose **Replace**. Each compressed file takes the original's place, and the original goes to the Recycle Bin, so you can still get it back.

### Compress straight from File Explorer

If you installed SquashForge, right-click a photo, a video or a folder and choose **Compress with SquashForge**. On Windows 11, click **Show more options** first. You can also select lots of files, right-click, and choose **Send to**, then **SquashForge**.

### Let it run overnight

Once compressing has started, the bar at the bottom of the window shows **When done**. Choose **Sleep** or **Shut down**. When the queue finishes you get a minute to cancel before it happens.

### Use your graphics card for faster video

On the **Videos** tab, the **Encoder** row shows **NVENC** (NVIDIA), **QSV** (Intel) and **AMF** (AMD). Any that your PC supports can be clicked. They are much faster than **CPU**, and the files come out a little bigger for the same quality. Greyed-out options mean that graphics card isn't in your PC or its driver is too old.

## What the settings mean

Most options have a short explanation right under them in the app. Here is the longer version.

### Photos

| Setting | What it does |
| --- | --- |
| Format | **Same** keeps each file's type. **JPEG** works everywhere. **PNG** is for graphics and screenshots. **WebP** is about 30% smaller than JPEG and fine for websites. **AVIF** is the smallest but slowest to make. |
| Quality | 1 to 100. Around 80 looks the same as the original for most photos. Below 60 you may start to see blotches. |
| Lossless | Makes the file smaller without changing any pixels. For JPEGs it removes hidden data only. Saves less than Quality mode. |
| Max size | Finds the best quality that fits under a size you choose. |
| Strip metadata | Removes hidden information such as the camera model and the GPS location where the photo was taken. Good for privacy. Photos are turned the right way up first. |
| Resize | Makes photos smaller in pixels. **Percent** scales everything by the same amount. **Fit in box** keeps photos inside a width and height you choose. It never makes a photo bigger. |

### Videos

| Setting | What it does |
| --- | --- |
| Codec | **H.264** plays on everything. **H.265** makes files about half the size, but some older devices can't play it. **AV1** is the smallest but slow to make. **VP9** is mainly for websites. |
| Container | The file type: **MP4** for most uses, **MKV** keeps extra subtitle tracks, **WebM** is for websites. |
| Encoder | **CPU** gives the smallest files. The graphics card options are much faster. |
| Speed | Slower settings squeeze the file harder at the same quality. |
| Quality | Lower numbers mean better quality and bigger files. The shaded part of the slider is the range most people use. |
| Target size | Aims for an exact file size instead of a quality level. |
| Resolution | Makes the picture smaller, for example 4K down to 1080p. It never makes a video bigger. |
| Frame rate | Caps the frames per second. 30 is plenty for most clips. |
| Audio | **Passthrough** keeps the sound exactly as it is. **AAC** and **Opus** re-compress it. **No audio** removes it. |

### Output

| Setting | What it does |
| --- | --- |
| Beside original | Saves the new file next to the original with an ending added to the name, `_compressed` unless you change it. |
| Folder | Saves everything into a folder you choose. |
| Replace | The new file takes the original's place. Originals go to the Recycle Bin. |
| Keep the original if the result is bigger | Leaves files alone when compressing wouldn't help. |
| Keep the modified date | Gives the new file the same date as the original, so photo apps keep them in order. |

Your settings are remembered the next time you open SquashForge. The arrow button next to the preset menu puts a tab back to its defaults. The bookmark button saves your current settings as a preset of your own.

## Something went wrong

### "Windows protected your PC"

Click **More info**, then **Run anyway**. See [Install it](#install-it).

### A file has red text under it

That file couldn't be compressed, and the red text says why in plain words. Hover over it to see the technical details. The usual causes:

- The file is open in another program. Close it and click the circular arrow next to the file to try again.
- The disk is full, or you picked a folder you can't save to. Choose another folder in the **Output** tab.
- The file is damaged. Check it opens in another program.
- A graphics card encoder failed to start. Switch **Encoder** to **CPU**, or update your graphics driver.

### It says "Original kept"

The compressed version would have been bigger than the file you started with, so SquashForge left the original as it was. This is normal for files that were already compressed hard.

### I can't find my files

Click **Help** at the top of the window. It tells you exactly where new files are being saved with your current settings. You can also click the folder icon that appears when you hover over a finished file.

### I replaced my originals by mistake

They are in the Recycle Bin. Open it, select them and click **Restore**.

### Compressing a video is slow

Video takes time, especially long 4K videos. You can speed it up by choosing **Fast** or **Fastest** under **Speed**, a lower **Resolution**, or a graphics card **Encoder** if yours is supported. The time left shown next to each file gets more accurate the more you use SquashForge.

### My PC is slow while it works

That is expected. SquashForge uses every processor core to finish sooner. It goes back to normal when the queue is done.

## Keyboard shortcuts

| Keys | What it does |
| --- | --- |
| Ctrl + O | Add files |
| Ctrl + Enter | Start compressing |
| Up / Down arrows | Move through the queue |
| Delete | Remove the selected file from the queue (it stays on your disk) |
| Mouse wheel over the picture | Zoom in and out |
| Double-click the picture | Zoom to 100% and back |
| Double-click a finished file | Open the compressed file |

![The Help box inside SquashForge.](docs/screenshots/help.png)

## For developers

SquashForge is an Electron app written in TypeScript, with a React 19, Tailwind CSS and Zustand interface. Photos go through [sharp](https://sharp.pixelplumbing.com) (libvips) and videos through a bundled FFmpeg.

### Build it

You need Node.js 22 or newer.

```bash
npm install
npm run fetch:ffmpeg      # downloads FFmpeg for Windows into binaries/win
npm run dist:win          # makes the installer and portable .exe in release/<version>
```

Build the Windows packages on Windows, because `npm install` fetches the image library for the machine it runs on. GitHub Actions does this for every push (the **Windows installer** job). The files are under that run's **Artifacts**.

### Run it while you work on it

```bash
npm run fetch:ffmpeg -- linux   # Linux only; on Windows use the command above
npm run dev                     # opens the app and reloads when you save
npm test                        # engine, queue and ETA tests, including real encodes
npm run typecheck
```

Without fetched binaries the app uses `ffmpeg` and `ffprobe` from your `PATH`. `SQUASHFORGE_FFMPEG_DIR` points it at another folder, and `SQUASHFORGE_USER_DATA` gives it a separate settings folder.

### Making a release

Push a tag that starts with `v`, for example `git tag v0.1.0 && git push origin v0.1.0`. The workflow builds the installer and portable exe and attaches both to a GitHub release, which is where the download links in this README point.

### How the code is laid out

```text
src/
├── main/                      Electron main process
│   ├── index.ts               window, taskbar progress, notifications, quit guard
│   ├── hardware.ts            CPU, GPU and RAM detection, encoder test runs
│   ├── systemMonitor.ts       live CPU, GPU and encoder load
│   ├── power.ts               sleep or shut down when the queue is done
│   ├── services/
│   │   ├── imageProcessor.ts  sharp pipelines, target-size search, previews
│   │   ├── jpegStrip.ts       lossless JPEG metadata removal
│   │   ├── bmp.ts             BMP decoder (sharp's libvips has none)
│   │   ├── videoProcessor.ts  ffprobe, FFmpeg arguments, two-pass, trims, previews
│   │   ├── etaCalculator.ts   hardware speed model, live ETA, per-PC calibration
│   │   ├── jobQueue.ts        photo and video lanes, safe saving, run totals
│   │   ├── friendlyErrors.ts  plain-English error messages
│   │   ├── mediaResolver.ts   expands dropped folders and reads media info
│   │   └── outputPaths.ts     output naming rules
│   └── ipc/handlers.ts        messages between the window and the main process
├── preload/index.ts           the window.api bridge
├── renderer/src/              the interface
└── shared/                    types, codec tables, presets, formatting
build/installer.nsh            adds the right-click menu and Send to entry
```

The build uses [electron-vite](https://electron-vite.org), so its config is `electron.vite.config.ts`. Packaging settings are in `electron-builder.json5`.

## Licences

SquashForge is MIT licensed. It ships the GPL "shared" build of FFmpeg from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) as separate programs, with FFmpeg's licence in `resources/bin/FFMPEG-LICENSE.txt` inside the install folder. FFmpeg's source code is available from that project and from [ffmpeg.org](https://ffmpeg.org).
