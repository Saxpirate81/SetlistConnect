import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseEnabled, supabase, supabaseEnvStatus } from './lib/supabaseClient'
import downloadPdfIcon from './assets/download-pdf-icon.png'
import openPlaylistIcon from './assets/open-playlist-icon.png'
import setlistConnectLogo from './assets/setlist-connect-logo.png'

type Role = 'admin' | 'user' | null
type Screen = 'setlists' | 'builder' | 'song' | 'musicians'

type SongKey = {
  singer: string
  defaultKey: string
  gigOverrides: Record<string, string>
}

type Song = {
  id: string
  title: string
  artist: string
  originalKey?: string
  bpm?: number
  youtubeUrl?: string
  tags: string[]
  keys: SongKey[]
  lyrics?: string
  specialPlayedCount: number
}

type Setlist = {
  id: string
  gigName: string
  date: string
  songIds: string[]
  venueAddress?: string
}

type SpecialRequest = {
  id: string
  gigId: string
  type: string
  songTitle: string
  songId?: string
  singers: string[]
  key: string
  note?: string
  djOnly?: boolean
  externalAudioUrl?: string
}

type Chart = {
  id: string
  songId: string
  instrument: string
  title: string
  fileName?: string
}

type Musician = {
  id: string
  name: string
  roster: 'core' | 'sub'
  email?: string
  phone?: string
  instruments: string[]
  singer?: 'male' | 'female' | 'other'
}

type GigMusician = {
  gigId: string
  musicianId: string
  status: 'active' | 'out'
  note?: string
}

type Document = {
  id: string
  songId: string
  type: 'Chart' | 'Lyrics' | 'Lead Sheet'
  instrument: string
  title: string
  url?: string
  content?: string
}

