import type { Musician, PlaylistEntry, SharedPlaylistView } from '../types'

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function encodeSharePayloadBase64Url(payload: unknown) {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeSharePayloadBase64Url(raw: string) {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4)
  const padded = `${normalized}${'='.repeat(padLength)}`
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

const MAX_SHARED_PAYLOAD_PARAM_LENGTH = 200_000
const MAX_SHARED_MUSICIANS_PARAM_LENGTH = 60_000
const MAX_SHARED_PLAYLIST_ENTRIES = 1500
const MAX_SHARED_MUSICIANS = 300
const MAX_SHARED_ID_LENGTH = 120
const MAX_SHARED_TITLE_LENGTH = 200
const MAX_SHARED_ARTIST_LENGTH = 160
const MAX_SHARED_URL_LENGTH = 4096
const MAX_SHARED_TAGS_PER_ENTRY = 24
const MAX_SHARED_ASSIGNMENTS_PER_ENTRY = 24
const MAX_SHARED_BAND_NAME_LENGTH = 160
const MAX_SHARED_GIG_NAME_LENGTH = 180
const MAX_SHARED_DATE_LENGTH = 40
const MAX_SHARED_VENUE_LENGTH = 240
const MAX_SHARED_MUSICIAN_NAME_LENGTH = 140
const MAX_SHARED_EMAIL_LENGTH = 254
const MAX_SHARED_PHONE_LENGTH = 48
const MAX_SHARED_INSTRUMENTS_PER_MUSICIAN = 16
const MAX_SHARED_INSTRUMENT_LENGTH = 64

function sanitizeSharedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.slice(0, maxLength)
}

function sanitizeSharedUrl(value: unknown, maxLength: number): string {
  const trimmed = sanitizeSharedText(value, maxLength)
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return trimmed
  } catch {
    return ''
  }
}

function sanitizeSharedStringArray(values: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const next: string[] = []
  values.forEach((value) => {
    if (next.length >= maxItems) return
    const sanitized = sanitizeSharedText(value, maxItemLength)
    if (!sanitized) return
    const key = sanitized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    next.push(sanitized)
  })
  return next
}

