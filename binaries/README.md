# Bundled FFmpeg binaries

SquashMedia ships `ffmpeg` and `ffprobe` inside the installer. On Windows it
uses the shared build: two small executables plus the FFmpeg DLLs they both
load, which take about 190 MB on disk once unpacked, instead of 330 MB for two
static executables. That is not the download size: the installer compresses
everything, and the whole Windows installer for 0.4.0 was about 160 MB.
They are not committed to git. Fetch them with:

```bash
npm run fetch:ffmpeg            # Windows x64 build into binaries/win
npm run fetch:ffmpeg -- linux   # Linux x64 build into binaries/linux (for local development)
```

The Windows build comes from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
(GPL shared variant, which includes x264, x265, SVT-AV1, libvpx, NVENC, QSV and AMF).
Its licence file is copied next to the binaries and packaged with the app.

When running `npm run dev` without fetched binaries the app falls back to
`ffmpeg`/`ffprobe` on your `PATH`. If neither is there, the app tells the user
that a part of it is missing and to reinstall, since installed copies always
include FFmpeg. That message is aimed at people using a download, not at
developers; fetch the binaries as above.
