/**
 * Client-side wrapper for the enrich-song-metadata Edge Function.
 */
import { supabase } from './supabaseClient'

export type EnrichResult = {
  year?: number
  genre?: string
  source: 'musicbrainz' | 'musicbrainz+ai' | 'ai' | 'unknown'
  error?: string
}

export const GENRE_OPTIONS = [
  'Pop',
  'Rock',
  'Alternative Rock',
  'Classic Rock',
  'Indie Rock',
  'R&B',
  'Soul',
  'Funk',
  'Motown',
  'Jazz',
  'Standards',
  'Swing',
  'Blues',
  'Country',
  'Folk',
  'Bluegrass',
  'Hip-Hop',
  'Rap',
  'Latin',
  'Reggae',
  'Afrobeats',
  'Electronic',
  'Dance',
  'EDM',
  'Gospel',
  'Christian',
  'Classical',
  'Opera',
  'Metal',
  'Punk',
  'Hard Rock',
  'Broadway',
  'Show Tunes',
  'Holiday',
  'Children',
] as const

export type Genre = (typeof GENRE_OPTIONS)[number]
let edgeFunctionUnavailable = false
let musicBrainzUnavailableUntil = 0
let musicBrainzOutageLogged = false

function normalizeGenre(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const direct = GENRE_OPTIONS.find((genre) => genre.toLowerCase() === trimmed.toLowerCase())
  if (direct) return direct
  const lower = trimmed.toLowerCase()
  if (lower.includes('rhythm') || lower.includes('r&b') || lower.includes('rnb')) return 'R&B'
  if (lower.includes('soul')) return 'Soul'
  if (lower.includes('funk')) return 'Funk'
  if (lower.includes('jazz')) return 'Jazz'
  if (lower.includes('standard')) return 'Standards'
  if (lower.includes('country')) return 'Country'
  if (lower.includes('hip')) return 'Hip-Hop'
  if (lower.includes('rock')) return 'Rock'
  if (lower.includes('pop')) return 'Pop'
  if (lower.includes('latin')) return 'Latin'
  if (lower.includes('reggae')) return 'Reggae'
  if (lower.includes('blues')) return 'Blues'
  if (lower.includes('gospel') || lower.includes('christian')) return 'Gospel'
  if (lower.includes('classical')) return 'Classical'
  if (lower.includes('metal')) return 'Metal'
  if (lower.includes('electronic') || lower.includes('edm') || lower.includes('dance')) return 'Dance'
  return trimmed
}

async function queryMusicBrainzFallback(title: string, artist: string): Promise<EnrichResult> {
  if (Date.now() < musicBrainzUnavailableUntil) {
    return {
      source: 'unknown',
      error: 'MusicBrainz is temporarily unavailable. Please try again in a few minutes.',
    }
  }

  const artistTrimmed = artist.trim()
  const query = artistTrimmed
    ? `recording:"${title}" AND artist:"${artistTrimmed}"`
    : `recording:"${title}"`
  const q = encodeURIComponent(query)
  const url = `https://musicbrainz.org/ws/2/recording?query=${q}&fmt=json&limit=3`
  try {
    let response: Response | null = null
    let attempt = 0
    while (attempt < 3) {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      })
      if (response.ok) break
      if (response.status !== 503 && response.status !== 429) break
      attempt += 1
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }

    if (!response || !response.ok) {
      const status = response?.status ?? 0
      if (status === 503 || status === 429) {
        musicBrainzUnavailableUntil = Date.now() + 5 * 60 * 1000
        if (!musicBrainzOutageLogged) {
          musicBrainzOutageLogged = true
          console.warn('[enrichSongMetadata] MusicBrainz temporarily unavailable, pausing requests for 5 minutes.')
        }
        return {
          source: 'unknown',
          error: 'MusicBrainz is temporarily unavailable. Please try again in a few minutes.',
        }
      }
      return { source: 'unknown', error: `MusicBrainz request failed (${status}).` }
    }
    musicBrainzOutageLogged = false
    const payload = await response.json()
    const recordings: Array<{
      score?: number
      'first-release-date'?: string
      releases?: Array<{ date?: string }>
      genres?: Array<{ name: string; count: number }>
      tags?: Array<{ name: string; count: number }>
    }> = payload?.recordings ?? []
    const top = recordings.find((recording) => (recording.score ?? 0) >= 80)
    if (!top) return { source: 'unknown' }

    const rawDate = top['first-release-date'] ??
      top.releases?.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))[0]?.date
    const parsedYear = rawDate ? Number.parseInt(rawDate.slice(0, 4), 10) : Number.NaN
    const year =
      Number.isFinite(parsedYear) && parsedYear > 1900 && parsedYear <= new Date().getFullYear() + 1
        ? parsedYear
        : undefined

    const genreCandidate =
      (top.genres ?? []).sort((a, b) => b.count - a.count)[0]?.name ??
      (top.tags ?? []).sort((a, b) => b.count - a.count)[0]?.name
    const genre = genreCandidate ? normalizeGenre(genreCandidate) : undefined
    if (!year && !genre) return { source: 'unknown' }
    return { year, genre, source: 'musicbrainz' }
  } catch (error) {
    return {
      source: 'unknown',
      error: error instanceof Error ? error.message : 'MusicBrainz fallback failed.',
    }
  }
}

export async function enrichSongMetadata(
  title: string,
  artist: string,
): Promise<EnrichResult> {
  let edgeResult: EnrichResult | null = null
  let edgeError = ''

  if (supabase && !edgeFunctionUnavailable) {
    const { data, error } = await supabase.functions.invoke('enrich-song-metadata', {
      body: { title, artist },
    })

    if (error) {
      edgeError = error.message
      if (/Failed to send a request to the Edge Function|CORS|preflight|ERR_FAILED|non-2xx/i.test(error.message)) {
        edgeFunctionUnavailable = true
      }
      console.warn('[enrichSongMetadata] Edge function error:', error.message)
    } else if (!data || typeof data !== 'object') {
      edgeError = 'Invalid metadata response payload.'
    } else {
      const parsed = data as Partial<EnrichResult>
      edgeResult = {
        year: typeof parsed.year === 'number' ? parsed.year : undefined,
        genre: typeof parsed.genre === 'string' ? parsed.genre : undefined,
        source: parsed.source ?? 'unknown',
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
      }
    }
  } else if (!supabase) {
    edgeError = 'Supabase is not configured in this environment.'
  } else {
    edgeError = 'Edge function unavailable in this session (using MusicBrainz fallback only).'
  }

  const needsFallback =
    !edgeResult ||
    edgeResult.source === 'unknown' ||
    (!edgeResult.year && !edgeResult.genre)

  if (needsFallback) {
    const fallback = await queryMusicBrainzFallback(title, artist)
    if (fallback.year || fallback.genre) {
      return {
        year: edgeResult?.year ?? fallback.year,
        genre: edgeResult?.genre ?? fallback.genre,
        source: 'musicbrainz',
      }
    }
    const fallbackError = fallback.error ?? edgeResult?.error ?? edgeError
    return { source: 'unknown', error: fallbackError || undefined }
  }

  return edgeResult ?? { source: 'unknown', error: edgeError || undefined }
}
