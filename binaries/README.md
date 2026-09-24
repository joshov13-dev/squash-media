# Bundled FFmpeg binaries

SquashForge ships `ffmpeg` and `ffprobe` inside the installer. On Windows it
uses the shared build: two small executables plus the FFmpeg DLLs they both
load, which is about 190 MB instead of 330 MB for two static executables.
They are not committed to git. Fetch them with:

```bash
npm run fetch:ffmpeg            # Windows x64 build into binaries/win
npm run fetch:ffmpeg -- linux   # Linux x64 build into binaries/linux (for local development)
```

The Windows build comes from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
(GPL shared variant, which includes x264, x265, SVT-AV1, libvpx, NVENC, QSV and AMF).
Its licence file is copied next to the binaries and packaged with the app.

When running `npm run dev` without fetched binaries the app falls back to
`ffmpeg`/`ffprobe` on your `PATH`.
