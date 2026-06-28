/**
 * Song deduplication helpers.
 *
 * Detects songs with the same (normalized title + artist) within a band
 * and provides a merge function that:
 *   1. Updates gig-song rows to point to the canonical (kept) song
 *   2. Re-links special request / singer-key references
 *   3. Soft-deletes duplicate songs
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

function normalizeArtistForDedupe(artist: string): string {
  return normalizeForDedupe(artist)
    .replace(/\b(feat|ft|featuring)\b.*$/g, '')
    .replace(/^the\s+/, '')
    .trim()
}

export function songDedupKey(song: Pick<Song, 'title' | 'artist'>): string {
  return `${normalizeForDedupe(song.title)}|||${normalizeArtistForDedupe(song.artist)}`
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
 * - Updates SetlistGigSongs rows to replace duplicateIds with canonicalId
 * - Re-links related rows that reference duplicate song IDs
 * - Soft-deletes duplicate song rows
 * - Does NOT touch the canonical song itself
 */
export async function mergeSongs(
  canonicalId: string,
  duplicateIds: string[],
  bandId: string,
): Promise<MergeResult> {
  if (!supabase) return { ok: false, setlistsUpdated: 0, songsDeleted: 0, error: 'Supabase not configured' }
  if (duplicateIds.length === 0) return { ok: true, setlistsUpdated: 0, songsDeleted: 0 }
  const dupSet = new Set(duplicateIds)
  const candidateIds = [canonicalId, ...duplicateIds]

  // 1) Fetch gig-song rows for any gig touched by canonical/duplicates.
  const { data: candidateRows, error: candidateRowsError } = await supabase
    .from('SetlistGigSongs')
    .select('id, gig_id, song_id, sort_order')
    .eq('band_id', bandId)
    .in('song_id', candidateIds)
  if (candidateRowsError) {
    return { ok: false, setlistsUpdated: 0, songsDeleted: 0, error: candidateRowsError.message }
  }

  const affectedGigIds = Array.from(new Set((candidateRows ?? []).map((row) => row.gig_id)))
  if (affectedGigIds.length === 0) {
    const { error: softDeleteError } = await supabase
      .from('SetlistSongs')
      .update({ deleted_at: new Date().toISOString() })
      .eq('band_id', bandId)
      .in('id', duplicateIds)
    if (softDeleteError) {
      return { ok: false, setlistsUpdated: 0, songsDeleted: 0, error: softDeleteError.message }
    }
    return { ok: true, setlistsUpdated: 0, songsDeleted: duplicateIds.length }
  }

  const { data: gigSongRows, error: gigSongRowsError } = await supabase
    .from('SetlistGigSongs')
    .select('id, gig_id, song_id, sort_order')
    .eq('band_id', bandId)
    .in('gig_id', affectedGigIds)
  if (gigSongRowsError) {
    return { ok: false, setlistsUpdated: 0, songsDeleted: 0, error: gigSongRowsError.message }
  }

  let setlistsUpdated = 0

  // 2) Re-point and de-duplicate rows per gig.
  for (const gigId of affectedGigIds) {
    const rows = (gigSongRows ?? [])
      .filter((row) => row.gig_id === gigId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    if (rows.length === 0) continue

    const keepRows: Array<{ id: string; nextSongId: string; nextSortOrder: number; changed: boolean }> = []
    const deleteRowIds: string[] = []
    const seen = new Set<string>()
    rows.forEach((row) => {
      const resolved = dupSet.has(row.song_id) ? canonicalId : row.song_id
      if (!seen.has(resolved)) {
        seen.add(resolved)
        keepRows.push({
          id: row.id,
          nextSongId: resolved,
          nextSortOrder: keepRows.length,
          changed: resolved !== row.song_id || (row.sort_order ?? 0) !== keepRows.length,
        })
      } else {
        deleteRowIds.push(row.id)
      }
    })

    const rowUpdates = keepRows.filter((row) => row.changed)
    for (const row of rowUpdates) {
      const { error: updateErr } = await supabase
        .from('SetlistGigSongs')
        .update({ song_id: row.nextSongId, sort_order: row.nextSortOrder })
        .eq('id', row.id)
        .eq('band_id', bandId)
      if (updateErr) {
        return { ok: false, setlistsUpdated, songsDeleted: 0, error: updateErr.message }
      }
    }
    if (deleteRowIds.length > 0) {
      const { error: deleteRowsError } = await supabase
        .from('SetlistGigSongs')
        .delete()
        .eq('band_id', bandId)
        .in('id', deleteRowIds)
      if (deleteRowsError) {
        return { ok: false, setlistsUpdated, songsDeleted: 0, error: deleteRowsError.message }
      }
    }
    if (rowUpdates.length > 0 || deleteRowIds.length > 0) setlistsUpdated++
  }

  // 3) Re-link tables that point directly at song IDs.
  const { error: specialReqError } = await supabase
    .from('SetlistSpecialRequests')
    .update({ song_id: canonicalId })
    .eq('band_id', bandId)
    .in('song_id', duplicateIds)
  if (specialReqError) {
    return { ok: false, setlistsUpdated, songsDeleted: 0, error: specialReqError.message }
  }

  const { error: singerKeysError } = await supabase
    .from('SetlistGigSingerKeys')
    .update({ song_id: canonicalId })
    .eq('band_id', bandId)
    .in('song_id', duplicateIds)
  if (singerKeysError) {
    return { ok: false, setlistsUpdated, songsDeleted: 0, error: singerKeysError.message }
  }

  // 4) Soft-delete duplicate song rows.
  const { error: softDeleteError } = await supabase
    .from('SetlistSongs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('band_id', bandId)
    .in('id', duplicateIds)
  if (softDeleteError) {
    return { ok: false, setlistsUpdated, songsDeleted: 0, error: softDeleteError.message }
  }

  return { ok: true, setlistsUpdated, songsDeleted: duplicateIds.length }
}
