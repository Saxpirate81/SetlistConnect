/**
 * enrich-song-metadata Edge Function
 *
 * POST body: { title: string, artist: string }
 * Returns:   { year?: number, genre?: string, source: 'musicbrainz' | 'ai' | 'unknown' }
 *
 * Strategy:
 *   1. Query MusicBrainz (free, no key) for structured recording data
 *   2. If MB returns high-confidence result → use it
 *   3. Fall back to Claude Haiku via Anthropic API for everything else
 *
 * Env vars:
 *   ANTHROPIC_API_KEY   — Anthropic API key for Claude fallback
 *   CORS_ALLOWED_ORIGIN — production origin (default: https://www.setlistconnect.com)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// ─── Genre taxonomy (kept in sync with frontend GENRE_OPTIONS) ────────────────

const VALID_GENRES = new Set([
  'Pop', 'Rock', 'Alternative Rock', 'Classic Rock', 'Indie Rock',
  'R&B', 'Soul', 'Funk', 'Motown',
  'Jazz', 'Standards', 'Swing', 'Blues',
  'Country', 'Folk', 'Bluegrass',
  'Hip-Hop', 'Rap',
  'Latin', 'Reggae', 'Afrobeats',
  'Electronic', 'Dance', 'EDM',
  'Gospel', 'Christian',
  'Classical', 'Opera',
  'Metal', 'Punk', 'Hard Rock',
  'Broadway', 'Show Tunes',
  'Holiday', 'Children',
])

// Normalise genre response from AI into our taxonomy
function normaliseGenre(raw: string): string {
  const trimmed = raw.trim()
  // Direct match
  for (const g of VALID_GENRES) {
    if (g.toLowerCase() === trimmed.toLowerCase()) return g
  }
  // Partial match
  for (const g of VALID_GENRES) {
    if (trimmed.toLowerCase().includes(g.toLowerCase()) ||
        g.toLowerCase().includes(trimmed.toLowerCase())) return g
  }
  // Fallback mappings
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
  if (lower.includes('broadway') || lower.includes('musical') || lower.includes('show')) return 'Broadway'
  return trimmed // unknown — return as-is, app will store it
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/
const ALLOWED_ORIGIN = Deno.env.get('CORS_ALLOWED_ORIGIN') ?? 'https://www.setlistconnect.com'

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allowed = LOCALHOST_RE.test(origin) ? origin : ALLOWED_ORIGIN
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
}

function json(data: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  })
}

// ─── MusicBrainz lookup ───────────────────────────────────────────────────────

type MBResult = { year?: number; genre?: string }

async function queryMusicBrainz(title: string, artist: string): Promise<MBResult> {
  const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`)
  const url = `https://musicbrainz.org/ws/2/recording?query=${q}&fmt=json&limit=3`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SetlistConnect/1.0 (contact@setlistconnect.com)',
        Accept: 'application/json',
      },
    })
    if (!res.ok) return {}
    const data = await res.json()
    const recordings: Array<{
      score: number
      'first-release-date'?: string
      releases?: Array<{ date?: string; 'release-group'?: { 'primary-type'?: string } }>
      genres?: Array<{ name: string; count: number }>
      tags?: Array<{ name: string; count: number }>
    }> = data.recordings ?? []

    const top = recordings.find((r) => (r.score ?? 0) >= 80)
    if (!top) return {}

    // Year: from first-release-date or earliest release date
    let year: number | undefined
    const rawDate = top['first-release-date'] ??
      top.releases?.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))[0]?.date
    if (rawDate) {
      const parsed = parseInt(rawDate.slice(0, 4), 10)
      if (parsed > 1900 && parsed <= new Date().getFullYear() + 1) year = parsed
    }

    // Genre: prefer explicit genres, fall back to tags
    const genreSource = (top.genres ?? []).sort((a, b) => b.count - a.count)[0]?.name
      ?? (top.tags ?? []).sort((a, b) => b.count - a.count)[0]?.name
    const genre = genreSource ? normaliseGenre(genreSource) : undefined

    return { year, genre }
  } catch (err) {
    console.warn('[enrich] MusicBrainz error:', err)
    return {}
  }
}

// ─── Claude fallback ──────────────────────────────────────────────────────────

type AIResult = { year?: number; genre?: string }

async function queryAI(title: string, artist: string, apiKey: string): Promise<AIResult> {
  const genres = [...VALID_GENRES].join(', ')
  const prompt = `What is the original release year and genre of the song "${title}" by "${artist}"?

Reply with a JSON object ONLY — no explanation, no markdown, no extra text.
Use one of these genres: ${genres}
If you are not confident about the year or genre, omit that field.

Example: {"year": 1978, "genre": "Funk"}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.warn('[enrich] Anthropic API error:', res.status, await res.text())
      return {}
    }

    const data = await res.json()
    const text: string = data.content?.[0]?.text ?? ''
    // Extract JSON from response (sometimes wrapped in whitespace)
    const match = text.match(/\{[^}]+\}/)
    if (!match) return {}
    const parsed = JSON.parse(match[0]) as { year?: unknown; genre?: unknown }

    const year = typeof parsed.year === 'number' && parsed.year > 1900 ? parsed.year : undefined
    const genre = typeof parsed.genre === 'string' ? normaliseGenre(parsed.genre) : undefined
    return { year, genre }
  } catch (err) {
    console.warn('[enrich] AI error:', err)
    return {}
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, req, 405)
  }

  const { title, artist } = (await req.json().catch(() => ({}))) as { title?: string; artist?: string }
  if (!title?.trim() || !artist?.trim()) {
    return json({ error: 'title and artist are required' }, req, 400)
  }

  // 1. Try MusicBrainz first
  const mbResult = await queryMusicBrainz(title.trim(), artist.trim())
  if (mbResult.year && mbResult.genre) {
    return json({ ...mbResult, source: 'musicbrainz' }, req)
  }

  // 2. AI fallback for missing fields
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    // Return whatever MB gave us, even if partial
    const source = mbResult.year || mbResult.genre ? 'musicbrainz' : 'unknown'
    return json({ ...mbResult, source }, req)
  }

  const aiResult = await queryAI(title.trim(), artist.trim(), apiKey)

  // Merge: prefer MB data when available (more authoritative), AI fills gaps
  const merged = {
    year: mbResult.year ?? aiResult.year,
    genre: mbResult.genre ?? aiResult.genre,
    source: (mbResult.year || mbResult.genre) ? 'musicbrainz+ai' : 'ai',
  }

  return json(merged, req)
})
