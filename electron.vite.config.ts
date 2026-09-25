import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

/** Lock the packaged renderer down. Dev needs inline scripts for React refresh. */
function contentSecurityPolicy(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
  return {
    name: 'squashforge-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  }
}

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      rollupOptions: {
        // The app, plus the command line and AI (MCP) server that run without a window.
        input: { index: resolve(__dirname, 'src/main/index.ts'), cli: resolve(__dirname, 'src/main/cli/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    build: { minify: true },
  },
})
