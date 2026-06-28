/**
 * Song deduplication helpers.
 *
 * Detects songs with the same (normalized title + artist) within a band
 * and provides a merge function that:
 *   1. Updates all setlist song_ids to point to the canonical (kept) song
 *   2. Deletes the duplicate songs
 *
 * "Normalize" = lowercase, trim, collapse whitespace, strip punctuation
 * so "September" and "september" and "September!" are treated as the same song.
 */

import { supabase } from './supabaseClient'
import type { Song } from '../types'

// ─── Normalization ────────────────────────────────────────────────────────────

export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s&]/g, '') // keep alphanumeric, spaces, ampersands
    .replace(/\s+/g, ' ')
}

export function songDedupKey(song: Pick<Song, 'title' | 'artist'>): string {
  return `${normalizeForDedupe(song.title)}|||${normalizeForDedupe(song.artist)}`
}

// ─── Detection ────────────────────────────────────────────────────────────────

export type DuplicateGroup = {
  key: string               // "title|||artist" normalized key
  displayTitle: string      // first song's original title
  displayArtist: string     // first song's original artist
  songs: Song[]             // 2+ songs with same key
  /** Suggested canonical: song with most data (youtubeUrl, lyrics, highest specialPlayedCount) */
  suggestedCanonicalId: string
}

export function findDuplicateGroups(songs: Song[]): DuplicateGroup[] {
  const groups = new Map<string, Song[]>()
  for (const song of songs) {
    const key = songDedupKey(song)
    const existing = groups.get(key) ?? []
    existing.push(song)
    groups.set(key, existing)
  }

  const result: DuplicateGroup[] = []
  for (const [key, groupSongs] of groups) {
    if (groupSongs.length < 2) continue

    // Score songs: prefer ones with more data
    const scored = groupSongs.map((s) => ({
      song: s,
      score:
        (s.youtubeUrl ? 10 : 0) +
        (s.lyrics ? 8 : 0) +
        (s.youtubeVerified ? 5 : 0) +
        ((s.keys?.length ?? 0) * 2) +
        (s.specialPlayedCount ?? 0),
    }))
    scored.sort((a, b) => b.score - a.score)

    result.push({
      key,
      displayTitle: scored[0].song.title,
      displayArtist: scored[0].song.artist,
      songs: groupSongs,
      suggestedCanonicalId: scored[0].song.id,
    })
  }

  // Sort by number of duplicates descending
  result.sort((a, b) => b.songs.length - a.songs.length)
  return result
}

// ─── Merge ────────────────────────────────────────────────────────────────────

export type MergeResult = {
  ok: boolean
  setlistsUpdated: number
  songsDeleted: number
  error?: string
}

/**
 * Merges duplicate songs into the canonical song.
 * - Updates all setlist song_ids to replace duplicateIds with canonicalId
 * - Deletes the duplicate song rows
 * - Does NOT touch the canonical song itself
 */
export async function mergeSongs(
  canonicalId: string,
  duplicateIds: string[],
  bandId: string,
): Promise<MergeResult> {
  if (!supabase) return { ok: false, setlistsUpdated: 0, songsDeleted: 0, error: 'Supabase not configured' }
  if (duplicateIds.length === 0) return { ok: true, setlistsUpdated: 0, songsDeleted: 0 }

  // 1. Fetch all setlists for this band that contain any duplicate song
  const { data: setlists, error: fetchErr } = await supabase
    .from('setlists')
    .select('id, song_ids')
    .eq('band_id', bandId)

  if (fetchErr) return { ok: false, setlistsUpdated: 0, songsDeleted: 0, error: fetchErr.message }

  const dupSet = new Set(duplicateIds)
  let setlistsUpdated = 0

  // 2. For each affected setlist, replace duplicate IDs with canonicalId
  for (const setlist of setlists ?? []) {
    const ids: string[] = setlist.song_ids ?? []
    if (!ids.some((id) => dupSet.has(id))) continue

    // Replace duplicates with canonical, preserving order, removing extras
    const seen = new Set<string>()
    const updated: string[] = []
    for (const id of ids) {
      const resolved = dupSet.has(id) ? canonicalId : id
      if (!seen.has(resolved)) {
        seen.add(resolved)
        updated.push(resolved)
      }
    }

    const { error: updateErr } = await supabase
      .from('setlists')
      .update({ song_ids: updated })
      .eq('id', setlist.id)

    if (updateErr) {
      console.error('[mergeSongs] Failed to update setlist', setlist.id, updateErr.message)
      continue
    }
    setlistsUpdated++
  }

  // 3. Delete duplicate song rows
  const { error: deleteErr } = await supabase
    .from('songs')
    .delete()
    .in('id', duplicateIds)

  if (deleteErr) {
    return { ok: false, setlistsUpdated, songsDeleted: 0, error: deleteErr.message }
  }

  return { ok: true, setlistsUpdated, songsDeleted: duplicateIds.length }
}
