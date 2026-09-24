# Bundled FFmpeg binaries

SquashForge ships static `ffmpeg` and `ffprobe` builds inside the installer.
They are not committed to git. Fetch them with:

```bash
npm run fetch:ffmpeg            # Windows x64 build into binaries/win
npm run fetch:ffmpeg -- linux   # Linux x64 build into binaries/linux (for local development)
```

The Windows build comes from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
(GPL variant, which includes x264, x265, SVT-AV1, libvpx, NVENC, QSV and AMF).
Its licence file is copied next to the binaries and packaged with the app.

When running `npm run dev` without fetched binaries the app falls back to
`ffmpeg`/`ffprobe` on your `PATH`.
