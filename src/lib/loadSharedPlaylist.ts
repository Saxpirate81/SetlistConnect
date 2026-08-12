import type { SupabaseClient } from '@supabase/supabase-js'
import { GIG_SECTION_DELETED_TAG_PREFIX, INSTRUMENTAL_LABEL } from './constants'
import { parseGigSectionTag as defaultParseGigSectionTag } from './gigSections'
import type { Musician, PlaylistEntry, SharedPlaylistView } from '../types'

export type SharedSongDisplayMap = Record<string, { title: string; singers: string[]; keys: string[] }>

export type LoadSharedPlaylistResult =
  | {
      ok: true
      view: SharedPlaylistView
      displayMap: SharedSongDisplayMap
      notice: string | null
      entryCount: number
    }
  | { ok: false; keepCached: true; notice: string | null }
  | { ok: false; error: string; notice?: string | null }

export async function loadSharedPlaylist(options: {
  client: SupabaseClient
  setlistId: string
  sharedBandNameParam?: string
  sharedMusiciansParam?: Musician[]
  fallbackBandName?: string
  hasCachedPayload: boolean
  parseGigSectionTag?: (value: string) => { gigId: string; section: string } | null
  isSetlistTypeTag: (value: string) => boolean
  normalizePlaylistSection: (value: string) => string
}): Promise<LoadSharedPlaylistResult> {
  const {
    client,
    setlistId,
    sharedBandNameParam,
    sharedMusiciansParam,
    fallbackBandName,
    hasCachedPayload,
    parseGigSectionTag = defaultParseGigSectionTag,
    isSetlistTypeTag,
    normalizePlaylistSection,
  } = options

  const [gigRes, gigSongsRes, specialReqRes, djTracksRes, gigMusiciansRes] = await Promise.all([
    client
      .from('SetlistGigs')
      .select('id, band_id, gig_name, gig_date, venue_address')
      .eq('id', setlistId)
      .single(),
    client
      .from('SetlistGigSongs')
      .select('id, song_id, sort_order')
      .eq('gig_id', setlistId)
      .order('sort_order', { ascending: true }),
    client
      .from('SetlistSpecialRequests')
      .select('id, request_type, song_id, song_title, singers, song_key, external_audio_url, dj_only')
      .eq('gig_id', setlistId),
    client
      .from('SetlistGigDjTracks')
      .select('id, title, artist, notes, source_type, source_url, sort_order, status, metadata')
      .eq('gig_id', setlistId)
      .order('sort_order', { ascending: true }),
    client
      .from('SetlistGigMusicians')
      .select('musician_id, status')
      .eq('gig_id', setlistId),
  ])

  const firstError = gigRes.error || gigSongsRes.error
  if (firstError) {
    if (hasCachedPayload) {
      return {
        ok: false,
        keepCached: true,
        notice: `Live refresh failed (${firstError.message ?? 'unknown error'}). Showing cached link data.`,
      }
    }
    return {
      ok: false,
      error: firstError.message ?? 'Shared playlist failed to load.',
    }
  }

  const gig = gigRes.data
  if (!gig) {
    return { ok: false, error: 'Gig not found for this share link.' }
  }

  const orderedSongIds = (gigSongsRes.data ?? []).map((row) => row.song_id).filter(Boolean)
  const sharedBandId = typeof gig.band_id === 'string' ? gig.band_id.trim() : ''
  if (!sharedBandId) {
    if (hasCachedPayload) {
      return {
        ok: false,
        keepCached: true,
        notice: 'Live refresh skipped: gig is missing band scope. Showing cached link data.',
      }
    }
    return {
      ok: false,
      error: 'This share link is missing band scope and cannot load safely.',
    }
  }

  let songsQuery = client
    .from('SetlistSongs')
    .select('id, title, artist, audio_url, band_id')
    .eq('band_id', sharedBandId)
    .is('deleted_at', null)
  if (orderedSongIds.length > 0) {
    songsQuery = songsQuery.in('id', orderedSongIds)
  } else {
    songsQuery = songsQuery.eq('id', '__none__')
  }
  const songsRes = await songsQuery

  if (songsRes.error) {
    if (hasCachedPayload) {
      return {
        ok: false,
        keepCached: true,
        notice: `Song refresh failed (${songsRes.error.message}). Showing cached link data.`,
      }
    }
    return {
      ok: false,
      error: songsRes.error.message ?? 'Shared playlist songs failed to load.',
    }
  }

  let sharedBandName = fallbackBandName || 'Band'
  const { data: bandRow } = await client.from('bands').select('name').eq('id', sharedBandId).single()
  if (bandRow?.name?.trim()) {
    sharedBandName = bandRow.name.trim()
  }
  if (sharedBandNameParam) {
    sharedBandName = sharedBandNameParam
  }

  const songsById = new Map((songsRes.data ?? []).map((song) => [song.id, song]))
  const tagsRes = orderedSongIds.length
    ? await client
        .from('SetlistSongTags')
        .select('song_id, tag')
        .eq('band_id', sharedBandId)
        .in('song_id', orderedSongIds)
    : { data: [], error: null as { message?: string } | null }

  const loadGaps: string[] = []
  if (specialReqRes.error) loadGaps.push('special requests')
  if (djTracksRes.error) loadGaps.push('DJ tracks')
  if (gigMusiciansRes.error) loadGaps.push('musicians')
  if (tagsRes.error) loadGaps.push('sections')

  const tagsBySong = new Map<string, string[]>()
  const sharedGigSectionOverrides = new Map<string, string[]>()
  ;(tagsRes.error ? [] : (tagsRes.data ?? [])).forEach((row) => {
    if (row.tag.startsWith(GIG_SECTION_DELETED_TAG_PREFIX)) return
    const gigSectionTag = parseGigSectionTag(row.tag)
    if (gigSectionTag?.gigId === setlistId) {
      const sections = sharedGigSectionOverrides.get(row.song_id) ?? []
      const sectionKey = gigSectionTag.section.trim().toLowerCase()
      if (
        gigSectionTag.section.trim() &&
        !sections.some((item) => item.trim().toLowerCase() === sectionKey)
      ) {
        sections.push(gigSectionTag.section)
        sharedGigSectionOverrides.set(row.song_id, sections)
      }
      return
    }
    const list = tagsBySong.get(row.song_id) ?? []
    list.push(row.tag)
    tagsBySong.set(row.song_id, list)
  })

  const gigSingerKeyAssignments = new Map<string, Array<{ singer: string; key: string }>>()
  const songDefaultKeysRes = orderedSongIds.length
    ? await client
        .from('SetlistSongKeys')
        .select('song_id, singer_name, default_key')
        .in('song_id', orderedSongIds)
    : { data: [], error: null as { message?: string } | null }
  const singerKeysRes = await client
    .from('SetlistGigSingerKeys')
    .select('song_id, singer_name, gig_key')
    .eq('gig_id', setlistId)

  const mergedAssignmentsBySong = new Map<string, Map<string, { singer: string; key: string }>>()
  const sharedAllowedSingerSet = new Set<string>()
  const activeGigMusicianIds = Array.from(
    new Set(
      (gigMusiciansRes.error ? [] : (gigMusiciansRes.data ?? []))
        .filter((row) => (row.status ?? 'active') !== 'out')
        .map((row) => row.musician_id)
        .filter(Boolean),
    ),
  )
  if (activeGigMusicianIds.length > 0) {
    const { data: sharedMusicianRows, error: sharedMusiciansError } = await client
      .from('SetlistMusicians')
      .select('name, singer, instruments, deleted_at')
      .in('id', activeGigMusicianIds)
      .is('deleted_at', null)
    if (!sharedMusiciansError) {
      ;(sharedMusicianRows ?? []).forEach((row) => {
        const instruments = Array.isArray(row.instruments) ? row.instruments : []
        const hasVocalsInstrument = instruments.some(
          (instrument): boolean =>
            typeof instrument === 'string' && instrument.trim().toLowerCase() === 'vocals',
        )
        if (!row.singer && !hasVocalsInstrument) return
        const normalizedName = (row.name ?? '').trim().toLowerCase()
        if (!normalizedName) return
        sharedAllowedSingerSet.add(normalizedName)
      })
    }
  }

  const shouldKeepSharedSinger = (singerName: string) => {
    const normalizedSinger = singerName.trim().toLowerCase()
    if (!normalizedSinger) return false
    if (normalizedSinger === INSTRUMENTAL_LABEL.toLowerCase()) return true
    if (sharedAllowedSingerSet.size === 0) return true
    return sharedAllowedSingerSet.has(normalizedSinger)
  }

  if (!songDefaultKeysRes.error) {
    ;(songDefaultKeysRes.data ?? []).forEach((row) => {
      const singer = (row.singer_name ?? '').trim()
      const cleanKey = (row.default_key ?? '').trim()
      if (!singer || !cleanKey) return
      if (!shouldKeepSharedSinger(singer)) return
      const songMap = mergedAssignmentsBySong.get(row.song_id) ?? new Map()
      songMap.set(singer.toLowerCase(), { singer, key: cleanKey })
      mergedAssignmentsBySong.set(row.song_id, songMap)
    })
  }

  if (!singerKeysRes.error) {
    ;(singerKeysRes.data ?? []).forEach((row) => {
      const singer = (row.singer_name ?? '').trim()
      const cleanKey = (row.gig_key ?? '').trim()
      if (!singer || !cleanKey) return
      if (!shouldKeepSharedSinger(singer)) return
      const songMap = mergedAssignmentsBySong.get(row.song_id) ?? new Map()
      // Gig-specific key should win over song default assignment.
      songMap.set(singer.toLowerCase(), { singer, key: cleanKey })
      mergedAssignmentsBySong.set(row.song_id, songMap)
    })
  }

  mergedAssignmentsBySong.forEach((singerMap, songId) => {
    gigSingerKeyAssignments.set(songId, Array.from(singerMap.values()))
  })

  const sharedDisplayMap: SharedSongDisplayMap = {}
  ;(gigSongsRes.data ?? []).forEach((row) => {
    const baseSongId = (row.song_id ?? '').trim()
    if (!baseSongId) return
    const song = songsById.get(baseSongId)
    const title = (song?.title ?? '').trim()
    const assignments = gigSingerKeyAssignments.get(baseSongId) ?? []
    const singers = Array.from(
      new Set(assignments.map((item) => item.singer?.trim()).filter(Boolean) as string[]),
    )
    const keys = Array.from(
      new Set(assignments.map((item) => item.key?.trim()).filter(Boolean) as string[]),
    )
    const payload = { title: title || 'Song selected', singers, keys }
    sharedDisplayMap[baseSongId] = payload
    const gigSongId = (row.id ?? '').trim()
    if (gigSongId) {
      sharedDisplayMap[gigSongId] = payload
    }
  })

  const orderedSongs = orderedSongIds
    .map((songId) => songsById.get(songId))
    .filter((song): song is NonNullable<(typeof songsRes.data)[number]> => Boolean(song))

  const entries: PlaylistEntry[] = []
  const byKey = new Map<string, PlaylistEntry>()

  const uniqueList = (values: string[]) => {
    const seen = new Set<string>()
    const next: string[] = []
    values.forEach((value) => {
      const trimmed = value.trim()
      if (!trimmed) return
      const key = trimmed.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      next.push(trimmed)
    })
    return next
  }

  const addOrMerge = (entry: PlaylistEntry) => {
    const existing = byKey.get(entry.key)
    if (existing) {
      const hasSpecialRequestTag = (tags: string[]) =>
        tags.some((item) => {
          const lower = item.trim().toLowerCase()
          return lower === 'special request' || lower === 'special requests'
        })
      const treatAsSpecialRequest =
        hasSpecialRequestTag(existing.tags) || hasSpecialRequestTag(entry.tags)
      entry.tags.forEach((tag) => {
        if (treatAsSpecialRequest && tag.trim().toLowerCase() === 'setlist') return
        if (!existing.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) {
          existing.tags.push(tag)
        }
      })
      if (treatAsSpecialRequest) {
        existing.tags = existing.tags.filter((tag) => tag.trim().toLowerCase() !== 'setlist')
      }
      if (!existing.audioUrl && entry.audioUrl) {
        existing.audioUrl = entry.audioUrl
      }
      ;(entry.assignmentSingers ?? []).forEach((singer) => {
        const clean = singer.trim()
        if (!clean) return
        if (!(existing.assignmentSingers ?? []).some((item) => item.toLowerCase() === clean.toLowerCase())) {
          existing.assignmentSingers = [...(existing.assignmentSingers ?? []), clean]
        }
      })
      ;(entry.assignmentKeys ?? []).forEach((keyValue) => {
        const clean = keyValue.trim()
        if (!clean) return
        if (!(existing.assignmentKeys ?? []).some((item) => item.toLowerCase() === clean.toLowerCase())) {
          existing.assignmentKeys = [...(existing.assignmentKeys ?? []), clean]
        }
      })
      return
    }
    const normalized = {
      ...entry,
      tags: uniqueList(entry.tags),
      assignmentSingers: uniqueList(entry.assignmentSingers ?? []),
      assignmentKeys: uniqueList(entry.assignmentKeys ?? []),
    }
    byKey.set(normalized.key, normalized)
    entries.push(normalized)
  }

  ;(specialReqRes.error ? [] : (specialReqRes.data ?? [])).forEach((request) => {
    const linkedSong = request.song_id ? songsById.get(request.song_id) : undefined
    const key = `special-request:${request.id}`
    const savedAssignments = request.song_id ? (gigSingerKeyAssignments.get(request.song_id) ?? []) : []
    const savedSingers = uniqueList(savedAssignments.map((entry) => entry.singer))
    const savedKeys = uniqueList(savedAssignments.map((entry) => entry.key))
    const directSingers = uniqueList(request.singers ?? [])
    const directKeys = request.song_key ? [request.song_key] : []
    addOrMerge({
      key,
      title: linkedSong?.title || request.song_title || 'Special Request',
      artist: linkedSong?.artist || '',
      audioUrl: (request.external_audio_url || linkedSong?.audio_url || '').trim(),
      tags: request.dj_only ? [request.request_type || 'DJ Only'] : ['Special Request'],
      songId: request.song_id ?? undefined,
      assignmentSingers: request.dj_only ? ['DJ'] : directSingers.length ? directSingers : savedSingers,
      assignmentKeys: request.dj_only ? [] : directKeys.length ? directKeys : savedKeys,
    })
  })

  ;(djTracksRes.error ? [] : (djTracksRes.data ?? []))
    .filter((track) => track.status !== 'archived')
    .forEach((track) => {
      const metadata =
        track.metadata && typeof track.metadata === 'object' ? (track.metadata as Record<string, unknown>) : null
      const customType = metadata && typeof metadata.type === 'string' ? metadata.type.trim() : ''
      const metadataSongId =
        metadata && typeof metadata.song_id === 'string' ? metadata.song_id.trim() : ''
      const linkedSong = metadataSongId ? songsById.get(metadataSongId) : undefined
      addOrMerge({
        key: `dj-track:${track.id}`,
        title: track.title || linkedSong?.title || 'DJ Track',
        artist: track.artist || linkedSong?.artist || '',
        audioUrl: (track.source_url || '').trim(),
        tags: [customType || 'DJ Only'],
        songId: metadataSongId || undefined,
        assignmentSingers: ['DJ'],
        assignmentKeys: [],
      })
    })

  orderedSongs.forEach((song) => {
    const overrideSections = sharedGigSectionOverrides.get(song.id)
    const sectionTags = uniqueList(
      (
        overrideSections && overrideSections.length > 0
          ? overrideSections
          : (tagsBySong.get(song.id) ?? []).filter((tag) => isSetlistTypeTag(tag))
      )
        .map(normalizePlaylistSection)
        .filter(Boolean),
    )
    const assignments = gigSingerKeyAssignments.get(song.id) ?? []
    addOrMerge({
      key: `song:${song.id}`,
      title: song.title,
      artist: song.artist ?? '',
      audioUrl: (song.audio_url || '').trim(),
      tags: sectionTags.length ? sectionTags : ['Setlist'],
      songId: song.id,
      assignmentSingers: uniqueList(assignments.map((entry) => entry.singer)),
      assignmentKeys: uniqueList(assignments.map((entry) => entry.key)),
    })
  })

  const isSpecialRequestEntry = (entry: PlaylistEntry) =>
    entry.tags.some((tag) => {
      const normalized = tag.trim().toLowerCase()
      return normalized === 'special request' || normalized === 'special requests'
    })

  const playableEntries = entries.filter(
    (entry) => Boolean(entry.audioUrl && entry.audioUrl.trim()) || isSpecialRequestEntry(entry),
  )

  const notice =
    loadGaps.length > 0 ? `Some parts could not load: ${loadGaps.join(', ')}.` : null

  return {
    ok: true,
    view: {
      setlistId: gig.id,
      bandName: sharedBandName,
      gigName: gig.gig_name,
      date: typeof gig.gig_date === 'string' ? gig.gig_date.slice(0, 10) : '',
      venueAddress: gig.venue_address ?? '',
      musicians: sharedMusiciansParam,
      entries: playableEntries,
      allEntries: entries,
    },
    displayMap: sharedDisplayMap,
    notice,
    entryCount: entries.length,
  }
}
