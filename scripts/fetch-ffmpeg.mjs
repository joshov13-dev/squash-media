// Downloads ffmpeg + ffprobe into binaries/<platform>.
//
//   node scripts/fetch-ffmpeg.mjs          -> Windows x64 (for packaging)
//   node scripts/fetch-ffmpeg.mjs linux    -> Linux x64 (development and the Linux packages)
//   node scripts/fetch-ffmpeg.mjs mac-arm64 / mac-x64 -> macOS (Apple silicon / Intel)
//
// Windows uses the "shared" build: ffmpeg.exe and ffprobe.exe are tiny and
// load the same set of DLLs, so the pair is about 190 MB instead of the
// 330 MB two static executables would take.
//
// Override the download with FFMPEG_URL=<zip or tar.xz url>.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = process.argv[2] ?? 'win'
const BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'

// BtbN publishes the newest release branch and master under the rolling
// "latest" tag. The release branch is preferred; master is the fallback when
// the branch name moves on.
const SOURCES = {
  win: {
    dir: 'win',
    exe: '.exe',
    libraries: /\.dll$/i,
    urls: [`${BASE}/ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip`, `${BASE}/ffmpeg-master-latest-win64-gpl-shared.zip`],
  },
  // Static on Linux: it is only used for development, and a shared build
  // would need its lib folder kept alongside.
  linux: {
    dir: 'linux',
    exe: '',
    libraries: null,
    urls: [`${BASE}/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz`, `${BASE}/ffmpeg-master-latest-linux64-gpl.tar.xz`],
  },
}

// Martin Riedl's static macOS builds come as one zip per program.
const RIEDL = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos'
for (const [name, arch] of [['mac-arm64', 'arm64'], ['mac-x64', 'amd64']]) {
  SOURCES[name] = {
    dir: name,
    exe: '',
    libraries: null,
    split: { ffmpeg: `${RIEDL}/${arch}/release/ffmpeg.zip`, ffprobe: `${RIEDL}/${arch}/release/ffprobe.zip` },
  }
}

const source = SOURCES[target]
if (!source) {
  console.error(`Unknown target "${target}". Use win, linux, mac-arm64 or mac-x64.`)
  process.exit(1)
}

const outDir = join(root, 'binaries', source.dir)
const urls = process.env.FFMPEG_URL ? [process.env.FFMPEG_URL] : source.urls
const work = mkdtempSync(join(os.tmpdir(), 'squashforge-ffmpeg-'))

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' })
}

function download(url, dest) {
  // curl ships with Windows 10+, macOS and every CI image, and honours proxies.
  run('curl', ['-L', '--fail', '--retry', '3', '--silent', '--show-error', '-o', dest, url])
}

function extract(archive, dest) {
  mkdirSync(dest, { recursive: true })
  if (archive.endsWith('.tar.xz')) return run('tar', ['-xJf', archive, '-C', dest])
  if (process.platform === 'win32') return run('tar', ['-xf', archive, '-C', dest])
  try {
    run('unzip', ['-q', archive, '-d', dest])
  } catch {
    run('python3', ['-m', 'zipfile', '-e', archive, dest])
  }
}

function find(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      const hit = find(p, name)
      if (hit) return hit
    } else if (entry === name) {
      return p
    }
  }
  return null
}

if (source.split) {
  try {
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
    for (const [tool, url] of Object.entries(source.split)) {
      const zip = join(work, `${tool}.zip`)
      console.log(`Downloading ${url}`)
      download(url, zip)
      extract(zip, join(work, tool))
      const file = find(join(work, tool), tool)
      if (!file) throw new Error(`${tool} not found in the archive`)
      copyFileSync(file, join(outDir, tool))
      chmodSync(join(outDir, tool), 0o755)
    }
    writeFileSync(
      join(outDir, 'FFMPEG-LICENSE.txt'),
      'FFmpeg static build for macOS by Martin Riedl (https://ffmpeg.martin-riedl.de), licensed under the GNU GPL version 3.\nSource code: https://ffmpeg.org/download.html\n',
    )
    console.log(`ffmpeg and ffprobe are in ${outDir}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  process.exit(0)
}

try {
  let archive = null
  for (const url of urls) {
    const name = url.split('/').pop()
    const dest = join(work, name)
    try {
      console.log(`Downloading ${url}`)
      download(url, dest)
      archive = dest
      break
    } catch {
      console.warn(`  failed, trying the next source`)
    }
  }
  if (!archive) throw new Error('Every download source failed')

  const unpacked = join(work, 'unpacked')
  extract(archive, unpacked)

  // Start clean so DLLs from an older build never mix with new ones.
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const file = find(unpacked, tool + source.exe)
    if (!file) throw new Error(`${tool}${source.exe} not found in the archive`)
    const dest = join(outDir, tool + source.exe)
    copyFileSync(file, dest)
    if (!source.exe) chmodSync(dest, 0o755)
  }
  if (source.libraries) {
    const binDir = dirname(find(unpacked, 'ffmpeg' + source.exe))
    for (const entry of readdirSync(binDir)) {
      if (source.libraries.test(entry)) copyFileSync(join(binDir, entry), join(outDir, entry))
    }
  }
  const licence = find(unpacked, 'LICENSE.txt')
  if (licence) copyFileSync(licence, join(outDir, 'FFMPEG-LICENSE.txt'))

  const hostMatches = (target === 'win' && process.platform === 'win32') || (target === 'linux' && process.platform === 'linux')
  if (hostMatches) {
    const version = execFileSync(join(outDir, 'ffmpeg' + source.exe), ['-hide_banner', '-version']).toString().split('\n')[0]
    console.log(version)
  }
  console.log(`ffmpeg and ffprobe are in ${outDir}`)
} finally {
  if (existsSync(work)) rmSync(work, { recursive: true, force: true })
}
