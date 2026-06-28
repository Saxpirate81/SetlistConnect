/**
 * Client-side wrapper for the search-youtube Supabase Edge Function.
 * Keeps API key server-side; browser never sees it.
 */

import { supabase } from './supabaseClient'
import type { YouTubeVideo } from '../../supabase/functions/search-youtube/index'

export type { YouTubeVideo }

export async function searchYouTube(
  title: string,
  artist: string,
  maxResults = 4,
): Promise<YouTubeVideo[]> {
  if (!supabase) return []

  const { data, error } = await supabase.functions.invoke('search-youtube', {
    body: { title, artist, maxResults },
  })

  if (error) {
    console.warn('[youtubeSearch] Edge function error:', error.message)
    return []
  }

  return (data?.videos ?? []) as YouTubeVideo[]
}
