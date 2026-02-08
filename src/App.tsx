import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseEnabled, supabase, supabaseEnvStatus } from './lib/supabaseClient'

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
  const [bannerTouchStartX, setBannerTouchStartX] = useState<number | null>(null)
  const [newDocSongId, setNewDocSongId] = useState('')
  const [newDocSongTitle, setNewDocSongTitle] = useState('')
  const [newDocType, setNewDocType] = useState<'Chart' | 'Lyrics' | 'Lead Sheet'>('Chart')
  const [newDocInstrument, setNewDocInstrument] = useState('')
  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocUrl, setNewDocUrl] = useState('')
  const [newDocFile, setNewDocFile] = useState<File | null>(null)
  const [newDocLyrics, setNewDocLyrics] = useState('')
  const [showDeleteGigConfirm, setShowDeleteGigConfirm] = useState(false)
  const [pendingDeleteGigId, setPendingDeleteGigId] = useState<string | null>(null)
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
  >({})
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

  const filteredInstruments = instrumentCatalog.filter((instrument) =>
    instrument.toLowerCase().includes(instrumentFilter.toLowerCase()),
  )

  const currentSetlist = useMemo(
    () => appState.setlists.find((setlist) => setlist.id === selectedSetlistId),
    [appState.setlists, selectedSetlistId],
  )

  const gigVocalists = useMemo(() => {
    if (!currentSetlist) return []
    const gigMusicianIds = new Set(
      appState.gigMusicians
        .filter((entry) => entry.gigId === currentSetlist.id)
        .map((entry) => entry.musicianId),
    )
    return appState.musicians
      .filter((musician) => gigMusicianIds.has(musician.id))
      .filter((musician) => Boolean(musician.singer))
  }, [appState.gigMusicians, appState.musicians, currentSetlist])

  const isEditSongDirty = useMemo(() => {
    if (!editingSongId || !editSongBaselineRef.current) return false
    const baseline = editSongBaselineRef.current
    const normalizeTags = (tags: string[]) => [...tags].sort().join('|')
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
        : bySearch.filter((song) => activeTags.every((tag) => song.tags.includes(tag)))
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
      .filter((song) => song.tags.includes(section)).length
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
        .filter((song) => song.tags.includes(section)).length
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
    setBuildPanelDirty(true)
    setBuildCompleteOverrides((prev) => ({
      ...prev,
      [currentSetlist.id]: {
        ...(prev[currentSetlist.id] ?? {}),
        [panel]: value,
      },
    }))
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
    if (!buildCompletion.musicians || gigVocalists.length === 0) {
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
    const normalizedKey = keyValue.trim() || song.originalKey?.trim() || ''
    if (!singerName || !normalizedKey) return
    const existingKey = song.keys.find((key) => key.singer === singerName)
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
      setRole('admin')
      localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
      return
    }
    if (loginInput === USER_PASSWORD) {
      setRole('user')
      localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
      return
    }
  }

  const handleLogout = () => {
    setRole(null)
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

  const duplicateSetlist = (setlistId: string) => {
    const source = appState.setlists.find((setlist) => setlist.id === setlistId)
    if (!source) return
    const newId = createId()
    commitChange('Duplicate setlist', (prev) => {
      const duplicate: Setlist = {
        ...source,
        id: newId,
        gigName: `${source.gigName} (Copy)`,
        date: new Date().toISOString().slice(0, 10),
      }
      return { ...prev, setlists: [duplicate, ...prev.setlists] }
    })
    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigs').insert({
          id: newId,
          gig_name: `${source.gigName} (Copy)`,
          gig_date: new Date().toISOString().slice(0, 10),
        }),
      )
      if (source.songIds.length) {
        runSupabase(
          supabase.from('SetlistGigSongs').insert(
            source.songIds.map((songId, index) => ({
              id: createId(),
              gig_id: newId,
              song_id: songId,
              sort_order: index,
            })),
          ),
        )
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
    setBuildPanelDirty(true)
    commitChange('Add songs', (prev) => ({
      ...prev,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? { ...setlist, songIds: [...setlist.songIds, ...selectedSongIds] }
          : setlist,
      ),
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigSongs').insert(
          selectedSongIds.map((songId, index) => ({
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

  const importSectionFromGig = (section: string, gigId: string) => {
    const source = appState.setlists.find((setlist) => setlist.id === gigId)
    if (!source || !currentSetlist) return
    setBuildPanelDirty(true)
    const sectionSongIds = source.songIds.filter((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      return song?.tags.includes(section)
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
        if (!found.tags.includes(section)) {
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
        item.id === song.id && !item.tags.includes(section)
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
      if (!song.tags.includes(section)) {
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

  const importRosterToGig = () => {
    if (!activeGigId) return
    setBuildPanelDirty(true)
    commitChange('Import roster', (prev) => ({
      ...prev,
      gigMusicians: [
        ...prev.gigMusicians.filter((gm) => gm.gigId !== activeGigId),
        ...prev.musicians.map((musician) => ({
          gigId: activeGigId,
          musicianId: musician.id,
          status: 'active' as const,
        })),
      ],
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigMusicians').delete().eq('gig_id', activeGigId),
      )
      runSupabase(
        supabase.from('SetlistGigMusicians').insert(
          appState.musicians.map((musician) => ({
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
    setNewDocType('Chart')
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

  const saveDocumentFromEditor = async (clearAfter: boolean) => {
    const trimmedTitle = newDocSongTitle.trim()
    const selectedSong =
      appState.songs.find((item) => item.id === newDocSongId) ??
      appState.songs.find(
        (item) => item.title.toLowerCase() === trimmedTitle.toLowerCase(),
      )
    if (!selectedSong) {
      setDocFormError('Select a song to attach this document.')
      return
    }
    setDocFormError('')
    const instrument = newDocInstrument.trim() || 'All'
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
      setNewDocType('Chart')
      setNewDocInstrument('')
      setNewDocTitle('')
      setNewDocUrl('')
      setNewDocFile(null)
      setNewDocLyrics('')
    } else {
      setNewDocFile(null)
    }
  }

  const addDocumentToSong = async () => {
    await saveDocumentFromEditor(true)
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
    setSongFormError('')
    const id = createId()
    const tags = newSongTags
    const createdSong: Song = {
      id,
      title,
      artist,
      originalKey: newSongOriginalKey.trim(),
      youtubeUrl: newSongAudio.trim() || '',
      tags,
      keys: [],
      specialPlayedCount: 0,
    }
    commitChange('Add song', (prev) => ({
      ...prev,
      songs: [createdSong, ...prev.songs],
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, ...tags])),
    }))
    if (supabase) {
      runSupabase(
        supabase.from('SetlistSongs').insert({
          id,
          title,
          artist: artist || null,
          audio_url: newSongAudio.trim() || null,
          original_key: newSongOriginalKey.trim() || null,
        }),
      )
      if (tags.length) {
        runSupabase(
          supabase.from('SetlistSongTags').insert(
            tags.map((tag) => ({
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
  }

  const startEditSong = (song: Song) => {
    setEditingSongId(song.id)
    setEditingSongTitle(song.title)
    setEditingSongArtist(song.artist ?? '')
    setEditingSongAudio(song.youtubeUrl ?? '')
    setEditingSongOriginalKey(song.originalKey ?? '')
    setEditingSongTags(song.tags ?? [])
    editSongBaselineRef.current = {
      title: song.title ?? '',
      artist: song.artist ?? '',
      audio: song.youtubeUrl ?? '',
      originalKey: song.originalKey ?? '',
      tags: song.tags ?? [],
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

  const saveEditSong = () => {
    if (!editingSongId) return
    const title = editingSongTitle.trim()
    if (!title) return
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
              tags: editingSongTags,
            }
          : song,
      ),
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, ...editingSongTags])),
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistSongs')
          .update({
            title,
            artist: editingSongArtist.trim() || null,
            audio_url: editingSongAudio.trim() || null,
            original_key: editingSongOriginalKey.trim() || null,
          })
          .eq('id', editingSongId),
      )
      runSupabase(
        supabase.from('SetlistSongTags').delete().eq('song_id', editingSongId),
      )
      if (editingSongTags.length) {
        runSupabase(
          supabase.from('SetlistSongTags').insert(
            editingSongTags.map((tag) => ({
              id: createId(),
              song_id: editingSongId,
              tag,
            })),
          ),
        )
      }
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
    gigSongsRes.data?.forEach((row) => {
      if (!songIdSet.has(row.song_id)) return
      const list = gigSongsByGig.get(row.gig_id) ?? []
      list.push(row.song_id)
      gigSongsByGig.set(row.gig_id, list)
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

  const screenHeader = (
    <div className="sticky top-0 z-[70]">
      <header className="border-b border-white/10 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
              Setlist Connect
            </p>
            <h1 className="text-lg font-semibold text-white">Gig Center</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            {installPrompt && !isInstalled && (
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
            <button
              className="rounded-full bg-slate-950/30 px-4 py-2 text-sm"
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
      )}
    </div>
  )

  const hasTodayGig = appState.setlists.some(
    (setlist) => setlist.date === new Date().toISOString().slice(0, 10),
  )

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
    if (!isSupabaseEnabled || !supabase) return
    void loadSupabaseData()
  }, [loadSupabaseData])

  useEffect(() => {
    if (!editingSongId) return
    if (!newDocSongId) return
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
    const stored = localStorage.getItem('setlist_build_complete')
    if (stored) {
      try {
        setBuildCompleteOverrides(JSON.parse(stored))
      } catch {
        localStorage.removeItem('setlist_build_complete')
      }
    }
  }, [])

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
      Boolean(editingSongId)
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
  ])

  if (!role) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
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
    <div className="relative min-h-screen bg-slate-950 text-white">
      {gigMode && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950 via-yellow-900/50 to-slate-950" />
      )}
      <div className="relative">
      {screenHeader}
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
          className="fixed inset-0 z-40 flex items-center bg-slate-950/80"
          onClick={() => setAppState((prev) => ({ ...prev, instrument: 'All' }))}
        >
          <div
            className="mx-auto w-full max-w-md rounded-t-3xl bg-slate-900 p-6 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Select your instrument</h2>
            <p className="mt-1 text-sm text-slate-300">
              Charts and lead sheets will filter to your part.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {INSTRUMENTS.map((instrument) => (
                <button
                  key={instrument}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                  onClick={() =>
                    setAppState((prev) => ({ ...prev, instrument }))
                  }
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
      )}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-24 pt-6">
        {screen === 'setlists' && (
          <section className="flex flex-col gap-5">
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-white/0 p-5">
              <h2 className="text-xl font-semibold">Upcoming gigs</h2>
              <p className="mt-1 text-sm text-slate-300">
                Duplicate a previous setlist, or jump straight into editing.
              </p>
              <div className="mt-4 flex flex-col gap-3">
                {appState.setlists.map((setlist) => {
                  const isToday = setlist.date === new Date().toISOString().slice(0, 10)
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
                      setScreen('builder')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedSetlistId(setlist.id)
                        setScreen('builder')
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{setlist.gigName}</h3>
                        <p className="text-xs text-slate-400">{setlist.date}</p>
                        {isToday && (
                          <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-teal-400/20 px-2 py-1 text-[10px] uppercase tracking-wide text-teal-200">
                            Today’s gig
                          </span>
                        )}
                      </div>
                      <div className="h-7 w-7" />
                    </div>
                    {isAdmin && (
                      <div className="mt-3 flex items-center gap-3 text-xs">
                        <button
                          className="text-teal-300"
                          onClick={(event) => {
                            event.stopPropagation()
                            duplicateSetlist(setlist.id)
                          }}
                        >
                          Duplicate setlist
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
                    {isAdmin ? 'Setlist' : 'Gig'}
                  </p>
                  {isAdmin ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <input
                        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-lg font-semibold text-white"
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
                      <div className="flex flex-col gap-2 md:flex-row">
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 md:w-[180px]"
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
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-200"
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
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-xl font-semibold">{currentSetlist.gigName}</h2>
                      <p className="text-xs text-slate-400">{currentSetlist.date}</p>
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

            {!isAdmin && (
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
                {isAdmin && (
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
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-slate-200"
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
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-slate-200"
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
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Singers
                      </label>
                    <div className="flex flex-wrap gap-2">
                        {appState.singersCatalog.map((singer) => {
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
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                        placeholder="e.g. F#m"
                        value={pendingSpecialKey}
                        onChange={(event) => setPendingSpecialKey(event.target.value)}
                      disabled={pendingSpecialDjOnly}
                      />
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Info note
                      </label>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
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
                      className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
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

            {!isAdmin && (
            <div className="grid gap-4 md:grid-cols-3">
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
                    <h3 className="text-sm font-semibold whitespace-nowrap">{section} Set</h3>
                    {isAdmin && (
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
                  {isAdmin && (
                    <details className="mt-3">
                      <summary className="inline-flex cursor-pointer items-center rounded-xl border border-white/10 px-2 py-1 text-[10px] text-slate-200">
                        Add song
                      </summary>
                        {!gigMode && (
                          <div className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 p-2 text-[10px] text-slate-200 shadow-xl">
                            <input
                              className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1"
                              placeholder="Choose a song"
                              list={`section-song-${section}`}
                              onChange={(event) => {
                                if (event.target.value) {
                                  addSongToSection(section, event.target.value)
                                  event.currentTarget.value = ''
                                }
                              }}
                            />
                            <datalist id={`section-song-${section}`}>
                              {appState.songs
                                .filter((song) => song.tags.includes(section))
                                .map((song) => (
                                  <option key={song.id} value={song.title} />
                                ))}
                            </datalist>
                          </div>
                        )}
                    </details>
                  )}
                  <div className="mt-3 space-y-2">
                    {currentSetlist.songIds
                      .map((songId) => appState.songs.find((song) => song.id === songId))
                      .filter((song): song is Song => Boolean(song))
                      .filter((song) => song.tags.includes(section))
                      .map((song) => (
                        <div
                          key={song.id}
                          className={`rounded-2xl border px-3 py-2 text-xs ${
                            gigMode ? 'cursor-pointer' : ''
                          } ${
                            appState.currentSongId === song.id
                              ? 'border-emerald-300/70 bg-emerald-400/15 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                              : 'border-white/10 bg-slate-950/40'
                          }`}
                          onClick={() => {
                            if (gigMode) {
                              setGigCurrentSong(song.id)
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-base font-semibold md:text-lg">
                                {song.title}
                              </div>
                              <div className="text-[10px] text-slate-400">{song.artist}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {song.youtubeUrl && (
                                <button
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-[12px] text-slate-200"
                                  onClick={() =>
                                    openAudioForUrl(song.youtubeUrl ?? '', 'YouTube audio')
                                  }
                                  aria-label="Audio"
                                  title="Audio"
                                >
                                  🔊
                                </button>
                              )}
                              {hasDocsForSong(song.id) && (
                                <button
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-[12px] text-slate-200"
                                  onClick={() => openDocsForSong(song.id)}
                                  aria-label="Documents"
                                  title="Documents"
                                >
                                  📄
                                </button>
                              )}
                              {isAdmin &&
                                !gigMode &&
                                !buildCompletion[
                                  section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                                ] && (
                                <button
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-[12px] text-red-200"
                                  onClick={() => removeSongFromSetlist(song.id)}
                                  aria-label="Remove song"
                                  title="Remove song"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    {currentSetlist.songIds.length === 0 && (
                      <div className="text-xs text-slate-500">
                        Add songs to this setlist first.
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
                </div>
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setScreen('builder')}
                >
                  Back
                </button>
              </div>
            </div>

            {isAdmin && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <div className="mt-4 space-y-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <h3 className="text-sm font-semibold">Add new song</h3>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
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
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <button
                        type="button"
                        className="w-full rounded-xl bg-teal-400/90 py-2 text-sm font-semibold text-slate-950"
                        onClick={() => addSongFromAdmin(false)}
                      >
                        Add song
                      </button>
                      <button
                        type="button"
                        className="w-full rounded-xl border border-white/10 py-2 text-sm text-slate-200"
                        onClick={() => addSongFromAdmin(true)}
                      >
                        Add + attach charts/lyrics
                      </button>
                      {songFormError && (
                        <div className="md:col-span-2 text-xs text-red-200">
                          {songFormError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              {appState.songs.map((song) => (
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
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
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
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
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
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-base"
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
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-base"
                                href={`tel:${musician.phone}`}
                                title="Call"
                                onClick={(event) => event.stopPropagation()}
                              >
                                📞
                              </a>
                              <a
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-base"
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
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 text-sm">
          <NavButton active={screen === 'setlists'} onClick={() => setScreen('setlists')}>
            Home
          </NavButton>
          <NavButton active={screen === 'builder'} onClick={() => setScreen('builder')}>
            {isAdmin ? 'Build' : 'Setlist'}
          </NavButton>
          <NavButton active={screen === 'song'} onClick={() => setScreen('song')}>
            Songs
          </NavButton>
          {isAdmin && (
            <NavButton active={screen === 'musicians'} onClick={() => setScreen('musicians')}>
              Musicians
            </NavButton>
          )}
        </div>
      </nav>

      {showInstrumentPrompt && pendingDocSongId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4"
          onClick={() => {
            setShowInstrumentPrompt(false)
            setPendingDocSongId(null)
          }}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Choose instrument</h3>
            <p className="mt-1 text-sm text-slate-300">
              Pick your instrument to open the right chart or lyrics.
            </p>
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
      )}

      {docModalSongId && (
        <div
          className="fixed inset-0 z-40 flex items-center bg-slate-950/80"
          onClick={() => {
            setDocModalSongId(null)
            setDocModalContent(null)
          }}
        >
          <div
            className="mx-auto w-full max-w-md overflow-hidden rounded-t-3xl bg-slate-900 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">
                {docModalContent ? 'Song Lyrics' : 'Song documents'}
              </h3>
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
            <div className="max-h-[70vh] overflow-auto px-6 pb-6">
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
          className="fixed inset-0 z-40 flex items-center bg-slate-950/80"
          onClick={() => setAudioModalUrl(null)}
        >
          <div
            className="mx-auto w-full max-w-md rounded-3xl bg-slate-900 p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{audioModalLabel}</h3>
              <button
                className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                onClick={() => setAudioModalUrl(null)}
              >
                Close
              </button>
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
                  <audio className="w-full" controls src={audioModalUrl} />
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
            <p className="mt-3 text-xs text-slate-400">
              Audio opens inside the app for practice.
            </p>
          </div>
        </div>
      )}

      {isAdmin && editingMusicianId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4"
          onClick={cancelEditMusician}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Musician</p>
                <h3 className="text-lg font-semibold">Edit musician</h3>
              </div>
              <div className="flex items-center gap-2">
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

            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-5">
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
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4"
          onClick={cancelDeleteGig}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Delete this gig?</h3>
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
      )}

      {showSingerWarning && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4"
          onClick={() => setShowSingerWarning(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Assign musicians first</h3>
            <p className="mt-2 text-sm text-slate-300">
              Add vocalists to this gig and mark the Musicians section complete before
              assigning singers and keys to songs.
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
      )}

      {editingSongId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4"
          onClick={cancelEditSong}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Song</p>
                <h3 className="text-lg font-semibold">Edit song</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={isEditSongDirty ? saveEditSong : cancelEditSong}
                >
                  {isEditSongDirty ? 'Save' : 'Close'}
                </button>
                <button
                  className="min-w-[92px] rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-200"
                  onClick={() => deleteSong(editingSongId)}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-5">
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
                  const active = editingSongTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                        active
                          ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                          : 'border-white/10 text-slate-300'
                      }`}
                      onClick={() =>
                        setEditingSongTags((current) =>
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
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <select
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                  value={newDocType}
                  onChange={(event) =>
                    setNewDocType(event.target.value as 'Chart' | 'Lyrics' | 'Lead Sheet')
                  }
                >
                  <option value="Chart">Chart</option>
                  <option value="Lyrics">Lyrics</option>
                  <option value="Lead Sheet">Lead sheet</option>
                </select>
                <input
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                  placeholder="Instrument (e.g. Vocals, Guitar)"
                  list="instrument-docs"
                  value={newDocInstrument}
                  onChange={(event) => setNewDocInstrument(event.target.value)}
                />
                {newDocType !== 'Lyrics' && (
                  <input
                    className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm md:col-span-2"
                    placeholder="Document title (optional)"
                    value={newDocTitle}
                    onChange={(event) => setNewDocTitle(event.target.value)}
                  />
                )}
                {newDocType === 'Lyrics' && (
                  <textarea
                    className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-center md:col-span-2"
                    placeholder="Paste lyrics here"
                    value={newDocLyrics}
                    onChange={(event) => setNewDocLyrics(event.target.value)}
                    rows={6}
                  />
                )}
                {newDocType !== 'Lyrics' && (
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
                <input
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm md:col-span-2"
                  placeholder="Or paste a file link (optional)"
                  value={newDocUrl}
                  onChange={(event) => setNewDocUrl(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="mt-3 w-full rounded-xl bg-teal-400/90 py-2 text-sm font-semibold text-slate-950"
                onClick={addDocumentToSong}
              >
                {newDocType === 'Lyrics' ? 'Save lyrics' : 'Save document'}
              </button>
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
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4"
          onClick={() => setActiveBuildPanel(null)}
        >
          <div
            className={`w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900 bg-gradient-to-br ${buildPanelGradient}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
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
              <div className="flex flex-col items-end gap-2">
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
            <div className="max-h-[75vh] overflow-auto px-5 py-4">
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
                    <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                      <div className="text-sm font-semibold">Singers for this gig</div>
                      <p className="mt-1 text-xs text-slate-400">
                        Assign vocalists and keys per song. Original key is the reference.
                      </p>
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
                        <div className="mt-4 space-y-3">
                          {currentSetlist.songIds
                            .map((songId) => appState.songs.find((song) => song.id === songId))
                            .filter((song): song is Song => Boolean(song))
                            .map((song) => {
                              const gigAssignments = song.keys.filter(
                                (key) => key.gigOverrides[currentSetlist.id],
                              )
                              const pendingRows = pendingSingerAssignments[song.id] ?? [
                                { singer: '', key: '' },
                              ]
                              return (
                                <div
                                  key={song.id}
                                  className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-semibold">{song.title}</div>
                                      <div className="text-[10px] text-slate-400">
                                        Original key: {song.originalKey || '—'}
                                      </div>
                                    </div>
                                  </div>
                                  {gigAssignments.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-300">
                                      {gigAssignments.map((key) => (
                                        <span
                                          key={key.singer}
                                          className="rounded-full border border-white/10 px-2 py-1"
                                        >
                                          {key.singer} · {key.gigOverrides[currentSetlist.id]}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="mt-3 space-y-2">
                                    {pendingRows.map((pending, index) => {
                                      const selectedKey = song.keys.find(
                                        (key) => key.singer === pending.singer,
                                      )
                                      const suggestion =
                                        selectedKey?.defaultKey || song.originalKey || ''
                                      return (
                                        <div
                                          key={`${song.id}-${index}`}
                                          className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_auto]"
                                        >
                                          <select
                                            className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
                                            value={pending.singer}
                                            onChange={(event) => {
                                              if (!ensureVocalistsReady()) return
                                              const singer = event.target.value
                                              const existing = song.keys.find(
                                                (key) => key.singer === singer,
                                              )
                                              setPendingSingerAssignments((prev) => {
                                                const nextRows = [...pendingRows]
                                                nextRows[index] = {
                                                  singer,
                                                  key:
                                                    existing?.gigOverrides[currentSetlist.id] ??
                                                    existing?.defaultKey ??
                                                    song.originalKey ??
                                                    '',
                                                }
                                                return { ...prev, [song.id]: nextRows }
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
                                            placeholder={`Key ${
                                              suggestion ? `(${suggestion})` : ''
                                            }`}
                                            value={pending.key}
                                            onChange={(event) =>
                                              setPendingSingerAssignments((prev) => {
                                                const nextRows = [...pendingRows]
                                                nextRows[index] = {
                                                  singer: pending.singer,
                                                  key: event.target.value,
                                                }
                                                return { ...prev, [song.id]: nextRows }
                                              })
                                            }
                                          />
                                          <button
                                            className="rounded-xl bg-teal-400/90 px-3 py-2 text-xs font-semibold text-slate-950"
                                            onClick={() =>
                                              saveSingerAssignment(
                                                song.id,
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
                                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                                    <span>Multiple vocalists supported.</span>
                                    <button
                                      className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-200"
                                      onClick={() =>
                                        setPendingSingerAssignments((prev) => ({
                                          ...prev,
                                          [song.id]: [
                                            ...(prev[song.id] ?? pendingRows),
                                            { singer: '', key: '' },
                                          ],
                                        }))
                                      }
                                    >
                                      Add vocalist
                                    </button>
                                  </div>
                                  {pendingRows.some(
                                    (row) =>
                                      row.singer &&
                                      !song.keys.find((key) => key.singer === row.singer),
                                  ) && (
                                    <div className="mt-2 text-[10px] text-amber-200">
                                      New singer for this song. Use the original key as a
                                      starting point.
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                        </div>
                      )}
                    </div>
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
                            className={`grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr] ${
                              gigMode ? 'cursor-pointer' : ''
                            }`}
                            onClick={() => {
                              if (gigMode && request.songId) {
                                setGigCurrentSong(request.songId)
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
                                    🎧
                                  </button>
                                )}
                                {hasDocsForSong(song?.id) && (
                                  <button
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-slate-200"
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
                        <div className="mt-3">
                          {!starterPasteOpen[section as 'Dinner' | 'Latin' | 'Dance'] ? (
                            <button
                              className="rounded-xl border border-white/10 px-2 py-1 text-[10px] text-slate-200"
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
                                  className="rounded-xl bg-teal-400/90 px-3 py-2 text-xs font-semibold text-slate-950"
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
                                  className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200"
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
                      {!buildCompletion[
                        section.toLowerCase() as 'dinner' | 'latin' | 'dance'
                      ] && !gigMode && (
                        <details className="mt-3">
                          <summary className="inline-flex cursor-pointer items-center rounded-xl border border-white/10 px-2 py-1 text-[10px] text-slate-200">
                            Add song
                          </summary>
                          <div className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 p-2 text-[10px] text-slate-200 shadow-xl">
                            <input
                              className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1"
                              placeholder="Choose a song"
                              list={`section-song-${section}`}
                              onChange={(event) => {
                                if (event.target.value) {
                                  addSongToSection(section, event.target.value)
                                  event.currentTarget.value = ''
                                }
                              }}
                            />
                            <datalist id={`section-song-${section}`}>
                              {appState.songs
                                .filter((song) => song.tags.includes(section))
                                .map((song) => (
                                  <option key={song.id} value={song.title} />
                                ))}
                            </datalist>
                          </div>
                        </details>
                      )}
                      <div className="mt-4 space-y-2">
                        {currentSetlist.songIds
                          .map((songId) => appState.songs.find((song) => song.id === songId))
                          .filter((song): song is Song => Boolean(song))
                          .filter((song) => song.tags.includes(section))
                          .map((song) => (
                            <div
                              key={song.id}
                              className={`rounded-2xl border px-3 py-2 text-xs ${
                                gigMode ? 'cursor-pointer' : ''
                              } ${
                                appState.currentSongId === song.id
                                  ? 'border-emerald-300/70 bg-emerald-400/15 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                                  : 'border-white/10 bg-slate-950/40'
                              }`}
                              onClick={() => {
                                if (gigMode) {
                                  setGigCurrentSong(song.id)
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
                                </div>
                                <div className="flex items-center gap-2">
                                  {song.youtubeUrl && (
                                    <button
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
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
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-[12px] text-slate-200"
                                      onClick={() => openDocsForSong(song.id)}
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
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-[12px] text-red-200"
                                        onClick={() => removeSongFromSetlist(song.id)}
                                        aria-label="Remove song"
                                        title="Remove song"
                                      >
                                        ✕
                                      </button>
                                    )}
                                </div>
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
          className={`fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-teal-400/90 px-4 py-2 text-xs font-semibold text-slate-950 shadow-lg transition-opacity duration-500 ${
            showUndoToast ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          Change saved.
          <button className="ml-3 underline" onClick={undoLast}>
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
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      className={`rounded-full px-4 py-2.5 text-base font-semibold ${
        active ? 'bg-teal-400/20 text-teal-200' : 'text-slate-300'
      }`}
      onClick={onClick}
    >
      {children}
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
