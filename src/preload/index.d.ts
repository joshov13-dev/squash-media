import type { SquashApi } from '../shared/ipc'

declare global {
  interface Window {
    api: SquashApi
  }
}

export {}
