// Renders build/icon.svg into the PNG electron-builder turns into the .ico.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const svg = await readFile(resolve(root, 'build/icon.svg'))
await sharp(svg, { density: 144 }).resize(512, 512).png({ compressionLevel: 9 }).toFile(resolve(root, 'build/icon.png'))
console.log('Wrote build/icon.png')
