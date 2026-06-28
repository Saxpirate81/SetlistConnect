/**
 * Centralized localStorage access.
 *
 * All keys are defined here. Import from this module instead of using
 * raw localStorage calls or magic strings anywhere in the app.
 *
 * Usage:
 *   import { storage } from './lib/storage'
 *   storage.set('activeBandId', bandId)
 *   const id = storage.get('activeBandId') ?? ''
 */

// ─── Key registry ─────────────────────────────────────────────────────────────
// Single source of truth for all localStorage key strings.

export const STORAGE_KEYS = {
  activeBandId:            'setlist:activeBandId',
  lastActive:              'setlist:lastActive',
  lastMainScreen:          'setlist:lastMainScreen',
  gigLockedSongs:          'setlist:gigLockedSongs',
  gigLastLockedSong:       'setlist:gigLastLockedSong',
  sharedLyricsTheme:       'setlist:sharedLyricsTheme',
  sharedLyricsFont:        'setlist:sharedLyricsFont',
  lyricsDocState:          'setlist:lyricsDocState:v1',
  lyricsUserPrefs:         'setlist:lyricsUserPrefs:v1',
  lyricsViewerId:          'setlist:lyricsViewerId',
  gigDeletedSectionSongs:  'setlist:gigDeletedSectionSongs:v1',
  sharedSignupReturn:      'setlist:sharedSignupReturnView',
  logSessionId:            'setlist:logSessionId',
  buildComplete:           'setlist_build_complete',
  gigSections:             'setlist_gig_sections',
  hiddenGigSections:       'setlist_hidden_gig_sections',
  hiddenSpecialSection:    'setlist_hidden_special_section',
  specialRequestOrder:     'setlist_special_request_order',
} as const

export type StorageKey = keyof typeof STORAGE_KEYS

// ─── Typed helpers ────────────────────────────────────────────────────────────

export const storage = {
  get(key: StorageKey): string | null {
    try {
      return localStorage.getItem(STORAGE_KEYS[key])
    } catch {
      return null
    }
  },

  set(key: StorageKey, value: string): void {
    try {
      localStorage.setItem(STORAGE_KEYS[key], value)
    } catch {
      console.warn('[storage] Failed to write key:', key)
    }
  },

  remove(key: StorageKey): void {
    try {
      localStorage.removeItem(STORAGE_KEYS[key])
    } catch {
      console.warn('[storage] Failed to remove key:', key)
    }
  },

  getJSON<T>(key: StorageKey): T | null {
    const raw = this.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      this.remove(key)
      return null
    }
  },

  setJSON<T>(key: StorageKey, value: T): void {
    try {
      this.set(key, JSON.stringify(value))
    } catch {
      console.warn('[storage] Failed to serialize key:', key)
    }
  },
}
