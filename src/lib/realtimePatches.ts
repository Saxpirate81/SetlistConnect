import type { Document, GigMusician, Setlist, Song } from '../types'

export type NowPlayingRealtimePayload = {
  eventType?: string
  new?: { gig_id?: string; song_id?: string | null } | null
  old?: { gig_id?: string; song_id?: string | null } | null
}

export type GigMusicianRealtimePayload = {
  eventType?: string
  new?: {
    gig_id?: string
    musician_id?: string
    status?: string | null
    note?: string | null
  } | null
  old?: {
    gig_id?: string
    musician_id?: string
    status?: string | null
    note?: string | null
  } | null
}

/**
 * Apply a SetlistGigNowPlaying realtime event to the local map.
 * Returns null when the payload is incomplete and a full refresh is needed.
 */
export function patchNowPlayingFromRealtime(
  prev: Record<string, string | null>,
  payload: NowPlayingRealtimePayload,
): Record<string, string | null> | null {
  const gigId = payload.new?.gig_id ?? payload.old?.gig_id
  if (!gigId) return null
  if (payload.eventType === 'DELETE') {
    return { ...prev, [gigId]: null }
  }
  return { ...prev, [gigId]: payload.new?.song_id ?? null }
}

/**
 * Apply a SetlistGigMusicians realtime event. Returns null if incomplete.
 */
export function patchGigMusiciansFromRealtime(
  prev: GigMusician[],
  payload: GigMusicianRealtimePayload,
): GigMusician[] | null {
  const gigId = payload.new?.gig_id ?? payload.old?.gig_id
  const musicianId = payload.new?.musician_id ?? payload.old?.musician_id
  if (!gigId || !musicianId) return null
  if (payload.eventType === 'DELETE') {
    return prev.filter((gm) => !(gm.gigId === gigId && gm.musicianId === musicianId))
  }
  const status = payload.new?.status === 'out' ? 'out' : 'active'
  const note = payload.new?.note?.trim() ? payload.new.note : undefined
  const nextEntry: GigMusician = { gigId, musicianId, status, note }
  const index = prev.findIndex((gm) => gm.gigId === gigId && gm.musicianId === musicianId)
  if (index < 0) return [...prev, nextEntry]
  const next = [...prev]
  next[index] = nextEntry
  return next
}

export type DocumentRealtimePayload = {
  eventType?: string
  new?: {
    id?: string
    song_id?: string
    doc_type?: string
    instrument?: string | null
    title?: string
    file_url?: string | null
    content?: string | null
  } | null
  old?: {
    id?: string
    song_id?: string
    doc_type?: string
    instrument?: string | null
    title?: string
    file_url?: string | null
    content?: string | null
  } | null
}

const DOC_TYPES = new Set(['Chart', 'Lyrics', 'Lead Sheet'])

/**
 * Apply a SetlistDocuments realtime event. Returns null if incomplete.
 * `normalizeInstrument` should match the app's document instrument normalization.
 */
export function patchDocumentsFromRealtime(
  prev: Document[],
  payload: DocumentRealtimePayload,
  normalizeInstrument: (raw: string) => string,
): Document[] | null {
  const id = payload.new?.id ?? payload.old?.id
  if (!id) return null
  if (payload.eventType === 'DELETE') {
    return prev.filter((doc) => doc.id !== id)
  }
  const row = payload.new
  if (!row?.id || !row.song_id || !row.title || !row.doc_type) return null
  if (!DOC_TYPES.has(row.doc_type)) return null
  const nextDoc: Document = {
    id: row.id,
    songId: row.song_id,
    type: row.doc_type as Document['type'],
    instrument: normalizeInstrument(row.instrument ?? 'All'),
    title: row.title,
    url: row.file_url ?? undefined,
    content: row.content ?? undefined,
  }
  const index = prev.findIndex((doc) => doc.id === nextDoc.id)
  if (index < 0) return [...prev, nextDoc]
  const next = [...prev]
  next[index] = nextDoc
  return next
}

export type SongRealtimePayload = {
  eventType?: string
  new?: {
    id?: string
    title?: string
    artist?: string | null
    original_key?: string | null
    audio_url?: string | null
    youtube_video_id?: string | null
    youtube_verified?: boolean | null
    original_year?: number | null
    genre?: string | null
    deleted_at?: string | null
  } | null
  old?: {
    id?: string
    title?: string
    artist?: string | null
    deleted_at?: string | null
  } | null
}

export type SongPatchResult = {
  songs: Song[]
  setlists: Setlist[]
}

/**
 * Patch local songs for SetlistSongs realtime events.
 * - UPDATE of an existing song: merge metadata, keep tags/keys
 * - Soft/hard delete: remove song + strip from setlist memberships
 * - INSERT of unknown song: returns null (needs full reload for tags/keys)
 */
export function patchSongsFromRealtime(
  prevSongs: Song[],
  prevSetlists: Setlist[],
  payload: SongRealtimePayload,
): SongPatchResult | null {
  const id = payload.new?.id ?? payload.old?.id
  if (!id) return null

  const isDelete =
    payload.eventType === 'DELETE' || Boolean(payload.new?.deleted_at)

  if (isDelete) {
    return {
      songs: prevSongs.filter((song) => song.id !== id),
      setlists: prevSetlists.map((setlist) => ({
        ...setlist,
        songIds: setlist.songIds.filter((songId) => songId !== id),
      })),
    }
  }

  const existing = prevSongs.find((song) => song.id === id)
  if (!existing) {
    // New songs need tags/keys from related tables — full reload is safer.
    return null
  }

  const row = payload.new
  if (!row?.id || !row.title) return null

  const nextSong: Song = {
    ...existing,
    title: row.title,
    artist: row.artist ?? '',
    originalKey: row.original_key ?? '',
    youtubeUrl: row.audio_url ?? '',
    youtubeVideoId: row.youtube_video_id ?? undefined,
    youtubeVerified: Boolean(row.youtube_verified),
    originalYear: row.original_year ?? undefined,
    genre: row.genre ?? undefined,
  }

  return {
    songs: prevSongs.map((song) => (song.id === id ? nextSong : song)),
    setlists: prevSetlists,
  }
}
