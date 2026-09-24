import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
  },
  preload: {
    resolve: { alias: sharedAlias },
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
})
