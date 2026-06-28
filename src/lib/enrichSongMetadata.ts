/**
 * Client-side wrapper for the enrich-song-metadata Edge Function.
 */
import { supabase } from './supabaseClient'

export type EnrichResult = {
  year?: number
  genre?: string
  source: 'musicbrainz' | 'musicbrainz+ai' | 'ai' | 'unknown'
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

export async function enrichSongMetadata(
  title: string,
  artist: string,
): Promise<EnrichResult> {
  if (!supabase) return { source: 'unknown' }

  const { data, error } = await supabase.functions.invoke('enrich-song-metadata', {
    body: { title, artist },
  })

  if (error) {
    console.warn('[enrichSongMetadata] Error:', error.message)
    return { source: 'unknown' }
  }

  return data as EnrichResult
}