type PlaylistEntry = {
  key: string
  title: string
  artist?: string
  audioUrl?: string
  tags: string[]
  songId?: string
  assignmentSingers?: string[]
  assignmentKeys?: string[]
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type AppState = {
  songs: Song[]
  setlists: Setlist[]
  specialRequests: SpecialRequest[]
  tagsCatalog: string[]
  specialTypes: string[]
  singersCatalog: string[]
  charts: Chart[]
  documents: Document[]
  musicians: Musician[]
  gigMusicians: GigMusician[]
  instrument: string | null
  currentSongId: string | null
}

type HistoryEntry = {
  label: string
  state: AppState
  timestamp: string
}

const ADMIN_PASSWORD = 'Signature'
const USER_PASSWORD = 'Signature2026'
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000
const LAST_ACTIVE_KEY = 'setlist:lastActive'

const INSTRUMENTS = ['Vocals', 'Guitar', 'Keys', 'Bass', 'Drums', 'Sax', 'Trumpet']
const DEFAULT_TAGS = ['Special Request', 'Dinner', 'Latin', 'Dance']
const DEFAULT_SPECIAL_TYPES = ['First Dance', 'Last Dance', 'Parent Dance', 'Anniversary']

const initialState: AppState = {
  songs: [],
  setlists: [],
  specialRequests: [],
  tagsCatalog: DEFAULT_TAGS,
  specialTypes: DEFAULT_SPECIAL_TYPES,
  singersCatalog: [],
  charts: [],
  documents: [],
  musicians: [],
  gigMusicians: [],
  instrument: null,
  currentSongId: null,
}

const emptyState: AppState = {
  songs: [],
  setlists: [],
  specialRequests: [],
  tagsCatalog: DEFAULT_TAGS,
  specialTypes: DEFAULT_SPECIAL_TYPES,
  singersCatalog: [],
  charts: [],
  documents: [],
  musicians: [],
  gigMusicians: [],
  instrument: null,
  currentSongId: null,
}

function App() {
  const [role, setRole] = useState<Role>(null)
  const [gigMode, setGigMode] = useState(false)
  const [newSongTitle, setNewSongTitle] = useState('')
  const [newSongArtist, setNewSongArtist] = useState('')
  const [newSongAudio, setNewSongAudio] = useState('')
  const [newSongOriginalKey, setNewSongOriginalKey] = useState('')
  const [newSongTags, setNewSongTags] = useState<string[]>([])
  const [editingSongId, setEditingSongId] = useState<string | null>(null)
  const [editingSongTitle, setEditingSongTitle] = useState('')
  const [editingSongArtist, setEditingSongArtist] = useState('')
  const [editingSongAudio, setEditingSongAudio] = useState('')
  const [editingSongOriginalKey, setEditingSongOriginalKey] = useState('')
  const [editingSongTags, setEditingSongTags] = useState<string[]>([])
  const [editingMusicianId, setEditingMusicianId] = useState<string | null>(null)
  const [editingMusicianName, setEditingMusicianName] = useState('')
  const [editingMusicianRoster, setEditingMusicianRoster] = useState<'core' | 'sub'>('core')
  const [editingMusicianEmail, setEditingMusicianEmail] = useState('')
  const [editingMusicianPhone, setEditingMusicianPhone] = useState('')
  const [editingMusicianInstruments, setEditingMusicianInstruments] = useState<string[]>([])
  const [editingMusicianSinger, setEditingMusicianSinger] = useState<
    'male' | 'female' | 'other' | ''
  >('')
  const [loginInput, setLoginInput] = useState('')
  const [screen, setScreen] = useState<Screen>('setlists')
  const [appState, setAppState] = useState<AppState>(
    isSupabaseEnabled ? emptyState : initialState,
  )
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showUndoToast, setShowUndoToast] = useState(false)
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [songSearch, setSongSearch] = useState('')
  const [supabaseError, setSupabaseError] = useState<string | null>(null)
  const initialSetlistId = isSupabaseEnabled ? '' : initialState.setlists[0]?.id ?? ''
  const [selectedSetlistId, setSelectedSetlistId] = useState(initialSetlistId)
  const [hideGigHeader, setHideGigHeader] = useState(false)
  const [pendingSpecialType, setPendingSpecialType] = useState('')
  const [pendingSpecialSong, setPendingSpecialSong] = useState('')
  const [pendingSpecialSingers, setPendingSpecialSingers] = useState<string[]>([])
  const [pendingSpecialKey, setPendingSpecialKey] = useState('')
  const [pendingSpecialNote, setPendingSpecialNote] = useState('')
  const [pendingSpecialDjOnly, setPendingSpecialDjOnly] = useState(false)
  const [pendingSpecialExternalUrl, setPendingSpecialExternalUrl] = useState('')
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([])
  const [docModalSongId, setDocModalSongId] = useState<string | null>(null)
  const [docModalContent, setDocModalContent] = useState<Document | null>(null)
  const [pendingDocSongId, setPendingDocSongId] = useState<string | null>(null)
  const [showInstrumentPrompt, setShowInstrumentPrompt] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [dismissedUpNextId, setDismissedUpNextId] = useState<string | null>(null)
  const [audioModalUrl, setAudioModalUrl] = useState<string | null>(null)
  const [audioModalLabel, setAudioModalLabel] = useState('Audio player')
  const [audioPlaybackRate, setAudioPlaybackRate] = useState(1)
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
  const [activeGigId, setActiveGigId] = useState(initialSetlistId)
  const [nowPlayingByGig, setNowPlayingByGig] = useState<Record<string, string | null>>({})
  const [newMusicianName, setNewMusicianName] = useState('')
  const [newMusicianRoster, setNewMusicianRoster] = useState<'core' | 'sub'>('core')
  const [newMusicianEmail, setNewMusicianEmail] = useState('')
  const [newMusicianPhone, setNewMusicianPhone] = useState('')
  const [newMusicianInstruments, setNewMusicianInstruments] = useState<string[]>([])
  const [newMusicianSinger, setNewMusicianSinger] = useState<'male' | 'female' | 'other' | ''>(
    '',
  )
  const [newSubName, setNewSubName] = useState('')
  const [newSubEmail, setNewSubEmail] = useState('')
  const [newSubPhone, setNewSubPhone] = useState('')
  const [newSubInstruments, setNewSubInstruments] = useState<string[]>([])
  const [instrumentCatalog, setInstrumentCatalog] = useState<string[]>([
    ...INSTRUMENTS,
    'Percussion',
    'Violin',
    'Saxophone',
  ])
  const [instrumentFilter, setInstrumentFilter] = useState('')
  const [newInstrumentInput, setNewInstrumentInput] = useState('')
  const [newSubSinger, setNewSubSinger] = useState<'male' | 'female' | 'other' | ''>('')
  const [subSearchInput, setSubSearchInput] = useState('')
  const [showSubModal, setShowSubModal] = useState(false)
  const [bannerTouchStartX, setBannerTouchStartX] = useState<number | null>(null)
  const [newDocSongId, setNewDocSongId] = useState('')
  const [newDocSongTitle, setNewDocSongTitle] = useState('')
  const [newDocType, setNewDocType] = useState<'Chart' | 'Lyrics' | 'Lead Sheet' | ''>('')
  const [newDocInstrument, setNewDocInstrument] = useState('')
  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocUrl, setNewDocUrl] = useState('')
  const [newDocFile, setNewDocFile] = useState<File | null>(null)
  const [newDocLyrics, setNewDocLyrics] = useState('')
  const [showDeleteGigConfirm, setShowDeleteGigConfirm] = useState(false)
  const [pendingDeleteGigId, setPendingDeleteGigId] = useState<string | null>(null)
  const [showRemoveSongConfirm, setShowRemoveSongConfirm] = useState(false)
  const [pendingRemoveSongId, setPendingRemoveSongId] = useState<string | null>(null)
  const [singerModalSongId, setSingerModalSongId] = useState<string | null>(null)
  const [showAddSongModal, setShowAddSongModal] = useState(false)
  const [songLibraryTags, setSongLibraryTags] = useState<string[]>([])
  const [songLibrarySearch, setSongLibrarySearch] = useState('')
  const [showDuplicateSongConfirm, setShowDuplicateSongConfirm] = useState(false)
  const [pendingSongDraft, setPendingSongDraft] = useState<{
    title: string
    artist: string
    originalKey: string
    audioUrl: string
    tags: string[]
  } | null>(null)
  const [similarSongMatches, setSimilarSongMatches] = useState<Song[]>([])
  const [showKeyResolveModal, setShowKeyResolveModal] = useState(false)
  const [resolveSongId, setResolveSongId] = useState<string | null>(null)
  const [showGigMusiciansModal, setShowGigMusiciansModal] = useState(false)
  const [showSetlistModal, setShowSetlistModal] = useState(false)
  const [showPlaylistModal, setShowPlaylistModal] = useState(false)
  const [playlistIndex, setPlaylistIndex] = useState(0)
  const [playlistAutoAdvance, setPlaylistAutoAdvance] = useState(true)
  const [playlistPlayNonce, setPlaylistPlayNonce] = useState(0)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [draggedSectionSongId, setDraggedSectionSongId] = useState<string | null>(null)
  const [dragOverSectionSongId, setDragOverSectionSongId] = useState<string | null>(null)
  const [recentlyMovedSongId, setRecentlyMovedSongId] = useState<string | null>(null)
  const movedSongTimerRef = useRef<number | null>(null)
  const [activeBuildPanel, setActiveBuildPanel] = useState<
    | 'musicians'
    | 'addSongs'
    | 'special'
    | 'dinner'
    | 'latin'
    | 'dance'
    | null
  >(null)
  const [buildPanelDirty, setBuildPanelDirty] = useState(false)
  const [pendingSingerAssignments, setPendingSingerAssignments] = useState<
    Record<string, { singer: string; key: string }[]>
  >({})
  const [showSingerWarning, setShowSingerWarning] = useState(false)
  const [showMissingSingerWarning, setShowMissingSingerWarning] = useState(false)
  const [starterPasteBySection, setStarterPasteBySection] = useState<{
    Dinner: string
    Latin: string
    Dance: string
  }>({ Dinner: '', Latin: '', Dance: '' })
  const [starterPasteOpen, setStarterPasteOpen] = useState<{
    Dinner: boolean
    Latin: boolean
    Dance: boolean
  }>({ Dinner: false, Latin: false, Dance: false })
  const [buildCompleteOverrides, setBuildCompleteOverrides] = useState<
    Record<string, Partial<Record<NonNullable<typeof activeBuildPanel>, boolean>>>
  >(() => {
    const stored = localStorage.getItem('setlist_build_complete')
    if (!stored) return {}
    try {
      return JSON.parse(stored)
    } catch {
      localStorage.removeItem('setlist_build_complete')
      return {}
    }
  })
  const lastDocAutosaveRef = useRef('')
  const editSongBaselineRef = useRef<{
    title: string
    artist: string
    audio: string
    originalKey: string
    tags: string[]
  } | null>(null)
  const [songFormError, setSongFormError] = useState('')
  const [docFormError, setDocFormError] = useState('')
  const [loginPhase, setLoginPhase] = useState<'login' | 'transition' | 'app'>('login')
  const loginTimerRef = useRef<number | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const standaloneMatch = window.matchMedia('(display-mode: standalone)').matches
    const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
    if (standaloneMatch || iosStandalone) {
      setIsInstalled(true)
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const isAdmin = role === 'admin'

  const filteredInstruments = useMemo(
    () =>
      instrumentCatalog.filter((instrument) =>
        instrument.toLowerCase().includes(instrumentFilter.toLowerCase()),
      ),
    [instrumentCatalog, instrumentFilter],
  )
  const normalizeTagList = (tags: string[]) => {
    const seen = new Set<string>()
    const normalized: string[] = []
    tags.forEach((tag) => {
      const value = tag.trim()
      if (!value) return
      const key = value.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      normalized.push(value)
    })
    return normalized
  }
  const hasSongTag = (song: Song, tag: string) =>
    song.tags.some((item) => item.trim().toLowerCase() === tag.trim().toLowerCase())

  const currentSetlist = useMemo(
    () => appState.setlists.find((setlist) => setlist.id === selectedSetlistId),
    [appState.setlists, selectedSetlistId],
  )
  useEffect(() => {
    if (!currentSetlist?.id) return
    setActiveGigId(currentSetlist.id)
  }, [currentSetlist?.id])

  const singerModalSong = useMemo(
    () => (singerModalSongId ? appState.songs.find((song) => song.id === singerModalSongId) : null),
    [appState.songs, singerModalSongId],
  )

  const gigVocalists = useMemo(() => {
    if (!currentSetlist) return []
    const gigMusicianIds = new Set(
      appState.gigMusicians
        .filter((entry) => entry.gigId === currentSetlist.id && entry.status !== 'out')
        .map((entry) => entry.musicianId),
    )
    const assignedMusicians = appState.musicians.filter((musician) =>
      gigMusicianIds.has(musician.id),
    )
    const preferredVocalists = assignedMusicians.filter(
      (musician) =>
        Boolean(musician.singer) ||
        (musician.instruments ?? []).some(
          (instrument) => instrument.toLowerCase() === 'vocals',
        ),
    )
    return preferredVocalists.length > 0 ? preferredVocalists : assignedMusicians
  }, [appState.gigMusicians, appState.musicians, currentSetlist])

  const isEditSongDirty = useMemo(() => {
    if (!editingSongId || !editSongBaselineRef.current) return false
    const baseline = editSongBaselineRef.current
    const normalizeTags = (tags: string[]) =>
      normalizeTagList(tags)
        .map((tag) => tag.toLowerCase())
        .sort()
        .join('|')
    return (
      editingSongTitle.trim() !== baseline.title.trim() ||
      editingSongArtist.trim() !== baseline.artist.trim() ||
      editingSongAudio.trim() !== baseline.audio.trim() ||
      editingSongOriginalKey.trim() !== baseline.originalKey.trim() ||
      normalizeTags(editingSongTags) !== normalizeTags(baseline.tags)
    )
  }, [
    editingSongId,
    editingSongTitle,
    editingSongArtist,
    editingSongAudio,
    editingSongOriginalKey,
    editingSongTags,
  ])

  const availableSongs = useMemo(() => {
    const setlistSongIds = new Set(currentSetlist?.songIds ?? [])
    const bySearch = appState.songs.filter((song) =>
      `${song.title} ${song.artist}`.toLowerCase().includes(songSearch.toLowerCase()),
    )
    const byTag =
      activeTags.length === 0
        ? bySearch
        : bySearch.filter((song) => activeTags.every((tag) => hasSongTag(song, tag)))
    return byTag.filter((song) => !setlistSongIds.has(song.id))
  }, [appState.songs, currentSetlist?.songIds, songSearch, activeTags])

  const recentGigs = useMemo(() => {
    return [...appState.setlists]
      .filter((setlist) => setlist.id !== currentSetlist?.id)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [appState.setlists, currentSetlist?.id])

  const buildCompletion = useMemo(() => {
    if (!currentSetlist) {
      return {
        musicians: false,
        addSongs: false,
        special: false,
        dinner: false,
        latin: false,
        dance: false,
      }
    }
    const gigId = currentSetlist.id
    const overrides = buildCompleteOverrides[gigId]
    return {
      musicians: overrides?.musicians ?? false,
      addSongs: overrides?.addSongs ?? false,
      special: overrides?.special ?? false,
      dinner: overrides?.dinner ?? false,
      latin: overrides?.latin ?? false,
      dance: overrides?.dance ?? false,
    }
  }, [
    currentSetlist,
    buildCompleteOverrides,
  ])

  const buildPanelCount = useMemo(() => {
    if (!currentSetlist || !activeBuildPanel) {
      return { label: '', value: 0 }
    }
    if (activeBuildPanel === 'musicians') {
      return {
        label: 'Musicians',
        value: appState.gigMusicians.filter((gm) => gm.gigId === currentSetlist.id).length,
      }
    }
    if (activeBuildPanel === 'special') {
      return {
        label: 'Requests',
        value: appState.specialRequests.filter((req) => req.gigId === currentSetlist.id).length,
      }
    }
    if (activeBuildPanel === 'addSongs') {
      return { label: 'Songs', value: currentSetlist.songIds.length }
    }
    const section =
      activeBuildPanel === 'dinner'
        ? 'Dinner'
        : activeBuildPanel === 'latin'
          ? 'Latin'
          : 'Dance'
    const count = currentSetlist.songIds
      .map((songId) => appState.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
      .filter((song) => hasSongTag(song, section)).length
    return { label: 'Songs', value: count }
  }, [
    activeBuildPanel,
    appState.gigMusicians,
    appState.specialRequests,
    appState.songs,
    currentSetlist,
  ])

  const buildCardCounts = useMemo(() => {
    if (!currentSetlist) {
      return {
        musicians: 0,
        addSongs: 0,
        special: 0,
        dinner: 0,
        latin: 0,
        dance: 0,
      }
    }
    const sectionCount = (section: 'Dinner' | 'Latin' | 'Dance') =>
      currentSetlist.songIds
        .map((songId) => appState.songs.find((song) => song.id === songId))
        .filter((song): song is Song => Boolean(song))
        .filter((song) => hasSongTag(song, section)).length
    return {
      musicians: appState.gigMusicians.filter((gm) => gm.gigId === currentSetlist.id)
        .length,
      addSongs: currentSetlist.songIds.length,
      special: appState.specialRequests.filter((req) => req.gigId === currentSetlist.id)
        .length,
      dinner: sectionCount('Dinner'),
      latin: sectionCount('Latin'),
      dance: sectionCount('Dance'),
    }
  }, [appState.gigMusicians, appState.specialRequests, appState.songs, currentSetlist])

  const filteredSongLibrary = useMemo(() => {
    const base = appState.songs.filter((song) => {
      const searchTerm = songLibrarySearch.trim().toLowerCase()
      if (searchTerm) {
        const haystack = `${song.title} ${song.artist} ${song.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(searchTerm)) return false
      }
      if (songLibraryTags.length === 0) return true
      return songLibraryTags.every((tag) => hasSongTag(song, tag))
    })
    return [...base].sort((a, b) => a.title.localeCompare(b.title))
  }, [appState.songs, songLibrarySearch, songLibraryTags])

  const playlistEntries = useMemo<PlaylistEntry[]>(() => {
    if (!currentSetlist) return []
    const ordered: PlaylistEntry[] = []
    const byKey = new Map<string, PlaylistEntry>()
    const addOrMerge = (entry: PlaylistEntry) => {
      const existing = byKey.get(entry.key)
      if (existing) {
        entry.tags.forEach((tag) => {
          if (!existing.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) {
            existing.tags.push(tag)
          }
        })
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
        tags: normalizeTagList(entry.tags),
        assignmentSingers: normalizeTagList(entry.assignmentSingers ?? []),
        assignmentKeys: normalizeTagList(entry.assignmentKeys ?? []),
      }
      byKey.set(normalized.key, normalized)
      ordered.push(normalized)
    }

    appState.specialRequests
      .filter((request) => request.gigId === currentSetlist.id)
      .forEach((request) => {
        const linkedSong = appState.songs.find((song) => song.id === request.songId)
        const key = request.songId
          ? `song:${request.songId}`
          : `special:${request.songTitle.trim().toLowerCase()}`
        addOrMerge({
          key,
          title: linkedSong?.title || request.songTitle,
          artist: linkedSong?.artist || '',
          audioUrl: (request.externalAudioUrl || linkedSong?.youtubeUrl || '').trim(),
          tags: ['Special Request'],
          songId: request.songId,
          assignmentSingers: request.djOnly ? ['DJ'] : request.singers,
          assignmentKeys: request.djOnly ? [] : request.key ? [request.key] : [],
        })
      })

    ;(['Dinner', 'Dance', 'Latin'] as const).forEach((section) => {
      currentSetlist.songIds
        .map((songId) => appState.songs.find((song) => song.id === songId))
        .filter((song): song is Song => Boolean(song))
        .filter((song) => hasSongTag(song, section))
        .forEach((song) => {
          addOrMerge({
            key: `song:${song.id}`,
            title: song.title,
            artist: song.artist,
            audioUrl: (song.youtubeUrl || '').trim(),
            tags: [section],
            songId: song.id,
          })
        })
    })
    return ordered
  }, [appState.songs, appState.specialRequests, currentSetlist])

  const currentPlaylistEntry = playlistEntries[playlistIndex] ?? null
  const isPlaylistEntryPlayable = (entry?: PlaylistEntry | null) =>
    Boolean(entry?.audioUrl && entry.audioUrl.trim())

  const findNextPlayableIndex = (startIndex: number, delta: number) => {
    if (!playlistEntries.length) return -1
    for (let step = 0; step < playlistEntries.length; step += 1) {
      const candidate =
        (startIndex + delta * step + playlistEntries.length) % playlistEntries.length
      if (isPlaylistEntryPlayable(playlistEntries[candidate])) {
        return candidate
      }
    }
    return -1
  }

  const jumpToPlaylistIndex = (index: number) => {
    if (!playlistEntries.length) return
    const playable = isPlaylistEntryPlayable(playlistEntries[index])
      ? index
      : findNextPlayableIndex(index, 1)
    if (playable < 0) return
    setPlaylistIndex(playable)
    setPlaylistPlayNonce((current) => current + 1)
  }
  const movePlaylistBy = (delta: number) => {
    if (!playlistEntries.length) return
    const next = findNextPlayableIndex(
      (playlistIndex + delta + playlistEntries.length) % playlistEntries.length,
      delta >= 0 ? 1 : -1,
    )
    if (next < 0) return
    setPlaylistIndex(next)
    setPlaylistPlayNonce((current) => current + 1)
  }

  const getGigKeysText = (songId: string, gigId: string) => {
    const song = appState.songs.find((item) => item.id === songId)
    if (!song) return ''
    const entries = song.keys
      .map((key) => ({
        singer: key.singer,
        key: key.gigOverrides[gigId] ?? '',
      }))
      .filter((entry) => entry.key)
    if (!entries.length) return ''
    return entries
      .map((entry) => `${entry.singer}: ${entry.key}`)
      .join(' · ')
  }

  const getGigSingerAssignments = (songId: string, gigId: string) => {
    const song = appState.songs.find((item) => item.id === songId)
    if (!song) return []
    return song.keys
      .map((key) => ({
        singer: key.singer,
        key: key.gigOverrides[gigId] ?? '',
      }))
      .filter((entry) => entry.key)
  }

  const getPlaylistAssignmentText = (entry: PlaylistEntry) => {
    const singers = normalizeTagList(entry.assignmentSingers ?? [])
    const keys = normalizeTagList(entry.assignmentKeys ?? [])
    if (entry.songId && currentSetlist) {
      getGigSingerAssignments(entry.songId, currentSetlist.id).forEach((assignment) => {
        if (
          assignment.singer &&
          !singers.some((item) => item.toLowerCase() === assignment.singer.toLowerCase())
        ) {
          singers.push(assignment.singer)
        }
        if (assignment.key && !keys.some((item) => item.toLowerCase() === assignment.key.toLowerCase())) {
          keys.push(assignment.key)
        }
      })
    }
    const singerLabel = singers.length ? `Assigned: ${singers.join(', ')}` : 'Assigned: none'
    const keyLabel = keys.length ? `Key: ${keys.join(', ')}` : 'Key: —'
    return `${singerLabel} · ${keyLabel}`
  }

  const resolveGigKeyForSong = (songId: string, keyValue: string) => {
    if (!currentSetlist) return
    const assignments = getGigSingerAssignments(songId, currentSetlist.id)
    if (!assignments.length) return
    commitChange('Resolve gig key', (prev) => ({
      ...prev,
      songs: prev.songs.map((song) => {
        if (song.id !== songId) return song
        return {
          ...song,
          keys: song.keys.map((key) => {
            if (!assignments.find((entry) => entry.singer === key.singer)) {
              return key
            }
            return {
              ...key,
              gigOverrides: {
                ...key.gigOverrides,
                [currentSetlist.id]: keyValue,
              },
            }
          }),
        }
      }),
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistGigSingerKeys')
          .delete()
          .eq('gig_id', currentSetlist.id)
          .eq('song_id', songId),
      )
      runSupabase(
        supabase.from('SetlistGigSingerKeys').insert(
          assignments.map((entry) => ({
            id: createId(),
            gig_id: currentSetlist.id,
            song_id: songId,
            singer_name: entry.singer,
            gig_key: keyValue,
          })),
        ),
      )
    }
    setShowKeyResolveModal(false)
    setResolveSongId(null)
  }

  const formatGigDate = (dateValue: string) => {
    if (!dateValue) return ''
    const parsed = new Date(`${dateValue}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return dateValue
    return parsed.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const setGigCurrentSong = (songId: string | null) => {
    if (!currentSetlist) return
    setAppState((prev) => ({ ...prev, currentSongId: songId }))
    setNowPlayingByGig((prev) => ({ ...prev, [currentSetlist.id]: songId }))
    const client = supabase
    if (!client) return
    if (songId) {
      runSupabase(
        client.from('SetlistGigNowPlaying').upsert({
          gig_id: currentSetlist.id,
          song_id: songId,
          updated_at: new Date().toISOString(),
        }),
      )
    } else {
      runSupabase(
        client.from('SetlistGigNowPlaying').delete().eq('gig_id', currentSetlist.id),
      )
    }
  }
  const buildPanelGradient =
    activeBuildPanel === 'musicians'
      ? 'from-indigo-500/20 via-slate-900/60 to-slate-950/80'
      : activeBuildPanel === 'addSongs'
        ? 'from-teal-500/20 via-slate-900/60 to-slate-950/80'
        : activeBuildPanel === 'special'
          ? 'from-amber-500/20 via-slate-900/60 to-slate-950/80'
          : activeBuildPanel === 'dinner'
            ? 'from-emerald-500/20 via-slate-900/60 to-slate-950/80'
            : activeBuildPanel === 'latin'
              ? 'from-pink-500/20 via-slate-900/60 to-slate-950/80'
              : activeBuildPanel === 'dance'
                ? 'from-cyan-500/20 via-slate-900/60 to-slate-950/80'
                : 'from-slate-900/60 via-slate-900/80 to-slate-950/90'

  const setBuildComplete = (
    panel: NonNullable<typeof activeBuildPanel>,
    value: boolean,
  ) => {
    if (!currentSetlist) return
    if (value && ['special', 'dinner', 'latin', 'dance'].includes(panel)) {
      const hasMissingSingers =
        panel === 'special'
          ? appState.specialRequests.some(
              (request) =>
                request.gigId === currentSetlist.id &&
                !request.djOnly &&
                (!request.singers || request.singers.length === 0),
            )
          : currentSetlist.songIds
              .map((songId) => appState.songs.find((song) => song.id === songId))
              .filter((song): song is Song => Boolean(song))
              .filter((song) =>
                hasSongTag(
                  song,
                  panel === 'dinner' ? 'Dinner' : panel === 'latin' ? 'Latin' : 'Dance',
                ),
              )
              .some((song) => getGigSingerAssignments(song.id, currentSetlist.id).length === 0)
      if (hasMissingSingers) {
        setShowMissingSingerWarning(true)
        return
      }
    }
    setBuildPanelDirty(true)
    setBuildCompleteOverrides((prev) => {
      const next = {
        ...prev,
        [currentSetlist.id]: {
          ...(prev[currentSetlist.id] ?? {}),
          [panel]: value,
        },
      }
      localStorage.setItem('setlist_build_complete', JSON.stringify(next))
      return next
    })
  }

  const handlePrintSetlist = () => {
    if (!currentSetlist) return
    setShowPrintPreview(true)
  }

  const logPlayedSong = (songId: string) => {
    if (!currentSetlist) return
    const client = supabase
    if (!client) return
    runSupabase(
      client.from('SetlistPlayedSongs').insert({
        id: createId(),
        gig_id: currentSetlist.id,
        song_id: songId,
        played_at: new Date().toISOString(),
      }),
    )
  }

  const ensureVocalistsReady = () => {
    if (!currentSetlist) return false
    if (gigVocalists.length === 0) {
      setShowSingerWarning(true)
      return false
    }
    return true
  }

  const saveSingerAssignment = (
    songId: string,
    singerName: string,
    keyValue: string,
    rowIndex: number,
  ) => {
    if (!currentSetlist) return
    if (!ensureVocalistsReady()) return
    const song = appState.songs.find((item) => item.id === songId)
    if (!song) return
    const existingKey = song.keys.find((key) => key.singer === singerName)
    const normalizedKey =
      keyValue.trim() || existingKey?.defaultKey?.trim() || song.originalKey?.trim() || 'TBD'
    if (!singerName) return
    commitChange('Assign singer key', (prev) => ({
      ...prev,
      songs: prev.songs.map((item) => {
        if (item.id !== songId) return item
        const existing = item.keys.find((key) => key.singer === singerName)
        if (existing) {
          return {
            ...item,
            keys: item.keys.map((key) =>
              key.singer === singerName
                ? {
                    ...key,
                    gigOverrides: {
                      ...key.gigOverrides,
                      [currentSetlist.id]: normalizedKey,
                    },
                  }
                : key,
            ),
          }
        }
        return {
          ...item,
          keys: [
            ...item.keys,
            {
              singer: singerName,
              defaultKey: normalizedKey,
              gigOverrides: { [currentSetlist.id]: normalizedKey },
            },
          ],
        }
      }),
    }))
    if (supabase) {
      if (!existingKey) {
        runSupabase(
          supabase.from('SetlistSongKeys').insert({
            id: createId(),
            song_id: songId,
            singer_name: singerName,
            default_key: normalizedKey,
          }),
        )
      }
      runSupabase(
        supabase
          .from('SetlistGigSingerKeys')
          .delete()
          .match({
            gig_id: currentSetlist.id,
            song_id: songId,
            singer_name: singerName,
          }),
      )
      runSupabase(
        supabase.from('SetlistGigSingerKeys').insert({
          id: createId(),
          gig_id: currentSetlist.id,
          song_id: songId,
          singer_name: singerName,
          gig_key: normalizedKey,
        }),
      )
    }
    setPendingSingerAssignments((prev) => ({
      ...prev,
      [songId]: (prev[songId] ?? []).map((row, index) =>
        index === rowIndex ? { singer: '', key: '' } : row,
      ),
    }))
    setSingerModalSongId(null)
  }

  const commitChange = (label: string, updater: (prev: AppState) => AppState) => {
    if (!isAdmin) return
    setAppState((prev) => {
      const next = updater(prev)
      setHistory((entries) => [
        ...entries,
        { label, state: prev, timestamp: new Date().toLocaleTimeString() },
      ])
      setShowUndoToast(true)
      return next
    })
  }

  const handleLogin = () => {
    if (loginInput === ADMIN_PASSWORD) {
      if (loginTimerRef.current) {
        window.clearTimeout(loginTimerRef.current)
      }
      setLoginPhase('transition')
      loginTimerRef.current = window.setTimeout(() => {
        setRole('admin')
        setGigMode(false)
        setShowGigMusiciansModal(false)
        setShowSetlistModal(false)
        setShowPlaylistModal(false)
        setShowPrintPreview(false)
        setActiveBuildPanel(null)
        setScreen('setlists')
        setLoginPhase('app')
        localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
      }, 300)
      return
    }
    if (loginInput === USER_PASSWORD) {
      if (loginTimerRef.current) {
        window.clearTimeout(loginTimerRef.current)
      }
      setLoginPhase('transition')
      loginTimerRef.current = window.setTimeout(() => {
        setRole('user')
        setGigMode(false)
        setShowGigMusiciansModal(false)
        setShowSetlistModal(false)
        setShowPlaylistModal(false)
        setShowPrintPreview(false)
        setActiveBuildPanel(null)
        setScreen('setlists')
        setLoginPhase('app')
        localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
      }, 300)
      return
    }
  }

  const handleLogout = () => {
    if (loginTimerRef.current) {
      window.clearTimeout(loginTimerRef.current)
      loginTimerRef.current = null
    }
    setRole(null)
    setGigMode(false)
    setShowGigMusiciansModal(false)
    setShowSetlistModal(false)
    setShowPlaylistModal(false)
    setShowPrintPreview(false)
    setActiveBuildPanel(null)
    setScreen('setlists')
    setLoginPhase('login')
    setLoginInput('')
    localStorage.removeItem(LAST_ACTIVE_KEY)
  }

  const undoLast = () => {
    setHistory((entries) => {
      if (entries.length === 0) return entries
      const last = entries[entries.length - 1]
      setAppState(last.state)
      return entries.slice(0, -1)
    })
    setShowUndoToast(false)
  }

  const duplicateGig = (setlistId: string) => {
    const source = appState.setlists.find((setlist) => setlist.id === setlistId)
    if (!source) return
    const uniqueSourceSongIds = Array.from(new Set(source.songIds))
    const newId = createId()
    commitChange('Duplicate gig', (prev) => {
      const duplicate: Setlist = {
        ...source,
        id: newId,
        gigName: `${source.gigName} (Copy)`,
        date: new Date().toISOString().slice(0, 10),
        songIds: uniqueSourceSongIds,
      }
      const sourceGigMusicians = prev.gigMusicians.filter((gm) => gm.gigId === source.id)
      const clonedGigMusicians = sourceGigMusicians.map((gm) => ({
        ...gm,
        gigId: newId,
      }))
      const clonedSongs = prev.songs.map((song) => {
        const keys = song.keys.map((key) => {
          const sourceKey = key.gigOverrides[source.id]
          if (!sourceKey) return key
          return {
            ...key,
            gigOverrides: {
              ...key.gigOverrides,
              [newId]: sourceKey,
            },
          }
        })
        return { ...song, keys }
      })
      return {
        ...prev,
        setlists: [duplicate, ...prev.setlists],
        gigMusicians: [
          ...prev.gigMusicians.filter((gm) => gm.gigId !== newId),
          ...clonedGigMusicians,
        ],
        songs: clonedSongs,
      }
    })
    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigs').insert({
          id: newId,
          gig_name: `${source.gigName} (Copy)`,
          gig_date: new Date().toISOString().slice(0, 10),
          venue_address: source.venueAddress ?? '',
        }),
      )
      if (uniqueSourceSongIds.length) {
        runSupabase(
          supabase.from('SetlistGigSongs').insert(
            uniqueSourceSongIds.map((songId, index) => ({
              id: createId(),
              gig_id: newId,
              song_id: songId,
              sort_order: index,
            })),
          ),
        )
      }
      const gigMusicianRows = appState.gigMusicians
        .filter((gm) => gm.gigId === source.id)
        .map((gm) => ({
          id: createId(),
          gig_id: newId,
          musician_id: gm.musicianId,
          status: gm.status,
          note: gm.note ?? null,
        }))
      if (gigMusicianRows.length) {
        runSupabase(supabase.from('SetlistGigMusicians').insert(gigMusicianRows))
      }
      const gigSingerRows = uniqueSourceSongIds.flatMap((songId) => {
        const song = appState.songs.find((item) => item.id === songId)
        if (!song) return []
        return song.keys
          .filter((key) => key.gigOverrides[source.id])
          .map((key) => ({
            id: createId(),
            gig_id: newId,
            song_id: songId,
            singer_name: key.singer,
            gig_key: key.gigOverrides[source.id],
          }))
      })
      if (gigSingerRows.length) {
        runSupabase(supabase.from('SetlistGigSingerKeys').insert(gigSingerRows))
      }
    }
  }

  const createBlankSetlist = () => {
    const newId = createId()
    commitChange('Create setlist', (prev) => ({
      ...prev,
      setlists: [
        {
          id: newId,
          gigName: 'New Gig',
          date: new Date().toISOString().slice(0, 10),
          songIds: [],
        },
        ...prev.setlists,
      ],
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigs').insert({
          id: newId,
          gig_name: 'New Gig',
          gig_date: new Date().toISOString().slice(0, 10),
          venue_address: '',
        }),
      )
    }
    setSelectedSetlistId(newId)
    setScreen('builder')
  }

  const deleteGig = (setlistId: string) => {
    setPendingDeleteGigId(setlistId)
    setShowDeleteGigConfirm(true)
  }

  const confirmDeleteGig = () => {
    if (!pendingDeleteGigId) return
    const setlistId = pendingDeleteGigId
    setShowDeleteGigConfirm(false)
    setPendingDeleteGigId(null)
    commitChange('Delete gig', (prev) => ({
      ...prev,
      setlists: prev.setlists.filter((setlist) => setlist.id !== setlistId),
      specialRequests: prev.specialRequests.filter(
        (request) => request.gigId !== setlistId,
      ),
      gigMusicians: prev.gigMusicians.filter((gm) => gm.gigId !== setlistId),
    }))
    if (supabase) {
      runSupabase(supabase.from('SetlistGigs').delete().eq('id', setlistId))
    }
    if (selectedSetlistId === setlistId) {
      setSelectedSetlistId('')
    }
    if (activeGigId === setlistId) {
      setActiveGigId('')
    }
    setScreen('setlists')
  }

  const cancelDeleteGig = () => {
    setShowDeleteGigConfirm(false)
    setPendingDeleteGigId(null)
  }

  const addSongsToSetlist = () => {
    if (selectedSongIds.length === 0 || !currentSetlist) return
    const songsToAdd = selectedSongIds.filter((songId) => !currentSetlist.songIds.includes(songId))
    if (songsToAdd.length === 0) {
      setSelectedSongIds([])
      return
    }
    setBuildPanelDirty(true)
    commitChange('Add songs', (prev) => ({
      ...prev,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? { ...setlist, songIds: [...setlist.songIds, ...songsToAdd] }
          : setlist,
      ),
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigSongs').insert(
          songsToAdd.map((songId, index) => ({
            id: createId(),
            gig_id: currentSetlist.id,
            song_id: songId,
            sort_order: (currentSetlist.songIds.length ?? 0) + index,
          })),
        ),
      )
    }
    setSelectedSongIds([])
  }

  const removeSongFromSetlist = (songId: string) => {
    if (!currentSetlist) return
    commitChange('Remove song', (prev) => ({
      ...prev,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? { ...setlist, songIds: setlist.songIds.filter((id) => id !== songId) }
          : setlist,
      ),
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistGigSongs')
          .delete()
          .eq('gig_id', currentSetlist.id)
          .eq('song_id', songId),
      )
    }
  }

  const requestRemoveSong = (songId: string) => {
    setPendingRemoveSongId(songId)
    setShowRemoveSongConfirm(true)
  }

  const openSingerModal = (songId: string) => {
    if (!currentSetlist) return
    setSingerModalSongId(songId)
  }

  const confirmRemoveSong = () => {
    if (!pendingRemoveSongId) return
    removeSongFromSetlist(pendingRemoveSongId)
    setPendingRemoveSongId(null)
    setShowRemoveSongConfirm(false)
  }

  const cancelRemoveSong = () => {
    setPendingRemoveSongId(null)
    setShowRemoveSongConfirm(false)
  }

  const importSectionFromGig = (section: string, gigId: string) => {
    const source = appState.setlists.find((setlist) => setlist.id === gigId)
    if (!source || !currentSetlist) return
    setBuildPanelDirty(true)
    const sectionSongIds = source.songIds.filter((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      return song ? hasSongTag(song, section) : false
    })
    if (sectionSongIds.length === 0) return
    commitChange(`Import ${section} from gig`, (prev) => ({
      ...prev,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? {
              ...setlist,
              songIds: Array.from(new Set([...setlist.songIds, ...sectionSongIds])),
            }
          : setlist,
      ),
      songs: prev.songs.map((song) => {
        if (!sectionSongIds.includes(song.id)) return song
        const nextKeys = song.keys.map((key) => {
          const sourceKey = key.gigOverrides[gigId]
          if (!sourceKey) return key
          return {
            ...key,
            gigOverrides: {
              ...key.gigOverrides,
              [currentSetlist.id]: sourceKey,
            },
          }
        })
        return { ...song, keys: nextKeys }
      }),
    }))
    const client = supabase
    if (client) {
      sectionSongIds.forEach((songId) => {
        const song = appState.songs.find((item) => item.id === songId)
        if (!song) return
        song.keys.forEach((key) => {
          const sourceKey = key.gigOverrides[gigId]
          if (!sourceKey) return
          runSupabase(
            client
              .from('SetlistGigSingerKeys')
              .delete()
              .match({
                gig_id: currentSetlist.id,
                song_id: songId,
                singer_name: key.singer,
              }),
          )
          runSupabase(
            client.from('SetlistGigSingerKeys').insert({
              id: createId(),
              gig_id: currentSetlist.id,
              song_id: songId,
              singer_name: key.singer,
              gig_key: sourceKey,
            }),
          )
        })
      })
    }
  }

  const importSectionFromPaste = (
    section: 'Dinner' | 'Latin' | 'Dance',
    text: string,
  ) => {
    if (!currentSetlist) return
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (!lines.length) return
    setBuildPanelDirty(true)
    const normalize = (value: string) =>
      value.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim()
    const entries = lines
      .map((line) => line.replace(/^[\-\*\u2022\d\.\)\s]+/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const divider = line.includes(' – ')
          ? ' – '
          : line.includes(' - ')
            ? ' - '
            : null
        if (!divider) {
          return { title: line, artist: '' }
        }
        const [title, artistRaw] = line.split(divider)
        const artist = (artistRaw ?? '').replace(/\s*\(.*\)\s*$/, '').trim()
        return { title: title.trim(), artist }
      })
      .filter((entry) => entry.title.length > 0)

    if (!entries.length) return

    const existingByTitle = new Map(
      appState.songs.map((song) => [normalize(song.title), song]),
    )
    const existingByTitleArtist = new Map(
      appState.songs.map((song) => [
        `${normalize(song.title)}|${normalize(song.artist ?? '')}`,
        song,
      ]),
    )
    const songIdsToAdd: string[] = []
    const songIdsToTag = new Set<string>()
    const newSongs: Song[] = []
    const songInserts: { id: string; title: string; artist: string | null }[] = []
    const tagInserts: { id: string; song_id: string; tag: string }[] = []

    entries.forEach((entry) => {
      const artistKey = normalize(entry.artist || '')
      const titleKey = normalize(entry.title)
      const found = artistKey
        ? existingByTitleArtist.get(`${titleKey}|${artistKey}`)
        : existingByTitle.get(titleKey)
      if (found) {
        if (!hasSongTag(found, section)) {
          songIdsToTag.add(found.id)
          tagInserts.push({ id: createId(), song_id: found.id, tag: section })
        }
        if (!currentSetlist.songIds.includes(found.id)) {
          songIdsToAdd.push(found.id)
        }
        return
      }
      const id = createId()
      newSongs.push({
        id,
        title: entry.title,
        artist: entry.artist,
        originalKey: '',
        youtubeUrl: '',
        tags: [section],
        keys: [],
        specialPlayedCount: 0,
      })
      songInserts.push({
        id,
        title: entry.title,
        artist: entry.artist || null,
      })
      tagInserts.push({ id: createId(), song_id: id, tag: section })
      songIdsToAdd.push(id)
      existingByTitle.set(titleKey, newSongs[newSongs.length - 1])
      if (artistKey) {
        existingByTitleArtist.set(
          `${titleKey}|${artistKey}`,
          newSongs[newSongs.length - 1],
        )
      }
    })

    const uniqueSongIdsToAdd = songIdsToAdd.filter(
      (songId, index) => songIdsToAdd.indexOf(songId) === index,
    )

    commitChange(`Import ${section} paste`, (prev) => ({
      ...prev,
      songs: [
        ...newSongs,
        ...prev.songs.map((song) =>
          songIdsToTag.has(song.id)
            ? { ...song, tags: Array.from(new Set([...song.tags, section])) }
            : song,
        ),
      ],
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? {
              ...setlist,
              songIds: Array.from(
                new Set([...setlist.songIds, ...uniqueSongIdsToAdd]),
              ),
            }
          : setlist,
      ),
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, section])),
    }))

    const client = supabase
    if (client) {
      if (songInserts.length) {
        runSupabase(client.from('SetlistSongs').insert(songInserts))
      }
      if (tagInserts.length) {
        runSupabase(client.from('SetlistSongTags').insert(tagInserts))
      }
      if (uniqueSongIdsToAdd.length) {
        runSupabase(
          client.from('SetlistGigSongs').insert(
            uniqueSongIdsToAdd.map((songId, index) => ({
              id: createId(),
              gig_id: currentSetlist.id,
              song_id: songId,
              sort_order: currentSetlist.songIds.length + index,
            })),
          ),
        )
      }
    }
    setStarterPasteBySection((prev) => ({ ...prev, [section]: '' }))
    setStarterPasteOpen((prev) => ({ ...prev, [section]: false }))
  }

  const addSongToSection = (section: string, songTitle: string) => {
    const song = appState.songs.find(
      (item) => item.title.toLowerCase() === songTitle.toLowerCase(),
    )
    if (!song || !currentSetlist) return
    setBuildPanelDirty(true)
    commitChange(`Add ${song.title} to ${section}`, (prev) => ({
      ...prev,
      songs: prev.songs.map((item) =>
        item.id === song.id && !hasSongTag(item, section)
          ? { ...item, tags: [...item.tags, section] }
          : item,
      ),
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? {
              ...setlist,
              songIds: Array.from(new Set([...setlist.songIds, song.id])),
            }
          : setlist,
      ),
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigSongs').insert({
          id: createId(),
          gig_id: currentSetlist.id,
          song_id: song.id,
          sort_order: currentSetlist.songIds.length,
        }),
      )
      if (!hasSongTag(song, section)) {
        runSupabase(
          supabase.from('SetlistSongTags').insert({
            id: createId(),
            song_id: song.id,
            tag: section,
          }),
        )
      }
    }
  }

  const reorderSectionSongs = (section: 'Dinner' | 'Latin' | 'Dance', fromId: string, toId: string) => {
    if (!currentSetlist || fromId === toId) return
    const sectionSongIds = currentSetlist.songIds.filter((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      return song ? hasSongTag(song, section) : false
    })
    const fromIndex = sectionSongIds.indexOf(fromId)
    const toIndex = sectionSongIds.indexOf(toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    const reorderedSectionSongIds = [...sectionSongIds]
    const [moved] = reorderedSectionSongIds.splice(fromIndex, 1)
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    reorderedSectionSongIds.splice(insertIndex, 0, moved)

    let cursor = 0
    const nextSongIds = currentSetlist.songIds.map((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      if (!song || !hasSongTag(song, section)) return songId
      const nextId = reorderedSectionSongIds[cursor]
      cursor += 1
      return nextId
    })
    const dedupedNextSongIds = Array.from(new Set(nextSongIds))

    setBuildPanelDirty(true)
    commitChange(`Reorder ${section} songs`, (prev) => ({
      ...prev,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id ? { ...setlist, songIds: dedupedNextSongIds } : setlist,
      ),
    }))

    if (supabase) {
      const client = supabase
      dedupedNextSongIds.forEach((songId, index) => {
        runSupabase(
          client
            .from('SetlistGigSongs')
            .update({ sort_order: index })
            .eq('gig_id', currentSetlist.id)
            .eq('song_id', songId),
        )
      })
    }
  }

  const flashMovedSong = (songId: string) => {
    setRecentlyMovedSongId(songId)
    if (movedSongTimerRef.current) {
      window.clearTimeout(movedSongTimerRef.current)
    }
    movedSongTimerRef.current = window.setTimeout(() => {
      setRecentlyMovedSongId(null)
      movedSongTimerRef.current = null
    }, 850)
  }

  const addMusician = () => {
    const name = newMusicianName.trim()
    if (!name) return
    const id = createId()
    commitChange('Add musician', (prev) => ({
      ...prev,
      musicians: [
        {
          id,
          name,
          roster: newMusicianRoster,
          email: newMusicianEmail.trim() || undefined,
          phone: newMusicianPhone.trim() || undefined,
          instruments: newMusicianInstruments,
          singer: newMusicianSinger || undefined,
        },
        ...prev.musicians,
      ],
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistMusicians').insert({
          id,
          name,
          roster: newMusicianRoster,
          email: newMusicianEmail.trim() || null,
          phone: newMusicianPhone.trim() || null,
          instruments: newMusicianInstruments,
          singer: newMusicianSinger || null,
        }),
      )
    }
    setNewMusicianName('')
    setNewMusicianEmail('')
    setNewMusicianPhone('')
    setNewMusicianInstruments([])
    setNewMusicianSinger('')
    setNewMusicianRoster('core')
  }

  const ensureGigExistsInSupabase = (gigId: string) => {
    if (!supabase) return
    const gig = appState.setlists.find((setlist) => setlist.id === gigId)
    if (!gig) return
    runSupabase(
      supabase.from('SetlistGigs').upsert(
        {
          id: gig.id,
          gig_name: gig.gigName,
          gig_date: gig.date,
          venue_address: gig.venueAddress ?? '',
        },
        { onConflict: 'id' },
      ),
    )
  }

  const importRosterToGig = () => {
    if (!activeGigId) return
    setBuildPanelDirty(true)
    const coreMusicians = appState.musicians.filter((musician) => musician.roster === 'core')
    commitChange('Import roster', (prev) => ({
      ...prev,
      gigMusicians: [
        ...prev.gigMusicians.filter((gm) => gm.gigId !== activeGigId),
        ...coreMusicians.map((musician) => ({
          gigId: activeGigId,
          musicianId: musician.id,
          status: 'active' as const,
        })),
      ],
    }))
    if (supabase) {
      ensureGigExistsInSupabase(activeGigId)
      runSupabase(
        supabase.from('SetlistGigMusicians').delete().eq('gig_id', activeGigId),
      )
      runSupabase(
        supabase.from('SetlistGigMusicians').insert(
          coreMusicians.map((musician) => ({
            id: createId(),
            gig_id: activeGigId,
            musician_id: musician.id,
            status: 'active',
          })),
        ),
      )
    }
  }

  const toggleGigMusicianStatus = (musicianId: string) => {
    if (!activeGigId) return
    setBuildPanelDirty(true)
    commitChange('Toggle musician', (prev) => ({
      ...prev,
      gigMusicians: prev.gigMusicians.map((gm) =>
        gm.gigId === activeGigId && gm.musicianId === musicianId
          ? { ...gm, status: gm.status === 'active' ? 'out' : 'active' }
          : gm,
      ),
    }))
    const current = appState.gigMusicians.find(
      (gm) => gm.gigId === activeGigId && gm.musicianId === musicianId,
    )
    if (supabase && current) {
      const nextStatus = current.status === 'active' ? 'out' : 'active'
      runSupabase(
        supabase
          .from('SetlistGigMusicians')
          .update({ status: nextStatus })
          .eq('gig_id', activeGigId)
          .eq('musician_id', musicianId),
      )
    }
  }

  const addMusicianToGig = (musicianId: string) => {
    if (!activeGigId) return
    setBuildPanelDirty(true)
    commitChange('Add musician to gig', (prev) => ({
      ...prev,
      gigMusicians: prev.gigMusicians.some(
        (gm) => gm.gigId === activeGigId && gm.musicianId === musicianId,
      )
        ? prev.gigMusicians
        : [
            ...prev.gigMusicians,
            { gigId: activeGigId, musicianId, status: 'active' },
          ],
    }))
    if (supabase) {
      ensureGigExistsInSupabase(activeGigId)
      runSupabase(
        supabase.from('SetlistGigMusicians').insert({
          id: createId(),
          gig_id: activeGigId,
          musician_id: musicianId,
          status: 'active',
        }),
      )
    }
  }

  const removeMusicianFromGig = (musicianId: string) => {
    if (!activeGigId) return
    setBuildPanelDirty(true)
    commitChange('Remove musician from gig', (prev) => ({
      ...prev,
      gigMusicians: prev.gigMusicians.filter(
        (gm) => !(gm.gigId === activeGigId && gm.musicianId === musicianId),
      ),
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistGigMusicians')
          .delete()
          .eq('gig_id', activeGigId)
          .eq('musician_id', musicianId),
      )
    }
  }

  const addSubAndAssign = () => {
    const name = newSubName.trim()
    if (!name || !activeGigId) return
    setBuildPanelDirty(true)
    const id = createId()
    commitChange('Add sub to gig', (prev) => ({
      ...prev,
      musicians: [
        {
          id,
          name,
          roster: 'sub',
          email: newSubEmail.trim() || undefined,
          phone: newSubPhone.trim() || undefined,
          instruments: newSubInstruments,
          singer: newSubSinger || undefined,
        },
        ...prev.musicians,
      ],
      gigMusicians: [
        ...prev.gigMusicians,
        { gigId: activeGigId, musicianId: id, status: 'active' },
      ],
    }))
    if (supabase) {
      ensureGigExistsInSupabase(activeGigId)
      runSupabase(
        supabase.from('SetlistMusicians').insert({
          id,
          name,
          roster: 'sub',
          email: newSubEmail.trim() || null,
          phone: newSubPhone.trim() || null,
          instruments: newSubInstruments,
          singer: newSubSinger || null,
        }),
      )
      runSupabase(
        supabase.from('SetlistGigMusicians').insert({
          id: createId(),
          gig_id: activeGigId,
          musician_id: id,
          status: 'active',
        }),
      )
    }
    setNewSubName('')
    setNewSubEmail('')
    setNewSubPhone('')
    setNewSubInstruments([])
    setNewSubSinger('')
    setInstrumentFilter('')
    setNewInstrumentInput('')
  }

  const addInstrumentToCatalog = () => {
    const value = newInstrumentInput.trim()
    if (!value) return
    if (!instrumentCatalog.includes(value)) {
      setInstrumentCatalog((prev) => [...prev, value])
    }
    setNewInstrumentInput('')
  }

  const openSongEditor = (song: Song) => {
    startEditSong(song)
    setNewDocSongId(song.id)
    setNewDocSongTitle(song.title)
    setNewDocType('')
    setNewDocInstrument('')
    setNewDocTitle('')
    setNewDocUrl('')
    setNewDocFile(null)
    setNewDocLyrics('')
  }

  const updateDocumentFile = async (doc: Document, file: File) => {
    const uploadedUrl = await uploadDocFile(file, doc.songId, doc.id)
    const fileUrl = uploadedUrl ?? file.name
    setAppState((prev) => ({
      ...prev,
      documents: prev.documents.map((item) =>
        item.id === doc.id ? { ...item, url: fileUrl } : item,
      ),
      charts:
        doc.type === 'Chart'
          ? prev.charts.map((item) =>
              item.id === doc.id ? { ...item, fileName: fileUrl } : item,
            )
          : prev.charts,
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistDocuments')
          .update({ file_url: fileUrl })
          .eq('id', doc.id),
      )
    }
  }

  const saveDocumentFromEditor = async (clearAfter: boolean): Promise<boolean> => {
    const trimmedTitle = newDocSongTitle.trim()
    const selectedSong =
      appState.songs.find((item) => item.id === newDocSongId) ??
      appState.songs.find(
        (item) => item.title.toLowerCase() === trimmedTitle.toLowerCase(),
      )
    if (!selectedSong) {
      setDocFormError('Select a song to attach this document.')
      return false
    }
    if (!newDocType) {
      setDocFormError('Select Chart, Lyrics, or Lead Sheet first.')
      return false
    }
    setDocFormError('')
    const instrument =
      newDocType === 'Lyrics' ? 'Vocals' : newDocInstrument.trim() || 'All'
    const title =
      newDocType === 'Lyrics'
        ? `${selectedSong.title}${selectedSong.artist ? ` - ${selectedSong.artist}` : ''}`
        : newDocTitle.trim() ||
          `${selectedSong.title} ${newDocType === 'Chart' ? 'Chart' : newDocType}`
    const existingDoc = appState.documents.find(
      (doc) =>
        doc.songId === selectedSong.id &&
        doc.type === newDocType &&
        doc.instrument === instrument &&
        doc.title === title,
    )
    const docId = existingDoc?.id ?? createId()
    const uploadedUrl = newDocFile
      ? await uploadDocFile(newDocFile, selectedSong.id, docId)
      : null
    const fileUrl = newDocUrl.trim() || uploadedUrl || newDocFile?.name || null
    const content = newDocType === 'Lyrics' ? newDocLyrics.trim() || undefined : undefined
    const doc: Document = {
      id: docId,
      songId: selectedSong.id,
      type: newDocType,
      instrument,
      title,
      url: fileUrl ?? undefined,
      content,
    }

    setAppState((prev) => {
      const nextDocuments = existingDoc
        ? prev.documents.map((item) => (item.id === doc.id ? doc : item))
        : [doc, ...prev.documents]
      const nextCharts =
        doc.type === 'Chart'
          ? existingDoc
            ? prev.charts.map((item) =>
                item.id === doc.id
                  ? {
                      ...item,
                      title: doc.title,
                      instrument: doc.instrument,
                      fileName: doc.url,
                    }
                  : item,
              )
            : [
                {
                  id: doc.id,
                  songId: doc.songId,
                  instrument: doc.instrument,
                  title: doc.title,
                  fileName: doc.url,
                },
                ...prev.charts,
              ]
          : prev.charts
      return { ...prev, documents: nextDocuments, charts: nextCharts }
    })

    if (supabase) {
      if (existingDoc) {
        runSupabase(
          supabase
            .from('SetlistDocuments')
            .update({
              doc_type: doc.type,
              instrument: doc.instrument,
              title: doc.title,
              file_url: doc.url ?? null,
              content: doc.content ?? null,
            })
            .eq('id', doc.id),
        )
      } else {
        runSupabase(
          supabase.from('SetlistDocuments').insert({
            id: doc.id,
            song_id: doc.songId,
            doc_type: doc.type,
            instrument: doc.instrument,
            title: doc.title,
            file_url: doc.url ?? null,
            content: doc.content ?? null,
          }),
        )
      }
    }

    if (clearAfter) {
      setNewDocSongId('')
      setNewDocSongTitle('')
      setNewDocType('')
      setNewDocInstrument('')
      setNewDocTitle('')
      setNewDocUrl('')
      setNewDocFile(null)
      setNewDocLyrics('')
    } else {
      setNewDocFile(null)
    }
    return true
  }

  const addSongDraft = (
    draft: {
      title: string
      artist: string
      originalKey: string
      audioUrl: string
      tags: string[]
    },
    openEditor = false,
  ) => {
    const id = createId()
    const createdSong: Song = {
      id,
      title: draft.title,
      artist: draft.artist,
      originalKey: draft.originalKey,
      youtubeUrl: draft.audioUrl || '',
      tags: draft.tags,
      keys: [],
      specialPlayedCount: 0,
    }
    commitChange('Add song', (prev) => ({
      ...prev,
      songs: [createdSong, ...prev.songs],
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, ...draft.tags])),
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistSongs').insert({
          id,
          title: draft.title,
          artist: draft.artist || null,
          audio_url: draft.audioUrl || null,
          original_key: draft.originalKey || null,
        }),
      )
      if (draft.tags.length) {
        runSupabase(
          supabase.from('SetlistSongTags').insert(
            draft.tags.map((tag) => ({
              id: createId(),
              song_id: id,
              tag,
            })),
          ),
        )
      }
    }
    if (openEditor) {
      openSongEditor(createdSong)
    }
    setNewSongTitle('')
    setNewSongArtist('')
    setNewSongAudio('')
    setNewSongOriginalKey('')
    setNewSongTags([])
    setSongFormError('')
    setPendingSongDraft(null)
    setSimilarSongMatches([])
    setShowDuplicateSongConfirm(false)
    setShowAddSongModal(false)
  }

  const addSongFromAdmin = (openEditor = false) => {
    const title = newSongTitle.trim()
    if (!title) {
      setSongFormError('Enter a song title to continue.')
      return
    }
    const normalize = (value: string) =>
      value.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim()
    const artist = newSongArtist.trim()
    const titleKey = normalize(title)
    const artistKey = normalize(artist)
    const existing = appState.songs.find((song) => {
      if (normalize(song.title) !== titleKey) return false
      if (!artistKey) return true
      return normalize(song.artist ?? '') === artistKey
    })
    if (existing) {
      setSongFormError('Song already exists. Tap it to edit.')
      if (openEditor) {
        openSongEditor(existing)
      }
      return
    }
    const similar = appState.songs.filter((song) => {
      const existingTitle = normalize(song.title)
      if (!existingTitle) return false
      if (existingTitle.includes(titleKey) || titleKey.includes(existingTitle)) {
        return true
      }
      const words = titleKey.split(' ').filter(Boolean)
      const overlap = words.filter((word) => existingTitle.includes(word))
      return overlap.length >= Math.min(2, words.length)
    })
    if (similar.length) {
      setSongFormError('')
      setPendingSongDraft({
        title,
        artist,
        originalKey: newSongOriginalKey.trim(),
        audioUrl: newSongAudio.trim(),
        tags: newSongTags,
      })
      setSimilarSongMatches(similar)
      setShowDuplicateSongConfirm(true)
      return
    }
    setSongFormError('')
    addSongDraft(
      {
        title,
        artist,
        originalKey: newSongOriginalKey.trim(),
        audioUrl: newSongAudio.trim(),
        tags: newSongTags,
      },
      openEditor,
    )
  }

  const confirmDuplicateSong = () => {
    if (!pendingSongDraft) return
    addSongDraft(pendingSongDraft, false)
    setPendingSongDraft(null)
    setSimilarSongMatches([])
    setShowDuplicateSongConfirm(false)
  }

  const cancelDuplicateSong = () => {
    setPendingSongDraft(null)
    setSimilarSongMatches([])
    setShowDuplicateSongConfirm(false)
  }

  const openAddSongForSection = (section: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    setNewSongArtist('')
    setNewSongAudio('')
    setNewSongOriginalKey('')
    setNewSongTitle(trimmed)
    setNewSongTags([section])
    setSongFormError('')
    setPendingSongDraft(null)
    setSimilarSongMatches([])
    setShowDuplicateSongConfirm(false)
    setShowAddSongModal(true)
  }

  const startEditSong = (song: Song) => {
    setEditingSongId(song.id)
    setEditingSongTitle(song.title)
    setEditingSongArtist(song.artist ?? '')
    setEditingSongAudio(song.youtubeUrl ?? '')
    setEditingSongOriginalKey(song.originalKey ?? '')
    const normalizedTags = normalizeTagList(song.tags ?? [])
    setEditingSongTags(normalizedTags)
    editSongBaselineRef.current = {
      title: song.title ?? '',
      artist: song.artist ?? '',
      audio: song.youtubeUrl ?? '',
      originalKey: song.originalKey ?? '',
      tags: normalizedTags,
    }
  }

  const cancelEditSong = () => {
    setEditingSongId(null)
    setEditingSongTitle('')
    setEditingSongArtist('')
    setEditingSongAudio('')
    setEditingSongOriginalKey('')
    setEditingSongTags([])
    editSongBaselineRef.current = null
  }

  const saveEditSong = (closeAfter = true) => {
    if (!editingSongId) return
    const title = editingSongTitle.trim()
    if (!title) return
    const normalizedEditingTags = normalizeTagList(editingSongTags)
    commitChange('Update song', (prev) => ({
      ...prev,
      songs: prev.songs.map((song) =>
        song.id === editingSongId
          ? {
              ...song,
              title,
              artist: editingSongArtist.trim(),
              youtubeUrl: editingSongAudio.trim(),
              originalKey: editingSongOriginalKey.trim(),
              tags: normalizedEditingTags,
            }
          : song,
      ),
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, ...normalizedEditingTags])),
    }))
    if (supabase) {
      runSupabase(
        (async () => {
          const { error: updateError } = await supabase
            .from('SetlistSongs')
            .update({
              title,
              artist: editingSongArtist.trim() || null,
              audio_url: editingSongAudio.trim() || null,
              original_key: editingSongOriginalKey.trim() || null,
            })
            .eq('id', editingSongId)
          if (updateError) return { error: updateError }

          const { error: deleteError } = await supabase
            .from('SetlistSongTags')
            .delete()
            .eq('song_id', editingSongId)
          if (deleteError) return { error: deleteError }

          if (!normalizedEditingTags.length) return { error: null }

          const { error: insertError } = await supabase.from('SetlistSongTags').insert(
            normalizedEditingTags.map((tag) => ({
              id: createId(),
              song_id: editingSongId,
              tag,
            })),
          )
          return { error: insertError }
        })(),
      )
    }
    if (closeAfter) {
      cancelEditSong()
    }
  }

  const hasPendingDocDraft =
    Boolean(editingSongId && newDocSongId && newDocType) &&
    (newDocType === 'Lyrics'
      ? Boolean(newDocLyrics.trim())
      : Boolean(newDocUrl.trim() || newDocFile))

  const handleSaveSongEditor = async () => {
    if (hasPendingDocDraft) {
      const ok = await saveDocumentFromEditor(false)
      if (!ok) return
    }
    if (isEditSongDirty) {
      saveEditSong(false)
    }
    cancelEditSong()
  }

  const deleteSong = (songId: string) => {
    commitChange('Delete song', (prev) => ({
      ...prev,
      songs: prev.songs.filter((song) => song.id !== songId),
      setlists: prev.setlists.map((setlist) => ({
        ...setlist,
        songIds: setlist.songIds.filter((id) => id !== songId),
      })),
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistSongs')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', songId),
      )
    }
    if (editingSongId === songId) {
      cancelEditSong()
    }
  }

  const startEditMusician = (musician: Musician) => {
    setEditingMusicianId(musician.id)
    setEditingMusicianName(musician.name)
    setEditingMusicianRoster(musician.roster)
    setEditingMusicianEmail(musician.email ?? '')
    setEditingMusicianPhone(musician.phone ?? '')
    setEditingMusicianInstruments(musician.instruments ?? [])
    setEditingMusicianSinger(musician.singer ?? '')
  }

  const cancelEditMusician = () => {
    setEditingMusicianId(null)
    setEditingMusicianName('')
    setEditingMusicianRoster('core')
    setEditingMusicianEmail('')
    setEditingMusicianPhone('')
    setEditingMusicianInstruments([])
    setEditingMusicianSinger('')
  }

  const saveEditMusician = () => {
    if (!editingMusicianId) return
    const name = editingMusicianName.trim()
    if (!name) return
    commitChange('Update musician', (prev) => ({
      ...prev,
      musicians: prev.musicians.map((musician) =>
        musician.id === editingMusicianId
          ? {
              ...musician,
              name,
              roster: editingMusicianRoster,
              email: editingMusicianEmail.trim() || undefined,
              phone: editingMusicianPhone.trim() || undefined,
              instruments: editingMusicianInstruments,
              singer: editingMusicianSinger || undefined,
            }
          : musician,
      ),
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistMusicians')
          .update({
            name,
            roster: editingMusicianRoster,
            email: editingMusicianEmail.trim() || null,
            phone: editingMusicianPhone.trim() || null,
            instruments: editingMusicianInstruments,
            singer: editingMusicianSinger || null,
          })
          .eq('id', editingMusicianId),
      )
    }
    cancelEditMusician()
  }

  const deleteMusician = (musicianId: string) => {
    commitChange('Delete musician', (prev) => ({
      ...prev,
      musicians: prev.musicians.filter((musician) => musician.id !== musicianId),
      gigMusicians: prev.gigMusicians.filter((gm) => gm.musicianId !== musicianId),
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistMusicians')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', musicianId),
      )
    }
    if (editingMusicianId === musicianId) {
      cancelEditMusician()
    }
  }

  useEffect(() => {
    if (!showUndoToast) return
    const timer = window.setTimeout(() => {
      setShowUndoToast(false)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [showUndoToast])

  const addSpecialRequest = () => {
    if (!currentSetlist) return
    setBuildPanelDirty(true)
    const type = pendingSpecialType.trim()
    const customSong = pendingSpecialSong.trim()
    const existingSong = appState.songs.find(
      (song) => song.title.toLowerCase() === customSong.toLowerCase(),
    )
    const songTitle = existingSong?.title ?? customSong
    if (
      !type ||
      !songTitle ||
      (!pendingSpecialDjOnly &&
        (pendingSpecialSingers.length === 0 || !pendingSpecialKey))
    ) {
      return
    }
    const requestId = createId()
    const createdSongId = existingSong?.id ?? createId()
    commitChange('Add special request', (prev) => {
      const requestTypeTag = prev.tagsCatalog.includes(type)
        ? prev.tagsCatalog
        : [...prev.tagsCatalog, type]
      const nextSongs =
        existingSong || !customSong
          ? prev.songs.map((song) =>
              song.id === existingSong?.id
                ? { ...song, specialPlayedCount: song.specialPlayedCount + 1 }
                : song,
            )
          : [
              {
                id: createdSongId,
                title: customSong,
                artist: 'New Artist',
                tags: ['Special Request', type],
                keys: [{ singer: 'Maya', defaultKey: 'C', gigOverrides: {} }],
                specialPlayedCount: 1,
              },
              ...prev.songs,
            ]
      return {
        ...prev,
        specialRequests: [
          {
            id: requestId,
            gigId: currentSetlist.id,
            type,
            songTitle,
            songId: createdSongId,
            singers: pendingSpecialDjOnly ? [] : pendingSpecialSingers,
            key: pendingSpecialDjOnly ? '' : pendingSpecialKey,
            note: pendingSpecialNote.trim() || undefined,
            djOnly: pendingSpecialDjOnly,
            externalAudioUrl: pendingSpecialExternalUrl.trim() || undefined,
          },
          ...prev.specialRequests,
        ],
        songs: nextSongs,
        specialTypes: prev.specialTypes.includes(type)
          ? prev.specialTypes
          : [...prev.specialTypes, type],
        tagsCatalog: requestTypeTag,
      }
    })
    setPendingSpecialType('')
    setPendingSpecialSong('')
    setPendingSpecialSingers([])
    setPendingSpecialKey('')
    setPendingSpecialNote('')
    setPendingSpecialDjOnly(false)
    setPendingSpecialExternalUrl('')
    if (supabase) {
      if (!existingSong && customSong) {
        runSupabase(
          supabase.from('SetlistSongs').insert({
            id: createdSongId,
            title: customSong,
            artist: 'New Artist',
            audio_url: null,
          }),
        )
        runSupabase(
          supabase.from('SetlistSongKeys').insert({
            id: createId(),
            song_id: createdSongId,
            singer_name: 'Maya',
            default_key: 'C',
          }),
        )
        runSupabase(
          supabase.from('SetlistSongTags').insert(
            ['Special Request', type].map((tag) => ({
              id: createId(),
              song_id: createdSongId,
              tag,
            })),
          ),
        )
      }
      runSupabase(
        supabase.from('SetlistSpecialRequests').insert({
          id: requestId,
          gig_id: currentSetlist.id,
          request_type: type,
          song_title: songTitle,
          song_id: createdSongId,
          singers: pendingSpecialDjOnly ? [] : pendingSpecialSingers,
          song_key: pendingSpecialDjOnly ? null : pendingSpecialKey,
          note: pendingSpecialNote.trim() || null,
          dj_only: pendingSpecialDjOnly,
          external_audio_url: pendingSpecialExternalUrl.trim() || null,
        }),
      )
    }
  }

  const hasDocsForSong = (songId?: string) => {
    if (!songId) return false
    const docs = appState.documents.filter((doc) => doc.songId === songId)
    if (docs.length === 0) return false
    if (!appState.instrument || appState.instrument === 'All') return true
    return docs.some(
      (doc) => doc.instrument === appState.instrument || doc.instrument === 'All',
    )
  }

  const openAudioForUrl = (url: string, label?: string) => {
    setAudioModalUrl(url)
    setAudioModalLabel(label ?? 'Audio player')
  }

  const isSpotifyUrl = (url: string | null) => Boolean(url?.includes('open.spotify.com'))
  const isAudioFileUrl = (url: string | null) =>
    Boolean(url && (url.endsWith('.mp3') || url.endsWith('.wav') || url.endsWith('.m4a')))

  const openDocsForSong = (songId?: string) => {
    if (!songId) return
    if (role === 'admin') {
      setShowInstrumentPrompt(false)
      setPendingDocSongId(null)
      setDocModalSongId(songId)
      return
    }
    if (!appState.instrument || appState.instrument === 'All') {
      setPendingDocSongId(songId)
      setShowInstrumentPrompt(true)
      return
    }
    setDocModalSongId(songId)
  }
  const openLyricsForSong = (songId?: string) => {
    if (!songId) return
    const lyricsDoc = appState.documents.find(
      (doc) => doc.songId === songId && doc.type === 'Lyrics',
    )
    if (!lyricsDoc) return
    setShowInstrumentPrompt(false)
    setPendingDocSongId(null)
    setDocModalSongId(songId)
    setDocModalContent(lyricsDoc)
  }

  const createId = () => crypto.randomUUID()
  const reportSupabaseError = (error: { message?: string } | null) => {
    if (error?.message) {
      setSupabaseError(error.message)
    }
  }
  const runSupabase = (
    promise: PromiseLike<{ error: { message?: string } | null }>,
  ) => {
    void promise.then(({ error }) => reportSupabaseError(error))
  }
  const uploadDocFile = async (file: File, songId: string, docId: string) => {
    if (!supabase) return null
    const path = `${songId}/${docId}-${file.name}`
    const { error } = await supabase.storage
      .from('setlist-docs')
      .upload(path, file, { upsert: true })
    if (error) {
      reportSupabaseError(error)
      return null
    }
    const { data } = supabase.storage.from('setlist-docs').getPublicUrl(path)
    return data.publicUrl
  }

  const loadSupabaseData = useCallback(async () => {
    if (!supabase) return
    setSupabaseError(null)
    const [
      songsRes,
      tagsRes,
      keysRes,
      gigsRes,
      gigSongsRes,
      gigSingerKeysRes,
      specialReqRes,
      docsRes,
      musiciansRes,
      gigMusiciansRes,
      nowPlayingRes,
    ] = await Promise.all([
      supabase.from('SetlistSongs').select('*').is('deleted_at', null),
      supabase.from('SetlistSongTags').select('*'),
      supabase.from('SetlistSongKeys').select('*'),
      supabase.from('SetlistGigs').select('*'),
      supabase.from('SetlistGigSongs').select('*'),
      supabase.from('SetlistGigSingerKeys').select('*'),
      supabase.from('SetlistSpecialRequests').select('*'),
      supabase.from('SetlistDocuments').select('*'),
      supabase.from('SetlistMusicians').select('*').is('deleted_at', null),
      supabase.from('SetlistGigMusicians').select('*'),
      supabase.from('SetlistGigNowPlaying').select('*'),
    ])

    const firstError =
      songsRes.error ||
      tagsRes.error ||
      keysRes.error ||
      gigsRes.error ||
      gigSongsRes.error ||
      gigSingerKeysRes.error ||
      specialReqRes.error ||
      docsRes.error ||
      musiciansRes.error ||
      gigMusiciansRes.error ||
      nowPlayingRes.error
    if (firstError) {
      setSupabaseError(firstError.message)
      return
    }

    const tagsBySong = new Map<string, string[]>()
    tagsRes.data?.forEach((row) => {
      const list = tagsBySong.get(row.song_id) ?? []
      list.push(row.tag)
      tagsBySong.set(row.song_id, list)
    })

    const keysBySong = new Map<string, SongKey[]>()
    keysRes.data?.forEach((row) => {
      const list = keysBySong.get(row.song_id) ?? []
      list.push({
        singer: row.singer_name,
        defaultKey: row.default_key,
        gigOverrides: {},
      })
      keysBySong.set(row.song_id, list)
    })

    const gigOverrideMap = new Map<string, Record<string, string>>()
    gigSingerKeysRes.data?.forEach((row) => {
      const key = `${row.song_id}-${row.singer_name}`
      const overrides = gigOverrideMap.get(key) ?? {}
      overrides[row.gig_id] = row.gig_key
      gigOverrideMap.set(key, overrides)
    })

    const specialCount = new Map<string, number>()
    specialReqRes.data?.forEach((row) => {
      if (!row.song_id) return
      specialCount.set(row.song_id, (specialCount.get(row.song_id) ?? 0) + 1)
    })

    const songs: Song[] =
      songsRes.data?.map((row) => {
        const keys = keysBySong.get(row.id) ?? []
        const enrichedKeys = keys.map((key) => ({
          ...key,
          gigOverrides: gigOverrideMap.get(`${row.id}-${key.singer}`) ?? {},
        }))
        return {
          id: row.id,
          title: row.title,
          artist: row.artist ?? '',
          originalKey: row.original_key ?? '',
          youtubeUrl: row.audio_url ?? '',
          bpm: undefined,
          tags: tagsBySong.get(row.id) ?? [],
          keys: enrichedKeys.length ? enrichedKeys : [],
          lyrics: undefined,
          specialPlayedCount: specialCount.get(row.id) ?? 0,
        }
      }) ?? []

    const songIdSet = new Set(songs.map((song) => song.id))

    const gigSongsByGig = new Map<string, string[]>()
    ;[...(gigSongsRes.data ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .forEach((row) => {
      if (!songIdSet.has(row.song_id)) return
      const list = gigSongsByGig.get(row.gig_id) ?? []
      list.push(row.song_id)
      gigSongsByGig.set(row.gig_id, list)
      })
    // Recovery path: if gig-song rows were partially lost, preserve known gig membership
    // from singer assignments so songs still appear for affected gigs.
    gigSingerKeysRes.data?.forEach((row) => {
      if (!songIdSet.has(row.song_id)) return
      const list = gigSongsByGig.get(row.gig_id) ?? []
      if (!list.includes(row.song_id)) {
        list.push(row.song_id)
        gigSongsByGig.set(row.gig_id, list)
      }
    })

    const setlists: Setlist[] =
      gigsRes.data?.map((row) => ({
        id: row.id,
        gigName: row.gig_name,
        date: row.gig_date,
        songIds: gigSongsByGig.get(row.id) ?? [],
        venueAddress: row.venue_address ?? '',
      })) ?? []

    const specialRequests: SpecialRequest[] =
      specialReqRes.data?.map((row) => ({
        id: row.id,
        gigId: row.gig_id,
        type: row.request_type,
        songTitle: row.song_title,
        songId: row.song_id ?? undefined,
        singers: row.singers ?? [],
        key: row.song_key ?? '',
        note: row.note ?? undefined,
        djOnly: row.dj_only ?? false,
        externalAudioUrl: row.external_audio_url ?? undefined,
      })) ?? []

    const documents: Document[] =
      docsRes.data?.map((row) => ({
        id: row.id,
        songId: row.song_id,
        type: row.doc_type,
        instrument: row.instrument,
        title: row.title,
        url: row.file_url ?? undefined,
        content: row.content ?? undefined,
      })) ?? []

    const charts: Chart[] = documents
      .filter((doc) => doc.type === 'Chart')
      .map((doc) => ({
        id: doc.id,
        songId: doc.songId,
        instrument: doc.instrument,
        title: doc.title,
        fileName: doc.url,
      }))

    const musicians: Musician[] =
      musiciansRes.data?.map((row) => ({
        id: row.id,
        name: row.name,
        roster: row.roster,
        email: row.email ?? undefined,
        phone: row.phone ?? undefined,
        instruments: row.instruments ?? [],
        singer: row.singer ?? undefined,
      })) ?? []

    const musicianIdSet = new Set(musicians.map((musician) => musician.id))

    const gigMusicians: GigMusician[] =
      gigMusiciansRes.data?.filter((row) => musicianIdSet.has(row.musician_id)).map((row) => ({
        gigId: row.gig_id,
        musicianId: row.musician_id,
        status: row.status,
        note: row.note ?? undefined,
      })) ?? []

    const tagsCatalog = Array.from(
      new Set([...DEFAULT_TAGS, ...(tagsRes.data ?? []).map((t) => t.tag)]),
    )
    const specialTypes = Array.from(
      new Set([
        ...DEFAULT_SPECIAL_TYPES,
        ...(specialReqRes.data ?? []).map((r) => r.request_type),
      ]),
    )
    const singersCatalog = Array.from(
      new Set([
        ...initialState.singersCatalog,
        ...(keysRes.data ?? []).map((row) => row.singer_name),
        ...(specialReqRes.data ?? []).flatMap((row) => row.singers ?? []),
      ]),
    )

    const nowPlayingMap =
      nowPlayingRes.data?.reduce<Record<string, string | null>>((acc, row) => {
        acc[row.gig_id] = row.song_id ?? null
        return acc
      }, {}) ?? {}
    setNowPlayingByGig(nowPlayingMap)

    setAppState((prev) => ({
      ...prev,
      songs,
      setlists,
      specialRequests,
      tagsCatalog,
      specialTypes,
      singersCatalog,
      documents,
      charts,
      musicians,
      gigMusicians,
    }))

    if (setlists.length) {
      setSelectedSetlistId((current) => current || setlists[0].id)
      setActiveGigId((current) => current || setlists[0].id)
    }
  }, [supabase])

  const loadNowPlaying = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('SetlistGigNowPlaying').select('*')
    if (error) {
      setSupabaseError(error.message)
      return
    }
    const nowPlayingMap =
      data?.reduce<Record<string, string | null>>((acc, row) => {
        acc[row.gig_id] = row.song_id ?? null
        return acc
      }, {}) ?? {}
    setNowPlayingByGig(nowPlayingMap)
  }, [supabase])

  const addSongToLibrary = () => {
    const title = pendingSpecialSong.trim()
    if (!title) return
    const newId = createId()
    commitChange('Add song', (prev) => ({
      ...prev,
      songs: [
        {
          id: newId,
          title,
          artist: 'New Artist',
          tags: [],
          keys: [{ singer: 'Maya', defaultKey: 'C', gigOverrides: {} }],
          specialPlayedCount: 0,
        },
        ...prev.songs,
      ],
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistSongs').insert({
          id: newId,
          title,
          artist: 'New Artist',
          audio_url: null,
        }),
      )
      runSupabase(
        supabase.from('SetlistSongKeys').insert({
          id: createId(),
          song_id: newId,
          singer_name: 'Maya',
          default_key: 'C',
        }),
      )
    }
    setPendingSpecialSong('')
  }

  const handleInstallClick = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null)
    }
  }

  const handleDownloadPDF = async () => {
    const element = document.getElementById('printable-setlist')
    if (!element || !currentSetlist) return

    // Clone the element to render it in a clean context
    const clone = element.cloneNode(true) as HTMLElement
    clone.id = 'printable-setlist-clone'
    
    // Create a container that mimics the page view width
    const container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    container.style.top = '0'
    container.style.width = '816px' // 8.5in at 96dpi
    container.style.padding = '32px' // Match the p-8 padding
    container.style.backgroundColor = '#ffffff'
    container.style.color = '#0b0f14'
    container.className = 'bg-white' // Ensure tailwind bg is applied if needed
    container.appendChild(clone)
    
    document.body.appendChild(container)

    const opt = {
      margin: 0.2, 
      filename: `${currentSetlist.gigName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_setlist.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        logging: false,
        windowWidth: 816,
        scrollY: 0
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    }

    try {
      const html2pdf = (await import('html2pdf.js')).default
      // @ts-ignore
      await html2pdf().set(opt).from(container).save()
    } catch (err) {
      console.error('PDF generation failed:', err)
    } finally {
      document.body.removeChild(container)
    }
  }

  const screenHeader = (
    <div className="fixed top-0 left-0 right-0 z-[70]">
      <header className="border-b border-white/10 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <img
              src={setlistConnectLogo}
              alt="Setlist Connect logo"
              className="h-10 w-10 rounded-xl object-contain"
            />
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
                Setlist Connect
              </p>
              <h1 className="text-lg font-semibold text-white">Gig Center</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            {screen === 'setlists' && installPrompt && !isInstalled && (
              <button
                className="min-w-[110px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                onClick={handleInstallClick}
              >
                Install App
              </button>
            )}
            {screen === 'builder' && (
              <button
                className={`liquid-button whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${
                  gigMode
                    ? 'bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 text-slate-950'
                    : 'border border-white/10 text-slate-200'
                }`}
                onClick={() => setGigMode((prev) => !prev)}
              >
                <span>{gigMode ? 'Gig Mode On' : 'Gig Mode'}</span>
              </button>
            )}
            {role && (
              <button
                className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                onClick={handleLogout}
              >
                Log out
              </button>
            )}
          </div>
        </div>
      </header>
      {appState.currentSongId && appState.currentSongId !== dismissedUpNextId && (
        <div
          role="button"
          tabIndex={0}
          className="liquid-button upnext-flash w-full cursor-pointer bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 text-slate-950 shadow-[0_0_18px_rgba(74,222,128,0.45)]"
          onClick={() => openDocsForSong(appState.currentSongId ?? undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              openDocsForSong(appState.currentSongId ?? undefined)
            }
          }}
          onTouchStart={(event) => setBannerTouchStartX(event.touches[0]?.clientX ?? null)}
          onTouchEnd={(event) => {
            if (bannerTouchStartX === null) return
            const endX = event.changedTouches[0]?.clientX ?? bannerTouchStartX
            if (endX - bannerTouchStartX > 60) {
              if (appState.currentSongId) {
                logPlayedSong(appState.currentSongId)
                setDismissedUpNextId(appState.currentSongId)
              }
            }
            setBannerTouchStartX(null)
          }}
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 text-base font-semibold">
            <div className="pointer-events-none flex flex-1 items-center justify-between gap-3">
              <span className="whitespace-nowrap text-base">Up next</span>
              <span className="flex-1 text-center text-lg font-semibold">
                {appState.songs.find((song) => song.id === appState.currentSongId)?.title}
              </span>
              <span className="text-sm">
                {getGigKeysText(
                  appState.currentSongId,
                  currentSetlist?.id ?? activeGigId,
                ) || 'Key: —'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="pointer-events-none inline-flex items-center gap-1 rounded-full bg-slate-950/30 px-3 py-2 text-xs text-slate-950/90">
                <span className="text-base">↔</span>
                <span>Swipe</span>
              </div>
              <button
                className="relative z-10 inline-flex min-h-[44px] items-center rounded-full bg-slate-950/30 px-4 py-2 text-sm"
                onClick={(event) => {
                  event.stopPropagation()
                  if (appState.currentSongId) {
                    logPlayedSong(appState.currentSongId)
                  }
                  if (isAdmin) {
                    setGigCurrentSong(null)
                  } else if (appState.currentSongId) {
                    setDismissedUpNextId(appState.currentSongId)
                  }
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const todayISO = new Date().toISOString().slice(0, 10)
  const hasTodayGig = appState.setlists.some((setlist) => setlist.date === todayISO)
  const upcomingGigs = appState.setlists.filter((setlist) => setlist.date >= todayISO)
  const pastGigs = appState.setlists.filter((setlist) => setlist.date < todayISO)

  useEffect(() => {
    if (!role) return
    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((event) => window.addEventListener(event, updateActivity))

    const interval = window.setInterval(() => {
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) ?? 0)
      if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
        setRole(null)
        setLoginInput('')
      }
    }, 30_000)

    return () => {
      events.forEach((event) => window.removeEventListener(event, updateActivity))
      window.clearInterval(interval)
    }
  }, [role])

  useEffect(() => {
    return () => {
      if (movedSongTimerRef.current) {
        window.clearTimeout(movedSongTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    void loadSupabaseData()
  }, [loadSupabaseData])

  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    void loadNowPlaying()
    const interval = window.setInterval(() => {
      void loadNowPlaying()
    }, 4000)
    return () => window.clearInterval(interval)
  }, [loadNowPlaying])

  useEffect(() => {
    if (!editingSongId) return
    if (!newDocSongId) return
    if (!newDocType) return
    const hasContent =
      newDocType === 'Lyrics'
        ? Boolean(newDocLyrics.trim())
        : Boolean(newDocUrl.trim() || newDocFile)
    if (!hasContent) return
    const signature = [
      newDocSongId,
      newDocType,
      newDocInstrument,
      newDocTitle,
      newDocUrl,
      newDocFile?.name ?? '',
      newDocLyrics,
    ].join('|')
    if (signature === lastDocAutosaveRef.current) return
    const timer = window.setTimeout(() => {
      void saveDocumentFromEditor(false)
      lastDocAutosaveRef.current = signature
    }, 700)
    return () => window.clearTimeout(timer)
  }, [
    editingSongId,
    newDocSongId,
    newDocType,
    newDocInstrument,
    newDocTitle,
    newDocUrl,
    newDocFile,
    newDocLyrics,
  ])

  useEffect(() => {
    localStorage.setItem(
      'setlist_build_complete',
      JSON.stringify(buildCompleteOverrides),
    )
  }, [buildCompleteOverrides])

  useEffect(() => {
    setBuildPanelDirty(false)
  }, [activeBuildPanel])

  useEffect(() => {
    if (!activeGigId) return
    setAppState((prev) => ({
      ...prev,
      currentSongId: nowPlayingByGig[activeGigId] ?? null,
    }))
  }, [activeGigId, nowPlayingByGig])

  useEffect(() => {
    if (!appState.currentSongId) return
    if (appState.currentSongId !== dismissedUpNextId) {
      setDismissedUpNextId(null)
    }
  }, [appState.currentSongId, dismissedUpNextId])

  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client
      .channel('setlist-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSongs' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSongTags' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSongKeys' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigs' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigSongs' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigSingerKeys' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigNowPlaying' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSpecialRequests' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistDocuments' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistMusicians' },
        () => void loadSupabaseData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigMusicians' },
        () => void loadSupabaseData(),
      )

    channel.subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [loadSupabaseData])

  useEffect(() => {
    if (screen !== 'builder') return
    const onScroll = () => {
      setHideGigHeader(window.scrollY > 140)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [screen])

  useEffect(() => {
    if (!newDocSongId) return
    if (!newDocType) return
    const existingDocs = appState.documents.filter(
      (doc) => doc.songId === newDocSongId && doc.type === newDocType,
    )
    if (!existingDocs.length) return
    const matchingInstrument = newDocInstrument.trim()
      ? existingDocs.find((doc) => doc.instrument === newDocInstrument.trim())
      : existingDocs[0]
    if (!matchingInstrument) return
    setNewDocTitle((current) => current || matchingInstrument.title)
    setNewDocInstrument((current) => current || matchingInstrument.instrument)
    setNewDocUrl(matchingInstrument.url ?? '')
    setNewDocLyrics(matchingInstrument.content ?? '')
    setNewDocFile(null)
  }, [appState.documents, newDocInstrument, newDocSongId, newDocType])

  useEffect(() => {
    const hasPopup =
      (role !== 'admin' && appState.instrument === null) ||
      showInstrumentPrompt ||
      Boolean(docModalSongId) ||
      Boolean(audioModalUrl) ||
      showDeleteGigConfirm ||
      Boolean(activeBuildPanel) ||
      Boolean(editingSongId) ||
      Boolean(singerModalSongId) ||
      showSubModal ||
      showDuplicateSongConfirm ||
      showAddSongModal ||
      showGigMusiciansModal ||
      showMissingSingerWarning ||
      showSetlistModal ||
      showPrintPreview
    document.body.style.overflow = hasPopup ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [
    appState.instrument,
    showInstrumentPrompt,
    docModalSongId,
    audioModalUrl,
    role,
    showDeleteGigConfirm,
    activeBuildPanel,
    editingSongId,
    singerModalSongId,
    showSubModal,
    showDuplicateSongConfirm,
    showAddSongModal,
    showGigMusiciansModal,
    showMissingSingerWarning,
    showSetlistModal,
    showPrintPreview,
  ])

  if (!role && loginPhase !== 'app') {
    return (
      <div
        className={`min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white transition-opacity duration-300 ${
          loginPhase === 'transition' ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
          <p className="text-sm uppercase tracking-[0.3em] text-teal-300/80">
            Setlist Connect
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-300">
            Enter the band password to access tonight’s setlist view. Admins can edit,
            undo, and manage everything.
          </p>
          <form
            className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4"
            autoComplete="on"
            onSubmit={(event) => {
              event.preventDefault()
              handleLogin()
            }}
          >
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Password
            </label>
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
              placeholder="Enter password"
              value={loginInput}
              onChange={(event) => setLoginInput(event.target.value)}
              type="password"
              autoComplete="current-password"
              inputMode="text"
            />
            <button
              type="submit"
              className="mt-4 w-full rounded-xl bg-teal-400/90 py-3 font-semibold text-slate-950"
            >
              Login
            </button>
            <div className="mt-3 text-xs text-slate-400">
              Admin: Signature · Crew: Signature2026
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-slate-950 text-white fade-in">
      {gigMode && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950 via-yellow-900/50 to-slate-950" />
      )}
      <div className="relative">
        {screenHeader}
        <div
          className={
            appState.currentSongId && appState.currentSongId !== dismissedUpNextId
              ? 'h-[140px]'
              : 'h-[92px]'
          }
        />
        {(!isSupabaseEnabled || supabaseError) && (
          <div className="mx-auto w-full max-w-3xl px-4 pt-3">
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-200">
              {!isSupabaseEnabled
                ? `Supabase offline: ${
                    supabaseEnvStatus.hasUrl ? 'URL ok' : 'missing VITE_SUPABASE_URL'
                  }, ${
                    supabaseEnvStatus.hasAnonKey
                      ? 'anon key ok'
                      : 'missing VITE_SUPABASE_ANON_KEY'
                  }. Restart the dev server after updating .env.`
                : `Supabase sync error: ${supabaseError}`}
            </div>
          </div>
        )}

      {appState.instrument === null && role !== 'admin' && (
        <div
          className="fixed inset-0 z-[80] flex items-center bg-slate-950/80 py-6"
          onClick={() => setAppState((prev) => ({ ...prev, instrument: 'All' }))}
        >
          <div
            className="mx-auto w-full max-w-md max-h-[85vh] overflow-hidden rounded-t-3xl bg-slate-900 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <h2 className="text-lg font-semibold">Select your instrument</h2>
              <p className="mt-1 text-sm text-slate-300">
                Charts and lead sheets will filter to your part.
              </p>
            </div>
            <div className="max-h-[calc(85vh-92px)] overflow-auto px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <div className="mt-4 grid grid-cols-2 gap-2">
                {INSTRUMENTS.map((instrument) => (
                  <button
                    key={instrument}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                    onClick={() => setAppState((prev) => ({ ...prev, instrument }))}
                  >
                    {instrument}
                  </button>
                ))}
              </div>
              <button
                className="mt-4 w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300"
                onClick={() => setAppState((prev) => ({ ...prev, instrument: 'All' }))}
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-24 pt-6">
        {screen === 'setlists' && (
          <section className="flex flex-col gap-5">
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-white/0 p-5">
              <h2 className="text-xl font-semibold">Upcoming gigs</h2>
              <p className="mt-1 text-sm text-slate-300">
                {isAdmin
                  ? 'Duplicate a previous setlist, or jump straight into editing.'
                  : 'Tap a gig, then use Musicians or Gig Info.'}
              </p>
              <div className="mt-4 flex flex-col gap-3">
                {upcomingGigs.map((setlist) => {
                  const isToday = setlist.date === todayISO
                  return (
                  <div
                    key={setlist.id}
                    role="button"
                    tabIndex={0}
                    className={`rounded-2xl border p-4 ${
                      isToday
                        ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                        : 'border-white/10 bg-slate-900/60'
                    }`}
                    onClick={() => {
                      setSelectedSetlistId(setlist.id)
                      if (isAdmin) {
                        setScreen('builder')
                      } else {
                        setShowSetlistModal(true)
                        setShowGigMusiciansModal(false)
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedSetlistId(setlist.id)
                        if (isAdmin) {
                          setScreen('builder')
                        } else {
                          setShowSetlistModal(true)
                          setShowGigMusiciansModal(false)
                        }
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold leading-tight">{setlist.gigName}</h3>
                        <p className="mt-1 text-sm text-slate-400">
                          {formatGigDate(setlist.date)}
                        </p>
                        {isToday && (
                          <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-teal-400/20 px-2 py-1 text-xs uppercase tracking-wide text-teal-200">
                            Today’s gig
                          </span>
                        )}
                      </div>
                      {setlist.venueAddress ? (
                        <a
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-base text-slate-200"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            setlist.venueAddress,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open address"
                          onClick={(event) => event.stopPropagation()}
                        >
                          📍
                        </a>
                      ) : (
                        <div className="h-11 w-11" />
                      )}
                    </div>
                    {isAdmin && (
                      <div className="mt-3 flex items-center gap-3 text-xs">
                          <button
                            className="text-teal-300"
                            onClick={(event) => {
                              event.stopPropagation()
                              duplicateGig(setlist.id)
                            }}
                          >
                            Duplicate gig
                          </button>
                      </div>
                    )}
                    {!isAdmin && (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                          className="flex min-h-[88px] flex-col items-start justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/35 via-slate-900/50 to-slate-900/70 px-3 py-3 text-left text-white shadow-[0_0_14px_rgba(79,70,229,0.25)]"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedSetlistId(setlist.id)
                            setShowGigMusiciansModal(true)
                            setShowSetlistModal(false)
                          }}
                        >
                          <span className="text-lg">🎤</span>
                          <span className="text-sm font-semibold">Musicians</span>
                        </button>
                        <button
                          className="flex min-h-[88px] flex-col items-start justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/35 via-slate-900/50 to-slate-900/70 px-3 py-3 text-left text-white shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedSetlistId(setlist.id)
                            setShowSetlistModal(true)
                            setShowGigMusiciansModal(false)
                          }}
                        >
                          <span className="text-lg">🎶</span>
                          <span className="text-sm font-semibold">Gig Info</span>
                        </button>
                      </div>
                    )}
                  </div>
                )})}
              </div>
              {isAdmin && (
                <button
                  className="liquid-button mt-4 w-full rounded-xl bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(74,222,128,0.45)]"
                  onClick={createBlankSetlist}
                >
                  <span>Create new setlist</span>
                </button>
              )}
            </div>

            {isAdmin && (
              <div
                className={`rounded-3xl border p-5 ${
                  hasTodayGig
                    ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                    : 'border-white/10 bg-slate-900/50'
                }`}
              >
                <h3 className="font-semibold">Tonight at a glance</h3>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <Stat label="Songs in library" value={appState.songs.length} />
                  <Stat label="Special requests" value={appState.specialRequests.length} />
                  <Stat
                    label="Charts for you"
                    value={
                      appState.charts.filter((chart) =>
                        appState.instrument === 'All'
                          ? true
                          : chart.instrument === appState.instrument,
                      ).length
                    }
                  />
                  <Stat
                    label="Tags"
                    value={appState.tagsCatalog.length}
                  />
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5">
                <h3 className="font-semibold">Past gigs</h3>
                <p className="mt-1 text-xs text-slate-400">Tap a gig to view the setlist.</p>
                <div className="mt-4 flex flex-col gap-3">
                  {pastGigs.map((setlist) => (
                    <div
                      key={setlist.id}
                      role="button"
                      tabIndex={0}
                      className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                      onClick={() => {
                        setSelectedSetlistId(setlist.id)
                        if (isAdmin) {
                          setScreen('builder')
                        } else {
                          setShowSetlistModal(true)
                          setShowGigMusiciansModal(false)
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedSetlistId(setlist.id)
                          if (isAdmin) {
                            setScreen('builder')
                          } else {
                            setShowSetlistModal(true)
                            setShowGigMusiciansModal(false)
                          }
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">{setlist.gigName}</h3>
                          <p className="text-xs text-slate-400">
                            {formatGigDate(setlist.date)}
                          </p>
                        </div>
                        {setlist.venueAddress ? (
                          <a
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-base text-slate-200"
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                              setlist.venueAddress,
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open address"
                            onClick={(event) => event.stopPropagation()}
                          >
                            📍
                          </a>
                        ) : (
                          <div className="h-11 w-11" />
                        )}
                      </div>
                      {isAdmin && (
                        <div className="mt-3 flex items-center gap-3 text-xs">
                          <button
                            className="text-teal-300"
                            onClick={(event) => {
                              event.stopPropagation()
                              duplicateGig(setlist.id)
                            }}
                          >
                            Duplicate gig
                          </button>
                        </div>
                      )}
                      {!isAdmin && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            className="flex min-h-[74px] flex-col items-start justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/35 via-slate-900/50 to-slate-900/70 px-3 py-3 text-left text-white shadow-[0_0_14px_rgba(79,70,229,0.25)]"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedSetlistId(setlist.id)
                              setShowGigMusiciansModal(true)
                              setShowSetlistModal(false)
                            }}
                          >
                            <span className="text-lg">🎤</span>
                            <span className="text-xs font-semibold">Musicians</span>
                          </button>
                          <button
                            className="flex min-h-[74px] flex-col items-start justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/35 via-slate-900/50 to-slate-900/70 px-3 py-3 text-left text-white shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedSetlistId(setlist.id)
                              setShowSetlistModal(true)
                              setShowGigMusiciansModal(false)
                            }}
                          >
                            <span className="text-lg">🎶</span>
                            <span className="text-xs font-semibold">Gig Info</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {pastGigs.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-300">
                      No past gigs yet.
                    </div>
                  )}
                </div>
              </div>
            )}

          </section>
        )}

        {screen === 'builder' && !currentSetlist && (
          <section className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center">
              <h2 className="text-xl font-semibold">No gig selected</h2>
              <p className="mt-2 text-sm text-slate-300">
                Create or select a gig before building the setlist.
              </p>
              {isAdmin ? (
                <button
                  className="liquid-button mt-4 w-full rounded-xl bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(74,222,128,0.45)]"
                  onClick={createBlankSetlist}
                >
                  <span>Create new setlist</span>
                </button>
              ) : (
                <button
                  className="mt-4 w-full rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setScreen('setlists')}
                >
                  Back to Home
                </button>
              )}
            </div>
          </section>
        )}

        {screen === 'builder' && currentSetlist && (
          <section className="flex flex-col gap-6">
            <div
              className={`sticky top-[72px] z-20 rounded-3xl border p-5 backdrop-blur transition-all ${
                currentSetlist.date === new Date().toISOString().slice(0, 10)
                  ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                  : 'border-white/10 bg-slate-950/90'
              } ${
                hideGigHeader
                  ? 'pointer-events-none -translate-y-4 opacity-0'
                  : 'translate-y-0 opacity-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    {isAdmin ? 'Setlist' : 'Gig Info'}
                  </p>
                  {isAdmin ? (
                    <div className="mt-3 flex flex-col gap-1">
                      <input
                        className="w-full border-b border-white/10 bg-transparent py-1 text-2xl font-semibold text-white outline-none focus:border-teal-300"
                        value={currentSetlist.gigName}
                        onChange={(event) => {
                          const value = event.target.value
                          commitChange('Update gig name', (prev) => ({
                            ...prev,
                            setlists: prev.setlists.map((setlist) =>
                              setlist.id === currentSetlist.id
                                ? { ...setlist, gigName: value }
                                : setlist,
                            ),
                          }))
                        }}
                        onBlur={(event) => {
                          if (supabase) {
                            runSupabase(
                              supabase
                                .from('SetlistGigs')
                                .update({ gig_name: event.target.value })
                                .eq('id', currentSetlist.id),
                            )
                          }
                        }}
                      />
                      <div className="flex flex-col gap-1 md:flex-row md:items-center">
                        <div className="flex items-center gap-2 md:w-[200px]">
                          <button
                            type="button"
                            className="w-full border-b border-white/10 bg-transparent py-1 text-left text-sm text-slate-200 outline-none focus:border-teal-300"
                            onClick={() => {
                              const input = dateInputRef.current
                              if (!input) return
                              if (typeof input.showPicker === 'function') {
                                input.showPicker()
                              } else {
                                input.focus()
                              }
                            }}
                          >
                            {formatGigDate(currentSetlist.date)}
                          </button>
                          <input
                            ref={dateInputRef}
                            className="sr-only"
                            type="date"
                            value={currentSetlist.date}
                            onChange={(event) => {
                              const value = event.target.value
                              commitChange('Update gig date', (prev) => ({
                                ...prev,
                                setlists: prev.setlists.map((setlist) =>
                                  setlist.id === currentSetlist.id
                                    ? { ...setlist, date: value }
                                    : setlist,
                                ),
                              }))
                            }}
                            onBlur={(event) => {
                              if (supabase) {
                                runSupabase(
                                  supabase
                                    .from('SetlistGigs')
                                    .update({ gig_date: event.target.value })
                                    .eq('id', currentSetlist.id),
                                )
                              }
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            className="w-full border-b border-white/10 bg-transparent py-1 text-sm text-slate-200 outline-none focus:border-teal-300"
                            placeholder="Venue address"
                            value={currentSetlist.venueAddress ?? ''}
                            onChange={(event) => {
                              const value = event.target.value
                              commitChange('Update venue address', (prev) => ({
                                ...prev,
                                setlists: prev.setlists.map((setlist) =>
                                  setlist.id === currentSetlist.id
                                    ? { ...setlist, venueAddress: value }
                                    : setlist,
                                ),
                              }))
                            }}
                            onBlur={(event) => {
                              if (supabase) {
                                runSupabase(
                                  supabase
                                    .from('SetlistGigs')
                                    .update({ venue_address: event.target.value })
                                    .eq('id', currentSetlist.id),
                                )
                              }
                            }}
                          />
                          {currentSetlist.venueAddress && (
                            <a
                              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-base text-slate-200"
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                currentSetlist.venueAddress,
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open address"
                              onClick={(event) => event.stopPropagation()}
                            >
                              📍
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-xl font-semibold">{currentSetlist.gigName}</h2>
                      <p className="text-xs text-slate-400">
                        {formatGigDate(currentSetlist.date)}
                      </p>
                      {currentSetlist.venueAddress && (
                        <a
                          className="mt-2 inline-flex rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
                          href={`https://maps.apple.com/?q=${encodeURIComponent(
                            currentSetlist.venueAddress,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {currentSetlist.venueAddress}
                        </a>
                      )}
                    </>
                  )}
                  <p className="mt-2 text-xs text-slate-400">
                    Tap a song in Gig mode to flash it at the top for the band.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-teal-300/40 bg-slate-800/95 text-xl font-semibold text-slate-100 shadow-[0_0_18px_rgba(20,184,166,0.2)]"
                    onClick={handlePrintSetlist}
                    title="Download setlist PDF"
                    aria-label="Download setlist PDF"
                  >
                  <img src={downloadPdfIcon} alt="" className="h-6 w-6 object-contain" />
                  </button>
                  {isAdmin && (
                    <button
                      className="whitespace-nowrap rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-200"
                      onClick={() => deleteGig(currentSetlist.id)}
                    >
                      Delete gig
                    </button>
                  )}
                </div>
              </div>
            </div>

            {isAdmin && (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    key: 'musicians',
                    label: 'Assign Musicians',
                    icon: '🎤',
                    tint: 'from-indigo-500/30 via-slate-900/40 to-slate-900/60',
                    complete: buildCompletion.musicians,
                  },
                  {
                    key: 'addSongs',
                    label: 'Add Songs',
                    icon: '➕',
                    tint: 'from-teal-500/30 via-slate-900/40 to-slate-900/60',
                    complete: buildCompletion.addSongs,
                  },
                  {
                    key: 'special',
                    label: 'Special Requests',
                    icon: '✨',
                    tint: 'from-amber-500/30 via-slate-900/40 to-slate-900/60',
                    complete: buildCompletion.special,
                  },
                  {
                    key: 'dinner',
                    label: 'Dinner',
                    icon: '🍽️',
                    tint: 'from-emerald-500/30 via-slate-900/40 to-slate-900/60',
                    complete: buildCompletion.dinner,
                  },
                  {
                    key: 'latin',
                    label: 'Latin',
                    icon: '💃',
                    tint: 'from-pink-500/30 via-slate-900/40 to-slate-900/60',
                    complete: buildCompletion.latin,
                  },
                  {
                    key: 'dance',
                    label: 'Dance',
                    icon: '🕺',
                    tint: 'from-cyan-500/30 via-slate-900/40 to-slate-900/60',
                    complete: buildCompletion.dance,
                  },
                ].map((item) => (
                  <button
                    key={item.key}
                    className={`flex min-h-[96px] flex-col items-start justify-between rounded-3xl border border-white/10 bg-gradient-to-br ${item.tint} px-4 py-4 text-left text-white shadow-[0_0_18px_rgba(15,23,42,0.35)]`}
                    onClick={() =>
                      setActiveBuildPanel(item.key as typeof activeBuildPanel)
                    }
                  >
                    <div className="flex w-full items-start justify-between">
                      <span className="text-2xl">{item.icon}</span>
                      <div className="flex flex-col items-end">
                        <span
                          className={`text-3xl ${
                            item.complete ? 'text-emerald-300' : 'text-amber-300'
                          }`}
                          title={item.complete ? 'Complete' : 'Not complete'}
                        >
                          {item.complete ? '✓' : '○'}
                        </span>
                        <span className="mt-1 text-sm font-semibold text-slate-100">
                          {buildCardCounts[item.key as keyof typeof buildCardCounts] ?? 0}
                        </span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
            {!isAdmin && (
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className="flex min-h-[96px] flex-col items-start justify-between rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-500/30 via-slate-900/40 to-slate-900/60 px-4 py-4 text-left text-white shadow-[0_0_18px_rgba(15,23,42,0.35)]"
                  onClick={() => setShowGigMusiciansModal(true)}
                >
                  <div className="flex w-full items-start justify-between">
                    <span className="text-2xl">🎤</span>
                  </div>
                  <span className="text-sm font-semibold">Musicians</span>
                </button>
                <button
                  className="flex min-h-[96px] flex-col items-start justify-between rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/30 via-slate-900/40 to-slate-900/60 px-4 py-4 text-left text-white shadow-[0_0_18px_rgba(15,23,42,0.35)]"
                  onClick={() => setShowSetlistModal(true)}
                >
                  <div className="flex w-full items-start justify-between">
                    <span className="text-2xl">🎶</span>
                  </div>
                  <span className="text-sm font-semibold">Gig Info</span>
                </button>
              </div>
            )}

            {false && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
                <h3 className="font-semibold">Add songs not on this setlist</h3>
                <div className="mt-4 flex flex-col gap-3">
                  <input
                    className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-2 text-sm"
                    placeholder="Search songs"
                    value={songSearch}
                    onChange={(event) => setSongSearch(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {appState.tagsCatalog.map((tag) => (
                      <button
                        key={tag}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                          activeTags.includes(tag)
                            ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                            : 'border-white/10 text-slate-300'
                        }`}
                        onClick={() =>
                          setActiveTags((current) =>
                            current.includes(tag)
                              ? current.filter((item) => item !== tag)
                              : [...current, tag],
                          )
                        }
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-64 space-y-2 overflow-auto">
                    {availableSongs.map((song) => (
                      <label
                        key={song.id}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm"
                      >
                        <div>
                          <div className="font-semibold">{song.title}</div>
                          <div className="text-xs text-slate-400">{song.artist}</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={selectedSongIds.includes(song.id)}
                          onChange={(event) =>
                            setSelectedSongIds((current) =>
                              event.target.checked
                                ? [...current, song.id]
                                : current.filter((id) => id !== song.id),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <button
                      className="rounded-full border border-white/10 px-3 py-1"
                      onClick={() =>
                        setSelectedSongIds(availableSongs.map((song) => song.id))
                      }
                    >
                      Select all
                    </button>
                    <button
                      className="rounded-full border border-white/10 px-3 py-1"
                      onClick={() => setSelectedSongIds([])}
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    className="rounded-xl bg-teal-400/90 py-2 text-sm font-semibold text-slate-950"
                    onClick={addSongsToSetlist}
                  >
                    Add selected songs
                  </button>
                </div>
              </div>
            )}

            {false && (
            <div
              className={`rounded-3xl border p-5 ${
                currentSetlist?.date === new Date().toISOString().slice(0, 10)
                  ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                  : 'border-white/10 bg-slate-900/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Special Requests</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Track request type, song, singers, key, and notes.
                  </p>
                </div>
                {isAdmin && (
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-center text-xs"
                    onClick={addSpecialRequest}
                  >
                    Add song
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <div className="grid gap-2 text-[10px] uppercase tracking-wide text-slate-400 md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr]">
                  <span>Category</span>
                  <span>Song</span>
                  <span>Vocal</span>
                  <span>Key</span>
                  <span>Info</span>
                </div>
                {appState.specialRequests
                  .filter((request) => request.gigId === currentSetlist?.id)
                  .map((request) => {
                    const song = appState.songs.find((item) => item.id === request.songId)
                    return (
                      <div
                        key={request.id}
                        className="grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr]"
                      >
                        <div className="text-xs text-teal-300">
                          Special Request
                        <div className="text-[10px] text-slate-400">{request.type}</div>
                        {request.djOnly && (
                          <div className="mt-1 inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-200">
                            DJ Only
                          </div>
                        )}
                        </div>
                        <div>
                          <div className="text-base font-semibold md:text-lg">
                            {request.songTitle}
                          </div>
                          {song?.artist && (
                            <div className="text-[10px] text-slate-400">{song.artist}</div>
                          )}
                          <div className="mt-2 flex items-center gap-2 text-[10px]">
                          {(request.externalAudioUrl || song?.youtubeUrl) && (
                              <button
                                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-slate-200"
                              onClick={() =>
                                openAudioForUrl(
                                  request.externalAudioUrl ?? song?.youtubeUrl ?? '',
                                  request.externalAudioUrl ? 'External audio' : 'YouTube audio',
                                )
                              }
                                aria-label="Audio"
                                title="Audio"
                              >
                                🔊
                              </button>
                            )}
                            {hasDocsForSong(song?.id) && (
                              <button
                                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-slate-200"
                                onClick={() => openDocsForSong(song?.id)}
                                aria-label="Documents"
                                title="Documents"
                              >
                                📄
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-slate-300">
                          {request.djOnly ? 'DJ' : request.singers.join(', ')}
                        </div>
                        <div className="text-xs text-slate-200">
                          {request.djOnly ? '—' : request.key}
                        </div>
                        <div className="text-xs text-slate-400">
                          {request.note ? 'ℹ️' : ''}
                        </div>
                      </div>
                    )
                  })}
              </div>

              {isAdmin && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <h4 className="text-sm font-semibold">Add a request</h4>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Request type
                      </label>
                    <input
                      className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
                      placeholder="Type a request type"
                      list="special-type-list"
                      value={pendingSpecialType}
                      onChange={(event) => setPendingSpecialType(event.target.value)}
                    />
                    <datalist id="special-type-list">
                      {appState.specialTypes.map((type) => (
                        <option key={type} value={type} />
                      ))}
                    </datalist>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Song title
                      </label>
                    <input
                      className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
                      placeholder="Type a song title"
                      list="special-song-list"
                      value={pendingSpecialSong}
                      onChange={(event) => setPendingSpecialSong(event.target.value)}
                    />
                    <datalist id="special-song-list">
                      {appState.songs.map((song) => (
                        <option key={song.id} value={song.title} />
                      ))}
                    </datalist>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Singers
                      </label>
                    <div className="flex flex-wrap gap-2">
                        {gigVocalists.map((musician) => {
                          const singer = musician.name
                          const active = pendingSpecialSingers.includes(singer)
                          return (
                            <button
                              key={singer}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                                active
                                  ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                                  : 'border-white/10 text-slate-300'
                              }`}
                              onClick={() =>
                                setPendingSpecialSingers((current) =>
                                  current.includes(singer)
                                    ? current.filter((item) => item !== singer)
                                    : [...current, singer],
                                )
                              }
                            disabled={pendingSpecialDjOnly}
                            >
                              {singer}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Key
                      </label>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
                        placeholder="e.g. F#m"
                        value={pendingSpecialKey}
                        onChange={(event) => setPendingSpecialKey(event.target.value)}
                      disabled={pendingSpecialDjOnly}
                      />
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Info note
                      </label>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
                        placeholder="Optional note"
                        value={pendingSpecialNote}
                        onChange={(event) => setPendingSpecialNote(event.target.value)}
                      />
                    <label className="text-[10px] uppercase tracking-wide text-slate-400">
                      DJ only
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={pendingSpecialDjOnly}
                        onChange={(event) => setPendingSpecialDjOnly(event.target.checked)}
                      />
                      Mark as DJ-only (band does not learn)
                    </label>
                    <label className="text-[10px] uppercase tracking-wide text-slate-400">
                      Audio link
                    </label>
                    <input
                      className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
                      placeholder="YouTube, Spotify, or MP3 link"
                      value={pendingSpecialExternalUrl}
                      onChange={(event) => setPendingSpecialExternalUrl(event.target.value)}
                    />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 md:w-1/2">
                    <button
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300"
                      onClick={addSongToLibrary}
                    >
                      Save to library
                    </button>
                    <button
                      className="rounded-xl bg-teal-400/90 px-3 py-2 text-xs font-semibold text-slate-950"
                      onClick={addSpecialRequest}
                    >
                      Add request
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}

            {false && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
                <h3 className="text-sm font-semibold">Assign musicians to gig</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Import the full roster, then toggle out who is unavailable and add subs.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <select
                    className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    value={activeGigId}
                    onChange={(event) => setActiveGigId(event.target.value)}
                  >
                    {appState.setlists.map((gig) => (
                      <option key={gig.id} value={gig.id}>
                        {gig.gigName} · {gig.date}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200"
                    onClick={importRosterToGig}
                  >
                    Import roster
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  {appState.musicians.map((musician) => {
                    const gigEntry = appState.gigMusicians.find(
                      (gm) => gm.gigId === activeGigId && gm.musicianId === musician.id,
                    )
                    if (!gigEntry) return null
                    return (
                      <div
                        key={musician.id}
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs"
                      >
                        <div>
                          <div className="text-sm font-semibold">{musician.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {musician.instruments.join(', ') || 'No instruments'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-wide ${
                              gigEntry.status === 'active'
                                ? 'bg-teal-400/20 text-teal-200'
                                : 'bg-red-500/20 text-red-200'
                            }`}
                            onClick={() => toggleGigMusicianStatus(musician.id)}
                          >
                            {gigEntry.status === 'active' ? 'Active' : 'Out'}
                          </button>
                          <button
                            className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-slate-200"
                            onClick={() => removeMusicianFromGig(musician.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Add sub to gig
                  </div>
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                    placeholder="Select existing musician"
                    list="gig-musician-list"
                    onChange={(event) => {
                      const match = appState.musicians.find(
                        (musician) =>
                          musician.name.toLowerCase() ===
                          event.target.value.toLowerCase(),
                      )
                      if (match) {
                        addMusicianToGig(match.id)
                        event.currentTarget.value = ''
                      }
                    }}
                  />
                  <datalist id="gig-musician-list">
                    {appState.musicians.map((musician) => (
                      <option key={musician.id} value={musician.name} />
                    ))}
                  </datalist>
                  <p className="mt-2 text-[10px] text-slate-400">
                    If the sub is not listed, add them to the roster above first.
                  </p>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Quick add new sub
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <input
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                      placeholder="Name"
                      value={newSubName}
                      onChange={(event) => setNewSubName(event.target.value)}
                    />
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        Instruments
                      </div>
                      <input
                        className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                        placeholder="Filter instruments"
                        value={instrumentFilter}
                        onChange={(event) => setInstrumentFilter(event.target.value)}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {filteredInstruments.map((instrument) => {
                          const active = newSubInstruments.includes(instrument)
                          return (
                            <button
                              key={instrument}
                              className={`rounded-full border px-3 py-1 text-xs ${
                                active
                                  ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                                  : 'border-white/10 text-slate-300'
                              }`}
                              onClick={() => {
                                const next = newSubInstruments.includes(instrument)
                                  ? newSubInstruments.filter(
                                      (item) => item !== instrument,
                                    )
                                  : [...newSubInstruments, instrument]
                                setNewSubInstruments(next)
                                if (!next.includes('Vocals')) {
                                  setNewSubSinger('')
                                }
                              }}
                            >
                              {instrument}
                            </button>
                          )
                        })}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input
                          className="flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                          placeholder="Add instrument"
                          value={newInstrumentInput}
                          onChange={(event) => setNewInstrumentInput(event.target.value)}
                        />
                        <button
                          className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-200"
                          onClick={addInstrumentToCatalog}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                    <input
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                      placeholder="Email"
                      value={newSubEmail}
                      onChange={(event) => setNewSubEmail(event.target.value)}
                    />
                    <input
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                      placeholder="Phone"
                      value={newSubPhone}
                      onChange={(event) => setNewSubPhone(event.target.value)}
                    />
                    {newSubInstruments.includes('Vocals') && (
                      <select
                        className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                        value={newSubSinger}
                        onChange={(event) =>
                          setNewSubSinger(
                            event.target.value as 'male' | 'female' | 'other' | '',
                          )
                        }
                      >
                        <option value="">Singer?</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    )}
                    <button
                      className="rounded-lg bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                      onClick={addSubAndAssign}
                    >
                      Add + assign
                    </button>
                  </div>
                </div>
              </div>
            )}

          </section>
        )}

        {screen === 'song' && (
          <section className="flex flex-col gap-6">
            <div className="sticky top-[72px] z-20 rounded-3xl border border-white/10 bg-slate-900/90 p-5 backdrop-blur">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Songs
                  </p>
                  <h2 className="text-xl font-semibold">Song Library</h2>
                  <p className="mt-2 text-xs text-slate-400">
                    Tap a song in Gig mode to flash it at the top for the band.
                  </p>
                  {isAdmin && (
                    <button
                      className="mt-3 w-full rounded-xl bg-teal-400/90 py-2 text-sm font-semibold text-slate-950"
                      onClick={() => {
                        setNewSongTitle('')
                        setNewSongArtist('')
                        setNewSongAudio('')
                        setNewSongOriginalKey('')
                        setNewSongTags([])
                        setSongFormError('')
                        setPendingSongDraft(null)
                        setSimilarSongMatches([])
                        setShowDuplicateSongConfirm(false)
                        setShowAddSongModal(true)
                      }}
                    >
                      Add New Song
                    </button>
                  )}
                </div>
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setScreen('builder')}
                >
                  Back
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              <label className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                Search songs
              </label>
              <input
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                placeholder="Search by title, artist, or tag..."
                value={songLibrarySearch}
                onChange={(event) => setSongLibrarySearch(event.target.value)}
              />
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                Setlist tags
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...appState.tagsCatalog].sort((a, b) => a.localeCompare(b)).map((tag) => {
                  const active = songLibraryTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                        active
                          ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                          : 'border-white/10 text-slate-300'
                      }`}
                      onClick={() =>
                        setSongLibraryTags((current) =>
                          current.includes(tag)
                            ? current.filter((item) => item !== tag)
                            : [...current, tag],
                        )
                      }
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              <div className="space-y-2">
                {filteredSongLibrary.map((song) => (
                <div
                  key={song.id}
                  role="button"
                  tabIndex={0}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-left"
                  onClick={() => openSongEditor(song)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openSongEditor(song)
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">{song.title}</div>
                        {song.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 text-[10px] text-slate-300">
                            {song.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border border-white/10 px-2 py-0.5"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">{song.artist}</div>
                      {song.originalKey?.trim() ? (
                        <div className="mt-1 text-[10px] text-emerald-200">
                          Key: {song.originalKey}
                        </div>
                      ) : (
                        <div className="mt-1 text-[10px] text-amber-200">
                          Need key!
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {appState.documents.some(
                        (doc) => doc.songId === song.id && doc.type === 'Lyrics',
                      ) && (
                        <button
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
                          title="Open lyrics"
                          aria-label="Open lyrics"
                          onClick={(event) => {
                            event.stopPropagation()
                            openLyricsForSong(song.id)
                          }}
                        >
                          📜
                        </button>
                      )}
                      {song.youtubeUrl && (
                        <button
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
                          title="Play audio"
                          aria-label="Play audio"
                          onClick={(event) => {
                            event.stopPropagation()
                            openAudioForUrl(song.youtubeUrl ?? '', 'YouTube audio')
                          }}
                        >
                          🎧
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {screen === 'musicians' && (
          <section className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Musicians
                  </p>
                  <h2 className="text-xl font-semibold">Band roster</h2>
                  <p className="text-xs text-slate-400">
                    Add, edit, and manage your core roster and subs.
                  </p>
                </div>
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setScreen('setlists')}
                >
                  Back
                </button>
              </div>
              <div className="mt-4 space-y-4">
                {isAdmin && (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <h3 className="text-sm font-semibold">Add musician</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Mark core members or subs. Add contact info and instruments.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <input
                        className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                        placeholder="Musician name"
                        value={newMusicianName}
                        onChange={(event) => setNewMusicianName(event.target.value)}
                      />
                      <select
                        className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                        value={newMusicianRoster}
                        onChange={(event) =>
                          setNewMusicianRoster(event.target.value as 'core' | 'sub')
                        }
                      >
                        <option value="core">Core roster</option>
                        <option value="sub">Sub</option>
                      </select>
                      <input
                        className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                        placeholder="Email"
                        value={newMusicianEmail}
                        onChange={(event) => setNewMusicianEmail(event.target.value)}
                      />
                      <input
                        className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                        placeholder="Phone"
                        value={newMusicianPhone}
                        onChange={(event) => setNewMusicianPhone(event.target.value)}
                      />
                      <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm">
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">
                          Instruments
                        </div>
                        <input
                          className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                          placeholder="Filter instruments"
                          value={instrumentFilter}
                          onChange={(event) => setInstrumentFilter(event.target.value)}
                        />
                        <div className="mt-2 flex flex-wrap gap-2">
                          {filteredInstruments.map((instrument) => {
                            const active = newMusicianInstruments.includes(instrument)
                            return (
                              <button
                                key={instrument}
                                className={`rounded-full border px-3 py-1 text-xs ${
                                  active
                                    ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                                    : 'border-white/10 text-slate-300'
                                }`}
                                onClick={() => {
                                  const next = newMusicianInstruments.includes(instrument)
                                    ? newMusicianInstruments.filter(
                                        (item) => item !== instrument,
                                      )
                                    : [...newMusicianInstruments, instrument]
                                  setNewMusicianInstruments(next)
                                  if (!next.includes('Vocals')) {
                                    setNewMusicianSinger('')
                                  }
                                }}
                              >
                                {instrument}
                              </button>
                            )
                          })}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            className="flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                            placeholder="Add instrument"
                            value={newInstrumentInput}
                            onChange={(event) => setNewInstrumentInput(event.target.value)}
                          />
                          <button
                            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-200"
                            onClick={addInstrumentToCatalog}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                      {newMusicianInstruments.includes('Vocals') && (
                        <select
                          className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                          value={newMusicianSinger}
                          onChange={(event) =>
                            setNewMusicianSinger(
                              event.target.value as 'male' | 'female' | 'other' | '',
                            )
                          }
                        >
                          <option value="">Singer?</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      )}
                    </div>
                    <button
                      className="mt-3 w-full rounded-xl bg-teal-400/90 py-2 text-sm font-semibold text-slate-950"
                      onClick={addMusician}
                    >
                      Add musician
                    </button>
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  {appState.musicians
                    .slice()
                    .sort((a, b) => {
                      if (a.roster !== b.roster) {
                        return a.roster === 'core' ? -1 : 1
                      }
                      return a.name.localeCompare(b.name)
                    })
                    .map((musician) => (
                    <div
                      key={musician.id}
                      role="button"
                      tabIndex={0}
                      className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs"
                      onClick={() => startEditMusician(musician)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          startEditMusician(musician)
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-semibold text-teal-100">
                              {musician.name}
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                                musician.roster === 'core'
                                  ? 'bg-emerald-400/20 text-emerald-200'
                                  : 'bg-white/10 text-slate-300'
                              }`}
                            >
                              {musician.roster === 'core' ? 'Core' : 'Sub'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {musician.instruments.join(', ') || 'No instruments'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          {musician.email && (
                            <a
                              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-base"
                              href={`mailto:${musician.email}`}
                              title="Email"
                              onClick={(event) => event.stopPropagation()}
                            >
                              ✉️
                            </a>
                          )}
                          {musician.phone && (
                            <>
                              <a
                                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-base"
                                href={`tel:${musician.phone}`}
                                title="Call"
                                onClick={(event) => event.stopPropagation()}
                              >
                                📞
                              </a>
                              <a
                                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-base"
                                href={`sms:${musician.phone}`}
                                title="Text"
                                onClick={(event) => event.stopPropagation()}
                              >
                                💬
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-sm">
          <NavButton
            active={screen === 'setlists'}
            onClick={() => setScreen('setlists')}
            icon="🏠"
            label="Home"
          />
          <NavButton
            active={screen === 'song'}
            onClick={() => setScreen('song')}
            icon="🎵"
            label="Songs"
          />
          {isAdmin && (
            <NavButton
              active={screen === 'musicians'}
              onClick={() => setScreen('musicians')}
              icon="🎤"
              label="Musicians"
            />
          )}
        </div>
      </nav>

      {currentSetlist && (
        <div id="printable-setlist" className="print-only">
          <div className="print-container">
            <div className="print-header">
              <div>
                <div className="print-title">{currentSetlist.gigName}</div>
                <div className="print-subtitle">{formatGigDate(currentSetlist.date)}</div>
                {currentSetlist.venueAddress && (
                  <div className="print-subtitle">{currentSetlist.venueAddress}</div>
                )}
              </div>
              <div className="print-badge">Setlist</div>
            </div>

            <div className="print-layout">
              <div className="print-section-box print-special">
                <div className="print-section-title">Special Requests</div>
                <div className="print-list">
                  {appState.specialRequests
                    .filter((request) => request.gigId === currentSetlist.id)
                    .map((request) => {
                      const song = appState.songs.find((item) => item.id === request.songId)
                      return (
                      <div key={request.id} className="print-row">
                        <div className="print-row-title">
                          {(request.externalAudioUrl || song?.youtubeUrl) ? (
                            <a
                              className="print-link"
                              href={request.externalAudioUrl ?? song?.youtubeUrl ?? ''}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {request.songTitle}
                            </a>
                          ) : (
                            request.songTitle
                          )}{' '}
                          {request.djOnly ? <span className="print-pill">DJ Only</span> : null}
                        </div>
                        <div className="print-row-subtitle">
                          {request.type} ·{' '}
                          {request.djOnly
                            ? 'DJ'
                            : request.singers.length
                              ? request.singers.join(', ')
                              : 'No singers'}{' '}
                          · {request.djOnly ? '—' : request.key || 'No key'}
                        </div>
                        {request.note && <div className="print-row-note">{request.note}</div>}
                      </div>
                    )})}
                  {appState.specialRequests.filter(
                    (request) => request.gigId === currentSetlist.id,
                  ).length === 0 && <div className="print-empty">No special requests.</div>}
                </div>
              </div>

              <div className="print-section-box print-musicians">
                <div className="print-section-title">Musicians</div>
                <div className="print-grid">
                  {appState.gigMusicians
                    .filter((row) => row.gigId === currentSetlist.id)
                    .map((row) =>
                      appState.musicians.find((musician) => musician.id === row.musicianId),
                    )
                    .filter((musician): musician is Musician => Boolean(musician))
                    .sort((a, b) => {
                      const aCore = a.roster === 'core'
                      const bCore = b.roster === 'core'
                      if (aCore !== bCore) return aCore ? -1 : 1
                      return a.name.localeCompare(b.name)
                    })
                    .map((musician) => (
                      <div key={musician.id} className="print-card">
                        <div className="print-card-title">{musician.name}</div>
                        <div className="print-card-subtitle">
                          {(musician.instruments ?? []).join(', ') || 'No instruments'}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="print-section-box print-latin">
                <div className="print-section-title">Latin Set</div>
                <div className="print-list">
                  {currentSetlist.songIds
                    .map((songId) => appState.songs.find((song) => song.id === songId))
                    .filter((song): song is Song => Boolean(song))
                    .filter((song) => hasSongTag(song, 'Latin'))
                    .map((song) => {
                      const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
                      const singers = assignments.map((entry) => entry.singer)
                      const keys = Array.from(new Set(assignments.map((entry) => entry.key)))
                      const keyLabel =
                        keys.length === 0 ? 'No key' : keys.length === 1 ? keys[0] : 'Multi'
                      return (
                        <div key={song.id} className="print-row">
                          <div className="print-row-title">
                            {song.youtubeUrl ? (
                              <a
                                className="print-link"
                                href={song.youtubeUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {song.title}
                              </a>
                            ) : (
                              song.title
                            )}
                          </div>
                          <div className="print-row-subtitle">
                            {song.artist || 'Unknown'} ·{' '}
                            {singers.length ? singers.join(', ') : 'No singers'} · {keyLabel}
                          </div>
                        </div>
                      )
                    })}
                  {currentSetlist.songIds.filter((songId) =>
                    (() => {
                      const song = appState.songs.find((item) => item.id === songId)
                      return song ? hasSongTag(song, 'Latin') : false
                    })(),
                  ).length === 0 && <div className="print-empty">No songs.</div>}
                </div>
              </div>

              <div className="print-section-box print-dinner">
                <div className="print-section-title">Dinner Set</div>
                <div className="print-list">
                  {currentSetlist.songIds
                    .map((songId) => appState.songs.find((song) => song.id === songId))
                    .filter((song): song is Song => Boolean(song))
                    .filter((song) => hasSongTag(song, 'Dinner'))
                    .map((song) => {
                      const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
                      const singers = assignments.map((entry) => entry.singer)
                      const keys = Array.from(new Set(assignments.map((entry) => entry.key)))
                      const keyLabel =
                        keys.length === 0 ? 'No key' : keys.length === 1 ? keys[0] : 'Multi'
                      return (
                        <div key={song.id} className="print-row">
                          <div className="print-row-title">
                            {song.youtubeUrl ? (
                              <a
                                className="print-link"
                                href={song.youtubeUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {song.title}
                              </a>
                            ) : (
                              song.title
                            )}
                          </div>
                          <div className="print-row-subtitle">
                            {song.artist || 'Unknown'} ·{' '}
                            {singers.length ? singers.join(', ') : 'No singers'} · {keyLabel}
                          </div>
                        </div>
                      )
                    })}
                  {currentSetlist.songIds.filter((songId) =>
                    (() => {
                      const song = appState.songs.find((item) => item.id === songId)
                      return song ? hasSongTag(song, 'Dinner') : false
                    })(),
                  ).length === 0 && <div className="print-empty">No songs.</div>}
                </div>
              </div>

              <div className="print-section-box print-dance">
                <div className="print-section-title">Dance Set</div>
                <div className="print-list">
                  {currentSetlist.songIds
                    .map((songId) => appState.songs.find((song) => song.id === songId))
                    .filter((song): song is Song => Boolean(song))
                    .filter((song) => hasSongTag(song, 'Dance'))
                    .map((song) => {
                      const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
                      const singers = assignments.map((entry) => entry.singer)
                      const keys = Array.from(new Set(assignments.map((entry) => entry.key)))
                      const keyLabel =
                        keys.length === 0 ? 'No key' : keys.length === 1 ? keys[0] : 'Multi'
                      return (
                        <div key={song.id} className="print-row">
                          <div className="print-row-title">
                            {song.youtubeUrl ? (
                              <a
                                className="print-link"
                                href={song.youtubeUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {song.title}
                              </a>
                            ) : (
                              song.title
                            )}
                          </div>
                          <div className="print-row-subtitle">
                            {song.artist || 'Unknown'} ·{' '}
                            {singers.length ? singers.join(', ') : 'No singers'} · {keyLabel}
                          </div>
                        </div>
                      )
                    })}
                  {currentSetlist.songIds.filter((songId) =>
                    (() => {
                      const song = appState.songs.find((item) => item.id === songId)
                      return song ? hasSongTag(song, 'Dance') : false
                    })(),
                  ).length === 0 && <div className="print-empty">No songs.</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showInstrumentPrompt && pendingDocSongId && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => {
            setShowInstrumentPrompt(false)
            setPendingDocSongId(null)
          }}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Choose instrument</h3>
              <p className="mt-1 text-sm text-slate-300">
                Pick your instrument to open the right chart or lyrics.
              </p>
            </div>
            <div className="max-h-[calc(80vh-92px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <div className="mt-4 grid grid-cols-2 gap-2">
                {INSTRUMENTS.map((instrument) => (
                  <button
                    key={instrument}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                    onClick={() => {
                      setAppState((prev) => ({ ...prev, instrument }))
                      setShowInstrumentPrompt(false)
                      setDocModalSongId(pendingDocSongId)
                      setPendingDocSongId(null)
                    }}
                  >
                    {instrument}
                  </button>
                ))}
              </div>
              <button
                className="mt-4 w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300"
                onClick={() => {
                  setShowInstrumentPrompt(false)
                  setPendingDocSongId(null)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {docModalSongId && (
        <div
          className="fixed inset-0 z-[80] flex items-center bg-slate-950/80 py-6"
          onClick={() => {
            setDocModalSongId(null)
            setDocModalContent(null)
          }}
        >
          <div
            className="mx-auto w-full max-w-md overflow-hidden rounded-t-3xl bg-slate-900 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">
                {docModalContent ? 'Song Lyrics' : 'Song documents'}
              </h3>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => {
                    setDocModalSongId(null)
                    setDocModalContent(null)
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              {!docModalContent && (
                <div className="mt-4 space-y-2">
                  {appState.documents
                    .filter((doc) => doc.songId === docModalSongId)
                    .filter((doc) =>
                      !appState.instrument || appState.instrument === 'All'
                        ? true
                        : doc.instrument === 'All' || doc.instrument === appState.instrument,
                    )
                    .map((doc) => (
                      <div
                        key={doc.id}
                        className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold">{doc.title}</div>
                            <div className="text-xs text-slate-400">
                              {doc.type} · {doc.instrument}
                            </div>
                          </div>
                          <button
                            className="rounded-full border border-white/10 px-3 py-1 text-xs"
                            onClick={() => {
                              if (doc.content) {
                                setDocModalContent(doc)
                                return
                              }
                              if (doc.url) {
                                window.open(doc.url, '_blank')
                              }
                            }}
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {docModalContent && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-slate-200">
                  <div className="mb-3 text-center text-xl font-bold">
                    {docModalContent?.title}
                  </div>
                  <pre className="whitespace-pre-wrap text-center text-sm font-semibold">
                    {docModalContent?.content}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {audioModalUrl && (
        <div
          className="fixed inset-0 z-[80] flex items-center bg-slate-950/80 py-6"
          onClick={() => setAudioModalUrl(null)}
        >
          <div
            className="mx-auto w-full max-w-md max-h-[80vh] overflow-hidden rounded-3xl bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">{audioModalLabel}</h3>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setAudioModalUrl(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(80vh-72px)] overflow-auto px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{audioModalLabel}</div>
                    <div className="text-xs text-slate-400">
                      {isSpotifyUrl(audioModalUrl)
                        ? 'Spotify'
                        : isAudioFileUrl(audioModalUrl)
                          ? 'Audio file'
                          : 'YouTube'}
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[10px] uppercase tracking-wide text-slate-300">
                    Practice
                  </div>
                </div>
                <div className="mt-4 w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
                  {isSpotifyUrl(audioModalUrl) ? (
                    <iframe
                      className="h-20 w-full"
                      src={getSpotifyEmbedUrl(audioModalUrl)}
                      title="Spotify player"
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                    />
                  ) : isAudioFileUrl(audioModalUrl) ? (
                    <div className="bg-slate-950/60 p-4">
                      <audio
                        ref={audioPlayerRef}
                        className="w-full"
                        controls
                        src={audioModalUrl}
                        onPlay={() => {
                          if (audioPlayerRef.current) {
                            audioPlayerRef.current.playbackRate = audioPlaybackRate
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="aspect-video w-full">
                      <iframe
                        className="h-full w-full"
                        src={getYouTubeEmbedUrl(audioModalUrl)}
                        title="YouTube audio player"
                        allow="autoplay; encrypted-media"
                        allowFullScreen
                      />
                    </div>
                  )}
                </div>
                {isAudioFileUrl(audioModalUrl) ? (
                  <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                    <span>Playback speed</span>
                    <div className="flex items-center gap-2">
                      {([0.75, 1, 1.25, 1.5] as const).map((rate) => (
                        <button
                          key={rate}
                          className={`rounded-full border px-2 py-1 text-[10px] ${
                            audioPlaybackRate === rate
                              ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() => {
                            setAudioPlaybackRate(rate)
                            if (audioPlayerRef.current) {
                              audioPlayerRef.current.playbackRate = rate
                            }
                          }}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-[10px] text-slate-400">
                    To slow down YouTube or Spotify, use their built-in playback controls.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isAdmin && editingMusicianId && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={cancelEditMusician}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Musician</p>
                <h3 className="text-lg font-semibold">Edit musician</h3>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={saveEditMusician}
                >
                  Save
                </button>
                <button
                  className="min-w-[92px] rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-200"
                  onClick={() => deleteMusician(editingMusicianId)}
                >
                  Delete
                </button>
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={cancelEditMusician}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  value={editingMusicianName}
                  onChange={(event) => setEditingMusicianName(event.target.value)}
                  placeholder="Name"
                />
                <select
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  value={editingMusicianRoster}
                  onChange={(event) =>
                    setEditingMusicianRoster(event.target.value as 'core' | 'sub')
                  }
                >
                  <option value="core">Core roster</option>
                  <option value="sub">Sub</option>
                </select>
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  value={editingMusicianEmail}
                  onChange={(event) => setEditingMusicianEmail(event.target.value)}
                  placeholder="Email"
                />
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  value={editingMusicianPhone}
                  onChange={(event) => setEditingMusicianPhone(event.target.value)}
                  placeholder="Phone"
                />
                <div className="md:col-span-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Instruments
                  </div>
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                    placeholder="Filter instruments"
                    value={instrumentFilter}
                    onChange={(event) => setInstrumentFilter(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {filteredInstruments.map((instrument) => {
                      const active = editingMusicianInstruments.includes(instrument)
                      return (
                        <button
                          key={instrument}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            active
                              ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() => {
                            const next = editingMusicianInstruments.includes(instrument)
                              ? editingMusicianInstruments.filter((item) => item !== instrument)
                              : [...editingMusicianInstruments, instrument]
                            setEditingMusicianInstruments(next)
                            if (!next.includes('Vocals')) {
                              setEditingMusicianSinger('')
                            }
                          }}
                        >
                          {instrument}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                      placeholder="Add instrument"
                      value={newInstrumentInput}
                      onChange={(event) => setNewInstrumentInput(event.target.value)}
                    />
                    <button
                      className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-200"
                      onClick={addInstrumentToCatalog}
                    >
                      Add
                    </button>
                  </div>
                </div>
                {editingMusicianInstruments.includes('Vocals') && (
                  <select
                    className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    value={editingMusicianSinger}
                    onChange={(event) =>
                      setEditingMusicianSinger(
                        event.target.value as 'male' | 'female' | 'other' | '',
                      )
                    }
                  >
                    <option value="">Singer?</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteGigConfirm && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={cancelDeleteGig}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Delete this gig?</h3>
            </div>
            <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <p className="mt-2 text-sm text-slate-300">
                This will remove the gig, assignments, and special requests.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200"
                  onClick={cancelDeleteGig}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 rounded-xl bg-red-500/80 px-3 py-2 text-sm font-semibold text-white"
                  onClick={confirmDeleteGig}
                >
                  Delete gig
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSingerWarning && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowSingerWarning(false)}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Assign musicians first</h3>
            </div>
            <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <p className="mt-2 text-sm text-slate-300">
                Add musicians to this gig first. Singer assignment will use active assigned
                musicians (vocalists preferred).
              </p>
              <div className="mt-4">
                <button
                  className="w-full rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={() => setShowSingerWarning(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMissingSingerWarning && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowMissingSingerWarning(false)}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Assign singers first</h3>
            </div>
            <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <p className="mt-2 text-sm text-slate-300">
                Add singer assignments for every song in this set before marking it complete.
              </p>
              <div className="mt-4">
                <button
                  className="w-full rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={() => setShowMissingSingerWarning(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {singerModalSong && currentSetlist && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setSingerModalSongId(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Assign singers</h3>
              <div className="mt-2 text-sm text-slate-300">
                {singerModalSong.title}
                {singerModalSong.artist ? ` · ${singerModalSong.artist}` : ''}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setSingerModalSongId(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <div className="text-[10px] text-slate-400">
                  Original key: {singerModalSong.originalKey || '—'}
                </div>
                {!buildCompletion.musicians && (
                  <div className="mt-2 text-xs text-amber-200">
                    Complete “Assign Musicians” before assigning singers.
                  </div>
                )}
                {gigVocalists.length === 0 ? (
                  <div className="mt-3 text-xs text-slate-400">
                    No vocalists assigned to this gig yet.
                  </div>
                ) : (
                  <>
                    {singerModalSong.keys.some(
                      (key) => key.gigOverrides[currentSetlist.id],
                    ) && (
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-300">
                        {singerModalSong.keys
                          .filter((key) => key.gigOverrides[currentSetlist.id])
                          .map((key) => (
                            <span
                              key={key.singer}
                              className="rounded-full border border-white/10 px-2 py-1"
                            >
                              {key.singer} · {key.gigOverrides[currentSetlist.id]}
                            </span>
                          ))}
                      </div>
                    )}
                    <div className="mt-4 space-y-2">
                      {(pendingSingerAssignments[singerModalSong.id] ?? [
                        { singer: '', key: '' },
                      ]).map((pending, index) => {
                        const selectedKey = singerModalSong.keys.find(
                          (key) => key.singer === pending.singer,
                        )
                        const suggestion =
                          selectedKey?.defaultKey || singerModalSong.originalKey || ''
                        return (
                          <div
                            key={`${singerModalSong.id}-${index}`}
                            className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_auto]"
                          >
                            <select
                              className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
                              value={pending.singer}
                              onChange={(event) => {
                                if (!ensureVocalistsReady()) return
                                const singer = event.target.value
                                const existing = singerModalSong.keys.find(
                                  (key) => key.singer === singer,
                                )
                                const rows =
                                  pendingSingerAssignments[singerModalSong.id] ?? [
                                    { singer: '', key: '' },
                                  ]
                                setPendingSingerAssignments((prev) => {
                                  const nextRows = [...rows]
                                  nextRows[index] = {
                                    singer,
                                    key:
                                      existing?.gigOverrides[currentSetlist.id] ??
                                      existing?.defaultKey ??
                                      singerModalSong.originalKey ??
                                      '',
                                  }
                                  return { ...prev, [singerModalSong.id]: nextRows }
                                })
                              }}
                            >
                              <option value="">Select singer</option>
                              {gigVocalists.map((musician) => (
                                <option key={musician.id} value={musician.name}>
                                  {musician.name}
                                </option>
                              ))}
                            </select>
                            <input
                              className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
                              placeholder={`Key ${suggestion ? `(${suggestion})` : ''}`}
                              value={pending.key}
                              onChange={(event) => {
                                const rows =
                                  pendingSingerAssignments[singerModalSong.id] ?? [
                                    { singer: '', key: '' },
                                  ]
                                setPendingSingerAssignments((prev) => {
                                  const nextRows = [...rows]
                                  nextRows[index] = {
                                    singer: pending.singer,
                                    key: event.target.value,
                                  }
                                  return { ...prev, [singerModalSong.id]: nextRows }
                                })
                              }}
                            />
                            <button
                              className="rounded-xl bg-teal-400/90 px-3 py-2 text-xs font-semibold text-slate-950"
                              onClick={() =>
                                saveSingerAssignment(
                                  singerModalSong.id,
                                  pending.singer,
                                  pending.key,
                                  index,
                                )
                              }
                            >
                              Save
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                      <span>Multiple vocalists supported.</span>
                      <button
                        className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-200"
                        onClick={() =>
                          setPendingSingerAssignments((prev) => ({
                            ...prev,
                            [singerModalSong.id]: [
                              ...(prev[singerModalSong.id] ?? [{ singer: '', key: '' }]),
                              { singer: '', key: '' },
                            ],
                          }))
                        }
                      >
                        Add vocalist
                      </button>
                    </div>
                    {(pendingSingerAssignments[singerModalSong.id] ?? []).some(
                      (row) =>
                        row.singer &&
                        !singerModalSong.keys.find((key) => key.singer === row.singer),
                    ) && (
                      <div className="mt-2 text-[10px] text-amber-200">
                        New singer for this song. Use the original key as a starting point.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showRemoveSongConfirm && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={cancelRemoveSong}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Remove this song?</h3>
            </div>
            <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <p className="mt-2 text-sm text-slate-300">
                This will remove the song from the gig setlist.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200"
                  onClick={cancelRemoveSong}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 rounded-xl bg-red-500/80 px-3 py-2 text-sm font-semibold text-white"
                  onClick={confirmRemoveSong}
                >
                  Remove song
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDuplicateSongConfirm && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={cancelDuplicateSong}
        >
          <div
            className="w-full max-w-md max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Possible duplicate</h3>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={cancelDuplicateSong}
                >
                  Cancel
                </button>
                <button
                  className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={confirmDuplicateSong}
                >
                  Save anyway
                </button>
              </div>
            </div>
            <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <p className="mt-2 text-sm text-slate-300">
                We found similar songs. Confirm before saving.
              </p>
              <div className="mt-3 space-y-2 text-sm">
                {similarSongMatches.map((song) => (
                  <div
                    key={song.id}
                    className="rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="font-semibold">{song.title}</div>
                    <div className="text-xs text-slate-400">{song.artist || 'Unknown'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showGigMusiciansModal && currentSetlist && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowGigMusiciansModal(false)}
        >
          <div
            className="w-full max-w-md max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Musicians on this gig</h3>
              <p className="mt-1 text-sm text-slate-300">
                {currentSetlist.gigName} • {formatGigDate(currentSetlist.date)}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setShowGigMusiciansModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-4">
              {appState.gigMusicians.filter((row) => row.gigId === currentSetlist.id)
                .map((row) => appState.musicians.find((musician) => musician.id === row.musicianId))
                .filter((musician): musician is Musician => Boolean(musician))
                .sort((a, b) => {
                  const aCore = a.roster === 'core'
                  const bCore = b.roster === 'core'
                  if (aCore !== bCore) return aCore ? -1 : 1
                  return a.name.localeCompare(b.name)
                })
                .map((musician) => (
                  <div
                    key={musician.id}
                    className="flex items-start justify-between rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-3 text-sm"
                  >
                    <div>
                      <div className="font-semibold">{musician.name}</div>
                      <div className="text-xs text-slate-400">
                        {(musician.instruments ?? []).join(', ') || 'No instruments listed'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {musician.email && (
                        <a
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px]"
                          href={`mailto:${musician.email}`}
                          title="Email"
                        >
                          ✉️
                        </a>
                      )}
                      {musician.phone && (
                        <>
                          <a
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px]"
                            href={`tel:${musician.phone}`}
                            title="Call"
                          >
                            📞
                          </a>
                          <a
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px]"
                            href={`sms:${musician.phone}`}
                            title="Text"
                          >
                            💬
                          </a>
                        </>
                      )}
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          musician.roster === 'core'
                            ? 'bg-emerald-400/20 text-emerald-200'
                            : 'bg-slate-600/40 text-slate-200'
                        }`}
                      >
                        {musician.roster === 'core' ? 'Core' : 'Sub'}
                      </span>
                    </div>
                  </div>
                ))}
              {!appState.gigMusicians.some((row) => row.gigId === currentSetlist.id) && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-300">
                  No musicians have been assigned yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSetlistModal && currentSetlist && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowSetlistModal(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Gig Info</h3>
              <div className="mt-1 text-sm text-slate-300">
                <span className="font-semibold text-slate-100">{currentSetlist.gigName}</span>
                <span className="mx-2 text-slate-500">•</span>
                <span>{formatGigDate(currentSetlist.date)}</span>
              </div>
              {currentSetlist.venueAddress && (
                <a
                  className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    currentSetlist.venueAddress,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  📍 {currentSetlist.venueAddress}
                </a>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setShowSetlistModal(false)}
                >
                  Close
                </button>
                <button
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-teal-300/40 bg-slate-800/95 text-xl text-slate-100 shadow-[0_0_18px_rgba(20,184,166,0.2)]"
                  onClick={handlePrintSetlist}
                  title="Download setlist PDF"
                  aria-label="Download setlist PDF"
                >
                  <img src={downloadPdfIcon} alt="" className="h-6 w-6 object-contain" />
                </button>
                <button
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-indigo-300/60 bg-indigo-500/20 text-xl text-indigo-100 shadow-[0_0_18px_rgba(99,102,241,0.28)]"
                  onClick={() => {
                    setPlaylistIndex(0)
                    setPlaylistAutoAdvance(true)
                    setShowPlaylistModal(true)
                  }}
                  title="Open setlist playlist"
                  aria-label="Open setlist playlist"
                >
                  <img src={openPlaylistIcon} alt="" className="h-6 w-6 object-contain" />
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5">
              <div
                className={`rounded-3xl border p-5 ${
                  currentSetlist.date === new Date().toISOString().slice(0, 10)
                    ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                    : 'border-white/10 bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Special Requests</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Track request type, song, singers, key, and notes.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="grid gap-2 text-xs uppercase tracking-wide text-slate-400 md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr]">
                    <span>Category</span>
                    <span>Song</span>
                    <span>Vocal</span>
                    <span>Key</span>
                    <span>Info</span>
                  </div>
                  {appState.specialRequests
                    .filter((request) => request.gigId === currentSetlist.id)
                    .map((request) => {
                      const song = appState.songs.find((item) => item.id === request.songId)
                      return (
                        <div
                          key={request.id}
                          className="grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr]"
                        >
                          <div className="text-xs text-teal-300">
                            Special Request
                            <div className="text-xs text-slate-400">{request.type}</div>
                            {request.djOnly && (
                              <div className="mt-1 inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-xs uppercase tracking-wide text-red-200">
                                DJ Only
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-base font-semibold md:text-lg">
                              {request.songTitle}
                            </div>
                            {song?.artist && (
                              <div className="text-xs text-slate-400">{song.artist}</div>
                            )}
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              {(request.externalAudioUrl || song?.youtubeUrl) && (
                                <button
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-slate-200"
                                  onClick={() =>
                                    openAudioForUrl(
                                      request.externalAudioUrl ?? song?.youtubeUrl ?? '',
                                      request.externalAudioUrl
                                        ? 'External audio'
                                        : 'YouTube audio',
                                    )
                                  }
                                  aria-label="Audio"
                                  title="Audio"
                                >
                                  🔊
                                </button>
                              )}
                              {hasDocsForSong(song?.id) && (
                                <button
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-slate-200"
                                  onClick={() => openDocsForSong(song?.id)}
                                  aria-label="Documents"
                                  title="Documents"
                                >
                                  📄
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-slate-300">
                            {request.djOnly ? 'DJ' : request.singers.join(', ')}
                          </div>
                          <div className="text-xs text-slate-200">
                            {request.djOnly ? '—' : request.key}
                          </div>
                          <div className="text-xs text-slate-400">
                            {request.note ? 'ℹ️' : ''}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {['Dinner', 'Latin', 'Dance'].map((section) => (
                  <div
                    key={section}
                    className={`rounded-3xl border p-5 ${
                      currentSetlist.date === new Date().toISOString().slice(0, 10)
                        ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                        : 'border-white/10 bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 min-w-0">
                      <h3 className="text-sm font-semibold whitespace-nowrap">
                        {section} Set
                      </h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Songs tagged for {section.toLowerCase()}.
                    </p>
                    <div className="mt-4 space-y-2">
                      {currentSetlist.songIds
                        .map((songId) => appState.songs.find((song) => song.id === songId))
                        .filter((song): song is Song => Boolean(song))
                        .filter((song) => hasSongTag(song, section))
                        .map((song) => (
                          <div
                            key={song.id}
                            className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-base font-semibold md:text-lg">
                                  {song.title}
                                </div>
                                <div className="text-xs text-slate-400">{song.artist}</div>
                                {currentSetlist && (() => {
                                  const assignments = getGigSingerAssignments(
                                    song.id,
                                    currentSetlist.id,
                                  )
                                  const singers = assignments.map((entry) => entry.singer)
                                  const keys = Array.from(
                                    new Set(assignments.map((entry) => entry.key)),
                                  )
                                  const label = !assignments.length
                                    ? 'No singers assigned?'
                                    : keys.length === 1
                                      ? `${singers.join(', ')} · Key: ${keys[0]}`
                                      : `${singers.join(', ')} · Multiple keys`
                                  return (
                                    <div
                                      className={`mt-2 text-xs ${
                                        assignments.length === 0
                                          ? 'text-red-300'
                                          : 'text-teal-200'
                                      }`}
                                    >
                                      {label}
                                    </div>
                                  )
                                })()}
                              </div>
                              <div className="flex items-center gap-2">
                                {song.youtubeUrl && (
                                  <button
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
                                    onClick={() =>
                                      openAudioForUrl(song.youtubeUrl ?? '', 'YouTube audio')
                                    }
                                    aria-label="Audio"
                                    title="Audio"
                                  >
                                    🎧
                                  </button>
                                )}
                                {hasDocsForSong(song.id) && (
                                  <button
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px] text-slate-200"
                                    onClick={() => openDocsForSong(song.id)}
                                    aria-label="Documents"
                                    title="Documents"
                                  >
                                    📄
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showPlaylistModal && currentSetlist && (
        <div
          className="fixed inset-0 z-[98] flex items-center justify-center bg-slate-950/85 px-4 py-6 backdrop-blur-sm"
        >
          <div
            className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Gig Playlist</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Ordered: Special Requests, Dinner, Dance, Latin
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300"
                  onClick={() => setShowPlaylistModal(false)}
                >
                  Close
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                  disabled={playlistEntries.length === 0}
                  onClick={() => movePlaylistBy(-1)}
                >
                  ⏮ Prev
                </button>
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                  disabled={playlistEntries.length === 0}
                  onClick={() => movePlaylistBy(1)}
                >
                  ⏭ Next
                </button>
                <button
                  type="button"
                  className={`col-span-2 min-h-[44px] rounded-xl border px-3 py-2 text-sm sm:col-span-1 ${
                    playlistAutoAdvance
                      ? 'border-teal-300/60 bg-teal-400/10 text-teal-100'
                      : 'border-white/10 text-slate-300'
                  }`}
                  onClick={() => setPlaylistAutoAdvance((current) => !current)}
                >
                  Auto-next: {playlistAutoAdvance ? 'On' : 'Off'}
                </button>
                <span className="col-span-2 text-xs text-slate-400 sm:col-span-1">
                  {playlistEntries.length
                    ? `${playlistIndex + 1} / ${playlistEntries.length}`
                    : 'No playable songs'}
                </span>
              </div>
            </div>

            <div className="max-h-[calc(88vh-140px)] overflow-auto px-5 pb-6 pt-4">
              {currentPlaylistEntry ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{currentPlaylistEntry.title}</p>
                      <p className="text-xs text-slate-400">{currentPlaylistEntry.artist || ' '}</p>
                      <p className="mt-1 text-xs text-teal-200">
                        {getPlaylistAssignmentText(currentPlaylistEntry)}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {currentPlaylistEntry.tags.map((tag) => (
                        <span
                          key={`${currentPlaylistEntry.key}-${tag}`}
                          className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                            tag === 'Special Request'
                              ? 'bg-fuchsia-500/20 text-fuchsia-100'
                              : tag === 'Dinner'
                                ? 'bg-amber-500/20 text-amber-100'
                                : tag === 'Dance'
                                  ? 'bg-cyan-500/20 text-cyan-100'
                                  : 'bg-pink-500/20 text-pink-100'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                    {!currentPlaylistEntry.audioUrl ? (
                      <div className="text-sm text-slate-400">
                        No audio URL saved for this song yet.
                      </div>
                    ) : isSpotifyUrl(currentPlaylistEntry.audioUrl) ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3">
                        <div className="text-sm text-slate-200">
                          Spotify track ready. Tap to open in Spotify.
                        </div>
                        <a
                          className="rounded-lg bg-emerald-500/90 px-3 py-2 text-xs font-semibold text-slate-950"
                          href={currentPlaylistEntry.audioUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Spotify
                        </a>
                      </div>
                    ) : isAudioFileUrl(currentPlaylistEntry.audioUrl) ? (
                      <audio
                        key={`${currentPlaylistEntry.key}-${playlistPlayNonce}`}
                        className="w-full"
                        controls
                        autoPlay
                        src={currentPlaylistEntry.audioUrl}
                        onEnded={() => {
                          if (!playlistAutoAdvance || playlistEntries.length <= 1) return
                          movePlaylistBy(1)
                        }}
                      />
                    ) : isYouTubeUrl(currentPlaylistEntry.audioUrl) ? (
                      <iframe
                        key={`${currentPlaylistEntry.key}-${playlistPlayNonce}`}
                        className="aspect-video w-full rounded-xl border border-white/10"
                        src={getYouTubeEmbedUrl(currentPlaylistEntry.audioUrl)}
                        title="YouTube playlist item"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3">
                        <div className="text-sm text-slate-200">
                          External audio link ready. Open in a new tab.
                        </div>
                        <a
                          className="rounded-lg bg-teal-500/90 px-3 py-2 text-xs font-semibold text-slate-950"
                          href={currentPlaylistEntry.audioUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Link
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
                  No playlist songs found for this gig yet.
                </div>
              )}

              <div className="mt-4 space-y-2">
                {playlistEntries.map((item, index) => (
                  <button
                    type="button"
                    key={item.key}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      index === playlistIndex
                        ? 'border-teal-300/70 bg-teal-400/10'
                        : 'border-white/10 bg-slate-950/40'
                    }`}
                    onClick={() => jumpToPlaylistIndex(index)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{item.title}</div>
                        <div className="text-[11px] text-slate-400">{item.artist || ' '}</div>
                        <div className="mt-0.5 text-[11px] text-teal-200">
                          {getPlaylistAssignmentText(item)}
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {item.tags.map((tag) => (
                          <span
                            key={`${item.key}-list-${tag}`}
                            className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                              tag === 'Special Request'
                                ? 'bg-fuchsia-500/20 text-fuchsia-100'
                                : tag === 'Dinner'
                                  ? 'bg-amber-500/20 text-amber-100'
                                  : tag === 'Dance'
                                    ? 'bg-cyan-500/20 text-cyan-100'
                                    : 'bg-pink-500/20 text-pink-100'
                            }`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showPrintPreview && currentSetlist && (
        <div
          className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm"
          onClick={() => setShowPrintPreview(false)}
        >
          <div
            className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900 text-slate-200 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col">
              <div className="border-b border-white/10 bg-slate-900 px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Setlist PDF Preview</h3>
                    <div className="text-xs text-slate-400">
                      {currentSetlist.gigName} · {formatGigDate(currentSetlist.date)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      className="min-w-[100px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
                      onClick={() => setShowPrintPreview(false)}
                    >
                      Close
                    </button>
                    <button
                      className="min-w-[120px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
                      onClick={() => window.print()}
                    >
                      Print
                    </button>
                    <button
                      className="liquid-button min-w-[160px] rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(20,184,166,0.3)] hover:bg-teal-400 transition-colors"
                      onClick={handleDownloadPDF}
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              </div>
              <div className="max-h-[calc(90vh-96px)] overflow-auto bg-slate-950/50 p-6">
                <div className="mx-auto w-full max-w-[900px] rounded-[2px] bg-white p-8 shadow-2xl ring-1 ring-white/10">
                  <div id="printable-setlist" className="print-container">
                <div className="print-header">
                  <div>
                    <div className="print-title">{currentSetlist.gigName}</div>
                    <div className="print-subtitle">{formatGigDate(currentSetlist.date)}</div>
                    {currentSetlist.venueAddress && (
                      <div className="print-subtitle">{currentSetlist.venueAddress}</div>
                    )}
                  </div>
                  <div className="print-badge">Setlist</div>
                </div>

                <div className="print-layout">
                  <div className="print-section-box print-special">
                    <div className="print-section-title">Special Requests</div>
                    <div className="print-list">
                      {appState.specialRequests
                        .filter((request) => request.gigId === currentSetlist.id)
                        .map((request) => {
                          const song = appState.songs.find((item) => item.id === request.songId)
                          return (
                            <div key={request.id} className="print-row">
                              <div className="print-row-title">
                                {(request.externalAudioUrl || song?.youtubeUrl) ? (
                                  <a
                                    className="print-link"
                                    href={request.externalAudioUrl ?? song?.youtubeUrl ?? ''}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {request.songTitle}
                                  </a>
                                ) : (
                                  request.songTitle
                                )}{' '}
                                {request.djOnly ? <span className="print-pill">DJ Only</span> : null}
                              </div>
                              <div className="print-row-subtitle">
                                {request.type} ·{' '}
                                {request.djOnly
                                  ? 'DJ'
                                  : request.singers.length
                                    ? request.singers.join(', ')
                                    : 'No singers'}{' '}
                                · {request.djOnly ? '—' : request.key || 'No key'}
                              </div>
                              {request.note && (
                                <div className="print-row-note">{request.note}</div>
                              )}
                            </div>
                          )
                        })}
                      {appState.specialRequests.filter(
                        (request) => request.gigId === currentSetlist.id,
                      ).length === 0 && <div className="print-empty">No special requests.</div>}
                    </div>
                  </div>

                  <div className="print-section-box print-musicians">
                    <div className="print-section-title">Musicians</div>
                    <div className="print-grid">
                      {appState.gigMusicians
                        .filter((row) => row.gigId === currentSetlist.id)
                        .map((row) =>
                          appState.musicians.find((musician) => musician.id === row.musicianId),
                        )
                        .filter((musician): musician is Musician => Boolean(musician))
                        .sort((a, b) => {
                          const aCore = a.roster === 'core'
                          const bCore = b.roster === 'core'
                          if (aCore !== bCore) return aCore ? -1 : 1
                          return a.name.localeCompare(b.name)
                        })
                        .map((musician) => (
                          <div key={musician.id} className="print-card">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="print-card-title">{musician.name}</div>
                                <div className="print-card-subtitle">
                                  {(musician.instruments ?? []).join(', ') || 'No instruments'}
                                </div>
                              </div>
                              <div className="print-contact-row">
                                {musician.email && (
                                  <a
                                    href={`mailto:${musician.email}`}
                                    className="print-icon-link"
                                    title="Email"
                                  >
                                    ✉️
                                  </a>
                                )}
                                {musician.phone && (
                                  <>
                                    <a
                                      href={`tel:${musician.phone}`}
                                      className="print-icon-link"
                                      title="Call"
                                    >
                                      📞
                                    </a>
                                    <a
                                      href={`sms:${musician.phone}`}
                                      className="print-icon-link"
                                      title="Text"
                                    >
                                      💬
                                    </a>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="print-section-box print-latin">
                    <div className="print-section-title">Latin Set</div>
                    <div className="print-list">
                      {currentSetlist.songIds
                        .map((songId) => appState.songs.find((song) => song.id === songId))
                        .filter((song): song is Song => Boolean(song))
                        .filter((song) => hasSongTag(song, 'Latin'))
                        .map((song) => {
                          const assignments = getGigSingerAssignments(
                            song.id,
                            currentSetlist.id,
                          )
                          const singers = assignments.map((entry) => entry.singer)
                          const keys = Array.from(
                            new Set(assignments.map((entry) => entry.key)),
                          )
                          const keyLabel =
                            keys.length === 0
                              ? 'No key'
                              : keys.length === 1
                                ? keys[0]
                                : 'Multi'
                          return (
                            <div key={song.id} className="print-row">
                              <div className="print-row-title">
                                {song.youtubeUrl ? (
                                  <a
                                    className="print-link"
                                    href={song.youtubeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {song.title}
                                  </a>
                                ) : (
                                  song.title
                                )}
                              </div>
                              <div className="print-row-subtitle">
                                {song.artist || 'Unknown'} ·{' '}
                                {singers.length ? singers.join(', ') : 'No singers'} · {keyLabel}
                              </div>
                            </div>
                          )
                        })}
                      {currentSetlist.songIds.filter((songId) => {
                        const song = appState.songs.find((item) => item.id === songId)
                        return song ? hasSongTag(song, 'Latin') : false
                      }).length === 0 && <div className="print-empty">No songs.</div>}
                    </div>
                  </div>

                  <div className="print-section-box print-dinner">
                    <div className="print-section-title">Dinner Set</div>
                    <div className="print-list">
                      {currentSetlist.songIds
                        .map((songId) => appState.songs.find((song) => song.id === songId))
                        .filter((song): song is Song => Boolean(song))
                        .filter((song) => hasSongTag(song, 'Dinner'))
                        .map((song) => {
                          const assignments = getGigSingerAssignments(
                            song.id,
                            currentSetlist.id,
                          )
                          const singers = assignments.map((entry) => entry.singer)
                          const keys = Array.from(
                            new Set(assignments.map((entry) => entry.key)),
                          )
                          const keyLabel =
                            keys.length === 0
                              ? 'No key'
                              : keys.length === 1
                                ? keys[0]
                                : 'Multi'
                          return (
                            <div key={song.id} className="print-row">
                              <div className="print-row-title">
                                {song.youtubeUrl ? (
                                  <a
                                    className="print-link"
                                    href={song.youtubeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {song.title}
                                  </a>
                                ) : (
                                  song.title
                                )}
                              </div>
                              <div className="print-row-subtitle">
                                {song.artist || 'Unknown'} ·{' '}
                                {singers.length ? singers.join(', ') : 'No singers'} · {keyLabel}
                              </div>
                            </div>
                          )
                        })}
                      {currentSetlist.songIds.filter((songId) => {
                        const song = appState.songs.find((item) => item.id === songId)
                        return song ? hasSongTag(song, 'Dinner') : false
                      }).length === 0 && <div className="print-empty">No songs.</div>}
                    </div>
                  </div>

                  <div className="print-section-box print-dance">
                    <div className="print-section-title">Dance Set</div>
                    <div className="print-list">
                      {currentSetlist.songIds
                        .map((songId) => appState.songs.find((song) => song.id === songId))
                        .filter((song): song is Song => Boolean(song))
                        .filter((song) => hasSongTag(song, 'Dance'))
                        .map((song) => {
                          const assignments = getGigSingerAssignments(
                            song.id,
                            currentSetlist.id,
                          )
                          const singers = assignments.map((entry) => entry.singer)
                          const keys = Array.from(
                            new Set(assignments.map((entry) => entry.key)),
                          )
                          const keyLabel =
                            keys.length === 0
                              ? 'No key'
                              : keys.length === 1
                                ? keys[0]
                                : 'Multi'
                          return (
                            <div key={song.id} className="print-row">
                              <div className="print-row-title">
                                {song.youtubeUrl ? (
                                  <a
                                    className="print-link"
                                    href={song.youtubeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {song.title}
                                  </a>
                                ) : (
                                  song.title
                                )}
                              </div>
                              <div className="print-row-subtitle">
                                {song.artist || 'Unknown'} ·{' '}
                                {singers.length ? singers.join(', ') : 'No singers'} · {keyLabel}
                              </div>
                            </div>
                          )
                        })}
                      {currentSetlist.songIds.filter((songId) => {
                        const song = appState.songs.find((item) => item.id === songId)
                        return song ? hasSongTag(song, 'Dance') : false
                      }).length === 0 && <div className="print-empty">No songs.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
          </div>
        </div>
      </div>
      )}

      {showKeyResolveModal && resolveSongId && currentSetlist && (
        <div
          className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => {
            setShowKeyResolveModal(false)
            setResolveSongId(null)
          }}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Resolve key</h3>
              <div className="mt-2 text-sm text-slate-300">
                Choose the correct key for all singers.
              </div>
            </div>
            <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="flex flex-wrap gap-2">
                {Array.from(
                  new Set(
                    getGigSingerAssignments(resolveSongId, currentSetlist.id).map(
                      (entry) => entry.key,
                    ),
                  ),
                ).map((key) => (
                  <button
                    key={key}
                    className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                    onClick={() => resolveGigKeyForSong(resolveSongId, key)}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => {
                    setShowKeyResolveModal(false)
                    setResolveSongId(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddSongModal && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => {
            setNewSongTitle('')
            setNewSongArtist('')
            setNewSongAudio('')
            setNewSongOriginalKey('')
            setNewSongTags([])
            setSongFormError('')
            setPendingSongDraft(null)
            setSimilarSongMatches([])
            setShowDuplicateSongConfirm(false)
            setShowAddSongModal(false)
          }}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Add new song</h3>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] justify-center rounded-xl bg-teal-400/90 px-4 py-2 text-center text-sm font-semibold text-slate-950"
                  onClick={() => addSongFromAdmin(false)}
                >
                  Add song
                </button>
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => {
                    setNewSongTitle('')
                    setNewSongArtist('')
                    setNewSongAudio('')
                    setNewSongOriginalKey('')
                    setNewSongTags([])
                    setSongFormError('')
                    setPendingSongDraft(null)
                    setSimilarSongMatches([])
                    setShowDuplicateSongConfirm(false)
                    setShowAddSongModal(false)
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  placeholder="Song title"
                  list="song-title-suggestions"
                  value={newSongTitle}
                  onChange={(event) => setNewSongTitle(event.target.value)}
                />
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  placeholder="Artist (optional)"
                  list="song-artist-suggestions"
                  value={newSongArtist}
                  onChange={(event) => setNewSongArtist(event.target.value)}
                />
                <datalist id="song-title-suggestions">
                  {Array.from(
                    new Set(
                      appState.songs
                        .map((song) => song.title.trim())
                        .filter(Boolean),
                    ),
                  ).map((title) => (
                    <option key={title} value={title} />
                  ))}
                </datalist>
                <datalist id="song-artist-suggestions">
                  {Array.from(
                    new Set(
                      appState.songs
                        .map((song) => song.artist?.trim() ?? '')
                        .filter(Boolean),
                    ),
                  ).map((artist) => (
                    <option key={artist} value={artist} />
                  ))}
                </datalist>
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  placeholder="Original key (optional)"
                  value={newSongOriginalKey}
                  onChange={(event) => setNewSongOriginalKey(event.target.value)}
                />
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm md:col-span-2"
                  placeholder="Audio link (YouTube, Spotify, MP3)"
                  value={newSongAudio}
                  onChange={(event) => setNewSongAudio(event.target.value)}
                />
                <div className="md:col-span-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Setlist tags
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {appState.tagsCatalog.map((tag) => {
                      const active = newSongTags.includes(tag)
                      return (
                        <button
                          key={tag}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                            active
                              ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() =>
                            setNewSongTags((current) =>
                              current.includes(tag)
                                ? current.filter((item) => item !== tag)
                                : [...current, tag],
                            )
                          }
                        >
                          {tag}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              {songFormError && (
                <div className="mt-3 text-xs text-red-200">{songFormError}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSubModal && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => {
            setNewSubName('')
            setNewSubEmail('')
            setNewSubPhone('')
            setNewSubInstruments([])
            setNewSubSinger('')
            setInstrumentFilter('')
            setNewInstrumentInput('')
            setShowSubModal(false)
          }}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Sub musician</p>
                <h3 className="text-lg font-semibold">Quick add new sub</h3>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={() => {
                    if (newSubName.trim() && activeGigId) {
                      addSubAndAssign()
                      setShowSubModal(false)
                    }
                  }}
                >
                  Add + assign
                </button>
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => {
                    setNewSubName('')
                    setNewSubEmail('')
                    setNewSubPhone('')
                    setNewSubInstruments([])
                    setNewSubSinger('')
                    setInstrumentFilter('')
                    setNewInstrumentInput('')
                    setShowSubModal(false)
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                  placeholder="Name"
                  value={newSubName}
                  onChange={(event) => setNewSubName(event.target.value)}
                />
                <div className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Instruments
                  </div>
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                    placeholder="Filter instruments"
                    value={instrumentFilter}
                    onChange={(event) => setInstrumentFilter(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {filteredInstruments.map((instrument) => {
                      const active = newSubInstruments.includes(instrument)
                      return (
                        <button
                          key={instrument}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            active
                              ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() => {
                            const next = newSubInstruments.includes(instrument)
                              ? newSubInstruments.filter((item) => item !== instrument)
                              : [...newSubInstruments, instrument]
                            setNewSubInstruments(next)
                            if (!next.includes('Vocals')) {
                              setNewSubSinger('')
                            }
                          }}
                        >
                          {instrument}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-xs"
                      placeholder="Add instrument"
                      value={newInstrumentInput}
                      onChange={(event) => setNewInstrumentInput(event.target.value)}
                    />
                    <button
                      className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-200"
                      onClick={addInstrumentToCatalog}
                    >
                      Add
                    </button>
                  </div>
                </div>
                <input
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                  placeholder="Email"
                  value={newSubEmail}
                  onChange={(event) => setNewSubEmail(event.target.value)}
                />
                <input
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                  placeholder="Phone"
                  value={newSubPhone}
                  onChange={(event) => setNewSubPhone(event.target.value)}
                />
                {newSubInstruments.includes('Vocals') && (
                  <select
                    className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                    value={newSubSinger}
                    onChange={(event) =>
                      setNewSubSinger(
                        event.target.value as 'male' | 'female' | 'other' | '',
                      )
                    }
                  >
                    <option value="">Singer?</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingSongId && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={cancelEditSong}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Song</p>
                <h3 className="text-lg font-semibold">Edit song</h3>
                <p className="mt-1 truncate text-sm text-teal-200">
                  {editingSongTitle.trim() || 'Untitled song'}
                </p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={
                    isEditSongDirty || hasPendingDocDraft
                      ? () => {
                          void handleSaveSongEditor()
                        }
                      : cancelEditSong
                  }
                >
                  {isEditSongDirty || hasPendingDocDraft ? 'Save' : 'Close'}
                </button>
                <button
                  className="min-w-[92px] rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-200"
                  onClick={() => deleteSong(editingSongId)}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="max-h-[calc(85vh-120px)] overflow-auto px-5 pb-16">
              <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                value={editingSongTitle}
                onChange={(event) => setEditingSongTitle(event.target.value)}
                placeholder="Song title"
              />
              <input
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                value={editingSongArtist}
                onChange={(event) => setEditingSongArtist(event.target.value)}
                placeholder="Artist"
              />
              <input
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                value={editingSongOriginalKey}
                onChange={(event) => setEditingSongOriginalKey(event.target.value)}
                placeholder="Original key"
              />
              <input
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm md:col-span-2"
                value={editingSongAudio}
                onChange={(event) => setEditingSongAudio(event.target.value)}
                placeholder="Audio link"
              />
              </div>
              <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Setlist tags
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {appState.tagsCatalog.map((tag) => {
                  const active = editingSongTags.some(
                    (item) => item.trim().toLowerCase() === tag.trim().toLowerCase(),
                  )
                  return (
                    <button
                      key={tag}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                        active
                          ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                          : 'border-white/10 text-slate-300'
                      }`}
                      onClick={() =>
                        setEditingSongTags((current) => {
                          const key = tag.trim().toLowerCase()
                          const hasTag = current.some(
                            (item) => item.trim().toLowerCase() === key,
                          )
                          if (hasTag) {
                            return current.filter(
                              (item) => item.trim().toLowerCase() !== key,
                            )
                          }
                          return normalizeTagList([...current, tag])
                        })
                      }
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
              </div>
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Update details above, then save in the header.
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold">Charts & Lyrics for this song</div>
              <div className="mt-3 space-y-2">
                {appState.documents
                  .filter((doc) => doc.songId === editingSongId)
                  .map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="font-semibold">{doc.title}</div>
                        <div className="text-[10px] text-slate-400">
                          {doc.type} · {doc.instrument}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-full border border-white/10 px-3 py-1 text-[10px]"
                          onClick={() => {
                            if (doc.content) {
                              setDocModalContent(doc)
                              setDocModalSongId(doc.songId)
                              return
                            }
                            if (doc.url) {
                              window.open(doc.url, '_blank')
                            }
                          }}
                        >
                          Open
                        </button>
                        <label className="cursor-pointer rounded-full border border-white/10 px-3 py-1 text-[10px]">
                          Upload
                          <input
                            className="hidden"
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              if (file) {
                                void updateDocumentFile(doc, file)
                              }
                              event.currentTarget.value = ''
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                {appState.documents.filter((doc) => doc.songId === editingSongId)
                  .length === 0 && (
                  <div className="text-xs text-slate-400">No documents yet.</div>
                )}
              </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold">Attach Charts & Lyrics</div>
              <div className="mt-3 grid gap-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                    Document type
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['Chart', 'Lyrics', 'Lead Sheet'] as const).map((type) => {
                      const active = newDocType === type
                      return (
                        <button
                          key={type}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                            active
                              ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() => setNewDocType(type)}
                        >
                          {type}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {(newDocType === 'Chart' || newDocType === 'Lead Sheet') && (
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                      Instrument
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {['All', ...instrumentCatalog].map((instrument) => {
                        const active = (newDocInstrument || 'All') === instrument
                        return (
                          <button
                            key={instrument}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                              active
                                ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                                : 'border-white/10 text-slate-300'
                            }`}
                            onClick={() =>
                              setNewDocInstrument(instrument === 'All' ? '' : instrument)
                            }
                          >
                            {instrument}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {(newDocType === 'Chart' || newDocType === 'Lead Sheet') && (
                  <input
                    className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm md:col-span-2"
                    placeholder="Document title (optional)"
                    value={newDocTitle}
                    onChange={(event) => setNewDocTitle(event.target.value)}
                  />
                )}
                {newDocType === 'Lyrics' && (
                  <textarea
                    className="min-h-[180px] rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-relaxed md:col-span-2"
                    placeholder="Paste lyrics here"
                    value={newDocLyrics}
                    onChange={(event) => setNewDocLyrics(event.target.value)}
                    rows={6}
                  />
                )}
                {(newDocType === 'Chart' || newDocType === 'Lead Sheet') && (
                  <label className="md:col-span-2 cursor-pointer rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                    {newDocFile ? `File selected: ${newDocFile.name}` : 'Choose a file'}
                    <input
                      className="hidden"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null
                        setNewDocFile(file)
                      }}
                    />
                  </label>
                )}
                {(newDocType === 'Chart' || newDocType === 'Lead Sheet') && (
                  <input
                    className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm md:col-span-2"
                    placeholder="Or paste a file link (optional)"
                    value={newDocUrl}
                    onChange={(event) => setNewDocUrl(event.target.value)}
                  />
                )}
              </div>
              <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                Use the top <span className="font-semibold text-slate-100">Save</span> button to
                save song details and any pending chart/lyrics changes together.
              </div>
              {docFormError && (
                <div className="mt-2 text-xs text-red-200">{docFormError}</div>
              )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isAdmin && activeBuildPanel && currentSetlist && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setActiveBuildPanel(null)}
        >
          <div
            className={`w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900 bg-gradient-to-br ${buildPanelGradient}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">
                {activeBuildPanel === 'musicians'
                  ? 'Assign Musicians'
                  : activeBuildPanel === 'addSongs'
                    ? 'Add Songs Not on Setlist'
                    : activeBuildPanel === 'special'
                      ? 'Special Requests'
                      : activeBuildPanel === 'dinner'
                        ? 'Dinner Set'
                        : activeBuildPanel === 'latin'
                          ? 'Latin Set'
                          : 'Dance Set'}
              </h3>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                    onClick={() => setActiveBuildPanel(null)}
                  >
                    {buildPanelDirty ? 'Save' : 'Close'}
                  </button>
                  {activeBuildPanel && (
                    <button
                      className={`flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-semibold ${
                        buildCompletion[activeBuildPanel]
                          ? 'border-emerald-300/40 text-emerald-200'
                          : 'border-amber-300/40 text-amber-200'
                      }`}
                      onClick={() =>
                        setBuildComplete(
                          activeBuildPanel,
                          !buildCompletion[activeBuildPanel],
                        )
                      }
                    >
                      <span className="text-xs uppercase tracking-wide">Complete</span>
                      <span
                        className={`relative h-6 w-11 rounded-full transition-colors ${
                          buildCompletion[activeBuildPanel]
                            ? 'bg-emerald-400/70'
                            : 'bg-slate-800'
                        }`}
                      >
                        <span
                          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                            buildCompletion[activeBuildPanel]
                              ? 'translate-x-5'
                              : 'translate-x-0'
                          }`}
                        />
                      </span>
                    </button>
                  )}
                </div>
                <div className="text-lg font-semibold text-slate-200">
                  {buildPanelCount.label}: {buildPanelCount.value}
                </div>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
              {gigMode && appState.currentSongId && (
                <button
                  className="liquid-button mb-4 w-full animate-pulse rounded-2xl bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(74,222,128,0.45)]"
                  onClick={() => openDocsForSong(appState.currentSongId ?? undefined)}
                >
                  <span>
                    Up next:{" "}
                    {appState.songs.find((song) => song.id === appState.currentSongId)?.title}
                  </span>
                </button>
              )}
              {activeBuildPanel === 'addSongs' && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="mt-4 flex flex-col gap-3">
                    <input
                      className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-2 text-sm"
                      placeholder="Search songs"
                      value={songSearch}
                      onChange={(event) => setSongSearch(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      {appState.tagsCatalog.map((tag) => (
                        <button
                          key={tag}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            activeTags.includes(tag)
                              ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() =>
                            setActiveTags((current) =>
                              current.includes(tag)
                                ? current.filter((item) => item !== tag)
                                : [...current, tag],
                            )
                          }
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <div className="max-h-64 space-y-2 overflow-auto">
                      {availableSongs.map((song) => (
                        <label
                          key={song.id}
                          className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-semibold">{song.title}</div>
                            <div className="text-xs text-slate-400">{song.artist}</div>
                            {song.tags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {song.tags.map((tag) => (
                                  <span
                                    key={`${song.id}-${tag}`}
                                    className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            checked={selectedSongIds.includes(song.id)}
                            onChange={(event) =>
                              setSelectedSongIds((current) =>
                                event.target.checked
                                  ? [...current, song.id]
                                  : current.filter((id) => id !== song.id),
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <button
                        className="rounded-full border border-white/10 px-3 py-1"
                        onClick={() =>
                          setSelectedSongIds(availableSongs.map((song) => song.id))
                        }
                      >
                        Select all
                      </button>
                      <button
                        className="rounded-full border border-white/10 px-3 py-1"
                        onClick={() => setSelectedSongIds([])}
                      >
                        Clear
                      </button>
                    </div>
                    <button
                      className="rounded-xl bg-teal-400/90 py-2 text-sm font-semibold text-slate-950"
                      onClick={addSongsToSetlist}
                    >
                      Add selected songs
                    </button>
                  </div>
                </div>
              )}

              {activeBuildPanel === 'special' && (
                <div
                  className={`rounded-3xl border p-5 ${
                    currentSetlist.date === new Date().toISOString().slice(0, 10)
                      ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                      : 'border-white/10 bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Special Requests</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Track request type, song, singers, key, and notes.
                      </p>
                    </div>
                    {!gigMode && (
                      <button
                        className="rounded-full border border-white/10 px-3 py-1 text-xs"
                        onClick={addSpecialRequest}
                      >
                        Add song
                      </button>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="grid gap-2 text-[10px] uppercase tracking-wide text-slate-400 md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr]">
                      <span>Category</span>
                      <span>Song</span>
                      <span>Vocal</span>
                      <span>Key</span>
                      <span>Info</span>
                    </div>
                    {appState.specialRequests
                      .filter((request) => request.gigId === currentSetlist.id)
                      .map((request) => {
                        const song = appState.songs.find(
                          (item) => item.id === request.songId,
                        )
                        return (
                          <div
                            key={request.id}
                            role="button"
                            tabIndex={0}
                            className={`grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr] ${
                              gigMode ? 'cursor-pointer' : ''
                            }`}
                            onClick={() => {
                              if (gigMode && request.songId) {
                                setGigCurrentSong(request.songId)
                                return
                              }
                              if (!gigMode && request.songId) {
                                openSingerModal(request.songId)
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                if (!gigMode && request.songId) {
                                  openSingerModal(request.songId)
                                }
                              }
                            }}
                          >
                            <div className="text-xs text-teal-300">
                              Special Request
                              <div className="text-[10px] text-slate-400">
                                {request.type}
                              </div>
                              {request.djOnly && (
                                <div className="mt-1 inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-200">
                                  DJ Only
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-base font-semibold md:text-lg">
                                {request.songTitle}
                              </div>
                              {song?.artist && (
                                <div className="text-[10px] text-slate-400">
                                  {song.artist}
                                </div>
                              )}
                              <div className="mt-2 flex items-center gap-2 text-[10px]">
                                {(request.externalAudioUrl || song?.youtubeUrl) && (
                                  <button
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openAudioForUrl(
                                        request.externalAudioUrl ?? song?.youtubeUrl ?? '',
                                        request.externalAudioUrl
                                          ? 'External audio'
                                          : 'YouTube audio',
                                      )
                                    }}
                                    aria-label="Audio"
                                    title="Audio"
                                  >
                                    🎧
                                  </button>
                                )}
                                {hasDocsForSong(song?.id) && (
                                  <button
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-slate-200"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openDocsForSong(song?.id)
                                    }}
                                    aria-label="Documents"
                                    title="Documents"
                                  >
                                    📄
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="text-xs text-slate-300">
                              {request.djOnly ? 'DJ' : request.singers.join(', ')}
                            </div>
                            <div className="text-xs text-slate-200">
                              {request.djOnly ? '—' : request.key}
                            </div>
                            <div className="text-xs text-slate-400">
                              {request.note ? 'ℹ️' : ''}
                            </div>
                          </div>
                        )
                      })}
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <h4 className="text-sm font-semibold">Add a request</h4>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-wide text-slate-400">
                          Request type
                        </label>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                          placeholder="Type a request type"
                          list="special-type-list"
                          value={pendingSpecialType}
                          onChange={(event) => setPendingSpecialType(event.target.value)}
                        />
                        <datalist id="special-type-list">
                          {appState.specialTypes.map((type) => (
                            <option key={type} value={type} />
                          ))}
                        </datalist>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-wide text-slate-400">
                          Song title
                        </label>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                          placeholder="Type a song title"
                          list="special-song-list"
                          value={pendingSpecialSong}
                          onChange={(event) => setPendingSpecialSong(event.target.value)}
                        />
                        <datalist id="special-song-list">
                          {appState.songs.map((song) => (
                            <option key={song.id} value={song.title} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-wide text-slate-400">
                          Singers
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {appState.singersCatalog.map((singer) => (
                            <button
                              key={singer}
                              className={`rounded-full border px-3 py-1 text-xs ${
                                pendingSpecialSingers.includes(singer)
                                  ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                                  : 'border-white/10 text-slate-300'
                              }`}
                              onClick={() =>
                                setPendingSpecialSingers((current) =>
                                  current.includes(singer)
                                    ? current.filter((item) => item !== singer)
                                    : [...current, singer],
                                )
                              }
                            >
                              {singer}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-wide text-slate-400">
                          Key
                        </label>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                          placeholder="Song key"
                          value={pendingSpecialKey}
                          onChange={(event) => setPendingSpecialKey(event.target.value)}
                          disabled={pendingSpecialDjOnly}
                        />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-wide text-slate-400">
                          Notes
                        </label>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                          placeholder="Optional notes"
                          value={pendingSpecialNote}
                          onChange={(event) => setPendingSpecialNote(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-wide text-slate-400">
                          DJ only
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={pendingSpecialDjOnly}
                            onChange={(event) => setPendingSpecialDjOnly(event.target.checked)}
                          />
                          <span className="text-xs text-slate-300">
                            This request is DJ only
                          </span>
                        </div>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                          placeholder="Audio link (YouTube, Spotify, MP3)"
                          value={pendingSpecialExternalUrl}
                          onChange={(event) => setPendingSpecialExternalUrl(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                      <button
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300"
                        onClick={addSongToLibrary}
                      >
                        Save to library
                      </button>
                      <button
                        className="rounded-xl bg-teal-400/90 px-3 py-2 text-xs font-semibold text-slate-950"
                        onClick={addSpecialRequest}
                      >
                        Add request
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeBuildPanel === 'musicians' && (
                <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
                  <h3 className="text-sm font-semibold">Assign musicians to gig</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Import the full roster, then toggle out who is unavailable and add subs.
                  </p>
                  {!buildCompletion.musicians && (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200"
                          onClick={importRosterToGig}
                        >
                          Import roster
                        </button>
                        <select
                          className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                          value={activeGigId}
                          onChange={(event) => setActiveGigId(event.target.value)}
                        >
                          {appState.setlists.map((gig) => (
                            <option key={gig.id} value={gig.id}>
                              {gig.gigName} · {formatGigDate(gig.date)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-xs">
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">
                          Add sub to gig
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-sm"
                            placeholder="Select existing musician"
                            list="gig-musician-list"
                            value={subSearchInput}
                            onChange={(event) => {
                              const value = event.target.value
                              setSubSearchInput(value)
                              const match = appState.musicians.find(
                                (musician) => musician.name.toLowerCase() === value.toLowerCase(),
                              )
                              if (match) {
                                addMusicianToGig(match.id)
                                setSubSearchInput('')
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200"
                            onClick={() => {
                              setNewSubName(subSearchInput.trim())
                              setNewSubEmail('')
                              setNewSubPhone('')
                              setNewSubInstruments([])
                              setNewSubSinger('')
                              setInstrumentFilter('')
                              setNewInstrumentInput('')
                              setShowSubModal(true)
                            }}
                          >
                            Add new sub
                          </button>
                        </div>
                        <datalist id="gig-musician-list">
                          {appState.musicians.map((musician) => (
                            <option key={musician.id} value={musician.name} />
                          ))}
                        </datalist>
                        <div className="mt-2 text-[10px] text-slate-400">
                          If the sub is not listed, tap Add new sub.
                        </div>
                      </div>
                    </>
                  )}
                  <div className="mt-4 space-y-2">
                    {appState.musicians.map((musician) => {
                      const gigEntry = appState.gigMusicians.find(
                        (gm) => gm.gigId === activeGigId && gm.musicianId === musician.id,
                      )
                      if (!gigEntry) return null
                      return (
                        <div
                          key={musician.id}
                          className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-xs"
                        >
                          <div>
                            <div className="text-sm font-semibold">{musician.name}</div>
                            <div className="text-[10px] text-slate-400">
                              {musician.instruments.join(', ') || 'No instruments'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-wide ${
                                gigEntry.status === 'active'
                                  ? 'bg-teal-400/20 text-teal-200'
                                  : 'bg-red-500/20 text-red-200'
                              }`}
                              onClick={() => {
                                if (buildCompletion.musicians) return
                                toggleGigMusicianStatus(musician.id)
                              }}
                            >
                              {gigEntry.status === 'active' ? 'Active' : 'Out'}
                            </button>
                            {!buildCompletion.musicians && (
                              <button
                                className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-slate-200"
                                onClick={() => removeMusicianFromGig(musician.id)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(activeBuildPanel === 'dinner' ||
                activeBuildPanel === 'latin' ||
                activeBuildPanel === 'dance') &&
                (() => {
                  const section =
                    activeBuildPanel === 'dinner'
                      ? 'Dinner'
                      : activeBuildPanel === 'latin'
                        ? 'Latin'
                        : 'Dance'
                  return (
                    <div
                      className={`rounded-3xl border p-5 ${
                        currentSetlist.date === new Date().toISOString().slice(0, 10)
                          ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                          : 'border-white/10 bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <h3 className="text-sm font-semibold whitespace-nowrap">
                          {section} Set
                        </h3>
                        {!buildCompletion[section.toLowerCase() as 'dinner' | 'latin' | 'dance'] &&
                          !gigMode && (
                          <select
                            className="w-[170px] shrink-0 rounded-xl border border-white/10 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-200"
                            onChange={(event) => {
                              if (event.target.value) {
                                importSectionFromGig(section, event.target.value)
                                event.target.value = ''
                              }
                            }}
                          >
                            <option value="">Import Previous Gig</option>
                            {recentGigs.map((gig) => (
                              <option key={gig.id} value={gig.id}>
                                {gig.gigName} · {gig.date}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Songs tagged for {section.toLowerCase()}.
                      </p>
                      {!buildCompletion[
                        section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                      ] && !gigMode && (
                        <p className="mt-1 text-[10px] text-slate-500">
                          Drag songs to reorder this section.
                        </p>
                      )}
                      {!buildCompletion[
                        section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                      ] && !gigMode && (
                        <div className="mt-3 space-y-3">
                          <div className="flex items-center gap-2">
                            {!starterPasteOpen[section as 'Dinner' | 'Latin' | 'Dance'] ? (
                              <button
                                className="min-w-[170px] whitespace-nowrap rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                                onClick={() =>
                                  setStarterPasteOpen((prev) => ({
                                    ...prev,
                                    [section]: true,
                                  }))
                                }
                              >
                                Paste starter list
                              </button>
                            ) : (
                              <button
                                className="min-w-[170px] whitespace-nowrap rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                                onClick={() =>
                                  setStarterPasteOpen((prev) => ({
                                    ...prev,
                                    [section]: false,
                                  }))
                                }
                              >
                                Close
                              </button>
                            )}
                            <details className="w-auto">
                              <summary
                                className="inline-flex min-w-[130px] cursor-pointer items-center justify-center whitespace-nowrap rounded-xl border border-white/10 px-4 py-2 text-center text-sm font-semibold text-slate-200"
                                onClick={() => {
                                  const panel = document.getElementById(`section-add-${section}`)
                                  panel?.classList.toggle('hidden')
                                }}
                              >
                                Add song
                              </summary>
                            </details>
                          </div>
                          <div
                            id={`section-add-${section}`}
                            className="mt-2 hidden w-full rounded-2xl border border-white/10 bg-slate-950 p-2 text-[10px] text-slate-200 shadow-xl"
                          >
                              <input
                                className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1 text-slate-200"
                                placeholder="Choose a song"
                                list={`section-song-${section}`}
                                onChange={(event) => {
                                  const value = event.currentTarget.value
                                  const match = appState.songs.find(
                                    (song) =>
                                      song.title.toLowerCase() === value.trim().toLowerCase(),
                                  )
                                  if (match) {
                                    addSongToSection(section, match.title)
                                    event.currentTarget.value = ''
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter') return
                                  event.preventDefault()
                                  const value = (event.currentTarget as HTMLInputElement).value
                                  const match = appState.songs.find(
                                    (song) =>
                                      song.title.toLowerCase() === value.trim().toLowerCase(),
                                  )
                                  if (match) {
                                    addSongToSection(section, match.title)
                                    ;(event.currentTarget as HTMLInputElement).value = ''
                                    return
                                  }
                                  openAddSongForSection(section, value)
                                  ;(event.currentTarget as HTMLInputElement).value = ''
                                }}
                                onBlur={(event) => {
                                  const value = event.currentTarget.value.trim()
                                  if (!value) return
                                  const match = appState.songs.find(
                                    (song) =>
                                      song.title.toLowerCase() === value.toLowerCase(),
                                  )
                                  if (!match) {
                                    openAddSongForSection(section, value)
                                    event.currentTarget.value = ''
                                  }
                                }}
                              />
                              <datalist id={`section-song-${section}`}>
                                {appState.songs
                                  .filter((song) => hasSongTag(song, section))
                                  .map((song) => (
                                    <option key={song.id} value={song.title} />
                                  ))}
                              </datalist>
                          </div>
                          {starterPasteOpen[section as 'Dinner' | 'Latin' | 'Dance'] && (
                            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-[10px] text-slate-200">
                              <div className="text-[10px] text-slate-400">
                                One song per line. Format: Title – Artist (singers optional).
                              </div>
                              <textarea
                                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
                                rows={6}
                                placeholder={`Example:\nSeptember – Earth, Wind & Fire\nUptown Funk – Mark Ronson ft. Bruno Mars`}
                                value={
                                  starterPasteBySection[
                                    section as 'Dinner' | 'Latin' | 'Dance'
                                  ]
                                }
                                onChange={(event) =>
                                  setStarterPasteBySection((prev) => ({
                                    ...prev,
                                    [section]: event.target.value,
                                  }))
                                }
                              />
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                                  onClick={() =>
                                    importSectionFromPaste(
                                      section as 'Dinner' | 'Latin' | 'Dance',
                                      starterPasteBySection[
                                        section as 'Dinner' | 'Latin' | 'Dance'
                                      ],
                                    )
                                  }
                                >
                                  Import paste
                                </button>
                                <button
                                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                                  onClick={() => {
                                    setStarterPasteBySection((prev) => ({
                                      ...prev,
                                      [section]: '',
                                    }))
                                    setStarterPasteOpen((prev) => ({
                                      ...prev,
                                      [section]: false,
                                    }))
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-4 space-y-2">
                        {currentSetlist.songIds
                          .map((songId) => appState.songs.find((song) => song.id === songId))
                          .filter((song): song is Song => Boolean(song))
                          .filter((song) => hasSongTag(song, section))
                          .map((song) => (
                            <div key={song.id} className="space-y-2">
                              {draggedSectionSongId &&
                                draggedSectionSongId !== song.id &&
                                dragOverSectionSongId === song.id && (
                                  <div className="h-4 rounded-xl border border-dashed border-teal-300/70 bg-teal-300/15" />
                                )}
                              <div
                                role="button"
                                tabIndex={0}
                                draggable={
                                  !gigMode &&
                                  !buildCompletion[section.toLowerCase() as 'dinner' | 'latin' | 'dance']
                                }
                                className={`rounded-2xl border px-3 py-2 text-xs transition-all duration-300 ${
                                  gigMode ? 'cursor-pointer' : ''
                                } ${
                                  appState.currentSongId === song.id
                                    ? 'border-emerald-300/70 bg-emerald-400/15 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                                    : 'border-white/10 bg-slate-950/40'
                                } ${
                                  recentlyMovedSongId === song.id
                                    ? 'ring-2 ring-teal-300/80 bg-teal-300/20'
                                    : ''
                                }`}
                                onDragStart={(event) => {
                                  if (
                                    gigMode ||
                                    buildCompletion[
                                      section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                                    ]
                                  ) {
                                    event.preventDefault()
                                    return
                                  }
                                  setDraggedSectionSongId(song.id)
                                  setDragOverSectionSongId(null)
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData('text/plain', song.id)
                                }}
                                onDragOver={(event) => {
                                  if (
                                    gigMode ||
                                    buildCompletion[
                                      section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                                    ]
                                  ) {
                                    return
                                  }
                                  event.preventDefault()
                                  event.dataTransfer.dropEffect = 'move'
                                  setDragOverSectionSongId(song.id)
                                }}
                                onDrop={(event) => {
                                  if (
                                    gigMode ||
                                    buildCompletion[
                                      section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                                    ]
                                  ) {
                                    return
                                  }
                                  event.preventDefault()
                                  const fromId =
                                    draggedSectionSongId ?? event.dataTransfer.getData('text/plain')
                                  if (!fromId) return
                                  reorderSectionSongs(
                                    section as 'Dinner' | 'Latin' | 'Dance',
                                    fromId,
                                    song.id,
                                  )
                                  flashMovedSong(fromId)
                                  setDraggedSectionSongId(null)
                                  setDragOverSectionSongId(null)
                                }}
                                onDragEnd={() => {
                                  setDraggedSectionSongId(null)
                                  setDragOverSectionSongId(null)
                                }}
                              onClick={() => {
                                if (gigMode) {
                                  setGigCurrentSong(song.id)
                                  return
                                }
                                openSingerModal(song.id)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  if (!gigMode) {
                                    openSingerModal(song.id)
                                  }
                                }
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-base font-semibold md:text-lg">
                                    {song.title}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {song.artist}
                                  </div>
                                  {!gigMode && currentSetlist && (() => {
                                    const assignments = getGigSingerAssignments(
                                      song.id,
                                      currentSetlist.id,
                                    )
                                    const singers = assignments.map((entry) => entry.singer)
                                    const keys = Array.from(
                                      new Set(assignments.map((entry) => entry.key)),
                                    )
                                    const label = !assignments.length
                                      ? 'No singers assigned?'
                                      : keys.length === 1
                                        ? `${singers.join(', ')} · Key: ${keys[0]}`
                                        : `${singers.join(', ')} · Multiple keys`
                                    return (
                                      <div
                                        className={`mt-2 text-[10px] ${
                                          assignments.length === 0 ? 'text-red-300' : 'text-teal-200'
                                        }`}
                                      >
                                        {label}
                                      </div>
                                    )
                                  })()}
                                </div>
                                <div className="flex items-center gap-2">
                                  {song.youtubeUrl && (
                                    <button
                                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        openAudioForUrl(song.youtubeUrl ?? '', 'YouTube audio')
                                      }}
                                      aria-label="Audio"
                                      title="Audio"
                                    >
                                      🎧
                                    </button>
                                  )}
                                  {hasDocsForSong(song.id) && (
                                    <button
                                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px] text-slate-200"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        openDocsForSong(song.id)
                                      }}
                                      aria-label="Documents"
                                      title="Documents"
                                    >
                                      📄
                                    </button>
                                  )}
                                  {!gigMode &&
                                    !buildCompletion[
                                      section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                                    ] && (
                                      <button
                                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px] text-red-200"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          requestRemoveSong(song.id)
                                        }}
                                        aria-label="Remove song"
                                        title="Remove song"
                                      >
                                        ✕
                                      </button>
                                    )}
                                </div>
                              </div>
                              {!gigMode &&
                                currentSetlist &&
                                (() => {
                                  const assignments = getGigSingerAssignments(
                                    song.id,
                                    currentSetlist.id,
                                  )
                                  const keys = Array.from(
                                    new Set(assignments.map((entry) => entry.key)),
                                  )
                                  if (keys.length <= 1) return null
                                  return (
                                    <button
                                      className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300/40 px-2 py-1 text-[10px] text-amber-200"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        setResolveSongId(song.id)
                                        setShowKeyResolveModal(true)
                                      }}
                                    >
                                      Resolve key
                                    </button>
                                  )
                                })()}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )
                })()}
            </div>
          </div>
        </div>
      )}


      {isAdmin && history.length > 0 && (
        <div
          className={`pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-teal-400/90 px-4 py-2 text-xs font-semibold text-slate-950 shadow-lg transition-opacity duration-500 ${
            showUndoToast ? 'opacity-100' : 'opacity-0'
          }`}
        >
          Change saved.
          <button className="pointer-events-auto ml-3 underline" onClick={undoLast}>
            Undo
          </button>
        </div>
      )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
}) {
  return (
    <button
      className={`flex min-h-[62px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-2 py-2 text-center ${
        active ? 'bg-teal-400/20 text-teal-200' : 'text-slate-300'
      }`}
      onClick={onClick}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="mt-1 text-xs font-semibold">{label}</span>
    </button>
  )
}

function getYouTubeEmbedUrl(url: string | null) {
  try {
    if (!url) return ''
    const parsed = new URL(url)
    if (parsed.hostname.includes('youtube.com')) {
      const id = parsed.searchParams.get('v')
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=1`
    }
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.replace('/', '')
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=1`
    }
  } catch (error) {
    return url ?? ''
  }
  return url ?? ''
}

function isYouTubeUrl(url: string | null) {
  try {
    if (!url) return false
    const parsed = new URL(url)
    return parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')
  } catch (error) {
    return false
  }
}

function getSpotifyEmbedUrl(url: string | null) {
  try {
    if (!url) return ''
    const parsed = new URL(url)
    if (parsed.hostname.includes('open.spotify.com')) {
      return `https://open.spotify.com/embed${parsed.pathname}`
    }
  } catch (error) {
    return url ?? ''
  }
  return url ?? ''
}

export default App
