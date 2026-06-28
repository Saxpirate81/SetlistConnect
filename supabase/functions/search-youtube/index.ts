// @ts-nocheck — Deno runtime, not checked by the Vite/Node TypeScript compiler
/**
 * search-youtube Edge Function
 *
 * POST body: { title: string, artist: string, maxResults?: number }
 * Returns:   { videos: YouTubeVideo[] }
 *
 * Env vars required:
 *   YOUTUBE_API_KEY    — Google Cloud API key with YouTube Data API v3 enabled
 *   CORS_ALLOWED_ORIGIN — production origin (default: https://www.setlistconnect.com)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type YouTubeVideo = {
  videoId: string
  title: string
  channelTitle: string
  thumbnailUrl: string
  url: string
}

type RequestBody = {
  title: string
  artist: string
  maxResults?: number
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/
const ALLOWED_ORIGIN = Deno.env.get('CORS_ALLOWED_ORIGIN') ?? 'https://www.setlistconnect.com'

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allowed = LOCALHOST_RE.test(origin) ? origin : ALLOWED_ORIGIN
  const requestedHeaders = req.headers.get('access-control-request-headers')?.trim()
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': requestedHeaders || 'Content-Type, Authorization, apikey, x-client-info',
    Vary: 'Origin',
  }
}

function json(data: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, req, 405)
  }

  const apiKey = Deno.env.get('YOUTUBE_API_KEY')
  if (!apiKey) {
    return json({ error: 'YouTube API key not configured' }, req, 500)
  }

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return json({ error: 'Invalid JSON body' }, req, 400)
  }

  const { title, artist, maxResults = 4 } = body
  if (!title?.trim() || !artist?.trim()) {
    return json({ error: 'title and artist are required' }, req, 400)
  }

  // Build search query — try "official" first to surface music videos
  const query = encodeURIComponent(`${title} ${artist} official`)
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', query)
  url.searchParams.set('type', 'video')
  url.searchParams.set('videoCategoryId', '10') // Music category
  url.searchParams.set('maxResults', String(Math.min(maxResults, 8)))
  url.searchParams.set('key', apiKey)

  let ytResponse: Response
  try {
    ytResponse = await fetch(url.toString())
  } catch (err) {
    console.error('[search-youtube] Fetch error:', err)
    return json({ error: 'Failed to reach YouTube API' }, req, 502)
  }

  if (!ytResponse.ok) {
    const text = await ytResponse.text()
    console.error('[search-youtube] YouTube API error:', ytResponse.status, text)
    return json({ error: 'YouTube API error', status: ytResponse.status }, req, 502)
  }

  const data = await ytResponse.json()
  const videos: YouTubeVideo[] = (data.items ?? []).map((item: {
    id: { videoId: string }
    snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string }; default?: { url: string } } }
  }) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? '',
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
  }))

  return json({ videos }, req)
})