function sanitizePlaylistEntry(entry: unknown, index: number): PlaylistEntry | null {
  if (!entry || typeof entry !== 'object') return null
  const source = entry as Partial<PlaylistEntry>
  const key = sanitizeSharedText(source.key, MAX_SHARED_ID_LENGTH) || `entry:${index}`
  const title = sanitizeSharedText(source.title, MAX_SHARED_TITLE_LENGTH) || 'Untitled Song'
  const artist = sanitizeSharedText(source.artist, MAX_SHARED_ARTIST_LENGTH)
  const audioUrl = sanitizeSharedUrl(source.audioUrl, MAX_SHARED_URL_LENGTH)
  const songId = sanitizeSharedText(source.songId, MAX_SHARED_ID_LENGTH)
  const tags = sanitizeSharedStringArray(source.tags, MAX_SHARED_TAGS_PER_ENTRY, MAX_SHARED_TITLE_LENGTH)
  const assignmentSingers = sanitizeSharedStringArray(
    source.assignmentSingers,
    MAX_SHARED_ASSIGNMENTS_PER_ENTRY,
    MAX_SHARED_TITLE_LENGTH,
  )
  const assignmentKeys = sanitizeSharedStringArray(
    source.assignmentKeys,
    MAX_SHARED_ASSIGNMENTS_PER_ENTRY,
    MAX_SHARED_TITLE_LENGTH,
  )
  return {
    key,
    title,
    ...(artist ? { artist } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    tags: tags.length ? tags : ['Setlist'],
    ...(songId ? { songId } : {}),
    ...(assignmentSingers.length ? { assignmentSingers } : {}),
    ...(assignmentKeys.length ? { assignmentKeys } : {}),
  }
}

function sanitizeMusician(entry: unknown, index: number): Musician | null {
  if (!entry || typeof entry !== 'object') return null
  const source = entry as Partial<Musician>
  const id = sanitizeSharedText(source.id, MAX_SHARED_ID_LENGTH) || `musician:${index}`
  const name = sanitizeSharedText(source.name, MAX_SHARED_MUSICIAN_NAME_LENGTH)
  if (!name) return null
  const roster = source.roster === 'sub' ? 'sub' : 'core'
  const instruments = sanitizeSharedStringArray(
    source.instruments,
    MAX_SHARED_INSTRUMENTS_PER_MUSICIAN,
    MAX_SHARED_INSTRUMENT_LENGTH,
  )
  const singer =
    source.singer === 'male' || source.singer === 'female' || source.singer === 'other'
      ? source.singer
      : undefined
  const email = sanitizeSharedText(source.email, MAX_SHARED_EMAIL_LENGTH)
  const phone = sanitizeSharedText(source.phone, MAX_SHARED_PHONE_LENGTH)
  return {
    id,
    name,
    roster,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    instruments,
    ...(singer ? { singer } : {}),
  }
}

function sanitizeMusiciansList(entries: unknown[]): Musician[] {
  const cappedEntries = entries.length > MAX_SHARED_MUSICIANS ? entries.slice(0, MAX_SHARED_MUSICIANS) : entries
  const deduped = new Map<string, Musician>()
  cappedEntries.forEach((entry, index) => {
    const sanitized = sanitizeMusician(entry, index)
    if (!sanitized) return
    const key = sanitized.id.toLowerCase()
    if (deduped.has(key)) return
    deduped.set(key, sanitized)
  })
  return Array.from(deduped.values())
}

export function sanitizeSharedPlaylistView(view: SharedPlaylistView | null): SharedPlaylistView | null {
  if (!view || typeof view !== 'object') return null
  const setlistId = sanitizeSharedText(view.setlistId, MAX_SHARED_ID_LENGTH)
  if (!setlistId) return null
  const entriesRaw = Array.isArray(view.entries) ? view.entries : []
  if (entriesRaw.length === 0 || entriesRaw.length > MAX_SHARED_PLAYLIST_ENTRIES) return null
  const entries = entriesRaw
    .map((entry, index) => sanitizePlaylistEntry(entry, index))
    .filter((entry): entry is PlaylistEntry => Boolean(entry))
  if (entries.length === 0) return null
  const allEntriesRaw =
    Array.isArray(view.allEntries) && view.allEntries.length > 0 ? view.allEntries : entriesRaw
  const allEntries = allEntriesRaw
    .map((entry, index) => sanitizePlaylistEntry(entry, index))
    .filter((entry): entry is PlaylistEntry => Boolean(entry))
  return {
    setlistId,
    bandName: sanitizeSharedText(view.bandName, MAX_SHARED_BAND_NAME_LENGTH) || undefined,
    gigName: sanitizeSharedText(view.gigName, MAX_SHARED_GIG_NAME_LENGTH) || 'Shared Gig',
    date: sanitizeSharedText(view.date, MAX_SHARED_DATE_LENGTH),
    venueAddress: sanitizeSharedText(view.venueAddress, MAX_SHARED_VENUE_LENGTH) || undefined,
    musicians: Array.isArray(view.musicians) ? sanitizeMusiciansList(view.musicians) : undefined,
    entries,
    allEntries: allEntries.length ? allEntries : entries,
  }
}

export function parseSharedPlaylistPayload(raw: string) {
  if (!raw || raw.length > MAX_SHARED_PAYLOAD_PARAM_LENGTH) return null
  const candidates = [raw, safeDecodeURIComponent(raw)]
  for (const candidate of candidates) {
    if (!candidate || candidate.length > MAX_SHARED_PAYLOAD_PARAM_LENGTH) continue
    try {
      const parsed = JSON.parse(candidate) as SharedPlaylistView
      const sanitized = sanitizeSharedPlaylistView(parsed)
      if (sanitized) return sanitized
    } catch {
      // Continue to base64 decode attempts.
    }
    try {
      const decoded = decodeSharePayloadBase64Url(candidate)
      const parsed = JSON.parse(decoded) as SharedPlaylistView
      const sanitized = sanitizeSharedPlaylistView(parsed)
      if (sanitized) return sanitized
    } catch {
      // Continue to next candidate.
    }
  }
  return null
}

function parseSharedMusiciansPayload(raw: string | null) {
  if (!raw) return []
  if (raw.length > MAX_SHARED_MUSICIANS_PARAM_LENGTH) return []
  const candidates = [raw, safeDecodeURIComponent(raw)]
  for (const candidate of candidates) {
    if (!candidate || candidate.length > MAX_SHARED_MUSICIANS_PARAM_LENGTH) continue
    try {
      const parsed = JSON.parse(candidate) as Musician[]
      if (Array.isArray(parsed)) return sanitizeMusiciansList(parsed)
    } catch {
      // Continue to base64 decode attempts.
    }
    try {
      const decoded = decodeSharePayloadBase64Url(candidate)
      const parsed = JSON.parse(decoded) as Musician[]
      if (Array.isArray(parsed)) return sanitizeMusiciansList(parsed)
    } catch {
      // Continue to next candidate.
    }
  }
  return []
}

export function parseSharedPlaylistQuery(search: string) {
  const params = new URLSearchParams(search)
  if (params.get('playlist') !== '1') return null
  const setlistId = sanitizeSharedText(params.get('setlist'), MAX_SHARED_ID_LENGTH)
  if (!setlistId) return null
  const requestedIndexRaw = Number.parseInt(params.get('item') ?? '0', 10)
  const requestedIndex =
    Number.isFinite(requestedIndexRaw) && requestedIndexRaw >= 0 ? requestedIndexRaw : 0
  const sharedBandNameParam = sanitizeSharedText(
    safeDecodeURIComponent(params.get('band') ?? ''),
    MAX_SHARED_BAND_NAME_LENGTH,
  )
  const sharedMusiciansParam = parseSharedMusiciansPayload(params.get('musicians'))
  const payloadEncoded = params.get('data')
  const parsedPayload = payloadEncoded ? parseSharedPlaylistPayload(payloadEncoded) : null
  return {
    setlistId,
    requestedIndex,
    sharedBandNameParam,
    sharedMusiciansParam,
    parsedPayload,
  }
}

export function openExternalUrlSafely(url: string) {
  const sanitized = sanitizeSharedUrl(url, MAX_SHARED_URL_LENGTH)
  if (!sanitized) return
  window.open(sanitized, '_blank', 'noopener,noreferrer')
}

export function getSpotifyEmbedUrl(url: string | null) {
  try {
    if (!url) return ''
    const parsed = new URL(url)
    if (parsed.hostname.includes('open.spotify.com')) {
      return `https://open.spotify.com/embed${parsed.pathname}`
    }
  } catch {
    return url ?? ''
  }
  return url ?? ''
}
