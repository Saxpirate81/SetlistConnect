/**
 * Setlist Connect — User Activity Logger
 *
 * Tracks user events to Supabase's `user_activity_logs` table.
 * Falls back to console.info in local/offline mode.
 *
 * Usage:
 *   import { logger } from './lib/logger'
 *   logger.log('song_added', { songId: '...', title: 'My Song' })
 *   logger.log('gig_created', { gigId: '...', gigName: 'Saturday Night' })
 */

import { supabase } from './supabaseClient'

// ─── Event catalog ────────────────────────────────────────────────────────────
// Add new event names here as the app grows.

export type LogEvent =
  // Auth
  | 'login'
  | 'logout'
  | 'signup'
  | 'password_reset_requested'
  | 'session_expired'
  // Songs
  | 'song_added'
  | 'song_edited'
  | 'song_deleted'
  | 'song_searched'
  // Setlists / Gigs
  | 'gig_created'
  | 'gig_deleted'
  | 'gig_opened'
  | 'gig_mode_started'
  | 'gig_shared'
  // Setlist builder
  | 'song_added_to_setlist'
  | 'song_removed_from_setlist'
  | 'song_reordered'
  | 'section_created'
  | 'section_deleted'
  // Special requests
  | 'special_request_added'
  | 'special_request_edited'
  | 'special_request_deleted'
  // Musicians
  | 'musician_added'
  | 'musician_edited'
  | 'musician_deleted'
  | 'musician_invited'
  // Documents / Charts
  | 'document_uploaded'
  | 'document_viewed'
  | 'document_deleted'
  // Export / Print
  | 'pdf_exported'
  | 'setlist_copied_to_clipboard'
  | 'offline_export_triggered'
  // Billing
  | 'upgrade_initiated'
  | 'portal_opened'
  // Errors
  | 'supabase_error'
  | 'auth_error'
  | 'stripe_error'
  // Navigation
  | 'screen_viewed'
  | 'shared_link_opened'

export type LogPayload = Record<string, string | number | boolean | null | undefined>

export interface LogEntry {
  event: LogEvent
  payload?: LogPayload
  userId?: string | null
  bandId?: string | null
  sessionId?: string
  appVersion?: string
  clientInfo?: {
    userAgent: string
    screenWidth: number
    screenHeight: number
    standalone: boolean
  }
}

// ─── Session ID ───────────────────────────────────────────────────────────────
// Persists for the lifetime of the browser tab.

const SESSION_ID = (() => {
  try {
    const key = 'setlist:logSessionId'
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return 'unknown-session'
  }
})()

// ─── App version ──────────────────────────────────────────────────────────────

const APP_VERSION = String(import.meta.env.VITE_APP_VERSION ?? 'dev')

// ─── Client info ─────────────────────────────────────────────────────────────

const getClientInfo = () => ({
  userAgent: navigator.userAgent,
  screenWidth: window.screen.width,
  screenHeight: window.screen.height,
  standalone: Boolean(
    window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone,
  ),
})

// ─── In-memory queue for offline / pre-auth events ───────────────────────────

interface QueuedEntry extends LogEntry {
  queuedAt: string
}

const MAX_QUEUE_SIZE = 50
const queue: QueuedEntry[] = []

// ─── Context set by the app ───────────────────────────────────────────────────
// Call logger.setContext() after login/band switch to attach IDs automatically.

let _userId: string | null = null
let _bandId: string | null = null

// ─── Core log function ────────────────────────────────────────────────────────

async function send(entry: LogEntry): Promise<void> {
  if (!supabase) {
    // Local/offline mode — log to console only
    console.info('[logger]', entry.event, entry.payload ?? {})
    return
  }

  try {
    const { error } = await supabase.from('user_activity_logs').insert({
      event: entry.event,
      payload: entry.payload ?? {},
      user_id: entry.userId ?? _userId ?? null,
      band_id: entry.bandId ?? _bandId ?? null,
      session_id: entry.sessionId ?? SESSION_ID,
      app_version: entry.appVersion ?? APP_VERSION,
      client_info: entry.clientInfo ?? getClientInfo(),
      occurred_at: new Date().toISOString(),
    })

    if (error) {
      // Don't throw — logging must never crash the app
      console.warn('[logger] Failed to write log:', error.message)
    }
  } catch (err) {
    console.warn('[logger] Unexpected error:', err)
  }
}

// ─── Flush queued events ──────────────────────────────────────────────────────
// Called after login so pre-auth events (e.g. 'screen_viewed') get persisted.

async function flushQueue(): Promise<void> {
  if (!supabase || queue.length === 0) return
  const toFlush = queue.splice(0, queue.length)
  for (const entry of toFlush) {
    await send(entry)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
  /**
   * Set the current user and band context.
   * Call this after login and after band selection changes.
   */
  setContext(userId: string | null, bandId: string | null) {
    _userId = userId
    _bandId = bandId
    // Flush any events that were queued before login
    void flushQueue()
  },

  /**
   * Clear context on logout.
   */
  clearContext() {
    _userId = null
    _bandId = null
  },

  /**
   * Log a user event.
   *
   * @param event  - The event name from the LogEvent catalog
   * @param payload - Optional key/value data about the event
   * @param overrides - Optional userId/bandId to override the global context
   */
  log(
    event: LogEvent,
    payload?: LogPayload,
    overrides?: { userId?: string | null; bandId?: string | null },
  ): void {
    const entry: LogEntry = {
      event,
      payload,
      userId: overrides?.userId ?? _userId,
      bandId: overrides?.bandId ?? _bandId,
      sessionId: SESSION_ID,
      appVersion: APP_VERSION,
      clientInfo: getClientInfo(),
    }

    if (!supabase) {
      console.info('[logger]', entry.event, entry.payload ?? {})
      return
    }

    if (!_userId) {
      // Queue pre-auth events; flush after login
      if (queue.length < MAX_QUEUE_SIZE) {
        queue.push({ ...entry, queuedAt: new Date().toISOString() })
      }
      return
    }

    void send(entry)
  },

  /**
   * Log an error event. Automatically sets event to 'supabase_error',
   * 'auth_error', or 'stripe_error' based on source, or falls back to the
   * provided event name.
   */
  error(
    event: LogEvent,
    error: unknown,
    extraPayload?: LogPayload,
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    this.log(event, { error: message, ...extraPayload })
  },
}
