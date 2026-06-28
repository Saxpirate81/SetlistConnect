import type { BandTier, LyricsUserPrefs } from '../types'

// ─── Session ──────────────────────────────────────────────────────────────────
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours

// ─── Instruments ──────────────────────────────────────────────────────────────
export const INSTRUMENTS = ['Vocals', 'Guitar', 'Keys', 'Bass', 'Drums', 'Sax', 'Trumpet']
export const INSTRUMENTAL_LABEL = 'Instrumental'

// ─── Default tags & types ─────────────────────────────────────────────────────
export const DEFAULT_TAGS = ['Special Request', 'DJ Only', 'Dinner', 'Latin', 'Dance']
export const DEFAULT_SPECIAL_TYPES = [
  'First Dance',
  'Last Dance',
  'Parent Dance',
  'Anniversary',
  'DJ Only',
]
export const REQUEST_TYPE_TAG_EXCLUSIONS = [
  'Special Request',
  'Special Requests',
  'Additional Request',
  'Bride/Father',
  'Bride/Father Dance',
  'First Dance',
  'Last Dance',
  'Parent Dance',
  'Wedding Party Intro',
  'Anniversary',
  'Anniversary Dance',
  'Hora',
  'HORA',
  'HORA!',
]

// ─── Setlist builder ──────────────────────────────────────────────────────────
export const SETLIST_PANEL_PREFIX = 'set:'
export const GIG_SECTION_TAG_PREFIX = '__gigsection__'
export const GIG_SECTION_DELETED_TAG_PREFIX = '__gigsectiondeleted__'

// ─── Print layout ─────────────────────────────────────────────────────────────
export const PRINT_SPECIAL_REQUESTS_PER_SECTION = 8
export const PRINT_DEFAULT_SONGS_PER_SECTION = 18
export const PRINT_DANCE_SONGS_PER_SECTION = 20

// ─── Origin / auth ────────────────────────────────────────────────────────────
export const DEFAULT_PRODUCTION_APP_ORIGIN = 'https://www.setlistconnect.com'
export const LOCALHOST_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

// ─── Billing ──────────────────────────────────────────────────────────────────
export const BILLING_TEST_EMAILS = new Set(
  String(import.meta.env.VITE_BILLING_TEST_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
)

export const BAND_TIER_DETAILS: Record<
  BandTier,
  { name: string; summary: string; includes: string[] }
> = {
  free: {
    name: 'Beta Free',
    summary: 'Free during the beta period',
    includes: [
      'Unlimited songs',
      'Unlimited musicians during beta',
      'Unlimited saved gigs during beta',
      'Core setlist builder',
      'Special request tracking',
      'Shareable gig view',
      'Paid storage and pro tools will come later',
    ],
  },
  pro: {
    name: 'Pro',
    summary: 'Coming after beta',
    includes: [
      'Unlimited songs',
      'Unlimited musicians',
      'Unlimited saved gigs',
      'Core setlist builder',
      'Special request tracking',
      'Shareable gig view',
      'Advanced collaboration tools',
      'Expanded storage',
      'Priority workflow features',
    ],
  },
}

// ─── Lyrics ───────────────────────────────────────────────────────────────────
export const LYRICS_COLOR_SWATCHES = [
  '#fde047',
  '#facc15',
  '#fb7185',
  '#f97316',
  '#34d399',
  '#38bdf8',
  '#a78bfa',
  '#f472b6',
  '#60a5fa',
  '#ffffff',
]

export const DEFAULT_LYRICS_USER_PREFS: LyricsUserPrefs = {
  theme: 'dark',
  font: 'sans',
  fontScale: 1,
  centered: false,
}
