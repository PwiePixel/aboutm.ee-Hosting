import type { WorldStatus } from './runtime/types'

export const STATUS_LABEL: Record<WorldStatus, string> = {
  paused: 'Pausiert',
  queued: 'Wartet',
  starting: 'Startet',
  online: 'Online',
  stopping: 'Pausiert …',
}
