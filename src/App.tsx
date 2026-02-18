import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
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

type Band = {
  id: string
  name: string
  createdBy?: string
}

type BandMembership = {
  id: string
  bandId: string
  userId: string
  role: 'admin' | 'member'
  status: 'active' | 'invited' | 'revoked'
  musicianId?: string
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

type SharedPlaylistView = {
  setlistId: string
  bandName?: string
  gigName: string
  date: string
  venueAddress?: string
  musicians?: Musician[]
  entries: PlaylistEntry[]
}

type DocumentSelectionItem = {
  id: string
  songId: string
  type: 'Chart' | 'Lyrics' | 'Lead Sheet'
  instrument: string
  title: string
  url?: string
  content?: string
  instruments: string[]
  sourceDocIds: string[]
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
  instrument: string[] | null
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
const INSTRUMENTAL_LABEL = 'Instrumental'
const DEFAULT_TAGS = ['Special Request', 'Dinner', 'Latin', 'Dance']
const DEFAULT_SPECIAL_TYPES = ['First Dance', 'Last Dance', 'Parent Dance', 'Anniversary']
const REQUEST_TYPE_TAG_EXCLUSIONS = [
  'Special Request',
  'Special Requests',
  'Additional Request',
  'Bride/Father',
  'Bride/Father Dance',
  'First Dance',
  'Last Dance',
  'Parent Dance',
  'Wedding Party Intro',
  'Anniversary',
  'Anniversary Dance',
  'Hora',
  'HORA',
  'HORA!',
]
const SETLIST_PANEL_PREFIX = 'set:'
const ACTIVE_BAND_KEY = 'setlist:activeBandId'
const GIG_LOCKED_SONGS_KEY = 'setlist:gigLockedSongs'
const GIG_LAST_LOCKED_SONG_KEY = 'setlist:gigLastLockedSong'
const GIG_SECTION_TAG_PREFIX = '__gigsection__'

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

const chunkList = <T,>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks.length ? chunks : [[]]
}

function App() {
  const [role, setRole] = useState<Role>(null)
  const [gigMode, setGigMode] = useState(false)
  const [showGigModeLaunchModal, setShowGigModeLaunchModal] = useState(false)
  const [showGigSetlistSheet, setShowGigSetlistSheet] = useState(false)
  const [gigSheetSongSearch, setGigSheetSongSearch] = useState('')
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
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null)
  const [bands, setBands] = useState<Band[]>([])
  const [memberships, setMemberships] = useState<BandMembership[]>([])
  const [activeBandId, setActiveBandId] = useState<string>(() =>
    localStorage.getItem(ACTIVE_BAND_KEY) ?? '',
  )
  const [newBandName, setNewBandName] = useState('')
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteMusicianId, setInviteMusicianId] = useState('')
  const [inviteCreateResult, setInviteCreateResult] = useState<string | null>(null)
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
  const [specialRequestError, setSpecialRequestError] = useState('')
  const [showSpecialRequestModal, setShowSpecialRequestModal] = useState(false)
  const [editingSpecialRequestId, setEditingSpecialRequestId] = useState<string | null>(null)
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([])
  const [docModalSongId, setDocModalSongId] = useState<string | null>(null)
  const [docModalContent, setDocModalContent] = useState<Document | null>(null)
  const [docModalPageIndex, setDocModalPageIndex] = useState(0)
  const [docSwipeStartX, setDocSwipeStartX] = useState<number | null>(null)
  const [pendingDocSongId, setPendingDocSongId] = useState<string | null>(null)
  const [showInstrumentPrompt, setShowInstrumentPrompt] = useState(false)
  const [instrumentSelectionDraft, setInstrumentSelectionDraft] = useState<string[]>([])
  const [docInstrumentDraft, setDocInstrumentDraft] = useState<string[]>([])
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [dismissedUpNextId, setDismissedUpNextId] = useState<string | null>(null)
  const [audioModalUrl, setAudioModalUrl] = useState<string | null>(null)
  const [audioModalLabel, setAudioModalLabel] = useState('Audio player')
  const [audioPlaybackRate, setAudioPlaybackRate] = useState(1)
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
  const [activeGigId, setActiveGigId] = useState(initialSetlistId)
  const [nowPlayingByGig, setNowPlayingByGig] = useState<Record<string, string | null>>({})
  const [gigLockedSongIdsByGig, setGigLockedSongIdsByGig] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(GIG_LOCKED_SONGS_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const next: Record<string, string[]> = {}
      Object.entries(parsed).forEach(([gigId, value]) => {
        if (!Array.isArray(value)) return
        next[gigId] = value.filter((item): item is string => typeof item === 'string')
      })
      return next
    } catch {
      return {}
    }
  })
  const [gigLastLockedSongByGig, setGigLastLockedSongByGig] = useState<Record<string, string | null>>(
    () => {
      try {
        const raw = localStorage.getItem(GIG_LAST_LOCKED_SONG_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const next: Record<string, string | null> = {}
        Object.entries(parsed).forEach(([gigId, value]) => {
          next[gigId] = typeof value === 'string' ? value : null
        })
        return next
      } catch {
        return {}
      }
    },
  )
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
  const [newDocInstruments, setNewDocInstruments] = useState<string[]>([])
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
  const [sharedPlaylistView, setSharedPlaylistView] = useState<SharedPlaylistView | null>(null)
  const [sharedPlaylistLoading, setSharedPlaylistLoading] = useState(false)
  const [sharedPlaylistError, setSharedPlaylistError] = useState<string | null>(null)
  const [sharedPublicTab, setSharedPublicTab] = useState<'setlist' | 'playlist'>('setlist')
  const [sharedGigMusicians, setSharedGigMusicians] = useState<Musician[]>([])
  const [sharedDocuments, setSharedDocuments] = useState<Document[]>([])
  const [sharedDocsLoading, setSharedDocsLoading] = useState(false)
  const [sharedDocsError, setSharedDocsError] = useState<string | null>(null)
  const [sharedGigFlashPulse, setSharedGigFlashPulse] = useState(false)
  const [playlistSingerFilter, setPlaylistSingerFilter] = useState('__all__')
  const [playlistShareStatus, setPlaylistShareStatus] = useState('')
  const playlistShareTimerRef = useRef<number | null>(null)
  const [playlistDrawerOverlay, setPlaylistDrawerOverlay] = useState(false)
  const [sharedPlaylistDrawerOverlay, setSharedPlaylistDrawerOverlay] = useState(false)
  const [playlistDrawerDockTop, setPlaylistDrawerDockTop] = useState(240)
  const [sharedPlaylistDrawerDockTop, setSharedPlaylistDrawerDockTop] = useState(240)
  const playlistPlayerBlockRef = useRef<HTMLDivElement | null>(null)
  const sharedPlaylistPlayerBlockRef = useRef<HTMLDivElement | null>(null)
  const playlistDrawerTouchStartYRef = useRef<number | null>(null)
  const sharedPlaylistDrawerTouchStartYRef = useRef<number | null>(null)
  const playlistDrawerAutoCloseTimerRef = useRef<number | null>(null)
  const sharedPlaylistDrawerAutoCloseTimerRef = useRef<number | null>(null)
  const sharedNowPlayingSongIdRef = useRef<string | null>(null)
  const sharedFlashTimerRef = useRef<number | null>(null)
  const [showAddMusicianModal, setShowAddMusicianModal] = useState(false)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [draggedSectionSongId, setDraggedSectionSongId] = useState<string | null>(null)
  const [dragOverSectionSongId, setDragOverSectionSongId] = useState<string | null>(null)
  const [sheetDraggedSongId, setSheetDraggedSongId] = useState<string | null>(null)
  const [sheetDraggedFromSection, setSheetDraggedFromSection] = useState<string | null>(null)
  const [sheetDragOverSongId, setSheetDragOverSongId] = useState<string | null>(null)
  const [sheetDragOverSection, setSheetDragOverSection] = useState<string | null>(null)
  const [recentlyMovedSongId, setRecentlyMovedSongId] = useState<string | null>(null)
  const movedSongTimerRef = useRef<number | null>(null)
  const [activeBuildPanel, setActiveBuildPanel] = useState<string | null>(null)
  const [buildPanelDirty, setBuildPanelDirty] = useState(false)
  const [pendingSingerAssignments, setPendingSingerAssignments] = useState<
    Record<string, { singer: string; key: string }[]>
  >({})
  const [showSingerWarning, setShowSingerWarning] = useState(false)
  const [showMissingSingerWarning, setShowMissingSingerWarning] = useState(false)
  const [starterPasteBySection, setStarterPasteBySection] = useState<Record<string, string>>({})
  const [starterPasteOpen, setStarterPasteOpen] = useState<Record<string, boolean>>({})
  const [showManualSectionOrderModal, setShowManualSectionOrderModal] = useState(false)
  const [manualSectionOrderSection, setManualSectionOrderSection] = useState<string | null>(null)
  const [manualSectionOrderSelections, setManualSectionOrderSelections] = useState<string[]>([])
  const [manualSectionOrderError, setManualSectionOrderError] = useState('')
  const [buildCompleteOverrides, setBuildCompleteOverrides] = useState<
    Record<string, Record<string, boolean>>
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
  const [gigSetlistSections, setGigSetlistSections] = useState<Record<string, string[]>>(() => {
    const stored = localStorage.getItem('setlist_gig_sections')
    if (!stored) return {}
    try {
      return JSON.parse(stored)
    } catch {
      localStorage.removeItem('setlist_gig_sections')
      return {}
    }
  })
  const [showAddSetlistModal, setShowAddSetlistModal] = useState(false)
  const [newSetlistLabel, setNewSetlistLabel] = useState('')
  const [draggedSetlistSection, setDraggedSetlistSection] = useState<string | null>(null)
  const [dragOverSetlistSection, setDragOverSetlistSection] = useState<string | null>(null)
  const [showSectionAddSongsModal, setShowSectionAddSongsModal] = useState(false)
  const [sectionAddSongsSource, setSectionAddSongsSource] = useState('')
  const [sectionAddSongsTargets, setSectionAddSongsTargets] = useState<string[]>([])
  const [sectionAddSongsSearch, setSectionAddSongsSearch] = useState('')
  const [showDeleteSetlistSectionConfirm, setShowDeleteSetlistSectionConfirm] = useState(false)
  const [pendingDeleteSetlistSection, setPendingDeleteSetlistSection] = useState<string | null>(null)
  const [gigHiddenSetlistSections, setGigHiddenSetlistSections] = useState<Record<string, string[]>>(
    () => {
      const stored = localStorage.getItem('setlist_hidden_gig_sections')
      if (!stored) return {}
      try {
        return JSON.parse(stored)
      } catch {
        localStorage.removeItem('setlist_hidden_gig_sections')
        return {}
      }
    },
  )
  const [gigHiddenSpecialSection, setGigHiddenSpecialSection] = useState<Record<string, boolean>>(
    () => {
      const stored = localStorage.getItem('setlist_hidden_special_section')
      if (!stored) return {}
      try {
        return JSON.parse(stored)
      } catch {
        localStorage.removeItem('setlist_hidden_special_section')
        return {}
      }
    },
  )
  const [specialRequestOrderByGig, setSpecialRequestOrderByGig] = useState<
    Record<string, string[]>
  >(() => {
    const stored = localStorage.getItem('setlist_special_request_order')
    if (!stored) return {}
    try {
      return JSON.parse(stored)
    } catch {
      localStorage.removeItem('setlist_special_request_order')
      return {}
    }
  })
  const [draggedSpecialRequestId, setDraggedSpecialRequestId] = useState<string | null>(null)
  const [dragOverSpecialRequestId, setDragOverSpecialRequestId] = useState<string | null>(null)
  const lastDocAutosaveRef = useRef('')
  const saveDocumentFromEditorRef = useRef<(clearAfter: boolean) => Promise<boolean>>(
    async () => false,
  )
  const editSongBaselineRef = useRef<{
    title: string
    artist: string
    audio: string
    originalKey: string
    tags: string[]
  } | null>(null)
  const [songFormError, setSongFormError] = useState('')
  const [docFormError, setDocFormError] = useState('')
  const [showDocInstrumentWarning, setShowDocInstrumentWarning] = useState(false)
  const [showDocUrlAccessWarning, setShowDocUrlAccessWarning] = useState(false)
  const [showGigLockedSongWarning, setShowGigLockedSongWarning] = useState(false)
  const [pendingResendGigSongId, setPendingResendGigSongId] = useState<string | null>(null)
  const [gigSongSectionOverrides, setGigSongSectionOverrides] = useState<
    Record<string, Record<string, string>>
  >({})
  const [, setLoginPhase] = useState<'login' | 'transition' | 'app'>('login')
  const loginTimerRef = useRef<number | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const sheetLongPressTimerRef = useRef<number | null>(null)
  const sheetLongPressTriggeredRef = useRef(false)
  const sheetDragOverSongRef = useRef<string | null>(null)
  const sheetDragOverSectionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!authLoading) return
    const timeout = window.setTimeout(() => {
      setAuthLoading(false)
      setAuthError((current) => current ?? 'Request timed out. Please try again.')
    }, 15000)
    return () => window.clearTimeout(timeout)
  }, [authLoading])

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
  const withBandId = <T extends Record<string, unknown>>(payload: T): T & { band_id: string } => ({
    ...payload,
    band_id: activeBandId,
  })

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
  const normalizeInstrumentName = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.toLowerCase() === 'saxophone') return 'Sax'
    return trimmed
  }
  const parseDocumentInstruments = useCallback((raw: string) => {
    const seen = new Set<string>()
    const normalized = raw
      .split('||')
      .map((item) => {
        const trimmed = item.trim()
        if (!trimmed) return ''
        if (trimmed.toLowerCase() === 'saxophone') return 'Sax'
        return trimmed
      })
      .filter((item) => {
        if (!item) return false
        const key = item.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    if (normalized.length === 0) return ['All']
    if (normalized.some((item) => item === 'All')) return ['All']
    return normalized
  }, [])
  const formatDocumentInstruments = (raw: string) => parseDocumentInstruments(raw).join(', ')
  const activeInstruments =
    appState.instrument && appState.instrument.length > 0 ? appState.instrument : ['All']
  const documentMatchesActiveInstruments = (doc: Document) => {
    if (role === 'admin') return true
    if (activeInstruments.includes('All')) return true
    const docInstruments = parseDocumentInstruments(doc.instrument)
    return docInstruments.includes('All')
      ? true
      : docInstruments.some((item) => activeInstruments.includes(item))
  }
  const getDocumentSelectionItems = (songId: string) => {
    const docs = appState.documents
      .filter((doc) => doc.songId === songId)
      .filter((doc) => documentMatchesActiveInstruments(doc))
    const grouped = new Map<string, DocumentSelectionItem>()
    docs.forEach((doc) => {
      const key = [
        doc.songId,
        doc.type,
        doc.title.trim().toLowerCase(),
        (doc.url ?? '').trim().toLowerCase(),
        (doc.content ?? '').trim().toLowerCase(),
      ].join('|')
      const existing = grouped.get(key)
      if (existing) {
        parseDocumentInstruments(doc.instrument).forEach((instrument) => {
          if (!existing.instruments.includes(instrument)) {
            existing.instruments.push(instrument)
          }
        })
        existing.sourceDocIds.push(doc.id)
        return
      }
      grouped.set(key, {
        id: doc.id,
        songId: doc.songId,
        type: doc.type,
        instrument: parseDocumentInstruments(doc.instrument).join('||'),
        title: doc.title,
        url: doc.url,
        content: doc.content,
        instruments: parseDocumentInstruments(doc.instrument),
        sourceDocIds: [doc.id],
      })
    })
    return [...grouped.values()].sort((a, b) => {
      if (a.type === 'Lyrics' && b.type !== 'Lyrics') return -1
      if (a.type !== 'Lyrics' && b.type === 'Lyrics') return 1
      return a.title.localeCompare(b.title)
    })
  }
  const getDocumentViewerUrl = (url?: string) => {
    if (!url) return ''
    if (!/\.pdf(\?|#|$)/i.test(url)) return url
    if (url.includes('#')) {
      return `${url}&zoom=page-width&view=FitH`
    }
    return `${url}#zoom=page-width&view=FitH`
  }
  const isImageFileUrl = (url: string | undefined) =>
    Boolean(url && /\.(png|jpe?g|gif|webp)$/i.test(url))
  const hasSongTag = (song: Song, tag: string) =>
    song.tags.some((item) => item.trim().toLowerCase() === tag.trim().toLowerCase())
  const setlistPanelKey = (section: string) => `${SETLIST_PANEL_PREFIX}${section}`
  const getSectionFromPanel = (panel: string | null) =>
    panel && panel.startsWith(SETLIST_PANEL_PREFIX)
      ? panel.slice(SETLIST_PANEL_PREFIX.length)
      : null
  const normalizeSetlistSectionLabel = (value: string) =>
    value.replace(/\s+/g, ' ').trim()
  const makeGigSectionTag = (gigId: string, section: string) =>
    `${GIG_SECTION_TAG_PREFIX}${gigId}::${encodeURIComponent(normalizeSetlistSectionLabel(section))}`
  const parseGigSectionTag = (value: string): { gigId: string; section: string } | null => {
    if (!value.startsWith(GIG_SECTION_TAG_PREFIX)) return null
    const payload = value.slice(GIG_SECTION_TAG_PREFIX.length)
    const separatorIndex = payload.indexOf('::')
    if (separatorIndex <= 0) return null
    const gigId = payload.slice(0, separatorIndex)
    const encodedSection = payload.slice(separatorIndex + 2)
    const decodedSection = normalizeSetlistSectionLabel(
      decodeURIComponent(encodedSection || ''),
    )
    if (!gigId || !decodedSection) return null
    return { gigId, section: decodedSection }
  }
  const getGigSongSectionOverride = useCallback(
    (gigId: string, songId: string) => {
      const override = gigSongSectionOverrides[gigId]?.[songId]
      return override ? normalizeSetlistSectionLabel(override) : ''
    },
    [gigSongSectionOverrides],
  )
  const songMatchesGigSection = useCallback(
    (song: Song, section: string, gigId: string) => {
      const normalizedSection = normalizeSetlistSectionLabel(section).toLowerCase()
      if (!normalizedSection) return false
      const override = getGigSongSectionOverride(gigId, song.id)
      if (override) {
        return override.toLowerCase() === normalizedSection
      }
      // Numbered set names should still map to the base tag bucket.
      if (normalizedSection === 'dance set 1' || normalizedSection === 'dance set 2' || normalizedSection === 'dance set 3' || normalizedSection.startsWith('dance set ')) {
        return hasSongTag(song, 'Dance')
      }
      if (normalizedSection === 'dinner set 1' || normalizedSection === 'dinner set 2' || normalizedSection === 'dinner set 3' || normalizedSection.startsWith('dinner set ')) {
        return hasSongTag(song, 'Dinner')
      }
      if (normalizedSection === 'latin set 1' || normalizedSection === 'latin set 2' || normalizedSection === 'latin set 3' || normalizedSection.startsWith('latin set ')) {
        return hasSongTag(song, 'Latin')
      }
      return hasSongTag(song, section)
    },
    [getGigSongSectionOverride],
  )
  const normalizeTagIdentity = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim()
  const specialTypeIdentitySet = useMemo(
    () => new Set(appState.specialTypes.map((type) => normalizeTagIdentity(type))),
    [appState.specialTypes],
  )
  const requestTypeIdentitySet = useMemo(
    () => new Set(REQUEST_TYPE_TAG_EXCLUSIONS.map((value) => normalizeTagIdentity(value))),
    [],
  )
  const isSetlistTypeTag = useCallback((value: string) => {
    const normalized = normalizeSetlistSectionLabel(value)
    if (!normalized) return false
    if (normalized.startsWith(GIG_SECTION_TAG_PREFIX)) return false
    const lower = normalized.toLowerCase()
    if (lower === 'special request' || lower === 'special requests') return false
    const identity = normalizeTagIdentity(normalized)
    if (!identity) return false
    if (requestTypeIdentitySet.has(identity)) return false
    return !specialTypeIdentitySet.has(identity)
  }, [requestTypeIdentitySet, specialTypeIdentitySet])
  const setlistTypeTags = useMemo(
    () => normalizeTagList(appState.tagsCatalog.filter((tag) => isSetlistTypeTag(tag))),
    [appState.tagsCatalog, isSetlistTypeTag],
  )
  const isReservedBuildPanel = (value: string) =>
    ['musicians', 'addsongs', 'special'].includes(value.trim().toLowerCase())

  const currentSetlist = useMemo(
    () => appState.setlists.find((setlist) => setlist.id === selectedSetlistId),
    [appState.setlists, selectedSetlistId],
  )
  const gigSheetQueuedSong = useMemo(
    () => appState.songs.find((song) => song.id === appState.currentSongId) ?? null,
    [appState.currentSongId, appState.songs],
  )
  const gigSheetSongSearchQuery = useMemo(() => gigSheetSongSearch.trim().toLowerCase(), [gigSheetSongSearch])
  const activeBandName = useMemo(
    () => bands.find((band) => band.id === activeBandId)?.name ?? '',
    [bands, activeBandId],
  )
  const isSpecialSectionHidden = currentSetlist
    ? Boolean(gigHiddenSpecialSection[currentSetlist.id])
    : false
  useEffect(() => {
    if (!currentSetlist?.id) return
    setActiveGigId(currentSetlist.id)
  }, [currentSetlist?.id])
  const orderedSetSections = useMemo(() => {
    if (!currentSetlist) return []
    const saved = gigSetlistSections[currentSetlist.id] ?? []
    const hidden = new Set(
      (gigHiddenSetlistSections[currentSetlist.id] ?? []).map((item) => item.toLowerCase()),
    )
    const fromSongs = currentSetlist.songIds.flatMap((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      if (!song) return []
      const override = getGigSongSectionOverride(currentSetlist.id, song.id)
      if (override) return [override]
      return song.tags.filter((tag) => isSetlistTypeTag(tag))
    })
    const seen = new Set<string>()
    const merged = [...saved, ...fromSongs]
      .map(normalizeSetlistSectionLabel)
      .filter(Boolean)
      .filter((section) => {
        const key = section.toLowerCase()
        if (key === 'special request' || key === 'special requests') return false
        if (hidden.has(key)) return false
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    return merged
  }, [
    appState.songs,
    currentSetlist,
    gigHiddenSetlistSections,
    gigSetlistSections,
    getGigSongSectionOverride,
    isSetlistTypeTag,
  ])
  const printableSetSections = useMemo(() => {
    if (!currentSetlist) return []
    const seen = new Set<string>()
    const sections: string[] = []
    const addSection = (value: string) => {
      const normalized = normalizeSetlistSectionLabel(value)
      if (!normalized) return
      const lower = normalized.toLowerCase()
      if (!isSetlistTypeTag(normalized)) return
      if (seen.has(lower)) return
      seen.add(lower)
      sections.push(normalized)
    }
    orderedSetSections.forEach(addSection)
    currentSetlist.songIds
      .map((songId) => appState.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
      .flatMap((song) => song.tags)
      .forEach(addSection)
    return sections
  }, [appState.songs, currentSetlist, isSetlistTypeTag, orderedSetSections])
  const orderedPrintableSongSections = useMemo(() => {
    const rankSection = (section: string) => {
      const lower = section.trim().toLowerCase()
      if (lower.includes('dinner')) return 0
      if (lower.includes('latin')) return 1
      if (lower.includes('dance')) return 2
      return 10
    }
    return [...printableSetSections].sort((a, b) => {
      const rankDiff = rankSection(a) - rankSection(b)
      if (rankDiff !== 0) return rankDiff
      return a.localeCompare(b)
    })
  }, [printableSetSections])
  const printableGigMusicians = useMemo(() => {
    if (!currentSetlist) return []
    const seen = new Set<string>()
    return appState.gigMusicians
      .filter((row) => row.gigId === currentSetlist.id && row.status !== 'out')
      .map((row) => appState.musicians.find((musician) => musician.id === row.musicianId))
      .filter((musician): musician is Musician => Boolean(musician))
      .filter((musician) => {
        if (seen.has(musician.id)) return false
        seen.add(musician.id)
        return true
      })
      .sort((a, b) => {
        const aCore = a.roster === 'core'
        const bCore = b.roster === 'core'
        if (aCore !== bCore) return aCore ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [appState.gigMusicians, appState.musicians, currentSetlist])
  const getPrintToneClass = (section: string) => {
    const normalized = section.trim().toLowerCase()
    if (normalized === 'special requests' || normalized === 'special request') {
      return 'print-tone-special'
    }
    if (normalized.includes('dinner')) return 'print-tone-dinner'
    if (normalized.includes('dance')) return 'print-tone-dance'
    if (normalized.includes('latin')) return 'print-tone-latin'
    if (normalized.includes('musician')) return 'print-tone-musicians'
    return 'print-tone-default'
  }
  const getPrintLayoutClass = (section: string) => {
    const normalized = section.trim().toLowerCase()
    if (normalized === 'special requests' || normalized === 'special request') return 'print-special'
    if (normalized.includes('musician')) return 'print-musicians'
    if (normalized.includes('dinner')) return 'print-dinner'
    if (normalized.includes('dance')) return 'print-dance'
    if (normalized.includes('latin')) return 'print-latin'
    return 'print-generic-set'
  }
  const normalizePlaylistSection = useCallback((value: string) => {
    const normalized = normalizeSetlistSectionLabel(value)
    if (!normalized) return ''
    const lower = normalized.toLowerCase()
    if (lower === 'special request' || lower === 'special requests') return 'Special Requests'
    return normalized
  }, [])
  const getPlaylistSections = useCallback((entry: PlaylistEntry) => {
    const seen = new Set<string>()
    const normalizedTags = (entry.tags ?? [])
      .map(normalizePlaylistSection)
      .filter((tag) => {
        if (!tag) return false
        const lower = tag.toLowerCase()
        if (seen.has(lower)) return false
        seen.add(lower)
        return true
      })
    const sections = normalizedTags.filter((tag) => {
      const lower = tag.toLowerCase()
      return lower === 'special requests' || isSetlistTypeTag(tag)
    })
    return sections.length ? sections : ['Setlist']
  }, [isSetlistTypeTag, normalizePlaylistSection])
  const getPlaylistToneClasses = (section: string) => {
    const tone = getPrintToneClass(section)
    if (tone === 'print-tone-special') {
      return 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-100'
    }
    if (tone === 'print-tone-dinner') {
      return 'border-amber-300/40 bg-amber-500/10 text-amber-100'
    }
    if (tone === 'print-tone-dance') {
      return 'border-cyan-300/40 bg-cyan-500/10 text-cyan-100'
    }
    if (tone === 'print-tone-latin') {
      return 'border-rose-300/40 bg-rose-500/10 text-rose-100'
    }
    return 'border-slate-300/25 bg-slate-700/30 text-slate-100'
  }
  const getPlaylistTagClasses = (tag: string) => {
    const normalized = tag.trim().toLowerCase()
    if (normalized === 'special request' || normalized === 'special requests') {
      return 'bg-fuchsia-500/20 text-fuchsia-100'
    }
    if (normalized.includes('dinner')) {
      return 'bg-amber-500/20 text-amber-100'
    }
    if (normalized.includes('dance')) {
      return 'bg-cyan-500/20 text-cyan-100'
    }
    if (normalized.includes('latin')) {
      return 'bg-pink-500/20 text-pink-100'
    }
    return 'bg-slate-500/20 text-slate-200'
  }
  const getPlaylistQueueItemButtonClasses = (isActive: boolean) =>
    `w-full rounded-2xl border px-3 py-3 text-left transition ${
      isActive ? 'border-teal-300/70 bg-teal-400/10' : 'border-white/10 bg-slate-950/40'
    }`
  const getPlaylistSectionCardClasses = (section: string) =>
    `rounded-2xl border p-2 ${getPlaylistToneClasses(section)}`
  const playlistSectionHeaderClasses =
    'mb-2 rounded-lg bg-black/20 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]'
  const getOrderedSpecialRequests = useCallback((gigId: string) => {
    const base = appState.specialRequests.filter((request) => request.gigId === gigId)
    const order = specialRequestOrderByGig[gigId] ?? []
    if (!order.length) return base
    const rank = new Map(order.map((id, index) => [id, index]))
    return [...base].sort((a, b) => {
      const aRank = rank.get(a.id)
      const bRank = rank.get(b.id)
      if (aRank === undefined && bRank === undefined) return 0
      if (aRank === undefined) return 1
      if (bRank === undefined) return -1
      return aRank - bRank
    })
  }, [appState.specialRequests, specialRequestOrderByGig])

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
    const base: Record<string, boolean> = {
      musicians: false,
      addSongs: false,
      special: false,
    }
    orderedSetSections.forEach((section) => {
      base[setlistPanelKey(section)] = false
    })
    if (!currentSetlist) return base
    const gigId = currentSetlist.id
    const overrides = buildCompleteOverrides[gigId]
    if (!overrides) return base
    const next = { ...base }
    Object.entries(overrides).forEach(([panel, value]) => {
      if (typeof value === 'boolean') next[panel] = value
    })
    return next
  }, [
    currentSetlist,
    buildCompleteOverrides,
    orderedSetSections,
  ])

  const buildPanelCount = useMemo(() => {
    if (!currentSetlist || !activeBuildPanel) {
      return { label: '', value: 0 }
    }
    if (activeBuildPanel === 'musicians') {
      const knownMusicianIds = new Set(appState.musicians.map((musician) => musician.id))
      const uniqueAssignedMusicians = new Set(
        appState.gigMusicians
          .filter(
            (gm) =>
              gm.gigId === currentSetlist.id &&
              gm.status !== 'out' &&
              knownMusicianIds.has(gm.musicianId),
          )
          .map((gm) => gm.musicianId),
      )
      return {
        label: 'Musicians',
        value: uniqueAssignedMusicians.size,
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
    const section = getSectionFromPanel(activeBuildPanel)
    if (!section) return { label: '', value: 0 }
    const count = currentSetlist.songIds
      .map((songId) => appState.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
      .filter((song) => hasSongTag(song, section)).length
    return { label: 'Songs', value: count }
  }, [
    activeBuildPanel,
    appState.gigMusicians,
    appState.musicians,
    appState.specialRequests,
    appState.songs,
    currentSetlist,
  ])

  const buildCardCounts = useMemo(() => {
    const base: Record<string, number> = {
      musicians: 0,
      addSongs: 0,
      special: 0,
    }
    if (!currentSetlist) return base
    const sectionCount = (section: string) =>
      currentSetlist.songIds
        .map((songId) => appState.songs.find((song) => song.id === songId))
        .filter((song): song is Song => Boolean(song))
        .filter((song) => hasSongTag(song, section)).length
    const knownMusicianIds = new Set(appState.musicians.map((musician) => musician.id))
    const uniqueAssignedMusicians = new Set(
      appState.gigMusicians
        .filter(
          (gm) =>
            gm.gigId === currentSetlist.id &&
            gm.status !== 'out' &&
            knownMusicianIds.has(gm.musicianId),
        )
        .map((gm) => gm.musicianId),
    )
    const next: Record<string, number> = {
      musicians: uniqueAssignedMusicians.size,
      addSongs: currentSetlist.songIds.length,
      special: appState.specialRequests.filter((req) => req.gigId === currentSetlist.id)
        .length,
    }
    orderedSetSections.forEach((section) => {
      next[setlistPanelKey(section)] = sectionCount(section)
    })
    return next
  }, [
    appState.gigMusicians,
    appState.musicians,
    appState.specialRequests,
    appState.songs,
    currentSetlist,
    orderedSetSections,
  ])

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

  const sectionAddSongsActiveFilters = useMemo(() => {
    const selected = normalizeTagList(
      sectionAddSongsTargets.length ? sectionAddSongsTargets : [sectionAddSongsSource],
    )
    return selected.filter(Boolean)
  }, [sectionAddSongsSource, sectionAddSongsTargets])

  const sectionAddSongsAvailableSongs = useMemo(() => {
    if (!currentSetlist) return []
    const search = sectionAddSongsSearch.trim().toLowerCase()
    const filterSections = sectionAddSongsActiveFilters
    const includeAllBySection =
      filterSections.length === 0 || filterSections.length >= orderedSetSections.length
    return appState.songs
      .filter((song) => !currentSetlist.songIds.includes(song.id))
      .filter((song) =>
        includeAllBySection ? true : filterSections.some((section) => hasSongTag(song, section)),
      )
      .filter((song) =>
        !search ? true : `${song.title} ${song.artist}`.toLowerCase().includes(search),
      )
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [
    appState.songs,
    currentSetlist,
    orderedSetSections.length,
    sectionAddSongsActiveFilters,
    sectionAddSongsSearch,
  ])

  const gigSingerOptions = useMemo(() => {
    if (!currentSetlist) return []
    const activeIds = new Set(
      appState.gigMusicians
        .filter((row) => row.gigId === currentSetlist.id && row.status !== 'out')
        .map((row) => row.musicianId),
    )
    const fallbackIds = new Set(
      appState.gigMusicians
        .filter((row) => row.gigId === currentSetlist.id)
        .map((row) => row.musicianId),
    )
    const idsToUse = activeIds.size > 0 ? activeIds : fallbackIds
    return normalizeTagList(
      appState.musicians
        .filter((musician) => idsToUse.has(musician.id))
        .filter(
          (musician) =>
            Boolean(musician.singer) ||
            (musician.instruments ?? []).some(
              (instrument) => instrument.trim().toLowerCase() === 'vocals',
            ),
        )
        .map((musician) => musician.name),
    )
  }, [appState.gigMusicians, appState.musicians, currentSetlist])
  const assignSingerOptions = useMemo(
    () => normalizeTagList([...gigSingerOptions, INSTRUMENTAL_LABEL]),
    [gigSingerOptions],
  )
  const specialRequestSingerOptions = useMemo(
    () => normalizeTagList([...gigSingerOptions, INSTRUMENTAL_LABEL]),
    [gigSingerOptions],
  )
  const pendingSpecialSongMatch = useMemo(() => {
    const title = pendingSpecialSong.trim().toLowerCase()
    if (!title) return null
    return appState.songs.find((song) => song.title.trim().toLowerCase() === title) ?? null
  }, [appState.songs, pendingSpecialSong])

  const playlistEntries = useMemo<PlaylistEntry[]>(() => {
    if (!currentSetlist) return []
    const ordered: PlaylistEntry[] = []
    const byKey = new Map<string, PlaylistEntry>()
    const addOrMerge = (entry: PlaylistEntry) => {
      const existing = byKey.get(entry.key)
      if (existing) {
        const hasSpecialRequestTag = (tags: string[]) =>
          tags.some((item) => {
            const lower = item.trim().toLowerCase()
            return lower === 'special request' || lower === 'special requests'
          })
        const treatAsSpecialRequest = hasSpecialRequestTag(existing.tags) || hasSpecialRequestTag(entry.tags)
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
        tags: normalizeTagList(entry.tags),
        assignmentSingers: normalizeTagList(entry.assignmentSingers ?? []),
        assignmentKeys: normalizeTagList(entry.assignmentKeys ?? []),
      }
      byKey.set(normalized.key, normalized)
      ordered.push(normalized)
    }

    getOrderedSpecialRequests(currentSetlist.id)
      .filter((request) => !request.djOnly)
      .forEach((request) => {
        const linkedSong = appState.songs.find((song) => song.id === request.songId)
        const key = `special-request:${request.id}`
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

    currentSetlist.songIds
      .map((songId) => appState.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
      .forEach((song) => {
        const overrideSection = getGigSongSectionOverride(currentSetlist.id, song.id)
        const sectionTags = normalizeTagList(song.tags)
          .filter((tag) => (overrideSection ? false : isSetlistTypeTag(tag)))
          .concat(overrideSection ? [overrideSection] : [])
          .map(normalizePlaylistSection)
          .filter(Boolean)
        const assignments = song.keys
          .map((key) => ({
            singer: key.singer,
            key: key.gigOverrides[currentSetlist.id] ?? '',
          }))
          .filter((entry) => entry.key)
        addOrMerge({
          key: `song:${song.id}`,
          title: song.title,
          artist: song.artist,
          audioUrl: (song.youtubeUrl || '').trim(),
          tags: sectionTags.length ? sectionTags : ['Setlist'],
          songId: song.id,
          assignmentSingers: assignments.map((entry) => entry.singer),
          assignmentKeys: assignments.map((entry) => entry.key),
        })
      })
    return ordered.filter((entry) => Boolean(entry.audioUrl && entry.audioUrl.trim()))
  }, [
    appState.songs,
    currentSetlist,
    getGigSongSectionOverride,
    getOrderedSpecialRequests,
    isSetlistTypeTag,
    normalizePlaylistSection,
  ])

  const activePlaylistEntries = sharedPlaylistView?.entries ?? playlistEntries
  const getPlaylistEntryAssignments = useCallback((entry: PlaylistEntry) => {
    const singers = normalizeTagList(entry.assignmentSingers ?? [])
    const keys = normalizeTagList(entry.assignmentKeys ?? [])
    if (entry.songId && currentSetlist) {
      const song = appState.songs.find((item) => item.id === entry.songId)
      song?.keys
        .map((key) => ({
          singer: key.singer,
          key: key.gigOverrides[currentSetlist.id] ?? '',
        }))
        .filter((assignment) => assignment.key)
        .forEach((assignment) => {
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
    return { singers, keys }
  }, [appState.songs, currentSetlist])
  const playlistSingerOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: string[] = []
    activePlaylistEntries.forEach((entry) => {
      getPlaylistEntryAssignments(entry).singers.forEach((singer) => {
        const normalized = singer.trim()
        if (!normalized) return
        const key = normalized.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        options.push(normalized)
      })
    })
    return options.sort((a, b) => a.localeCompare(b))
  }, [activePlaylistEntries, getPlaylistEntryAssignments])
  const visiblePlaylistEntries = useMemo(() => {
    if (playlistSingerFilter === '__all__') return activePlaylistEntries
    return activePlaylistEntries.filter((entry) =>
      getPlaylistEntryAssignments(entry).singers.some(
        (singer) => singer.toLowerCase() === playlistSingerFilter.toLowerCase(),
      ),
    )
  }, [activePlaylistEntries, getPlaylistEntryAssignments, playlistSingerFilter])
  const groupedPlaylistSections = useMemo(() => {
    const buckets = new Map<string, Array<{ entry: PlaylistEntry; index: number }>>()
    visiblePlaylistEntries.forEach((entry, index) => {
      const sections = getPlaylistSections(entry)
      sections.forEach((section) => {
        const list = buckets.get(section) ?? []
        list.push({ entry, index })
        buckets.set(section, list)
      })
    })
    const preferredOrder = [
      'Special Requests',
      ...orderedSetSections.map(normalizePlaylistSection).filter(Boolean),
      'Setlist',
    ]
    const seen = new Set<string>()
    const orderedSections: string[] = []
    preferredOrder.forEach((section) => {
      const lower = section.toLowerCase()
      if (seen.has(lower)) return
      seen.add(lower)
      orderedSections.push(section)
    })
    buckets.forEach((_value, key) => {
      const lower = key.toLowerCase()
      if (seen.has(lower)) return
      seen.add(lower)
      orderedSections.push(key)
    })
    return orderedSections
      .map((section) => ({
        section,
        items: buckets.get(section) ?? [],
      }))
      .filter((group) => group.items.length > 0)
  }, [getPlaylistSections, normalizePlaylistSection, orderedSetSections, visiblePlaylistEntries])
  const currentPlaylistEntry = visiblePlaylistEntries[playlistIndex] ?? null
  const docModalPages = useMemo(() => {
    if (!docModalContent?.url) return []
    const pages = docModalContent.url
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    return pages.length ? pages : [docModalContent.url]
  }, [docModalContent])
  const activeDocModalPage = docModalPages[docModalPageIndex] ?? docModalPages[0] ?? ''
  const isPlaylistEntryPlayable = (entry?: PlaylistEntry | null) =>
    Boolean(entry?.audioUrl && entry.audioUrl.trim())

  const findNextPlayableIndex = (startIndex: number, delta: number) => {
    if (!visiblePlaylistEntries.length) return -1
    for (let step = 0; step < visiblePlaylistEntries.length; step += 1) {
      const candidate =
        (startIndex + delta * step + visiblePlaylistEntries.length) % visiblePlaylistEntries.length
      if (isPlaylistEntryPlayable(visiblePlaylistEntries[candidate])) {
        return candidate
      }
    }
    return -1
  }

  const jumpToPlaylistIndex = (index: number) => {
    if (!visiblePlaylistEntries.length) return
    const playable = isPlaylistEntryPlayable(visiblePlaylistEntries[index])
      ? index
      : findNextPlayableIndex(index, 1)
    if (playable < 0) return
    setPlaylistIndex(playable)
    setPlaylistPlayNonce((current) => current + 1)
  }
  const handlePlaylistDrawerTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (playlistDrawerOverlay) {
      if (playlistDrawerAutoCloseTimerRef.current) {
        window.clearTimeout(playlistDrawerAutoCloseTimerRef.current)
      }
      playlistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
        setPlaylistDrawerOverlay(false)
        playlistDrawerAutoCloseTimerRef.current = null
      }, 6000)
    }
    playlistDrawerTouchStartYRef.current = event.touches[0]?.clientY ?? null
  }
  const handlePlaylistDrawerTouchMove = () => {
    if (!playlistDrawerOverlay) return
    if (playlistDrawerAutoCloseTimerRef.current) {
      window.clearTimeout(playlistDrawerAutoCloseTimerRef.current)
    }
    playlistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
      setPlaylistDrawerOverlay(false)
      playlistDrawerAutoCloseTimerRef.current = null
    }, 6000)
  }
  const handlePlaylistDrawerScroll = () => {
    if (!playlistDrawerOverlay) return
    if (playlistDrawerAutoCloseTimerRef.current) {
      window.clearTimeout(playlistDrawerAutoCloseTimerRef.current)
    }
    playlistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
      setPlaylistDrawerOverlay(false)
      playlistDrawerAutoCloseTimerRef.current = null
    }, 6000)
  }
  const handlePlaylistDrawerTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const startY = playlistDrawerTouchStartYRef.current
    playlistDrawerTouchStartYRef.current = null
    if (startY === null) return
    const endY = event.changedTouches[0]?.clientY ?? startY
    const deltaY = endY - startY
    if (deltaY <= -70) {
      setPlaylistDrawerOverlay(true)
      return
    }
    if (deltaY >= 90) {
      setPlaylistDrawerOverlay(false)
    }
  }
  const handleSharedPlaylistDrawerTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (sharedPlaylistDrawerOverlay) {
      if (sharedPlaylistDrawerAutoCloseTimerRef.current) {
        window.clearTimeout(sharedPlaylistDrawerAutoCloseTimerRef.current)
      }
      sharedPlaylistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
        setSharedPlaylistDrawerOverlay(false)
        sharedPlaylistDrawerAutoCloseTimerRef.current = null
      }, 6000)
    }
    sharedPlaylistDrawerTouchStartYRef.current = event.touches[0]?.clientY ?? null
  }
  const handleSharedPlaylistDrawerTouchMove = () => {
    if (!sharedPlaylistDrawerOverlay) return
    if (sharedPlaylistDrawerAutoCloseTimerRef.current) {
      window.clearTimeout(sharedPlaylistDrawerAutoCloseTimerRef.current)
    }
    sharedPlaylistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
      setSharedPlaylistDrawerOverlay(false)
      sharedPlaylistDrawerAutoCloseTimerRef.current = null
    }, 6000)
  }
  const handleSharedPlaylistDrawerScroll = () => {
    if (!sharedPlaylistDrawerOverlay) return
    if (sharedPlaylistDrawerAutoCloseTimerRef.current) {
      window.clearTimeout(sharedPlaylistDrawerAutoCloseTimerRef.current)
    }
    sharedPlaylistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
      setSharedPlaylistDrawerOverlay(false)
      sharedPlaylistDrawerAutoCloseTimerRef.current = null
    }, 6000)
  }
  const handleSharedPlaylistDrawerTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const startY = sharedPlaylistDrawerTouchStartYRef.current
    sharedPlaylistDrawerTouchStartYRef.current = null
    if (startY === null) return
    const endY = event.changedTouches[0]?.clientY ?? startY
    const deltaY = endY - startY
    if (deltaY <= -70) {
      setSharedPlaylistDrawerOverlay(true)
      return
    }
    if (deltaY >= 90) {
      setSharedPlaylistDrawerOverlay(false)
    }
  }
  const movePlaylistBy = (delta: number) => {
    if (!visiblePlaylistEntries.length) return
    const next = findNextPlayableIndex(
      (playlistIndex + delta + visiblePlaylistEntries.length) % visiblePlaylistEntries.length,
      delta >= 0 ? 1 : -1,
    )
    if (next < 0) return
    setPlaylistIndex(next)
    setPlaylistPlayNonce((current) => current + 1)
  }
  const triggerSharedGigFlash = useCallback(() => {
    setSharedGigFlashPulse(true)
    if (sharedFlashTimerRef.current) {
      window.clearTimeout(sharedFlashTimerRef.current)
    }
    sharedFlashTimerRef.current = window.setTimeout(() => {
      setSharedGigFlashPulse(false)
      sharedFlashTimerRef.current = null
    }, 1500)
  }, [])
  const copyPlaylistShareLink = async () => {
    if (!currentSetlist) return
    const currentShareEntry = visiblePlaylistEntries[playlistIndex]
    const shareStartIndex = currentShareEntry
      ? Math.max(
          0,
          activePlaylistEntries.findIndex((entry) => entry.key === currentShareEntry.key),
        )
      : 0
    const sharedMusicians: Musician[] = appState.gigMusicians
      .filter((row) => row.gigId === currentSetlist.id && row.status !== 'out')
      .map((row) => appState.musicians.find((musician) => musician.id === row.musicianId))
      .filter((musician): musician is Musician => Boolean(musician))
    const params = new URLSearchParams()
    params.set('playlist', '1')
    params.set('setlist', currentSetlist.id)
    params.set('item', String(shareStartIndex))
    params.set('band', activeBandName || 'Band')
    if (sharedMusicians.length > 0) {
      params.set('musicians', encodeSharePayloadBase64Url(sharedMusicians))
    }
    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`
    const setStatus = (value: string) => {
      setPlaylistShareStatus(value)
      if (playlistShareTimerRef.current) {
        window.clearTimeout(playlistShareTimerRef.current)
      }
      playlistShareTimerRef.current = window.setTimeout(() => {
        setPlaylistShareStatus('')
        playlistShareTimerRef.current = null
      }, 2200)
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = shareUrl
        textArea.style.position = 'fixed'
        textArea.style.left = '-9999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setStatus('Playlist link copied.')
    } catch {
      setStatus('Could not copy link. Copy from browser URL bar.')
    }
  }
  const moveDocPageBy = (delta: number) => {
    if (docModalPages.length <= 1) return
    setDocModalPageIndex((current) => {
      const next = current + delta
      if (next < 0) return docModalPages.length - 1
      if (next >= docModalPages.length) return 0
      return next
    })
  }
  const printActiveDocument = () => {
    if (!docModalContent) return
    const runPrintInHiddenFrame = (options: { html?: string; url?: string }) => {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.style.opacity = '0'
      const cleanup = () => {
        window.setTimeout(() => {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe)
          }
        }, 1200)
      }
      iframe.onload = () => {
        window.setTimeout(() => {
          try {
            iframe.contentWindow?.focus()
            iframe.contentWindow?.print()
          } catch {
            // Some remote viewers block programmatic print.
          } finally {
            cleanup()
          }
        }, 250)
      }
      if (options.html) {
        iframe.srcdoc = options.html
      } else if (options.url) {
        iframe.src = options.url
      }
      document.body.appendChild(iframe)
    }

    if (docModalContent.content) {
      const escaped = docModalContent.content
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
      runPrintInHiddenFrame({
        html: `<!doctype html><html><head><title>${docModalContent.title}</title><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>body{font-family:Inter,system-ui,-apple-system,sans-serif;margin:20px;color:#0f172a;}h1{font-size:18px;margin:0 0 12px;}pre{white-space:pre-wrap;line-height:1.55;font-size:13px;}</style></head><body><h1>${docModalContent.title}</h1><pre>${escaped}</pre></body></html>`,
      })
      return
    }
    if (activeDocModalPage) {
      runPrintInHiddenFrame({ url: activeDocModalPage })
    }
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
    const { singers, keys } = getPlaylistEntryAssignments(entry)
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
        (async () => {
          const deleteQuery = supabase
            .from('SetlistGigSingerKeys')
            .delete()
            .eq('gig_id', currentSetlist.id)
            .eq('song_id', songId)
          const { error: deleteError } = activeBandId
            ? await deleteQuery.eq('band_id', activeBandId)
            : await deleteQuery
          if (deleteError) return { error: deleteError }
          const { error: insertError } = await supabase.from('SetlistGigSingerKeys').insert(
            assignments.map((entry) => withBandId({
              id: createId(),
              gig_id: currentSetlist.id,
              song_id: songId,
              singer_name: entry.singer,
              gig_key: keyValue,
            })),
          )
          return { error: insertError }
        })(),
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
  const formatSingerShortName = (value: string) => {
    const parts = value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    if (parts.length === 0) return ''
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')
    return initials || parts[0].slice(0, 2).toUpperCase()
  }
  const formatSingerAssignmentNames = (values: string[]) =>
    values.map((name) => formatSingerShortName(name)).filter(Boolean).join(', ')
  const formatSingerFirstNames = (values: string[]) =>
    values
      .map((name) => name.trim().split(/\s+/).filter(Boolean)[0] ?? '')
      .filter(Boolean)
      .join(', ')

  const setGigCurrentSong = (songId: string | null) => {
    if (!currentSetlist) return
    setAppState((prev) => ({ ...prev, currentSongId: songId }))
    setNowPlayingByGig((prev) => ({ ...prev, [currentSetlist.id]: songId }))
    const client = supabase
    if (!client) return
    if (songId) {
      runSupabase(
        client.from('SetlistGigNowPlaying').upsert(withBandId({
          gig_id: currentSetlist.id,
          song_id: songId,
          updated_at: new Date().toISOString(),
        })),
      )
    } else {
      runSupabase(
        client
          .from('SetlistGigNowPlaying')
          .delete()
          .eq('band_id', activeBandId)
          .eq('gig_id', currentSetlist.id),
      )
    }
  }
  const isGigSongLocked = useCallback((songId: string) => {
    if (!currentSetlist) return false
    return (gigLockedSongIdsByGig[currentSetlist.id] ?? []).includes(songId)
  }, [currentSetlist, gigLockedSongIdsByGig])
  const markGigSongAsSelected = (songId: string, options?: { forceResend?: boolean }) => {
    if (!currentSetlist) return
    const forceResend = Boolean(options?.forceResend)
    if (isGigSongLocked(songId) && !forceResend) {
      setPendingResendGigSongId(songId)
      setShowGigLockedSongWarning(true)
      return
    }
    setGigLockedSongIdsByGig((prev) => {
      const current = prev[currentSetlist.id] ?? []
      if (current.includes(songId)) return prev
      return {
        ...prev,
        [currentSetlist.id]: [...current, songId],
      }
    })
    setGigLastLockedSongByGig((prev) => ({
      ...prev,
      [currentSetlist.id]: songId,
    }))
    setGigCurrentSong(songId)
    logPlayedSong(songId)
  }
  const clearGigQueuedSong = () => {
    if (!currentSetlist || !appState.currentSongId) return
    const queuedSongId = appState.currentSongId
    setGigCurrentSong(null)
    setGigLockedSongIdsByGig((prev) => ({
      ...prev,
      [currentSetlist.id]: (prev[currentSetlist.id] ?? []).filter((songId) => songId !== queuedSongId),
    }))
    setGigLastLockedSongByGig((prev) => ({
      ...prev,
      [currentSetlist.id]:
        (prev[currentSetlist.id] ?? null) === queuedSongId ? null : prev[currentSetlist.id] ?? null,
    }))
  }
  const finishGigQueuedSong = () => {
    if (!currentSetlist || !appState.currentSongId) return
    setGigCurrentSong(null)
  }
  const closeGigSetlistSheet = () => {
    if (currentSetlist) {
      setSelectedSetlistId(currentSetlist.id)
      setActiveGigId(currentSetlist.id)
    }
    setGigSheetSongSearch('')
    setScreen('builder')
    setShowGigSetlistSheet(false)
  }
  const undoLastGigSongSelection = () => {
    if (!currentSetlist) return
    const lastSongId = gigLastLockedSongByGig[currentSetlist.id]
    if (!lastSongId) return
    setGigLockedSongIdsByGig((prev) => {
      const current = prev[currentSetlist.id] ?? []
      return {
        ...prev,
        [currentSetlist.id]: current.filter((songId) => songId !== lastSongId),
      }
    })
    setGigLastLockedSongByGig((prev) => ({
      ...prev,
      [currentSetlist.id]: null,
    }))
    if (appState.currentSongId === lastSongId) {
      setGigCurrentSong(null)
    }
  }
  const buildPanelGradient =
    activeBuildPanel === 'musicians'
      ? 'from-indigo-500/20 via-slate-900/60 to-slate-950/80'
      : activeBuildPanel === 'addSongs'
        ? 'from-teal-500/20 via-slate-900/60 to-slate-950/80'
        : activeBuildPanel === 'special'
          ? 'from-amber-500/20 via-slate-900/60 to-slate-950/80'
          : (getSectionFromPanel(activeBuildPanel)?.toLowerCase().includes('dinner') ?? false)
            ? 'from-emerald-500/20 via-slate-900/60 to-slate-950/80'
            : (getSectionFromPanel(activeBuildPanel)?.toLowerCase().includes('latin') ?? false)
              ? 'from-pink-500/20 via-slate-900/60 to-slate-950/80'
              : (getSectionFromPanel(activeBuildPanel)?.toLowerCase().includes('dance') ?? false)
                ? 'from-cyan-500/20 via-slate-900/60 to-slate-950/80'
                : 'from-slate-900/60 via-slate-900/80 to-slate-950/90'

  const setBuildComplete = (
    panel: string,
    value: boolean,
  ) => {
    if (!currentSetlist) return
    const sectionPanel = getSectionFromPanel(panel)
    if (value && (panel === 'special' || Boolean(sectionPanel))) {
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
                hasSongTag(song, sectionPanel ?? ''),
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
      client.from('SetlistPlayedSongs').insert(withBandId({
        id: createId(),
        gig_id: currentSetlist.id,
        song_id: songId,
        played_at: new Date().toISOString(),
      })),
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
          supabase.from('SetlistSongKeys').insert(withBandId({
            id: createId(),
            song_id: songId,
            singer_name: singerName,
            default_key: normalizedKey,
          })),
        )
      }
      runSupabase(
        (async () => {
          const deleteQuery = supabase
            .from('SetlistGigSingerKeys')
            .delete()
            .eq('gig_id', currentSetlist.id)
            .eq('song_id', songId)
            .eq('singer_name', singerName)
          const { error: deleteError } = activeBandId
            ? await deleteQuery.eq('band_id', activeBandId)
            : await deleteQuery
          if (deleteError) return { error: deleteError }
          const { error: insertError } = await supabase.from('SetlistGigSingerKeys').insert(withBandId({
            id: createId(),
            gig_id: currentSetlist.id,
            song_id: songId,
            singer_name: singerName,
            gig_key: normalizedKey,
          }))
          return { error: insertError }
        })(),
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

  const loadBandContext = useCallback(async (userId: string) => {
    if (!supabase) return
    const { data: membershipsData, error: membershipsError } = await supabase
      .from('band_memberships')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
    if (membershipsError) {
      setSupabaseError(`Band membership load failed: ${membershipsError.message}`)
      return
    }
    const mappedMemberships: BandMembership[] = (membershipsData ?? []).map((row) => ({
      id: row.id,
      bandId: row.band_id,
      userId: row.user_id,
      role: row.role,
      status: row.status,
      musicianId: row.musician_id ?? undefined,
    }))
    setMemberships(mappedMemberships)
    const bandIds = mappedMemberships.map((item) => item.bandId)
    if (bandIds.length === 0) {
      setBands([])
      setActiveBandId('')
      setRole(null)
      return
    }
    const { data: bandsData, error: bandsError } = await supabase
      .from('bands')
      .select('*')
      .in('id', bandIds)
    if (bandsError) {
      setSupabaseError(`Band load failed: ${bandsError.message}`)
      return
    }
    const mappedBands: Band[] = (bandsData ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      createdBy: row.created_by ?? undefined,
    }))
    setBands(mappedBands)
    const storedBandId = localStorage.getItem(ACTIVE_BAND_KEY) ?? ''
    const resolvedBandId = mappedBands.some((band) => band.id === storedBandId)
      ? storedBandId
      : mappedBands[0]?.id ?? ''
    setActiveBandId(resolvedBandId)
    const membership = mappedMemberships.find((item) => item.bandId === resolvedBandId)
    setRole(membership?.role === 'admin' ? 'admin' : 'user')
  }, [])

  const createBandAsFirstAdmin = async () => {
    if (authLoading) return
    if (!supabase || !authUserId) return
    setSupabaseError(null)
    const trimmedName = newBandName.trim()
    if (!trimmedName) {
      setSupabaseError('Enter band name.')
      return
    }
    setAuthLoading(true)
    try {
      const { data: createdBand, error: createBandError } = await supabase
        .from('bands')
        .insert({ name: trimmedName, created_by: authUserId })
        .select('*')
        .single()
      if (createBandError || !createdBand) {
        setSupabaseError(`Create band failed: ${createBandError?.message ?? 'Unknown error'}`)
        return
      }
      const { error: membershipError } = await supabase.from('band_memberships').insert({
        band_id: createdBand.id,
        user_id: authUserId,
        role: 'admin',
        status: 'active',
      })
      if (membershipError) {
        setSupabaseError(`Create admin membership failed: ${membershipError.message}`)
        return
      }
      const newBand: Band = {
        id: createdBand.id,
        name: createdBand.name,
        createdBy: createdBand.created_by ?? undefined,
      }
      const newMembership: BandMembership = {
        id: crypto.randomUUID(),
        bandId: createdBand.id,
        userId: authUserId,
        role: 'admin',
        status: 'active',
      }
      setBands([newBand])
      setMemberships([newMembership])
      setActiveBandId(createdBand.id)
      localStorage.setItem(ACTIVE_BAND_KEY, createdBand.id)
      setRole('admin')
      setNewBandName('')
    } catch (error) {
      console.error('Create band failed unexpectedly:', error)
      setSupabaseError('Create band failed unexpectedly. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const createBandInvite = async () => {
    if (!supabase || !activeBandId || !inviteEmail.trim()) return
    const { data, error } = await supabase.rpc('create_band_invite', {
      p_band_id: activeBandId,
      p_email: inviteEmail.trim().toLowerCase(),
      p_role: inviteRole,
      p_musician_id: inviteMusicianId || null,
      p_expires_hours: 168,
    })
    if (error) {
      setSupabaseError(`Invite create failed: ${error.message}`)
      return
    }
    const token = Array.isArray(data) ? data[0]?.invite_token : null
    setInviteCreateResult(
      token
        ? `Invite token (copy once): ${token}`
        : 'Invite created. Send email from your mail app with this token link.',
    )
    setInviteEmail('')
    setInviteRole('member')
    setInviteMusicianId('')
  }

  const sendInviteForMusician = async (musician: Musician) => {
    if (!supabase || !activeBandId) return
    const email = musician.email?.trim().toLowerCase() ?? ''
    if (!email) {
      setSupabaseError(`Add an email for ${musician.name} before sending an invite.`)
      return
    }
    const membership = memberships.find(
      (item) => item.bandId === activeBandId && item.musicianId === musician.id,
    )
    const inviteRoleForMusician: 'member' | 'admin' = membership?.role === 'admin' ? 'admin' : 'member'
    const { data, error } = await supabase.rpc('create_band_invite', {
      p_band_id: activeBandId,
      p_email: email,
      p_role: inviteRoleForMusician,
      p_musician_id: musician.id,
      p_expires_hours: 168,
    })
    if (error) {
      setSupabaseError(`Invite create failed: ${error.message}`)
      return
    }
    const token = Array.isArray(data) ? data[0]?.invite_token : null
    setInviteCreateResult(
      token
        ? `Invite for ${musician.name}: ${token}`
        : `Invite created for ${musician.name}. Send email from your mail app.`,
    )
  }

  const updateMembershipRole = async (membershipId: string, nextRole: 'admin' | 'member') => {
    if (!supabase) return
    const { error } = await supabase
      .from('band_memberships')
      .update({ role: nextRole })
      .eq('id', membershipId)
    if (error) {
      setSupabaseError(`Role update failed: ${error.message}`)
      return
    }
    if (authUserId) await loadBandContext(authUserId)
  }

  const linkMembershipMusician = async (membershipId: string, musicianId: string) => {
    if (!supabase) return
    const { error } = await supabase
      .from('band_memberships')
      .update({ musician_id: musicianId || null })
      .eq('id', membershipId)
    if (error) {
      setSupabaseError(`Membership link failed: ${error.message}`)
      return
    }
    if (authUserId) await loadBandContext(authUserId)
  }

  const handleLogin = async () => {
    if (!supabase) {
      setAuthError(null)
      if (!loginInput.trim()) {
        setAuthError('Enter password.')
        return
      }
      if (loginInput === ADMIN_PASSWORD || loginInput === USER_PASSWORD) {
        setRole(loginInput === ADMIN_PASSWORD ? 'admin' : 'user')
        setScreen('setlists')
        setLoginPhase('app')
      } else {
        setAuthError('Invalid password.')
      }
      return
    }
    setAuthError(null)
    setSupabaseError(null)
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError('Enter email and password.')
      return
    }
    setAuthLoading(true)
    try {
      const authTimeoutMs = 12000
      if (authMode === 'signup') {
        const signUpPromise = supabase.auth.signUp({
          email: authEmail.trim().toLowerCase(),
          password: authPassword,
          options: {
            emailRedirectTo: window.location.origin,
          },
        })
        const { data, error } = (await Promise.race([
          signUpPromise,
          new Promise<{ data: null; error: { message: string } }>((resolve) =>
            window.setTimeout(
              () => resolve({ data: null, error: { message: 'Signup timed out. Try again.' } }),
              authTimeoutMs,
            ),
          ),
        ])) as Awaited<typeof signUpPromise>
        if (error) {
          setAuthError(error.message)
          return
        }
        if (data.session) {
          return
        }
        setAuthError('Check your email to confirm signup, then log in.')
        setAuthMode('login')
        return
      }
      const signInPromise = supabase.auth.signInWithPassword({
        email: authEmail.trim().toLowerCase(),
        password: authPassword,
      })
      const { data, error } = (await Promise.race([
        signInPromise,
        new Promise<{ data: null; error: { message: string } }>((resolve) =>
          window.setTimeout(
            () => resolve({ data: null, error: { message: 'Login timed out. Try again.' } }),
            authTimeoutMs,
          ),
        ),
      ])) as Awaited<typeof signInPromise>
      if (error) {
        setAuthError(error.message)
        return
      }
      const userId = data.user?.id ?? null
      setAuthUserId(userId)
      const userEmail = data.user?.email ?? null
      setAuthUserEmail(userEmail)
      setLoginPhase('app')
      if (userId) {
        await loadBandContext(userId)
      }
    } catch (error) {
      console.error('Auth request failed:', error)
      setAuthError('Authentication failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    if (loginTimerRef.current) {
      window.clearTimeout(loginTimerRef.current)
      loginTimerRef.current = null
    }
    if (supabase) {
      await supabase.auth.signOut()
    }
    setRole(null)
    setAuthUserId(null)
    setAuthUserEmail(null)
    setBands([])
    setMemberships([])
    setActiveBandId('')
    localStorage.removeItem(ACTIVE_BAND_KEY)
    setGigMode(false)
    setShowGigMusiciansModal(false)
    setShowSetlistModal(false)
    setShowPlaylistModal(false)
    setShowPrintPreview(false)
    setShowAddMusicianModal(false)
    setShowTeamModal(false)
    setShowAddSetlistModal(false)
    setShowSectionAddSongsModal(false)
    setShowDeleteSetlistSectionConfirm(false)
    setPendingDeleteSetlistSection(null)
    setShowSpecialRequestModal(false)
    setActiveBuildPanel(null)
    setScreen('setlists')
    setLoginPhase('login')
    setLoginInput('')
    setAuthEmail('')
    setAuthPassword('')
    setAuthError(null)
    setAuthLoading(false)
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
    if (supabase && activeBandId) {
      void (async () => {
        const { error: gigInsertError } = await supabase.from('SetlistGigs').insert(withBandId({
          id: newId,
          gig_name: `${source.gigName} (Copy)`,
          gig_date: new Date().toISOString().slice(0, 10),
          venue_address: source.venueAddress ?? '',
        }))
        if (gigInsertError) {
          reportSupabaseError(gigInsertError)
          return
        }

        if (uniqueSourceSongIds.length) {
          const { error: gigSongsInsertError } = await supabase.from('SetlistGigSongs').insert(
            uniqueSourceSongIds.map((songId, index) => withBandId({
              id: createId(),
              gig_id: newId,
              song_id: songId,
              sort_order: index,
            })),
          )
          reportSupabaseError(gigSongsInsertError)
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
          const { error: gigMusiciansInsertError } = await supabase.from('SetlistGigMusicians').insert(
            gigMusicianRows.map((row) => withBandId(row)),
          )
          reportSupabaseError(gigMusiciansInsertError)
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
          const { error: gigSingerKeysInsertError } = await supabase.from('SetlistGigSingerKeys').insert(
            gigSingerRows.map((row) => withBandId(row)),
          )
          reportSupabaseError(gigSingerKeysInsertError)
        }
      })()
    }
    setGigHiddenSpecialSection((prev) => ({ ...prev, [newId]: false }))
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
    if (supabase && activeBandId) {
      runSupabase(
        supabase.from('SetlistGigs').insert(withBandId({
          id: newId,
          gig_name: 'New Gig',
          gig_date: new Date().toISOString().slice(0, 10),
          venue_address: '',
        })),
      )
    }
    setGigHiddenSpecialSection((prev) => ({ ...prev, [newId]: false }))
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
    setGigSetlistSections((prev) => {
      const next = { ...prev }
      delete next[setlistId]
      return next
    })
    setGigHiddenSetlistSections((prev) => {
      const next = { ...prev }
      delete next[setlistId]
      return next
    })
    setGigHiddenSpecialSection((prev) => {
      const next = { ...prev }
      delete next[setlistId]
      return next
    })
    setSpecialRequestOrderByGig((prev) => {
      const next = { ...prev }
      delete next[setlistId]
      return next
    })
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
          songsToAdd.map((songId, index) => withBandId({
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

  const openAddSongsForSection = (section: string) => {
    const normalized = normalizeSetlistSectionLabel(section)
    if (!normalized) return
    setSectionAddSongsSource(normalized)
    setSectionAddSongsTargets([normalized])
    setSectionAddSongsSearch('')
    setSelectedSongIds([])
    setShowSectionAddSongsModal(true)
  }

  const addSelectedSongsToTargetSetlists = () => {
    if (!currentSetlist || selectedSongIds.length === 0) return
    const targetSections = normalizeTagList(
      sectionAddSongsTargets.length ? sectionAddSongsTargets : [sectionAddSongsSource],
    ).filter(Boolean)
    if (targetSections.length === 0) return
    const songsToAdd = selectedSongIds.filter((songId) => !currentSetlist.songIds.includes(songId))
    if (songsToAdd.length === 0) {
      setSelectedSongIds([])
      setShowSectionAddSongsModal(false)
      return
    }

    const selectedSongs = songsToAdd
      .map((songId) => appState.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
    const tagInserts = selectedSongs.flatMap((song) =>
      targetSections
        .filter((section) => !hasSongTag(song, section))
        .map((section) => ({
          id: createId(),
          song_id: song.id,
          tag: section,
        })),
    )

    setBuildPanelDirty(true)
    commitChange('Add songs to setlists', (prev) => ({
      ...prev,
      songs: prev.songs.map((song) =>
        songsToAdd.includes(song.id)
          ? {
              ...song,
              tags: Array.from(new Set([...song.tags, ...targetSections])),
            }
          : song,
      ),
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? { ...setlist, songIds: [...setlist.songIds, ...songsToAdd] }
          : setlist,
      ),
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, ...targetSections])),
    }))

    if (supabase) {
      runSupabase(
        supabase.from('SetlistGigSongs').insert(
          songsToAdd.map((songId, index) => withBandId({
            id: createId(),
            gig_id: currentSetlist.id,
            song_id: songId,
            sort_order: (currentSetlist.songIds.length ?? 0) + index,
          })),
        ),
      )
      if (tagInserts.length) {
        runSupabase(
          supabase.from('SetlistSongTags').insert(tagInserts.map((row) => withBandId(row))),
        )
      }
    }

    setSelectedSongIds([])
    setShowSectionAddSongsModal(false)
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
            client.from('SetlistGigSingerKeys').insert(withBandId({
              id: createId(),
              gig_id: currentSetlist.id,
              song_id: songId,
              singer_name: key.singer,
              gig_key: sourceKey,
            })),
          )
        })
      })
    }
  }

  const importSectionFromPaste = (
    section: string,
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
      .map((line) => line.replace(/^[-*\u2022\d.)\s]+/, '').trim())
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
        runSupabase(client.from('SetlistSongs').insert(songInserts.map((row) => withBandId(row))))
      }
      if (tagInserts.length) {
        runSupabase(client.from('SetlistSongTags').insert(tagInserts.map((row) => withBandId(row))))
      }
      if (uniqueSongIdsToAdd.length) {
        runSupabase(
          client.from('SetlistGigSongs').insert(
            uniqueSongIdsToAdd.map((songId, index) => withBandId({
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

  const getSectionSongIds = useCallback((section: string) => {
    if (!currentSetlist) return []
    return currentSetlist.songIds.filter((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      return song ? songMatchesGigSection(song, section, currentSetlist.id) : false
    })
  }, [appState.songs, currentSetlist, songMatchesGigSection])
  const getSectionSongs = useCallback((section: string) => {
    if (!currentSetlist) return []
    return currentSetlist.songIds
      .map((songId) => appState.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
      .filter((song) => songMatchesGigSection(song, section, currentSetlist.id))
  }, [appState.songs, currentSetlist, songMatchesGigSection])
  const manualSectionOrderSongs = useMemo(() => {
    if (!currentSetlist || !manualSectionOrderSection) return []
    return getSectionSongs(manualSectionOrderSection)
  }, [currentSetlist, getSectionSongs, manualSectionOrderSection])
  const applySectionSongOrder = (section: string, reorderedSectionSongIds: string[]) => {
    if (!currentSetlist || reorderedSectionSongIds.length === 0) return
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
  const reorderSectionSongs = (section: string, fromId: string, toId: string) => {
    if (!currentSetlist || fromId === toId) return
    const sectionSongIds = getSectionSongIds(section)
    const fromIndex = sectionSongIds.indexOf(fromId)
    const toIndex = sectionSongIds.indexOf(toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const reorderedSectionSongIds = [...sectionSongIds]
    const [moved] = reorderedSectionSongIds.splice(fromIndex, 1)
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    reorderedSectionSongIds.splice(insertIndex, 0, moved)
    applySectionSongOrder(section, reorderedSectionSongIds)
  }
  const assignGigSongSection = (gigId: string, songId: string, section: string) => {
    const normalizedSection = normalizeSetlistSectionLabel(section)
    if (!normalizedSection) return
    setGigSongSectionOverrides((prev) => ({
      ...prev,
      [gigId]: {
        ...(prev[gigId] ?? {}),
        [songId]: normalizedSection,
      },
    }))
    if (!supabase) return
    const client = supabase
    const tagPrefix = `${GIG_SECTION_TAG_PREFIX}${gigId}::%`
    void (async () => {
      const { error: clearError } = await client
        .from('SetlistSongTags')
        .delete()
        .eq('song_id', songId)
        .like('tag', tagPrefix)
      reportSupabaseError(clearError)
      const { error: insertError } = await client.from('SetlistSongTags').insert(withBandId({
        id: createId(),
        song_id: songId,
        tag: makeGigSectionTag(gigId, normalizedSection),
      }))
      reportSupabaseError(insertError)
    })()
  }
  const moveSongToGigSection = (
    fromSection: string,
    toSection: string,
    songId: string,
    beforeSongId?: string,
  ) => {
    if (!currentSetlist) return
    const sourceSong = appState.songs.find((song) => song.id === songId)
    if (!sourceSong) return
    const normalizedToSection = normalizeSetlistSectionLabel(toSection)
    if (!normalizedToSection) return

    if (fromSection.trim().toLowerCase() === normalizedToSection.trim().toLowerCase()) {
      if (beforeSongId) {
        reorderSectionSongs(fromSection, songId, beforeSongId)
      }
      return
    }

    const withoutSong = currentSetlist.songIds.filter((id) => id !== songId)
    const targetSongs = withoutSong.filter((id) => {
      const song = appState.songs.find((item) => item.id === id)
      if (!song) return false
      return songMatchesGigSection(song, normalizedToSection, currentSetlist.id)
    })

    let insertionIndex = withoutSong.length
    if (beforeSongId) {
      const beforeIndex = withoutSong.indexOf(beforeSongId)
      insertionIndex = beforeIndex >= 0 ? beforeIndex : insertionIndex
    } else if (targetSongs.length > 0) {
      const lastTargetId = targetSongs[targetSongs.length - 1]
      const lastTargetIndex = withoutSong.indexOf(lastTargetId)
      insertionIndex = lastTargetIndex >= 0 ? lastTargetIndex + 1 : insertionIndex
    }
    const nextSongIds = [...withoutSong]
    nextSongIds.splice(insertionIndex, 0, songId)

    setBuildPanelDirty(true)
    commitChange(`Move song to ${normalizedToSection}`, (prev) => ({
      ...prev,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id ? { ...setlist, songIds: nextSongIds } : setlist,
      ),
    }))
    assignGigSongSection(currentSetlist.id, songId, normalizedToSection)
    flashMovedSong(songId)

    if (supabase) {
      const client = supabase
      nextSongIds.forEach((id, index) => {
        runSupabase(
          client.from('SetlistGigSongs').update({ sort_order: index }).eq('gig_id', currentSetlist.id).eq(
            'song_id',
            id,
          ),
        )
      })
    }
  }

  const reorderSpecialRequests = (fromId: string, toId: string) => {
    if (!currentSetlist || fromId === toId) return
    const gigId = currentSetlist.id
    const requests = getOrderedSpecialRequests(gigId)
    const fromIndex = requests.findIndex((request) => request.id === fromId)
    const toIndex = requests.findIndex((request) => request.id === toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    const reordered = [...requests]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const reorderedIds = reordered.map((request) => request.id)

    setBuildPanelDirty(true)
    setSpecialRequestOrderByGig((prev) => ({
      ...prev,
      [gigId]: reorderedIds,
    }))
    commitChange('Reorder special requests', (prev) => {
      const byId = new Map(prev.specialRequests.map((request) => [request.id, request]))
      const orderedForGig = reorderedIds
        .map((id) => byId.get(id))
        .filter((request): request is SpecialRequest => Boolean(request))
      const others = prev.specialRequests.filter((request) => request.gigId !== gigId)
      return {
        ...prev,
        specialRequests: [...others, ...orderedForGig],
      }
    })
  }
  const autoScrollDragContainer = (event: React.DragEvent<HTMLElement>) => {
    const container = event.currentTarget.closest('[data-drag-scroll-container="build-panel"]')
    if (!(container instanceof HTMLElement)) return
    const rect = container.getBoundingClientRect()
    const edgeThreshold = 90
    const maxStep = 24
    let delta = 0
    if (event.clientY < rect.top + edgeThreshold) {
      const ratio = Math.min(1, (rect.top + edgeThreshold - event.clientY) / edgeThreshold)
      delta = -Math.ceil(maxStep * ratio)
    } else if (event.clientY > rect.bottom - edgeThreshold) {
      const ratio = Math.min(1, (event.clientY - (rect.bottom - edgeThreshold)) / edgeThreshold)
      delta = Math.ceil(maxStep * ratio)
    }
    if (delta !== 0) {
      container.scrollTop += delta
    }
  }
  const openManualSectionOrderModal = (section: string) => {
    const sectionSongIds = getSectionSongIds(section)
    if (!sectionSongIds.length) return
    setManualSectionOrderSection(section)
    setManualSectionOrderSelections(Array.from({ length: sectionSongIds.length }, () => ''))
    setManualSectionOrderError('')
    setShowManualSectionOrderModal(true)
  }
  const closeManualSectionOrderModal = () => {
    setShowManualSectionOrderModal(false)
    setManualSectionOrderSection(null)
    setManualSectionOrderSelections([])
    setManualSectionOrderError('')
  }
  const applyManualSectionOrder = () => {
    if (!manualSectionOrderSection) return
    const sectionSongs = getSectionSongs(manualSectionOrderSection)
    if (!sectionSongs.length) return
    const firstEmptyIndex = manualSectionOrderSelections.findIndex((songId) => !songId)
    const selectedPrefix =
      firstEmptyIndex === -1
        ? manualSectionOrderSelections
        : manualSectionOrderSelections.slice(0, firstEmptyIndex)
    if (!selectedPrefix.length) {
      setManualSectionOrderError('Choose at least Position 1 to apply manual order.')
      return
    }
    const hasGapAfterStart =
      firstEmptyIndex !== -1 &&
      manualSectionOrderSelections.slice(firstEmptyIndex + 1).some((songId) => Boolean(songId))
    if (hasGapAfterStart) {
      setManualSectionOrderError(
        'Use consecutive positions from the top (no gaps between selected songs).',
      )
      return
    }
    const unique = new Set(selectedPrefix)
    if (unique.size !== selectedPrefix.length) {
      setManualSectionOrderError('Each song can only be selected once.')
      return
    }
    const validIds = new Set(sectionSongs.map((song) => song.id))
    const selectedTopSongs = selectedPrefix.filter((songId) => validIds.has(songId))
    if (selectedTopSongs.length !== selectedPrefix.length) {
      setManualSectionOrderError('One or more selections are invalid. Please reselect.')
      return
    }
    const selectedSet = new Set(selectedTopSongs)
    const remainingSongIds = sectionSongs
      .map((song) => song.id)
      .filter((songId) => !selectedSet.has(songId))
    const nextOrder = [...selectedTopSongs, ...remainingSongIds]
    applySectionSongOrder(manualSectionOrderSection, nextOrder)
    closeManualSectionOrderModal()
  }

  const addGigSetlistSection = (requestedLabel: string) => {
    if (!currentSetlist) return
    const normalized = normalizeSetlistSectionLabel(requestedLabel)
    if (!normalized) return
    if (isReservedBuildPanel(normalized.toLowerCase())) return
    const existing = orderedSetSections.find(
      (section) => section.toLowerCase() === normalized.toLowerCase(),
    )
    if (existing) return
    setBuildPanelDirty(true)
    setGigSetlistSections((prev) => {
      const next = {
        ...prev,
        [currentSetlist.id]: [...orderedSetSections, normalized],
      }
      return next
    })
    setGigHiddenSetlistSections((prev) => {
      const hidden = prev[currentSetlist.id] ?? []
      if (!hidden.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
        return prev
      }
      const next = {
        ...prev,
        [currentSetlist.id]: hidden.filter(
          (item) => item.toLowerCase() !== normalized.toLowerCase(),
        ),
      }
      return next
    })
    setAppState((prev) => ({
      ...prev,
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, normalized])),
    }))
  }

  const reorderGigSetlistSections = (fromSection: string, toSection: string) => {
    if (!currentSetlist || fromSection === toSection) return
    const fromIndex = orderedSetSections.findIndex(
      (section) => section.toLowerCase() === fromSection.toLowerCase(),
    )
    const toIndex = orderedSetSections.findIndex(
      (section) => section.toLowerCase() === toSection.toLowerCase(),
    )
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const reordered = [...orderedSetSections]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    setBuildPanelDirty(true)
    setGigSetlistSections((prev) => ({
      ...prev,
      [currentSetlist.id]: reordered,
    }))
  }
  const renameGigSetlistSectionLabel = (fromSection: string, toSection: string) => {
    if (!currentSetlist) return
    const normalizedFrom = normalizeSetlistSectionLabel(fromSection)
    const normalizedTo = normalizeSetlistSectionLabel(toSection)
    if (!normalizedFrom || !normalizedTo) return
    if (normalizedFrom.toLowerCase() === normalizedTo.toLowerCase()) return

    setGigSetlistSections((prev) => ({
      ...prev,
      [currentSetlist.id]: (prev[currentSetlist.id] ?? []).map((section) =>
        section.toLowerCase() === normalizedFrom.toLowerCase() ? normalizedTo : section,
      ),
    }))
    setGigHiddenSetlistSections((prev) => ({
      ...prev,
      [currentSetlist.id]: (prev[currentSetlist.id] ?? []).map((section) =>
        section.toLowerCase() === normalizedFrom.toLowerCase() ? normalizedTo : section,
      ),
    }))
    setBuildCompleteOverrides((prev) => {
      const gigOverrides = prev[currentSetlist.id] ?? {}
      const fromKey = setlistPanelKey(normalizedFrom)
      const toKey = setlistPanelKey(normalizedTo)
      if (!(fromKey in gigOverrides)) return prev
      const nextGigOverrides = { ...gigOverrides, [toKey]: gigOverrides[fromKey] }
      delete nextGigOverrides[fromKey]
      return {
        ...prev,
        [currentSetlist.id]: nextGigOverrides,
      }
    })
    setStarterPasteOpen((prev) => {
      if (!(normalizedFrom in prev)) return prev
      const next = { ...prev, [normalizedTo]: prev[normalizedFrom] }
      delete next[normalizedFrom]
      return next
    })
    setStarterPasteBySection((prev) => {
      if (!(normalizedFrom in prev)) return prev
      const next = { ...prev, [normalizedTo]: prev[normalizedFrom] }
      delete next[normalizedFrom]
      return next
    })
    setGigSongSectionOverrides((prev) => {
      const bySong = prev[currentSetlist.id]
      if (!bySong) return prev
      const nextBySong = Object.fromEntries(
        Object.entries(bySong).map(([songId, section]) => [
          songId,
          section.toLowerCase() === normalizedFrom.toLowerCase() ? normalizedTo : section,
        ]),
      )
      return {
        ...prev,
        [currentSetlist.id]: nextBySong,
      }
    })
    if (getSectionFromPanel(activeBuildPanel)?.toLowerCase() === normalizedFrom.toLowerCase()) {
      setActiveBuildPanel(setlistPanelKey(normalizedTo))
    }

    if (supabase) {
      const oldTag = makeGigSectionTag(currentSetlist.id, normalizedFrom)
      const newTag = makeGigSectionTag(currentSetlist.id, normalizedTo)
      runSupabase(
        supabase
          .from('SetlistSongTags')
          .update({ tag: newTag })
          .eq('band_id', activeBandId)
          .eq('tag', oldTag),
      )
    }
  }

  const addGigSetlistSectionFromTemplate = (template: string) => {
    const current = orderedSetSections
    if (template === 'Dance') {
      const danceCount = current.filter((section) =>
        section.toLowerCase().startsWith('dance'),
      ).length
      if (
        danceCount === 1 &&
        current.some((section) => section.toLowerCase() === 'dance')
      ) {
        renameGigSetlistSectionLabel('Dance', 'Dance Set 1')
      }
      const label = danceCount === 0 ? 'Dance' : `Dance Set ${danceCount + 1}`
      addGigSetlistSection(label)
      return
    }
    if (template === 'Dinner') {
      const dinnerCount = current.filter((section) =>
        section.toLowerCase().startsWith('dinner'),
      ).length
      if (
        dinnerCount === 1 &&
        current.some((section) => section.toLowerCase() === 'dinner')
      ) {
        renameGigSetlistSectionLabel('Dinner', 'Dinner Set 1')
      }
      const label = dinnerCount === 0 ? 'Dinner' : `Dinner Set ${dinnerCount + 1}`
      addGigSetlistSection(label)
      return
    }
    if (template === 'Latin') {
      const latinCount = current.filter((section) =>
        section.toLowerCase().startsWith('latin'),
      ).length
      if (
        latinCount === 1 &&
        current.some((section) => section.toLowerCase() === 'latin')
      ) {
        renameGigSetlistSectionLabel('Latin', 'Latin Set 1')
      }
      const label = latinCount === 0 ? 'Latin' : `Latin Set ${latinCount + 1}`
      addGigSetlistSection(label)
      return
    }
    if (template === 'Special Requests') {
      if (!currentSetlist) return
      setGigHiddenSpecialSection((prev) => ({
        ...prev,
        [currentSetlist.id]: false,
      }))
      return
    }
    addGigSetlistSection(template)
  }

  const requestDeleteSetlistSection = (section: string) => {
    setPendingDeleteSetlistSection(section)
    setShowDeleteSetlistSectionConfirm(true)
  }

  const confirmDeleteSetlistSection = () => {
    if (!currentSetlist || !pendingDeleteSetlistSection) return
    const section = pendingDeleteSetlistSection
    const normalized = section.trim().toLowerCase()
    if (normalized === 'special request' || normalized === 'special requests') {
      setBuildPanelDirty(true)
      setGigHiddenSpecialSection((prev) => ({
        ...prev,
        [currentSetlist.id]: true,
      }))
      if (activeBuildPanel === 'special') {
        setActiveBuildPanel(null)
      }
      setPendingDeleteSetlistSection(null)
      setShowDeleteSetlistSectionConfirm(false)
      return
    }
    setBuildPanelDirty(true)
    setGigSetlistSections((prev) => ({
      ...prev,
      [currentSetlist.id]: (prev[currentSetlist.id] ?? []).filter(
        (item) => item.toLowerCase() !== section.toLowerCase(),
      ),
    }))
    setGigHiddenSetlistSections((prev) => ({
      ...prev,
      [currentSetlist.id]: Array.from(
        new Set([...(prev[currentSetlist.id] ?? []), section]),
      ),
    }))
    setBuildCompleteOverrides((prev) => {
      const gigOverrides = prev[currentSetlist.id] ?? {}
      const key = setlistPanelKey(section)
      if (!(key in gigOverrides)) return prev
      const rest = { ...gigOverrides }
      delete rest[key]
      return {
        ...prev,
        [currentSetlist.id]: rest,
      }
    })
    setStarterPasteOpen((prev) => {
      const next = { ...prev }
      delete next[section]
      return next
    })
    setStarterPasteBySection((prev) => {
      const next = { ...prev }
      delete next[section]
      return next
    })
    if (getSectionFromPanel(activeBuildPanel)?.toLowerCase() === section.toLowerCase()) {
      setActiveBuildPanel(null)
    }
    setPendingDeleteSetlistSection(null)
    setShowDeleteSetlistSectionConfirm(false)
  }

  const cancelDeleteSetlistSection = () => {
    setPendingDeleteSetlistSection(null)
    setShowDeleteSetlistSectionConfirm(false)
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
  const clearSheetLongPress = () => {
    if (sheetLongPressTimerRef.current) {
      window.clearTimeout(sheetLongPressTimerRef.current)
      sheetLongPressTimerRef.current = null
    }
  }
  const startGigSheetLongPress = (songId: string) => {
    clearSheetLongPress()
    sheetLongPressTriggeredRef.current = false
    sheetLongPressTimerRef.current = window.setTimeout(() => {
      sheetLongPressTriggeredRef.current = true
      markGigSongAsSelected(songId)
      sheetLongPressTimerRef.current = null
    }, 1000)
  }
  const endGigSheetLongPress = () => {
    clearSheetLongPress()
  }
  const updateSheetDragHover = (section: string, songId: string | null) => {
    if (sheetDragOverSectionRef.current !== section) {
      sheetDragOverSectionRef.current = section
      setSheetDragOverSection(section)
    }
    if (sheetDragOverSongRef.current !== songId) {
      sheetDragOverSongRef.current = songId
      setSheetDragOverSongId(songId)
    }
  }
  const clearSheetDragHover = () => {
    sheetDragOverSongRef.current = null
    sheetDragOverSectionRef.current = null
    setSheetDragOverSongId(null)
    setSheetDragOverSection(null)
  }
  useEffect(() => () => clearSheetLongPress(), [])

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
        supabase.from('SetlistMusicians').insert(withBandId({
          id,
          name,
          roster: newMusicianRoster,
          email: newMusicianEmail.trim() || null,
          phone: newMusicianPhone.trim() || null,
          instruments: newMusicianInstruments,
          singer: newMusicianSinger || null,
        })),
      )
    }
    setNewMusicianName('')
    setNewMusicianEmail('')
    setNewMusicianPhone('')
    setNewMusicianInstruments([])
    setNewMusicianSinger('')
    setNewMusicianRoster('core')
  }

  const ensureGigExistsInSupabase = async (gigId: string) => {
    if (!supabase) return { error: null as { message?: string } | null }
    if (!activeBandId) {
      return { error: { message: 'No active band selected.' } as { message?: string } }
    }
    const gig = appState.setlists.find((setlist) => setlist.id === gigId)
    if (!gig) return { error: null as { message?: string } | null }
    return await supabase.from('SetlistGigs').upsert(
      withBandId({
        id: gig.id,
        gig_name: gig.gigName,
        gig_date: gig.date,
        venue_address: gig.venueAddress ?? '',
      }),
      { onConflict: 'id' },
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
      runSupabase(
        (async () => {
          const ensureResult = await ensureGigExistsInSupabase(activeGigId)
          if (ensureResult.error) return { error: ensureResult.error }
          const { error: deleteError } = await supabase
            .from('SetlistGigMusicians')
            .delete()
            .eq('gig_id', activeGigId)
          if (deleteError) return { error: deleteError }
          const { error: insertError } = await supabase.from('SetlistGigMusicians').insert(
            coreMusicians.map((musician) => withBandId({
              id: createId(),
              gig_id: activeGigId,
              musician_id: musician.id,
              status: 'active',
            })),
          )
          return { error: insertError }
        })(),
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
        (async () => {
          const ensureResult = await ensureGigExistsInSupabase(activeGigId)
          if (ensureResult.error) return { error: ensureResult.error }
          const { error } = await supabase.from('SetlistGigMusicians').insert(withBandId({
            id: createId(),
            gig_id: activeGigId,
            musician_id: musicianId,
            status: 'active',
          }))
          return { error }
        })(),
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
        (async () => {
          const ensureResult = await ensureGigExistsInSupabase(activeGigId)
          if (ensureResult.error) return { error: ensureResult.error }
          const { error: musicianInsertError } = await supabase.from('SetlistMusicians').insert(withBandId({
            id,
            name,
            roster: 'sub',
            email: newSubEmail.trim() || null,
            phone: newSubPhone.trim() || null,
            instruments: newSubInstruments,
            singer: newSubSinger || null,
          }))
          if (musicianInsertError) return { error: musicianInsertError }
          const { error: gigMusicianInsertError } = await supabase.from('SetlistGigMusicians').insert(withBandId({
            id: createId(),
            gig_id: activeGigId,
            musician_id: id,
            status: 'active',
          }))
          return { error: gigMusicianInsertError }
        })(),
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
    const value = normalizeInstrumentName(newInstrumentInput)
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
    setNewDocInstruments([])
    setNewDocTitle('')
    setNewDocUrl('')
    setNewDocFile(null)
    setNewDocLyrics('')
  }

  const openSongEditorFromSpecialRequest = () => {
    const trimmedTitle = pendingSpecialSong.trim()
    if (!trimmedTitle) return
    if (pendingSpecialSongMatch) {
      openSongEditor(pendingSpecialSongMatch)
      setShowSpecialRequestModal(false)
      return
    }
    setNewSongArtist('')
    setNewSongAudio(pendingSpecialExternalUrl.trim())
    setNewSongOriginalKey(pendingSpecialDjOnly ? '' : pendingSpecialKey.trim())
    setNewSongTitle(trimmedTitle)
    setNewSongTags(
      normalizeTagList(['Special Request', pendingSpecialType.trim()].filter(Boolean)),
    )
    setSongFormError('')
    setPendingSongDraft(null)
    setSimilarSongMatches([])
    setShowDuplicateSongConfirm(false)
    setShowAddSongModal(true)
    setShowSpecialRequestModal(false)
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
    if (role !== 'admin' && newDocType === 'Lead Sheet') {
      setDocFormError('Only Chart and Lyrics are allowed in musician view.')
      return false
    }
    setDocFormError('')
    setShowDocInstrumentWarning(false)
    const instruments =
      newDocType === 'Lyrics'
        ? ['Vocals']
        : newDocInstruments.length
          ? newDocInstruments.map((item) => normalizeInstrumentName(item))
          : []
    if (
      (newDocType === 'Chart' || newDocType === 'Lead Sheet') &&
      (instruments.length === 0 || instruments.includes('All'))
    ) {
      setDocFormError('Select one or more instruments before saving this chart.')
      setShowDocInstrumentWarning(true)
      return false
    }
    const normalizedInstruments = normalizeTagList(instruments.filter(Boolean))
    const finalInstruments = normalizedInstruments.includes('All')
      ? ['All']
      : normalizedInstruments.length
        ? normalizedInstruments
        : ['All']
    const title =
      newDocType === 'Lyrics'
        ? `${selectedSong.title}${selectedSong.artist ? ` - ${selectedSong.artist}` : ''}`
        : newDocTitle.trim() ||
          `${selectedSong.title} ${newDocType === 'Chart' ? 'Chart' : newDocType}`
    const docsToSave = finalInstruments.map((instrument) => {
      const existingDoc = appState.documents.find(
        (doc) =>
          doc.songId === selectedSong.id &&
          doc.type === newDocType &&
          normalizeInstrumentName(doc.instrument) === instrument &&
          doc.title === title,
      )
      return {
        existing: existingDoc,
        doc: {
          id: existingDoc?.id ?? createId(),
          songId: selectedSong.id,
          type: newDocType,
          instrument,
          title,
        } as Document,
      }
    })
    const uploadedUrl = newDocFile
      ? await uploadDocFile(newDocFile, selectedSong.id, docsToSave[0]?.doc.id ?? createId())
      : null
    const fileUrl = newDocUrl.trim() || uploadedUrl || newDocFile?.name || null
    const content = newDocType === 'Lyrics' ? newDocLyrics.trim() || undefined : undefined
    const documentsToPersist = docsToSave.map(({ existing, doc }) => ({
      existing,
      doc: {
        ...doc,
        url: fileUrl ?? undefined,
        content,
      },
    }))

    setAppState((prev) => {
      let nextDocuments = [...prev.documents]
      documentsToPersist.forEach(({ doc }) => {
        const index = nextDocuments.findIndex((item) => item.id === doc.id)
        if (index >= 0) {
          nextDocuments[index] = doc
        } else {
          nextDocuments = [doc, ...nextDocuments]
        }
      })
      const nextCharts =
        newDocType === 'Chart'
          ? nextDocuments
              .filter((item) => item.type === 'Chart')
              .map((item) => ({
                id: item.id,
                songId: item.songId,
                instrument: item.instrument,
                title: item.title,
                fileName: item.url,
              }))
          : prev.charts
      return { ...prev, documents: nextDocuments, charts: nextCharts }
    })

    if (supabase) {
      const client = supabase
      documentsToPersist.forEach(({ existing, doc }) => {
        if (existing) {
          runSupabase(
            client
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
            client.from('SetlistDocuments').insert(withBandId({
              id: doc.id,
              song_id: doc.songId,
              doc_type: doc.type,
              instrument: doc.instrument,
              title: doc.title,
              file_url: doc.url ?? null,
              content: doc.content ?? null,
            })),
          )
        }
      })
    }

    if (clearAfter) {
      setNewDocSongId('')
      setNewDocSongTitle('')
      setNewDocType('')
      setNewDocInstruments([])
      setNewDocTitle('')
      setNewDocUrl('')
      setNewDocFile(null)
      setNewDocLyrics('')
    } else {
      setNewDocFile(null)
    }
    return true
  }

  saveDocumentFromEditorRef.current = saveDocumentFromEditor

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
        supabase.from('SetlistSongs').insert(withBandId({
          id,
          title: draft.title,
          artist: draft.artist || null,
          audio_url: draft.audioUrl || null,
          original_key: draft.originalKey || null,
        })),
      )
      if (draft.tags.length) {
        runSupabase(
          supabase.from('SetlistSongTags').insert(
            draft.tags.map((tag) => withBandId({
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
            normalizedEditingTags.map((tag) => withBandId({
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

  useEffect(() => {
    if (showSpecialRequestModal) return
    setEditingSpecialRequestId(null)
  }, [showSpecialRequestModal])

  const resetPendingSpecialRequest = () => {
    setPendingSpecialType('')
    setPendingSpecialSong('')
    setPendingSpecialSingers([])
    setPendingSpecialKey('')
    setPendingSpecialNote('')
    setPendingSpecialDjOnly(false)
    setPendingSpecialExternalUrl('')
    setSpecialRequestError('')
    setEditingSpecialRequestId(null)
  }

  const openSpecialRequestEditor = (request: SpecialRequest) => {
    setPendingSpecialType(request.type ?? '')
    setPendingSpecialSong(request.songTitle ?? '')
    setPendingSpecialSingers(request.djOnly ? [] : normalizeTagList(request.singers ?? []))
    setPendingSpecialKey(request.djOnly ? '' : request.key ?? '')
    setPendingSpecialNote(request.note ?? '')
    setPendingSpecialDjOnly(Boolean(request.djOnly))
    setPendingSpecialExternalUrl(request.externalAudioUrl ?? '')
    setSpecialRequestError('')
    setEditingSpecialRequestId(request.id)
    setShowSpecialRequestModal(true)
  }
  const deleteSpecialRequest = (requestId: string) => {
    if (!currentSetlist) return
    setBuildPanelDirty(true)
    commitChange('Delete special request', (prev) => ({
      ...prev,
      specialRequests: prev.specialRequests.filter((request) => request.id !== requestId),
    }))
    setSpecialRequestOrderByGig((prev) => {
      const ordered = prev[currentSetlist.id] ?? []
      if (!ordered.includes(requestId)) return prev
      return {
        ...prev,
        [currentSetlist.id]: ordered.filter((id) => id !== requestId),
      }
    })
    if (supabase) {
      runSupabase(supabase.from('SetlistSpecialRequests').delete().eq('id', requestId))
    }
  }

  const updateSpecialRequest = () => {
    if (!currentSetlist || !editingSpecialRequestId) return
    setBuildPanelDirty(true)
    setSpecialRequestError('')
    const type = pendingSpecialType.trim()
    const customSong = pendingSpecialSong.trim()
    if (!type || !customSong) {
      setSpecialRequestError('Request type and song title are required.')
      return
    }
    const matchingSong = appState.songs.find(
      (song) => song.title.trim().toLowerCase() === customSong.toLowerCase(),
    )
    const normalizedSingers = pendingSpecialDjOnly ? [] : normalizeTagList(pendingSpecialSingers)
    const normalizedKey = pendingSpecialDjOnly ? '' : pendingSpecialKey.trim()
    const nextSongId = matchingSong?.id
    commitChange('Update special request', (prev) => ({
      ...prev,
      specialRequests: prev.specialRequests.map((request) =>
        request.id === editingSpecialRequestId
          ? {
              ...request,
              type,
              songTitle: customSong,
              songId: nextSongId,
              singers: normalizedSingers,
              key: normalizedKey,
              note: pendingSpecialNote.trim() || undefined,
              djOnly: pendingSpecialDjOnly,
              externalAudioUrl: pendingSpecialExternalUrl.trim() || undefined,
            }
          : request,
      ),
      specialTypes: prev.specialTypes.includes(type) ? prev.specialTypes : [...prev.specialTypes, type],
    }))
    if (supabase) {
      runSupabase(
        supabase
          .from('SetlistSpecialRequests')
          .update(
            withBandId({
              request_type: type,
              song_title: customSong,
              song_id: nextSongId ?? null,
              singers: normalizedSingers,
              song_key: normalizedKey || null,
              note: pendingSpecialNote.trim() || null,
              dj_only: pendingSpecialDjOnly,
              external_audio_url: pendingSpecialExternalUrl.trim() || null,
            }),
          )
          .eq('id', editingSpecialRequestId),
      )
    }
    resetPendingSpecialRequest()
    setShowSpecialRequestModal(false)
  }

  const saveSpecialRequest = () => {
    if (editingSpecialRequestId) {
      updateSpecialRequest()
      return
    }
    addSpecialRequest()
  }

  const addSpecialRequest = () => {
    if (!currentSetlist) return
    setBuildPanelDirty(true)
    setSpecialRequestError('')
    const type = pendingSpecialType.trim()
    const customSong = pendingSpecialSong.trim()
    const existingSong = appState.songs.find(
      (song) => song.title.toLowerCase() === customSong.toLowerCase(),
    )
    const songTitle = existingSong?.title ?? customSong
    const normalizedSingers = pendingSpecialDjOnly ? [] : normalizeTagList(pendingSpecialSingers)
    const normalizedKey = pendingSpecialDjOnly ? '' : pendingSpecialKey.trim()
    if (!type || !songTitle) {
      setSpecialRequestError('Request type and song title are required.')
      return
    }
    const requestId = createId()
    const createdSongId = existingSong?.id ?? createId()
    const requestTags = normalizeTagList(['Special Request'])
    const existingSongTagsLower = new Set(
      (existingSong?.tags ?? []).map((tag) => tag.trim().toLowerCase()),
    )
    const missingTagsForExistingSong = requestTags.filter(
      (tag) => !existingSongTagsLower.has(tag.toLowerCase()),
    )
    commitChange('Add special request', (prev) => {
      const nextSongs =
        existingSong || !customSong
          ? prev.songs.map((song) =>
              song.id === existingSong?.id
                ? {
                    ...song,
                    tags: Array.from(new Set([...song.tags, ...requestTags])),
                    specialPlayedCount: song.specialPlayedCount + 1,
                  }
                : song,
            )
          : [
              {
                id: createdSongId,
                title: customSong,
                artist: '',
                tags: requestTags,
                keys: normalizedSingers.map((singer) => ({
                  singer,
                  defaultKey: normalizedKey,
                  gigOverrides: {},
                })),
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
            singers: normalizedSingers,
            key: normalizedKey,
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
      }
    })
    setSpecialRequestOrderByGig((prev) => ({
      ...prev,
      [currentSetlist.id]: [requestId, ...(prev[currentSetlist.id] ?? []).filter((id) => id !== requestId)],
    }))
    resetPendingSpecialRequest()
    setShowSpecialRequestModal(false)
    if (supabase) {
      runSupabase(
        (async () => {
          // Ensure the referenced song row exists in Supabase before inserting special request.
          // This protects against legacy local-only songs causing FK failures.
          const { error: ensureSongError } = await supabase.from('SetlistSongs').upsert(
            withBandId({
              id: createdSongId,
              title: songTitle,
              artist: existingSong?.artist ?? '',
              audio_url: existingSong?.youtubeUrl ?? null,
              original_key: existingSong?.originalKey ?? null,
              deleted_at: null,
            }),
            { onConflict: 'id' },
          )
          if (ensureSongError) return { error: ensureSongError }

          if (!existingSong && customSong) {
            if (normalizedSingers.length > 0 && normalizedKey) {
              const { error: keyInsertError } = await supabase.from('SetlistSongKeys').insert(
                normalizedSingers.map((singer) => withBandId({
                  id: createId(),
                  song_id: createdSongId,
                  singer_name: singer,
                  default_key: normalizedKey,
                })),
              )
              if (keyInsertError) return { error: keyInsertError }
            }
          }

          const tagsToPersist = existingSong ? missingTagsForExistingSong : requestTags
          if (tagsToPersist.length > 0) {
            const { error: tagInsertError } = await supabase.from('SetlistSongTags').insert(
              tagsToPersist.map((tag) => withBandId({
                id: createId(),
                song_id: createdSongId,
                tag,
              })),
            )
            if (tagInsertError) return { error: tagInsertError }
          }

          const { error: requestInsertError } = await supabase
            .from('SetlistSpecialRequests')
            .insert(withBandId({
              id: requestId,
              gig_id: currentSetlist.id,
              request_type: type,
              song_title: songTitle,
              song_id: createdSongId,
              singers: normalizedSingers,
              song_key: normalizedKey || null,
              note: pendingSpecialNote.trim() || null,
              dj_only: pendingSpecialDjOnly,
              external_audio_url: pendingSpecialExternalUrl.trim() || null,
            }))
          return { error: requestInsertError }
        })(),
      )
    }
  }

  const hasDocsForSong = (songId?: string) => {
    if (!songId) return false
    return getDocumentSelectionItems(songId).length > 0
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
    const openSongDocsWithSelection = (targetSongId: string) => {
      const matchingDocs = getDocumentSelectionItems(targetSongId)
      if (matchingDocs.length === 0) return
      // Always open chooser popup first so admin/musician flows match.
      setDocModalSongId(targetSongId)
      setDocModalPageIndex(0)
      setDocModalContent(null)
    }
    if (role === 'admin') {
      setShowInstrumentPrompt(false)
      setPendingDocSongId(null)
      openSongDocsWithSelection(songId)
      return
    }
    if (!appState.instrument || appState.instrument.length === 0) {
      setPendingDocSongId(songId)
      setDocInstrumentDraft([])
      setShowInstrumentPrompt(true)
      return
    }
    openSongDocsWithSelection(songId)
  }
  const openLyricsForSong = (songId?: string) => {
    if (!songId) return
    const lyricsDoc = getDocumentSelectionItems(songId).find((doc) => doc.type === 'Lyrics')
    if (!lyricsDoc) return
    setShowInstrumentPrompt(false)
    setPendingDocSongId(null)
    setDocModalSongId(songId)
    setDocModalPageIndex(0)
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
    if (!supabase || !activeBandId) return
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
      supabase.from('SetlistSongs').select('*').eq('band_id', activeBandId).is('deleted_at', null),
      supabase.from('SetlistSongTags').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistSongKeys').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistGigs').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistGigSongs').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistGigSingerKeys').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistSpecialRequests').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistDocuments').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistMusicians').select('*').eq('band_id', activeBandId).is('deleted_at', null),
      supabase.from('SetlistGigMusicians').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistGigNowPlaying').select('*').eq('band_id', activeBandId),
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

    const toTagIdentity = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()
    const dedupeTags = (values: string[]) => {
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
    const specialTypes = Array.from(
      new Set([
        ...DEFAULT_SPECIAL_TYPES,
        ...(specialReqRes.data ?? []).map((r) => r.request_type),
      ]),
    )
    const reservedSetlistTagIdentities = new Set(
      DEFAULT_TAGS.map((tag) => toTagIdentity(tag)).filter(Boolean),
    )
    const specialTypeIdentities = new Set(
      specialTypes.map((type) => toTagIdentity(type)).filter(Boolean),
    )
    const isPollutedSpecialTypeTag = (tag: string) => {
      const trimmed = tag.trim()
      if (!trimmed) return false
      const lower = trimmed.toLowerCase()
      if (lower === 'special request' || lower === 'special requests') return false
      const identity = toTagIdentity(trimmed)
      if (!identity) return false
      if (reservedSetlistTagIdentities.has(identity)) return false
      return specialTypeIdentities.has(identity)
    }

    const tagsBySong = new Map<string, string[]>()
    const gigSectionOverrideMap = new Map<string, Record<string, string>>()
    tagsRes.data?.forEach((row) => {
      const gigSectionTag = parseGigSectionTag(row.tag)
      if (gigSectionTag) {
        const bySong = gigSectionOverrideMap.get(gigSectionTag.gigId) ?? {}
        bySong[row.song_id] = gigSectionTag.section
        gigSectionOverrideMap.set(gigSectionTag.gigId, bySong)
        return
      }
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
          tags: (tagsBySong.get(row.id) ?? []).filter((tag) => !isPollutedSpecialTypeTag(tag)),
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
        date: typeof row.gig_date === 'string' ? row.gig_date.slice(0, 10) : '',
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
        instrument: parseDocumentInstruments(row.instrument ?? 'All').join('||'),
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
        instruments: (row.instruments ?? []).map((item: string) => normalizeInstrumentName(item)),
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
      new Set([
        ...DEFAULT_TAGS,
        ...(tagsRes.data ?? []).map((t) => t.tag).filter((tag) => !tag.startsWith(GIG_SECTION_TAG_PREFIX)),
      ]),
    ).filter((tag) => !isPollutedSpecialTypeTag(tag))
    const pollutedTagValues = dedupeTags(
      (tagsRes.data ?? [])
        .map((row) => row.tag)
        .filter((tag) => isPollutedSpecialTypeTag(tag)),
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
    setGigSongSectionOverrides(
      Array.from(gigSectionOverrideMap.entries()).reduce<Record<string, Record<string, string>>>(
        (acc, [gigId, bySong]) => {
          acc[gigId] = bySong
          return acc
        },
        {},
      ),
    )

    if (pollutedTagValues.length > 0 && supabase && activeBandId) {
      void supabase
        .from('SetlistSongTags')
        .delete()
        .eq('band_id', activeBandId)
        .in('tag', pollutedTagValues)
    }

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
  }, [activeBandId, parseDocumentInstruments])

  const loadNowPlaying = useCallback(async () => {
    if (!supabase || !activeBandId) return
    const { data, error } = await supabase
      .from('SetlistGigNowPlaying')
      .select('*')
      .eq('band_id', activeBandId)
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
  }, [activeBandId])

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
        supabase.from('SetlistSongs').insert(withBandId({
          id: newId,
          title,
          artist: 'New Artist',
          audio_url: null,
        })),
      )
      runSupabase(
        supabase.from('SetlistSongKeys').insert(withBandId({
          id: createId(),
          song_id: newId,
          singer_name: 'Maya',
          default_key: 'C',
        })),
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

  const handlePrintSetlistPDF = () => {
    if (!currentSetlist) return
    window.requestAnimationFrame(() => {
      window.print()
    })
  }

  const getPrintableSetlistElement = () => {
    const preview = document.getElementById('printable-setlist-preview')
    return preview instanceof HTMLElement ? preview : null
  }

  const handleDownloadPDF = async () => {
    if (!currentSetlist) return
    const element = getPrintableSetlistElement()
    if (!element) {
      setSupabaseError('Unable to generate PDF preview. Please reopen the preview and try again.')
      return
    }
    const safeBand = (activeBandName || 'band').replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const safeGig = currentSetlist.gigName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const safeDate = (currentSetlist.date || '').replace(/[^0-9-]/g, '')
    const exportName = `${safeBand}_${safeGig}_${safeDate || 'date'}_setlist.pdf`
    try {
      const html2pdf = (await import('html2pdf.js')).default
      const pdfOptions = {
        margin: 0.2,
        filename: exportName,
        enableLinks: true,
        image: { type: 'png', quality: 1 },
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['.print-row', '.print-card', '.print-section-title', '.print-row-note'],
        },
        html2canvas: {
          scale: 3,
          useCORS: true,
          backgroundColor: '#ffffff',
          onclone: (clonedDocument: unknown) => {
            const clonedPreview = (
              clonedDocument as { getElementById?: (id: string) => Element | null }
            ).getElementById?.('printable-setlist-preview')
            clonedPreview?.classList.add('pdf-export-mode')
          },
        },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      } as const
      await html2pdf()
        .set(pdfOptions as unknown as Record<string, unknown>)
        .from(element)
        .save()
    } catch (error) {
      console.error('PDF download failed:', error)
      setSupabaseError('Download failed. Please try Print and choose "Save as PDF".')
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
            {bands.length > 1 && (
              <select
                className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
                value={activeBandId}
                onChange={(event) => setActiveBandId(event.target.value)}
              >
                {bands.map((band) => (
                  <option key={band.id} value={band.id}>
                    {band.name}
                  </option>
                ))}
              </select>
            )}
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
                onClick={() => {
                  if (gigMode) {
                    setGigMode(false)
                    setShowGigSetlistSheet(false)
                    setShowGigModeLaunchModal(false)
                    return
                  }
                  setShowGigModeLaunchModal(true)
                }}
              >
                <span>{gigMode ? 'Gig Mode On' : 'Gig Mode'}</span>
              </button>
            )}
            {role && (
              <>
                {authUserEmail && <span className="hidden sm:inline">{authUserEmail}</span>}
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => void handleLogout()}
                >
                  Log out
                </button>
              </>
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
              if (appState.currentSongId) setDismissedUpNextId(appState.currentSongId)
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
                  if (isAdmin) {
                    finishGigQueuedSong()
                  } else if (appState.currentSongId) {
                    setDismissedUpNextId(appState.currentSongId)
                  }
                }}
              >
                Finished Song
              </button>
              {gigMode && currentSetlist && gigLastLockedSongByGig[currentSetlist.id] && (
                <button
                  className="relative z-10 inline-flex min-h-[44px] items-center rounded-full bg-slate-950/30 px-4 py-2 text-sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    undoLastGigSongSelection()
                  }}
                >
                  Undo song
                </button>
              )}
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
    if (!activeBandId) return
    void loadSupabaseData()
  }, [activeBandId, loadSupabaseData])

  useEffect(() => {
    if (!activeBandId) return
    localStorage.setItem(ACTIVE_BAND_KEY, activeBandId)
    const membership = memberships.find(
      (item) => item.bandId === activeBandId && item.status === 'active',
    )
    setRole(membership?.role === 'admin' ? 'admin' : membership ? 'user' : null)
  }, [activeBandId, memberships])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    let syncToken = 0
    const syncAuthState = async (user: { id?: string; email?: string } | null) => {
      const token = ++syncToken
      setAuthLoading(false)
      setAuthUserId(user?.id ?? null)
      setAuthUserEmail(user?.email ?? null)
      if (!user?.id) {
        setRole(null)
        setBands([])
        setMemberships([])
        setActiveBandId('')
        setLoginPhase('login')
        return
      }
      setLoginPhase('app')
      await loadBandContext(user.id)
      // Ignore stale async completions when another auth event has fired.
      if (cancelled || token !== syncToken) return
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      void syncAuthState(data.session?.user ?? null)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      void syncAuthState(session?.user ?? null)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadBandContext])

  useEffect(() => {
    if (!supabase || !authUserId) return
    const params = new URLSearchParams(window.location.search)
    const inviteToken = params.get('invite')
    if (!inviteToken) return
    void (async () => {
      const { error } = await supabase.rpc('accept_band_invite', { p_token: inviteToken })
      if (error) {
        setSupabaseError(`Invite accept failed: ${error.message}`)
        return
      }
      params.delete('invite')
      const next = params.toString()
      const newUrl = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', newUrl)
      await loadBandContext(authUserId)
    })()
  }, [authUserId, loadBandContext])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('playlist') !== '1') return
    const setlistId = params.get('setlist')
    if (!setlistId) return
    const requestedIndexRaw = Number.parseInt(params.get('item') ?? '0', 10)
    const requestedIndex =
      Number.isFinite(requestedIndexRaw) && requestedIndexRaw >= 0 ? requestedIndexRaw : 0
    const sharedBandNameParam = safeDecodeURIComponent(params.get('band') ?? '').trim()
    const sharedMusiciansParam = parseSharedMusiciansPayload(params.get('musicians'))
    const payloadEncoded = params.get('data')
    if (payloadEncoded) {
      const parsed = parseSharedPlaylistPayload(payloadEncoded)
      if (parsed) {
        setSharedPlaylistView({
          setlistId: parsed.setlistId || setlistId,
          bandName: parsed.bandName ?? sharedBandNameParam ?? activeBandName ?? 'Band',
          gigName: parsed.gigName || 'Shared Gig',
          date: parsed.date || '',
          venueAddress: parsed.venueAddress ?? '',
          musicians: parsed.musicians ?? sharedMusiciansParam,
          entries: parsed.entries,
        })
        setSharedPlaylistError(null)
        setSharedPlaylistLoading(false)
        setPlaylistIndex(Math.min(requestedIndex, Math.max(0, parsed.entries.length - 1)))
        setPlaylistAutoAdvance(true)
        return
      }
    }
    const targetSetlist = appState.setlists.find((setlist) => setlist.id === setlistId)
    if (targetSetlist) {
      setSharedPlaylistView(null)
      setSharedPlaylistError(null)
      setSharedPlaylistLoading(false)
      setSelectedSetlistId(setlistId)
      setScreen('builder')
      setPlaylistIndex(requestedIndex)
      setPlaylistAutoAdvance(true)
      setShowPlaylistModal(true)
      params.delete('playlist')
      params.delete('setlist')
      params.delete('item')
      const next = params.toString()
      const newUrl = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', newUrl)
      return
    }
    if (!supabase) {
      setSharedPlaylistError('Shared playlist is unavailable right now.')
      setSharedPlaylistLoading(false)
      return
    }
    let cancelled = false
    setSharedPlaylistLoading(true)
    setSharedPlaylistError(null)
    void (async () => {
      const [gigRes, gigSongsRes, songsRes, specialReqRes] = await Promise.all([
        supabase
          .from('SetlistGigs')
          .select('id, band_id, gig_name, gig_date, venue_address')
          .eq('id', setlistId)
          .single(),
        supabase
          .from('SetlistGigSongs')
          .select('song_id, sort_order')
          .eq('gig_id', setlistId)
          .order('sort_order', { ascending: true }),
        supabase
          .from('SetlistSongs')
          .select('id, title, artist, audio_url')
          .is('deleted_at', null),
        supabase
          .from('SetlistSpecialRequests')
          .select('id, song_id, song_title, singers, song_key, external_audio_url, dj_only')
          .eq('gig_id', setlistId),
      ])
      if (cancelled) return
      const firstError =
        gigRes.error || gigSongsRes.error || songsRes.error || specialReqRes.error
      if (firstError) {
        setSharedPlaylistError(firstError.message ?? 'Shared playlist failed to load.')
        setSharedPlaylistView(null)
        setSharedPlaylistLoading(false)
        return
      }
      const gig = gigRes.data
      if (!gig) {
        setSharedPlaylistError('Gig not found for this share link.')
        setSharedPlaylistView(null)
        setSharedPlaylistLoading(false)
        return
      }
      let sharedBandName = activeBandName || 'Band'
      if (gig.band_id) {
        const { data: bandRow } = await supabase
          .from('SetlistBands')
          .select('name')
          .eq('id', gig.band_id)
          .single()
        if (bandRow?.name?.trim()) {
          sharedBandName = bandRow.name.trim()
        }
      }
      if (sharedBandNameParam) {
        sharedBandName = sharedBandNameParam
      }
      const songsById = new Map((songsRes.data ?? []).map((song) => [song.id, song]))
      const orderedSongIds = (gigSongsRes.data ?? []).map((row) => row.song_id)
      const tagsRes = orderedSongIds.length
        ? await supabase
            .from('SetlistSongTags')
            .select('song_id, tag')
            .in('song_id', orderedSongIds)
        : { data: [], error: null as { message?: string } | null }
      if (cancelled) return
      if (tagsRes.error) {
        setSharedPlaylistError(tagsRes.error.message ?? 'Shared playlist failed to load.')
        setSharedPlaylistView(null)
        setSharedPlaylistLoading(false)
        return
      }
      const tagsBySong = new Map<string, string[]>()
      const sharedGigSectionOverrides = new Map<string, string>()
      ;(tagsRes.data ?? []).forEach((row) => {
        const gigSectionTag = parseGigSectionTag(row.tag)
        if (gigSectionTag?.gigId === setlistId) {
          sharedGigSectionOverrides.set(row.song_id, gigSectionTag.section)
          return
        }
        const list = tagsBySong.get(row.song_id) ?? []
        list.push(row.tag)
        tagsBySong.set(row.song_id, list)
      })
      const gigSingerKeyAssignments = new Map<string, Array<{ singer: string; key: string }>>()
      const singerKeysRes = await supabase
        .from('SetlistGigSingerKeys')
        .select('song_id, singer_name, gig_key')
        .eq('gig_id', setlistId)
      if (cancelled) return
      if (!singerKeysRes.error) {
        ;(singerKeysRes.data ?? []).forEach((row) => {
          const cleanKey = (row.gig_key ?? '').trim()
          if (!cleanKey) return
          const list = gigSingerKeyAssignments.get(row.song_id) ?? []
          list.push({ singer: row.singer_name, key: cleanKey })
          gigSingerKeyAssignments.set(row.song_id, list)
        })
      }
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
      ;(specialReqRes.data ?? [])
        .filter((request) => !request.dj_only)
        .forEach((request) => {
          const linkedSong = request.song_id ? songsById.get(request.song_id) : undefined
          const key = `special-request:${request.id}`
          addOrMerge({
            key,
            title: linkedSong?.title || request.song_title || 'Special Request',
            artist: linkedSong?.artist || '',
            audioUrl: (request.external_audio_url || linkedSong?.audio_url || '').trim(),
            tags: ['Special Request'],
            songId: request.song_id ?? undefined,
            assignmentSingers: request.singers ?? [],
            assignmentKeys: request.song_key ? [request.song_key] : [],
          })
        })
      orderedSongs.forEach((song) => {
        const overrideSection = sharedGigSectionOverrides.get(song.id)
        const sectionTags = uniqueList(
          (
            overrideSection
              ? [overrideSection]
              : (tagsBySong.get(song.id) ?? [])
                .filter((tag) => isSetlistTypeTag(tag))
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
      const playableEntries = entries.filter((entry) => Boolean(entry.audioUrl && entry.audioUrl.trim()))
      setSharedPlaylistView({
        setlistId: gig.id,
        bandName: sharedBandName,
        gigName: gig.gig_name,
        date: typeof gig.gig_date === 'string' ? gig.gig_date.slice(0, 10) : '',
        venueAddress: gig.venue_address ?? '',
        musicians: sharedMusiciansParam,
        entries: playableEntries,
      })
      setPlaylistIndex(Math.min(requestedIndex, Math.max(0, playableEntries.length - 1)))
      setPlaylistAutoAdvance(true)
      setSharedPlaylistLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [activeBandName, appState.setlists, isSetlistTypeTag, normalizePlaylistSection, supabase])

  useEffect(() => {
    if (!sharedPlaylistView) {
      setSharedDocuments([])
      setSharedDocsError(null)
      setSharedDocsLoading(false)
      return
    }
    setSharedPublicTab('setlist')
    if (!supabase) {
      setSharedDocsError('Documents are unavailable right now.')
      setSharedDocsLoading(false)
      return
    }
    const songIds = Array.from(
      new Set(sharedPlaylistView.entries.map((entry) => entry.songId).filter(Boolean)),
    )
    if (songIds.length === 0) {
      setSharedDocuments([])
      setSharedDocsError(null)
      setSharedDocsLoading(false)
      return
    }
    let cancelled = false
    setSharedDocsLoading(true)
    setSharedDocsError(null)
    void (async () => {
      const { data, error } = await supabase
        .from('SetlistDocuments')
        .select('id, song_id, title, doc_type, instrument, file_url, content')
        .in('song_id', songIds)
      if (cancelled) return
      if (error) {
        setSharedDocuments([])
        setSharedDocsError(error.message ?? 'Failed to load shared documents.')
        setSharedDocsLoading(false)
        return
      }
      const docs: Document[] = (data ?? [])
        .map((row) => ({
          id: row.id,
          songId: row.song_id,
          title: row.title,
          type: row.doc_type,
          instrument: parseDocumentInstruments(row.instrument ?? 'All').join('||'),
          url: row.file_url ?? undefined,
          content: row.content ?? undefined,
        }))
        .filter((doc) => doc.type === 'Chart' || doc.type === 'Lead Sheet' || doc.type === 'Lyrics')
      setSharedDocuments(docs)
      setSharedDocsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [parseDocumentInstruments, sharedPlaylistView, supabase])

  useEffect(() => {
    if (!sharedPlaylistView) {
      setSharedGigMusicians([])
      return
    }
    const payloadMusicians = sharedPlaylistView.musicians ?? []
    setSharedGigMusicians(payloadMusicians)
    if (!supabase || payloadMusicians.length > 0) {
      return
    }
    const gigId = sharedPlaylistView.setlistId
    let cancelled = false
    void (async () => {
      const { data: gigMusicianRows, error: gigMusicianError } = await supabase
        .from('SetlistGigMusicians')
        .select('musician_id, status')
        .eq('gig_id', gigId)
      if (cancelled || gigMusicianError) {
        setSharedGigMusicians(payloadMusicians)
        return
      }
      const activeMusicianIds = Array.from(
        new Set(
          (gigMusicianRows ?? [])
            .filter((row) => (row.status ?? 'active') !== 'out')
            .map((row) => row.musician_id)
            .filter(Boolean),
        ),
      )
      if (activeMusicianIds.length === 0) {
        setSharedGigMusicians(payloadMusicians)
        return
      }
      const { data: musicianRows, error: musiciansError } = await supabase
        .from('SetlistMusicians')
        .select('id, name, roster, email, phone, instruments, singer, deleted_at')
        .in('id', activeMusicianIds)
        .is('deleted_at', null)
      if (cancelled || musiciansError) {
        setSharedGigMusicians(payloadMusicians)
        return
      }
      const musicians: Musician[] = (musicianRows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        roster: row.roster,
        email: row.email ?? undefined,
        phone: row.phone ?? undefined,
        instruments: (row.instruments ?? []).map((item: string) => normalizeInstrumentName(item)),
        singer: row.singer ?? undefined,
      }))
      const rank = new Map(activeMusicianIds.map((id, index) => [id, index]))
      musicians.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
      setSharedGigMusicians(musicians)
    })()
    return () => {
      cancelled = true
    }
  }, [normalizeInstrumentName, sharedPlaylistView, supabase])

  useEffect(() => {
    if (!sharedPlaylistView || !supabase) return
    const client = supabase
    const gigId = sharedPlaylistView.setlistId
    const applySharedNowPlaying = (songId: string | null) => {
      if (!songId) {
        sharedNowPlayingSongIdRef.current = null
        return
      }
      if (sharedNowPlayingSongIdRef.current === songId) return
      sharedNowPlayingSongIdRef.current = songId
      const visibleIndex = visiblePlaylistEntries.findIndex((entry) => entry.songId === songId)
      if (visibleIndex >= 0) {
        setPlaylistIndex(visibleIndex)
      } else {
        const activeIndex = activePlaylistEntries.findIndex((entry) => entry.songId === songId)
        if (activeIndex >= 0) {
          if (playlistSingerFilter !== '__all__') {
            setPlaylistSingerFilter('__all__')
          }
          setPlaylistIndex(activeIndex)
        }
      }
      setPlaylistPlayNonce((current) => current + 1)
      triggerSharedGigFlash()
    }

    let cancelled = false
    void (async () => {
      const { data, error } = await client
        .from('SetlistGigNowPlaying')
        .select('song_id, updated_at')
        .eq('gig_id', gigId)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (cancelled || error) return
      const row = (data?.[0] ?? null) as { song_id?: string | null } | null
      applySharedNowPlaying(row?.song_id ?? null)
    })()

    const channel = client
      .channel(`shared-now-playing-${gigId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigNowPlaying', filter: `gig_id=eq.${gigId}` },
        (payload) => {
          const nextSongId =
            payload.eventType === 'DELETE'
              ? null
              : ((payload.new as { song_id?: string | null } | null)?.song_id ?? null)
          applySharedNowPlaying(nextSongId)
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void client.removeChannel(channel)
    }
  }, [
    activePlaylistEntries,
    playlistSingerFilter,
    sharedPlaylistView,
    supabase,
    triggerSharedGigFlash,
    visiblePlaylistEntries,
  ])

  useEffect(() => {
    if (playlistSingerFilter === '__all__') return
    const hasSelected = playlistSingerOptions.some(
      (option) => option.toLowerCase() === playlistSingerFilter.toLowerCase(),
    )
    if (!hasSelected) {
      setPlaylistSingerFilter('__all__')
    }
  }, [playlistSingerFilter, playlistSingerOptions])

  useEffect(() => {
    setPlaylistIndex(0)
    setPlaylistPlayNonce((current) => current + 1)
  }, [playlistSingerFilter])

  useEffect(() => {
    const updateDockTop = () => {
      const playerHeight = playlistPlayerBlockRef.current?.getBoundingClientRect().height ?? 220
      setPlaylistDrawerDockTop(Math.max(120, Math.round(playerHeight + 12)))
    }
    updateDockTop()
    window.addEventListener('resize', updateDockTop)
    return () => window.removeEventListener('resize', updateDockTop)
  }, [currentPlaylistEntry, playlistIndex, showPlaylistModal, visiblePlaylistEntries.length])

  useEffect(() => {
    const updateDockTop = () => {
      const playerHeight = sharedPlaylistPlayerBlockRef.current?.getBoundingClientRect().height ?? 220
      setSharedPlaylistDrawerDockTop(Math.max(120, Math.round(playerHeight + 12)))
    }
    updateDockTop()
    window.addEventListener('resize', updateDockTop)
    return () => window.removeEventListener('resize', updateDockTop)
  }, [currentPlaylistEntry, playlistIndex, sharedPlaylistView, visiblePlaylistEntries.length])

  useEffect(() => {
    if (showPlaylistModal) return
    setPlaylistDrawerOverlay(false)
  }, [showPlaylistModal])

  useEffect(() => {
    if (gigMode) return
    setShowGigSetlistSheet(false)
    setShowGigModeLaunchModal(false)
  }, [gigMode])

  useEffect(() => {
    if (sharedPlaylistView) return
    setSharedPlaylistDrawerOverlay(false)
  }, [sharedPlaylistView])

  useEffect(() => {
    if (!playlistDrawerOverlay) {
      if (playlistDrawerAutoCloseTimerRef.current) {
        window.clearTimeout(playlistDrawerAutoCloseTimerRef.current)
        playlistDrawerAutoCloseTimerRef.current = null
      }
      return
    }
    playlistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
      setPlaylistDrawerOverlay(false)
      playlistDrawerAutoCloseTimerRef.current = null
    }, 6000)
    return () => {
      if (playlistDrawerAutoCloseTimerRef.current) {
        window.clearTimeout(playlistDrawerAutoCloseTimerRef.current)
        playlistDrawerAutoCloseTimerRef.current = null
      }
    }
  }, [playlistDrawerOverlay])

  useEffect(() => {
    if (!sharedPlaylistDrawerOverlay) {
      if (sharedPlaylistDrawerAutoCloseTimerRef.current) {
        window.clearTimeout(sharedPlaylistDrawerAutoCloseTimerRef.current)
        sharedPlaylistDrawerAutoCloseTimerRef.current = null
      }
      return
    }
    sharedPlaylistDrawerAutoCloseTimerRef.current = window.setTimeout(() => {
      setSharedPlaylistDrawerOverlay(false)
      sharedPlaylistDrawerAutoCloseTimerRef.current = null
    }, 6000)
    return () => {
      if (sharedPlaylistDrawerAutoCloseTimerRef.current) {
        window.clearTimeout(sharedPlaylistDrawerAutoCloseTimerRef.current)
        sharedPlaylistDrawerAutoCloseTimerRef.current = null
      }
    }
  }, [sharedPlaylistDrawerOverlay])

  useEffect(
    () => () => {
      if (sharedFlashTimerRef.current) {
        window.clearTimeout(sharedFlashTimerRef.current)
        sharedFlashTimerRef.current = null
      }
    },
    [],
  )

  useEffect(() => {
    if (playlistIndex < visiblePlaylistEntries.length) return
    setPlaylistIndex(Math.max(0, visiblePlaylistEntries.length - 1))
  }, [playlistIndex, visiblePlaylistEntries.length])

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
      newDocInstruments.join('|'),
      newDocTitle,
      newDocUrl,
      newDocFile?.name ?? '',
      newDocLyrics,
    ].join('|')
    if (signature === lastDocAutosaveRef.current) return
    const timer = window.setTimeout(() => {
      void saveDocumentFromEditorRef.current(false)
      lastDocAutosaveRef.current = signature
    }, 700)
    return () => window.clearTimeout(timer)
  }, [
    editingSongId,
    newDocSongId,
    newDocType,
    newDocInstruments,
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
    localStorage.setItem('setlist_gig_sections', JSON.stringify(gigSetlistSections))
  }, [gigSetlistSections])

  useEffect(() => {
    localStorage.setItem(
      'setlist_hidden_gig_sections',
      JSON.stringify(gigHiddenSetlistSections),
    )
  }, [gigHiddenSetlistSections])

  useEffect(() => {
    localStorage.setItem('setlist_hidden_special_section', JSON.stringify(gigHiddenSpecialSection))
  }, [gigHiddenSpecialSection])

  useEffect(() => {
    localStorage.setItem('setlist_special_request_order', JSON.stringify(specialRequestOrderByGig))
  }, [specialRequestOrderByGig])

  useEffect(() => {
    localStorage.setItem(GIG_LOCKED_SONGS_KEY, JSON.stringify(gigLockedSongIdsByGig))
  }, [gigLockedSongIdsByGig])

  useEffect(() => {
    localStorage.setItem(GIG_LAST_LOCKED_SONG_KEY, JSON.stringify(gigLastLockedSongByGig))
  }, [gigLastLockedSongByGig])

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
    const selectedSet = new Set(
      normalizeTagList(newDocInstruments.map((item) => normalizeInstrumentName(item))),
    )
    const matchingInstrument =
      selectedSet.size > 0
        ? existingDocs.find((doc) => selectedSet.has(normalizeInstrumentName(doc.instrument)))
        : existingDocs[0]
    if (!matchingInstrument) return
    setNewDocTitle((current) => current || matchingInstrument.title)
    setNewDocInstruments((current) =>
      current.length ? current : parseDocumentInstruments(matchingInstrument.instrument),
    )
    setNewDocUrl(matchingInstrument.url ?? '')
    setNewDocLyrics(matchingInstrument.content ?? '')
    setNewDocFile(null)
  }, [appState.documents, newDocInstruments, newDocSongId, newDocType, parseDocumentInstruments])

  const isAuthScreen =
    ((!supabase && !role) || (supabase && !authUserId)) &&
    !sharedPlaylistView &&
    !sharedPlaylistLoading &&
    !sharedPlaylistError
  const showLegacyPanels = useMemo(() => false, [])

  useEffect(() => {
    if (isAuthScreen) {
      document.body.style.overflow = ''
      return
    }
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
      showAddMusicianModal ||
      showTeamModal ||
      showGigMusiciansModal ||
      showMissingSingerWarning ||
      showDocInstrumentWarning ||
      showDocUrlAccessWarning ||
      showAddSetlistModal ||
      showSectionAddSongsModal ||
      showDeleteSetlistSectionConfirm ||
      showSpecialRequestModal ||
      showSetlistModal ||
      showPrintPreview
    document.body.style.overflow = hasPopup ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [
    isAuthScreen,
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
    showAddMusicianModal,
    showTeamModal,
    showGigMusiciansModal,
    showMissingSingerWarning,
    showDocInstrumentWarning,
    showDocUrlAccessWarning,
    showAddSetlistModal,
    showSectionAddSongsModal,
    showDeleteSetlistSectionConfirm,
    showSpecialRequestModal,
    showSetlistModal,
    showPrintPreview,
  ])

  if ((sharedPlaylistView || sharedPlaylistLoading || sharedPlaylistError) && !authUserId) {
    return (
      <div className="h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4 pb-24 pt-6 text-white">
        {appState.instrument === null && (
          <div
            className="fixed inset-0 z-[110] flex items-center bg-slate-950/80 py-6"
            onClick={() => setAppState((prev) => ({ ...prev, instrument: ['All'] }))}
          >
            <div
              className="mx-auto w-full max-w-md max-h-[85vh] overflow-hidden rounded-t-3xl bg-slate-900 sm:rounded-3xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
                <h2 className="text-lg font-semibold">Select your instrument</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Pick one or more instruments to view matching charts and lyrics.
                </p>
              </div>
              <div className="max-h-[calc(85vh-92px)] overflow-auto px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {INSTRUMENTS.map((instrument) => (
                    <button
                      key={`shared-instrument-${instrument}`}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        instrumentSelectionDraft.includes(instrument)
                          ? 'border-teal-300 bg-teal-400/10 text-teal-100'
                          : 'border-white/10 bg-white/5'
                      }`}
                      onClick={() =>
                        setInstrumentSelectionDraft((current) =>
                          current.includes(instrument)
                            ? current.filter((item) => item !== instrument)
                            : [...current, instrument],
                        )
                      }
                    >
                      {instrument}
                    </button>
                  ))}
                </div>
                <button
                  className="mt-4 w-full rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                  onClick={() =>
                    setAppState((prev) => ({
                      ...prev,
                      instrument: instrumentSelectionDraft.length ? instrumentSelectionDraft : ['All'],
                    }))
                  }
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
          <div className="flex h-full min-h-0 flex-col rounded-3xl border border-white/10 bg-slate-900/90 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Shared Gig Playlist</h2>
                {sharedPlaylistView && (
                  <>
                    <p className="mt-1 text-xs text-slate-300">
                      {sharedPlaylistView.gigName} · {formatGigDate(sharedPlaylistView.date)}
                    </p>
                    {sharedPlaylistView.venueAddress ? (
                      <p className="mt-0.5 text-[11px] text-slate-400">{sharedPlaylistView.venueAddress}</p>
                    ) : null}
                  </>
                )}
              </div>
              <div className="text-xs text-slate-400">
                {visiblePlaylistEntries.length
                  ? `${playlistIndex + 1} / ${visiblePlaylistEntries.length}`
                  : 'No playable songs'}
              </div>
            </div>
            {sharedPlaylistLoading && (
              <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-200">
                Loading shared playlist...
              </div>
            )}
            {sharedPlaylistError && (
              <div className="mt-4 rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">
                {sharedPlaylistError}
              </div>
            )}
            {sharedPlaylistView && (
              <>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">
                    Instrument filter:{' '}
                    <span className="font-semibold text-teal-200">
                      {(appState.instrument ?? ['All']).join(', ')}
                    </span>
                    <span className="ml-2 text-slate-400">Docs: {sharedDocuments.length}</span>
                  </span>
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300"
                    onClick={() => {
                      setInstrumentSelectionDraft(appState.instrument ?? [])
                      setAppState((prev) => ({ ...prev, instrument: null }))
                    }}
                  >
                    Change
                  </button>
                </div>

                {sharedPublicTab === 'setlist' ? (
                  <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-2xl bg-slate-950/50 p-2 sm:p-4">
                    {sharedDocsLoading && (
                      <div className="mb-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                        Loading charts and lyrics...
                      </div>
                    )}
                    {sharedDocsError && (
                      <div className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {sharedDocsError}
                      </div>
                    )}
                    <div className="w-full bg-white p-4 sm:p-6">
                      <div className="print-container">
                        <div className="print-header">
                          <div className="print-band-name">
                            {sharedPlaylistView.bandName?.trim() || activeBandName || sharedPlaylistView.gigName || 'Band'}
                          </div>
                          <div className="print-header-details">
                            <div className="print-title">{sharedPlaylistView.gigName}</div>
                            <div className="print-subtitle">{formatGigDate(sharedPlaylistView.date)}</div>
                            {sharedPlaylistView.venueAddress ? (
                              <div className="print-subtitle">{sharedPlaylistView.venueAddress}</div>
                            ) : null}
                          </div>
                          <div className="print-badge">Setlist</div>
                        </div>
                        <div className="print-layout">
                          <div
                            className={`print-section-box ${getPrintToneClass('musicians')} ${getPrintLayoutClass('musicians')}`}
                          >
                            <div className="print-section-title">Musicians</div>
                            <div className="print-grid">
                              {sharedGigMusicians.map((musician) => (
                                <div key={`shared-musician-${musician.id}`} className="print-card">
                                  <div className="print-musician-row">
                                    <div className="print-musician-name">{musician.name}</div>
                                    <div className="print-musician-instruments">
                                      {(musician.instruments ?? []).join(', ') || 'No instruments'}
                                    </div>
                                    <div className="print-contact-row">
                                      {musician.email && (
                                        <a href={`mailto:${musician.email}`} className="print-icon-link" title="Email">
                                          ✉️
                                        </a>
                                      )}
                                      {musician.phone && (
                                        <>
                                          <a href={`tel:${musician.phone}`} className="print-icon-link" title="Call">
                                            📞
                                          </a>
                                          <a href={`sms:${musician.phone}`} className="print-icon-link" title="Text">
                                            💬
                                          </a>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {sharedGigMusicians.length === 0 && (
                                <div className="print-empty">No musicians assigned.</div>
                              )}
                            </div>
                          </div>
                          {groupedPlaylistSections.map((group) => (
                            <div
                              key={`shared-pdf-section-${group.section}`}
                              className={`print-section-box ${getPrintToneClass(group.section)} ${getPrintLayoutClass(group.section)}`}
                            >
                              <div className="print-section-title">{group.section}</div>
                              <div className="print-list">
                                {group.items.map(({ entry: item }) => {
                                  const singerNames = Array.from(new Set(item.assignmentSingers ?? []))
                                  const assignmentKeys = item.assignmentKeys ?? []
                                  const keyLabel =
                                    assignmentKeys.length === 0
                                      ? 'No key'
                                      : assignmentKeys.length === 1
                                        ? assignmentKeys[0]
                                        : 'Multi'
                                  return (
                                    <div
                                      key={`shared-pdf-row-${item.key}`}
                                      className={`print-row song-row ${
                                        currentPlaylistEntry?.songId === item.songId
                                          ? 'ring-2 ring-emerald-300/80'
                                          : ''
                                      } ${
                                        currentPlaylistEntry?.songId === item.songId && sharedGigFlashPulse
                                          ? 'upnext-flash'
                                          : ''
                                      }`}
                                    >
                                      <div className="print-row-title">
                                        <div className="song-title-stack">
                                          {item.audioUrl ? (
                                            <a
                                              className="print-link song-name text-[0.95em]"
                                              href={item.audioUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              {item.title}
                                            </a>
                                          ) : (
                                            <span className="song-name text-[0.95em]">{item.title}</span>
                                          )}
                                          <span className="artist-name">{item.artist || 'Unknown'}</span>
                                        </div>
                                      </div>
                                      <div className="print-row-subtitle print-song-meta">
                                        <span className="musical-key text-[0.72em]">{keyLabel}</span>
                                        <span className="print-assignee-names text-[0.62em]">
                                          {singerNames.length ? formatSingerAssignmentNames(singerNames) : 'No singers'}
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                                {group.items.length === 0 && <div className="print-empty">No songs.</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-4 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                          disabled={visiblePlaylistEntries.length === 0}
                          onClick={() => movePlaylistBy(-1)}
                        >
                          ⏮ Prev
                        </button>
                        <button
                          type="button"
                          className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                          disabled={visiblePlaylistEntries.length === 0}
                          onClick={() => movePlaylistBy(1)}
                        >
                          ⏭ Next
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm ${
                            playlistAutoAdvance
                              ? 'border-teal-300/60 bg-teal-400/10 text-teal-100'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() => setPlaylistAutoAdvance((current) => !current)}
                        >
                          Auto-next: {playlistAutoAdvance ? 'On' : 'Off'}
                        </button>
                        <select
                          className="min-h-[44px] rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-300"
                          value={playlistSingerFilter}
                          onChange={(event) => setPlaylistSingerFilter(event.target.value)}
                        >
                          <option value="__all__">All singers</option>
                          {playlistSingerOptions.map((singer) => (
                            <option key={`shared-playlist-singer-${singer}`} value={singer}>
                              {singer}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="mt-4 min-h-0 flex-1 overflow-hidden">
                      <div className="relative h-full min-h-0">
                        <div
                          ref={sharedPlaylistPlayerBlockRef}
                          className={`relative z-10 transition-opacity duration-200 ${
                            sharedPlaylistDrawerOverlay ? 'pointer-events-none opacity-0' : 'opacity-100'
                          }`}
                        >
                          {currentPlaylistEntry ? (
                            <div
                              className={`rounded-2xl border border-white/10 bg-slate-950/40 p-4 transition-all duration-300 ${
                                sharedGigFlashPulse
                                  ? 'upnext-flash ring-2 ring-emerald-300/70 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                                  : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-lg font-semibold">{currentPlaylistEntry.title}</p>
                                  <p className="text-xs text-slate-400">{currentPlaylistEntry.artist || ' '}</p>
                                  <p className="mt-1 text-xs text-teal-200">
                                    {getPlaylistAssignmentText(currentPlaylistEntry)}
                                  </p>
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
                                    key={`${currentPlaylistEntry.key}-${playlistPlayNonce}-shared`}
                                    className="w-full"
                                    controls
                                    autoPlay
                                    src={currentPlaylistEntry.audioUrl}
                                    onEnded={() => {
                                      if (!playlistAutoAdvance || visiblePlaylistEntries.length <= 1) return
                                      movePlaylistBy(1)
                                    }}
                                  />
                                ) : isYouTubeUrl(currentPlaylistEntry.audioUrl) ? (
                                  <iframe
                                    key={`${currentPlaylistEntry.key}-${playlistPlayNonce}-shared`}
                                    className="h-[145px] w-full rounded-xl border border-white/10 sm:h-[170px]"
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
                        </div>

                        <div
                          className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl transition-all duration-300"
                          style={{
                            top: sharedPlaylistDrawerOverlay ? 0 : sharedPlaylistDrawerDockTop,
                          }}
                          onTouchStart={handleSharedPlaylistDrawerTouchStart}
                          onTouchMove={handleSharedPlaylistDrawerTouchMove}
                          onTouchEnd={handleSharedPlaylistDrawerTouchEnd}
                        >
                          <div className="flex items-center justify-center py-2">
                            <div className="h-1 w-12 rounded-full bg-white/25" />
                          </div>
                          <div
                            className="max-h-full overflow-y-auto px-2 pb-2"
                            onScroll={handleSharedPlaylistDrawerScroll}
                          >
                            <div className="space-y-3 pb-2">
                              {groupedPlaylistSections.map((group) => (
                                <div
                                  key={`shared-playlist-group-${group.section}`}
                                  className={getPlaylistSectionCardClasses(group.section)}
                                >
                                  <div className={playlistSectionHeaderClasses}>
                                    {group.section}
                                  </div>
                                  <div className="space-y-2">
                                    {group.items.map(({ entry: item, index }) => (
                                      <button
                                        type="button"
                                        key={`${item.key}-shared-list`}
                                        className={getPlaylistQueueItemButtonClasses(index === playlistIndex)}
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
                                                key={`${item.key}-shared-tag-${tag}`}
                                                className={`rounded-full px-2 py-1 text-[10px] font-semibold ${getPlaylistTagClasses(tag)}`}
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
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {sharedPlaylistView && (
          <nav className="fixed bottom-0 left-0 right-0 z-[90] border-t border-white/10 bg-slate-950/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                className={`flex min-w-[140px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  sharedPublicTab === 'setlist'
                    ? 'border-teal-300/70 bg-teal-400/10 text-teal-100'
                    : 'border-white/10 text-slate-300'
                }`}
                onClick={() => setSharedPublicTab('setlist')}
              >
                <img src={downloadPdfIcon} alt="" className="h-5 w-5 object-contain" />
                Setlist
              </button>
              <button
                type="button"
                className={`flex min-w-[140px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  sharedPublicTab === 'playlist'
                    ? 'border-teal-300/70 bg-teal-400/10 text-teal-100'
                    : 'border-white/10 text-slate-300'
                }`}
                onClick={() => setSharedPublicTab('playlist')}
              >
                <img src={openPlaylistIcon} alt="" className="h-5 w-5 object-contain" />
                Audio Playlist
              </button>
            </div>
          </nav>
        )}
      </div>
    )
  }

  if (isAuthScreen) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white opacity-100">
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
          <p className="text-sm uppercase tracking-[0.3em] text-teal-300/80">
            Setlist Connect
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-300">
            Sign in with your account to access your band workspace.
          </p>
          <form
            className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4"
            autoComplete="on"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void handleLogin()
            }}
          >
            {supabase ? (
              <>
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Email
                </label>
                <input
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                  placeholder="you@band.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                />
                <label className="mt-3 block text-xs uppercase tracking-wide text-slate-400">
                  Password
                </label>
                <input
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                  placeholder="Enter password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  type="password"
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                />
              </>
            ) : (
              <>
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Password
                </label>
                <input
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                  placeholder="Enter shared password"
                  value={loginInput}
                  onChange={(event) => setLoginInput(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className={`mt-4 w-full rounded-xl bg-teal-400/90 py-3 font-semibold text-slate-950 ${
                authLoading ? 'cursor-not-allowed opacity-70' : ''
              }`}
            >
              {authLoading
                ? 'Please wait...'
                : !supabase
                ? 'Login'
                : authMode === 'signup'
                ? 'Create account'
                : 'Login'}
            </button>
            {supabase && (
              <button
                type="button"
                className="mt-3 w-full rounded-xl border border-white/10 py-2 text-sm text-slate-200"
                onClick={() => setAuthMode((current) => (current === 'login' ? 'signup' : 'login'))}
              >
                {authMode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
              </button>
            )}
            {authError && <div className="mt-3 text-xs text-red-200">{authError}</div>}
          </form>
        </div>
      </div>
    )
  }

  if (supabase && authUserId && !activeBandId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
          <p className="text-sm uppercase tracking-[0.3em] text-teal-300/80">Setlist Connect</p>
          <h1 className="mt-2 text-3xl font-semibold">Create your band</h1>
          <p className="mt-2 text-sm text-slate-300">
            Your account is ready. Create your first band workspace to continue.
          </p>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <label className="text-xs uppercase tracking-wide text-slate-400">Band name</label>
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
              placeholder="Your Band Name"
              value={newBandName}
              onChange={(event) => {
                setNewBandName(event.target.value)
                if (supabaseError) setSupabaseError(null)
              }}
            />
            <button
              disabled={authLoading}
              className={`mt-4 w-full rounded-xl bg-teal-400/90 py-3 font-semibold text-slate-950 ${
                authLoading ? 'cursor-not-allowed opacity-70' : ''
              }`}
              onClick={() => void createBandAsFirstAdmin()}
            >
              {authLoading ? 'Creating workspace...' : 'Create band admin workspace'}
            </button>
            {supabaseError && <div className="mt-3 text-xs text-red-200">{supabaseError}</div>}
          </div>
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
          onClick={() => setAppState((prev) => ({ ...prev, instrument: ['All'] }))}
        >
          <div
            className="mx-auto w-full max-w-md max-h-[85vh] overflow-hidden rounded-t-3xl bg-slate-900 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <h2 className="text-lg font-semibold">Select your instrument</h2>
              <p className="mt-1 text-sm text-slate-300">
                Pick one or more instruments to view matching charts and lyrics.
              </p>
            </div>
            <div className="max-h-[calc(85vh-92px)] overflow-auto px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <div className="mt-4 grid grid-cols-2 gap-2">
                {INSTRUMENTS.map((instrument) => (
                  <button
                    key={instrument}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      instrumentSelectionDraft.includes(instrument)
                        ? 'border-teal-300 bg-teal-400/10 text-teal-100'
                        : 'border-white/10 bg-white/5'
                    }`}
                    onClick={() =>
                      setInstrumentSelectionDraft((current) =>
                        current.includes(instrument)
                          ? current.filter((item) => item !== instrument)
                          : [...current, instrument],
                      )
                    }
                  >
                    {instrument}
                  </button>
                ))}
              </div>
              <button
                className="mt-4 w-full rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                onClick={() =>
                  setAppState((prev) => ({
                    ...prev,
                    instrument: instrumentSelectionDraft.length ? instrumentSelectionDraft : ['All'],
                  }))
                }
              >
                Continue
              </button>
              <button
                className="mt-4 w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300"
                onClick={() => setAppState((prev) => ({ ...prev, instrument: ['All'] }))}
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
                        documentMatchesActiveInstruments({
                          id: chart.id,
                          songId: chart.songId,
                          type: 'Chart',
                          instrument: chart.instrument,
                          title: chart.title,
                        }),
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
                  aria-label="Back"
                  title="Back"
                >
                  ←
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
                              if (!value) return
                              commitChange('Update gig date', (prev) => ({
                                ...prev,
                                setlists: prev.setlists.map((setlist) =>
                                  setlist.id === currentSetlist.id
                                    ? { ...setlist, date: value }
                                    : setlist,
                                ),
                              }))
                              if (supabase) {
                                runSupabase(
                                  supabase
                                    .from('SetlistGigs')
                                    .update({ gig_date: value })
                                    .eq('id', currentSetlist.id),
                                )
                              }
                              // Close the native date picker right after a date is chosen.
                              event.currentTarget.blur()
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
                  <div className="flex items-center gap-2">
                    <button
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-teal-300/40 bg-slate-800/95 text-xl font-semibold text-slate-100 shadow-[0_0_18px_rgba(20,184,166,0.2)]"
                      onClick={handlePrintSetlist}
                      title="Download setlist PDF"
                      aria-label="Download setlist PDF"
                    >
                      <img src={downloadPdfIcon} alt="" className="h-6 w-6 object-contain" />
                    </button>
                    <button
                      className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full border border-indigo-300/60 bg-indigo-500/20 px-3 text-sm font-semibold text-indigo-100 shadow-[0_0_18px_rgba(99,102,241,0.28)]"
                      onClick={() => {
                        setPlaylistIndex(0)
                        setPlaylistAutoAdvance(true)
                        setShowPlaylistModal(true)
                      }}
                      title="Open setlist playlist"
                      aria-label="Open setlist playlist"
                    >
                      <span aria-hidden>🎵</span>
                      <img src={openPlaylistIcon} alt="" className="h-5 w-5 object-contain" />
                    </button>
                  </div>
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
                    complete: Boolean(buildCompletion.musicians),
                    count: buildCardCounts.musicians ?? 0,
                  },
                  ...(!isSpecialSectionHidden
                    ? [
                        {
                          key: 'special',
                          label: 'Special Requests',
                          icon: '✨',
                          tint: 'from-amber-500/30 via-slate-900/40 to-slate-900/60',
                          complete: Boolean(buildCompletion.special),
                          count: buildCardCounts.special ?? 0,
                        },
                      ]
                    : []),
                ].map((item) => (
                  <button
                    key={item.key}
                    className={`flex min-h-[96px] flex-col items-start justify-between rounded-3xl border border-white/10 bg-gradient-to-br ${item.tint} px-4 py-4 text-left text-white shadow-[0_0_18px_rgba(15,23,42,0.35)]`}
                    onClick={() => setActiveBuildPanel(item.key)}
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
                          {item.count}
                        </span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold">{item.label}</span>
                  </button>
                ))}
                {orderedSetSections.map((section) => {
                  const panelKey = setlistPanelKey(section)
                  const lower = section.toLowerCase()
                  const icon = lower.includes('dinner')
                    ? '🍽️'
                    : lower.includes('latin')
                      ? '💃'
                      : lower.includes('dance')
                        ? '🕺'
                        : '🎶'
                  const tint = lower.includes('dinner')
                    ? 'from-emerald-500/30 via-slate-900/40 to-slate-900/60'
                    : lower.includes('latin')
                      ? 'from-pink-500/30 via-slate-900/40 to-slate-900/60'
                      : lower.includes('dance')
                        ? 'from-cyan-500/30 via-slate-900/40 to-slate-900/60'
                        : 'from-violet-500/30 via-slate-900/40 to-slate-900/60'
                  return (
                    <div key={panelKey} className="space-y-2">
                      {draggedSetlistSection &&
                        draggedSetlistSection !== section &&
                        dragOverSetlistSection === section && (
                          <div className="h-4 rounded-xl border border-dashed border-teal-300/70 bg-teal-300/15" />
                        )}
                      <button
                        draggable
                        className={`flex min-h-[96px] w-full flex-col items-start justify-between rounded-3xl border border-white/10 bg-gradient-to-br ${tint} px-4 py-4 text-left text-white shadow-[0_0_18px_rgba(15,23,42,0.35)]`}
                        onClick={() => setActiveBuildPanel(panelKey)}
                        onDragStart={(event) => {
                          setDraggedSetlistSection(section)
                          setDragOverSetlistSection(null)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', section)
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setDragOverSetlistSection(section)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          const fromSection =
                            draggedSetlistSection ?? event.dataTransfer.getData('text/plain')
                          if (!fromSection) return
                          reorderGigSetlistSections(fromSection, section)
                          setDraggedSetlistSection(null)
                          setDragOverSetlistSection(null)
                        }}
                        onDragEnd={() => {
                          setDraggedSetlistSection(null)
                          setDragOverSetlistSection(null)
                        }}
                      >
                        <div className="flex w-full items-start justify-between">
                          <span className="text-2xl">{icon}</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-3xl ${
                                buildCompletion[panelKey] ? 'text-emerald-300' : 'text-amber-300'
                              }`}
                              title={buildCompletion[panelKey] ? 'Complete' : 'Not complete'}
                            >
                              {buildCompletion[panelKey] ? '✓' : '○'}
                            </span>
                            <span className="mt-1 text-sm font-semibold text-slate-100">
                              {buildCardCounts[panelKey] ?? 0}
                            </span>
                          </div>
                        </div>
                        <span className="text-sm font-semibold">{section}</span>
                      </button>
                    </div>
                  )
                })}
                <button
                  className="flex min-h-[96px] flex-col items-start justify-between rounded-3xl border border-dashed border-teal-300/50 bg-gradient-to-br from-teal-500/30 via-slate-900/40 to-slate-900/60 px-4 py-4 text-left text-white shadow-[0_0_18px_rgba(15,23,42,0.35)]"
                  onClick={() => {
                    setNewSetlistLabel('')
                    setShowAddSetlistModal(true)
                  }}
                >
                  <div className="flex w-full items-start justify-between">
                    <span className="text-2xl">➕</span>
                  </div>
                  <span className="text-sm font-semibold">Add Setlist</span>
                </button>
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

            {showLegacyPanels ? (
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
                {getOrderedSpecialRequests(currentSetlist.id)
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
                        <div
                          className={`text-xs ${
                            !request.djOnly &&
                            request.singers.some(
                              (singer) =>
                                singer.trim().toLowerCase() === INSTRUMENTAL_LABEL.toLowerCase(),
                            )
                              ? 'text-fuchsia-200'
                              : 'text-slate-300'
                          }`}
                        >
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
            ) : null}

            {showLegacyPanels ? (
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
            ) : null}

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
                  aria-label="Back"
                  title="Back"
                >
                  ←
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
                {[...setlistTypeTags].sort((a, b) => a.localeCompare(b)).map((tag) => {
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
                  aria-label="Back"
                  title="Back"
                >
                  ←
                </button>
              </div>
              <div className="mt-4 space-y-4">
                {isAdmin && (
                  <button
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm font-semibold text-slate-100"
                    onClick={() => setShowAddMusicianModal(true)}
                  >
                    Add musician
                  </button>
                )}
                {inviteCreateResult && (
                  <div className="rounded-2xl border border-indigo-300/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
                    {inviteCreateResult}
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
                          {isAdmin && (
                            <button
                              className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                                musician.email?.trim()
                                  ? 'border-indigo-300/50 text-indigo-100'
                                  : 'border-white/10 text-slate-500'
                              }`}
                              disabled={!musician.email?.trim()}
                              title={
                                musician.email?.trim()
                                  ? `Send invite to ${musician.email}`
                                  : 'Add email before inviting'
                              }
                              onClick={(event) => {
                                event.stopPropagation()
                                void sendInviteForMusician(musician)
                              }}
                            >
                              Send Invite
                            </button>
                          )}
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
        <div id="printable-setlist-hidden" className="print-only">
          <div className="print-container">
            <div className="print-header">
              {activeBandName && <div className="print-band-name">{activeBandName}</div>}
              <div className="print-header-details">
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
                  {getOrderedSpecialRequests(currentSetlist.id)
                    .map((request) => {
                      const song = appState.songs.find((item) => item.id === request.songId)
                      return (
                      <div key={request.id} className="print-row">
                        <div className="print-row-title">
                          <span className="print-title-line">
                            {request.djOnly ? <span className="print-pill">DJ Only</span> : null}
                            {request.externalAudioUrl || song?.youtubeUrl ? (
                              <a
                                className="print-link song-name"
                                href={request.externalAudioUrl ?? song?.youtubeUrl ?? ''}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {request.songTitle}
                              </a>
                            ) : (
                              <span className="song-name">{request.songTitle}</span>
                            )}
                          </span>
                        </div>
                        <div className="print-row-subtitle">
                          {request.type} ·{' '}
                          <span className="print-assignee-names">
                            {request.djOnly
                              ? 'DJ'
                              : request.singers.length
                                ? formatSingerAssignmentNames(request.singers)
                                : 'No singers'}
                          </span>{' '}
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
                  {printableGigMusicians.map((musician) => (
                    <div key={musician.id} className="print-card">
                      <div className="print-musician-row">
                        <div className="print-musician-name">{musician.name}</div>
                        <div className="print-musician-instruments">
                          {(musician.instruments ?? []).join(', ') || 'No instruments'}
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
                  {printableGigMusicians.length === 0 && (
                    <div className="print-empty">No musicians have been assigned yet.</div>
                  )}
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
                        <div key={song.id} className="print-row song-row">
                          <div className="print-row-title">
                            <div className="song-title-stack">
                              {song.youtubeUrl ? (
                                <a
                                  className="print-link song-name"
                                  href={song.youtubeUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {song.title}
                                </a>
                              ) : (
                                <span className="song-name">{song.title}</span>
                              )}
                              <span className="artist-name">{song.artist || 'Unknown'}</span>
                            </div>
                          </div>
                          <div className="print-row-subtitle print-song-meta">
                            <span className="musical-key">{keyLabel}</span>
                            <span className="print-assignee-names">
                              {singers.length ? formatSingerAssignmentNames(singers) : 'No singers'}
                            </span>
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
                        <div key={song.id} className="print-row song-row">
                          <div className="print-row-title">
                            <div className="song-title-stack">
                              {song.youtubeUrl ? (
                                <a
                                  className="print-link song-name"
                                  href={song.youtubeUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {song.title}
                                </a>
                              ) : (
                                <span className="song-name">{song.title}</span>
                              )}
                              <span className="artist-name">{song.artist || 'Unknown'}</span>
                            </div>
                          </div>
                          <div className="print-row-subtitle print-song-meta">
                            <span className="musical-key">{keyLabel}</span>
                            <span className="print-assignee-names">
                              {singers.length ? formatSingerAssignmentNames(singers) : 'No singers'}
                            </span>
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
                        <div key={song.id} className="print-row song-row">
                          <div className="print-row-title">
                            <div className="song-title-stack">
                              {song.youtubeUrl ? (
                                <a
                                  className="print-link song-name"
                                  href={song.youtubeUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {song.title}
                                </a>
                              ) : (
                                <span className="song-name">{song.title}</span>
                              )}
                              <span className="artist-name">{song.artist || 'Unknown'}</span>
                            </div>
                          </div>
                          <div className="print-row-subtitle print-song-meta">
                            <span className="musical-key">{keyLabel}</span>
                            <span className="print-assignee-names">
                              {singers.length ? formatSingerAssignmentNames(singers) : 'No singers'}
                            </span>
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
          className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/80 px-4 py-6"
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
                Pick one or more instruments to open matching charts and lyrics.
              </p>
            </div>
            <div className="max-h-[calc(80vh-92px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <div className="mt-4 grid grid-cols-2 gap-2">
                {INSTRUMENTS.map((instrument) => (
                  <button
                    key={instrument}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      docInstrumentDraft.includes(instrument)
                        ? 'border-teal-300 bg-teal-400/10 text-teal-100'
                        : 'border-white/10 bg-white/5'
                    }`}
                    onClick={() =>
                      setDocInstrumentDraft((current) =>
                        current.includes(instrument)
                          ? current.filter((item) => item !== instrument)
                          : [...current, instrument],
                      )
                    }
                  >
                    {instrument}
                  </button>
                ))}
              </div>
              <button
                className="mt-4 w-full rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                onClick={() => {
                  setAppState((prev) => ({
                    ...prev,
                    instrument: docInstrumentDraft.length ? docInstrumentDraft : ['All'],
                  }))
                  setShowInstrumentPrompt(false)
                  setDocModalSongId(pendingDocSongId)
                  setDocModalPageIndex(0)
                  setDocModalContent(null)
                  setPendingDocSongId(null)
                }}
              >
                Continue
              </button>
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
          className="fixed inset-0 z-[130] bg-slate-950/95"
          onClick={() => {
            setDocModalSongId(null)
            setDocModalContent(null)
            setDocModalPageIndex(0)
          }}
        >
          <div
            className="h-full w-full overflow-hidden bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">
                {docModalContent
                  ? docModalContent.type === 'Lyrics'
                    ? 'Song Lyrics'
                    : 'Song Chart'
                  : 'Song documents'}
              </h3>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => {
                    setDocModalSongId(null)
                    setDocModalContent(null)
                    setDocModalPageIndex(0)
                  }}
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
                {docModalContent && (
                  <button
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                    onClick={() => {
                      setDocModalContent(null)
                      setDocModalPageIndex(0)
                    }}
                    aria-label="Back"
                    title="Back"
                  >
                    ←
                  </button>
                )}
              </div>
            </div>
            <div className="h-[calc(100vh-88px)] overflow-auto px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              {!docModalContent && (
                <div className="mt-4 space-y-2">
                  {getDocumentSelectionItems(docModalSongId).map((doc) => (
                      <div
                        key={doc.id}
                        role="button"
                        tabIndex={0}
                        className={`rounded-2xl border p-3 text-sm ${
                          doc.type === 'Lyrics'
                            ? activeInstruments.includes('Vocals')
                              ? 'border-fuchsia-300/50 bg-fuchsia-400/10'
                              : 'border-fuchsia-300/30 bg-fuchsia-400/5'
                            : 'border-white/10 bg-slate-950/40'
                        }`}
                        onClick={() => {
                          setDocModalPageIndex(0)
                          setDocModalContent(doc)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setDocModalPageIndex(0)
                            setDocModalContent(doc)
                          }
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold">{doc.title}</div>
                            <div className="text-xs text-slate-400">
                              {doc.type} · {doc.instruments.join(', ')}
                            </div>
                          </div>
                          {isAdmin && (
                            <button
                              className="rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-200"
                              onClick={(event) => {
                                event.stopPropagation()
                                commitChange('Delete document', (prev) => ({
                                  ...prev,
                                  documents: prev.documents.filter(
                                    (item) => !doc.sourceDocIds.includes(item.id),
                                  ),
                                  charts: prev.charts.filter(
                                    (item) => !doc.sourceDocIds.includes(item.id),
                                  ),
                                }))
                                if (supabase) {
                                  const client = supabase
                                  doc.sourceDocIds.forEach((id) => {
                                    runSupabase(
                                      client.from('SetlistDocuments').delete().eq('id', id),
                                    )
                                  })
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  {getDocumentSelectionItems(docModalSongId).length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
                      No charts or lyrics found for selected instruments.
                    </div>
                  )}
                </div>
              )}
              {docModalContent && (
                <div
                  className="relative mt-4 h-[calc(100%-1rem)] rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-slate-200"
                  onTouchStart={(event) => setDocSwipeStartX(event.touches[0]?.clientX ?? null)}
                  onTouchEnd={(event) => {
                    if (docSwipeStartX === null) return
                    const endX = event.changedTouches[0]?.clientX ?? docSwipeStartX
                    if (endX - docSwipeStartX > 50) moveDocPageBy(-1)
                    if (docSwipeStartX - endX > 50) moveDocPageBy(1)
                    setDocSwipeStartX(null)
                  }}
                >
                  <div className="mb-3 text-center text-xl font-bold">{docModalContent.title}</div>
                  {docModalContent.content ? (
                    <pre className="h-[calc(100%-2rem)] overflow-auto whitespace-pre-wrap text-sm font-semibold leading-relaxed">
                      {docModalContent.content}
                    </pre>
                  ) : activeDocModalPage ? (
                    <div className="relative h-[calc(100%-2rem)] w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
                      {isImageFileUrl(activeDocModalPage) ? (
                        <img
                          src={activeDocModalPage}
                          alt={docModalContent.title}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <iframe
                          src={getDocumentViewerUrl(activeDocModalPage)}
                          className="h-full w-full"
                          title={docModalContent.title}
                        />
                      )}
                      {docModalPages.length > 1 && (
                        <>
                          <button
                            className="absolute bottom-3 left-3 rounded-xl bg-slate-900/80 px-3 py-2 text-xs font-semibold"
                            onClick={() => moveDocPageBy(-1)}
                          >
                            ◀ Page
                          </button>
                          <button
                            className="absolute bottom-3 right-3 rounded-xl bg-slate-900/80 px-3 py-2 text-xs font-semibold"
                            onClick={() => moveDocPageBy(1)}
                          >
                            Page ▶
                          </button>
                          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-xs">
                            {docModalPageIndex + 1} / {docModalPages.length}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-300">No document URL available.</div>
                  )}
                  <button
                    className="absolute bottom-3 right-3 rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2 text-xs font-semibold text-slate-100"
                    onClick={printActiveDocument}
                    title="Print chart or lyrics"
                    aria-label="Print chart or lyrics"
                  >
                    Print
                  </button>
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
                  aria-label="Close"
                  title="Close"
                >
                  ✕
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
                  aria-label="Close"
                  title="Close"
                >
                  ✕
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

      {showTeamModal && activeBandId && (
        <div
          className="fixed inset-0 z-[94] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowTeamModal(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Team</h3>
              <div className="mt-1 text-sm text-slate-300">
                Invite members and manage band roles.
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setShowTeamModal(false)}
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div
              className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4"
              data-drag-scroll-container="build-panel"
            >
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold">Invite by email</div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <input
                    className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    placeholder="member@band.com"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                  <select
                    className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as 'member' | 'admin')}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <select
                    className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    value={inviteMusicianId}
                    onChange={(event) => setInviteMusicianId(event.target.value)}
                  >
                    <option value="">Optional musician link</option>
                    {appState.musicians.map((musician) => (
                      <option key={musician.id} value={musician.id}>
                        {musician.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="mt-3 rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={() => void createBandInvite()}
                >
                  Create invite
                </button>
                {inviteCreateResult && (
                  <div className="mt-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
                    {inviteCreateResult}
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold">Band members</div>
                <div className="mt-3 space-y-2">
                  {memberships
                    .filter((item) => item.bandId === activeBandId)
                    .map((membership) => (
                      <div
                        key={membership.id}
                        className="rounded-xl border border-white/10 bg-slate-900/60 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm text-slate-100">{membership.userId}</div>
                          <div className="flex items-center gap-2">
                            <select
                              className="rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1 text-xs"
                              value={membership.role}
                              onChange={(event) =>
                                void updateMembershipRole(
                                  membership.id,
                                  event.target.value as 'admin' | 'member',
                                )
                              }
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                            <select
                              className="rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1 text-xs"
                              value={membership.musicianId ?? ''}
                              onChange={(event) =>
                                void linkMembershipMusician(membership.id, event.target.value)
                              }
                            >
                              <option value="">Link musician</option>
                              {appState.musicians.map((musician) => (
                                <option key={musician.id} value={musician.id}>
                                  {musician.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  {memberships.filter((item) => item.bandId === activeBandId).length === 0 && (
                    <div className="text-xs text-slate-400">No active members in this band yet.</div>
                  )}
                </div>
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

      {showGigLockedSongWarning && (
        <div
          className="fixed inset-0 z-[108] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => {
            setShowGigLockedSongWarning(false)
            setPendingResendGigSongId(null)
          }}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Song already selected</h3>
            <p className="mt-2 text-sm text-slate-300">
              This song is already in the gig queue. Do you want to re-send it anyway?
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                onClick={() => {
                  setShowGigLockedSongWarning(false)
                  setPendingResendGigSongId(null)
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                onClick={() => {
                  if (pendingResendGigSongId) {
                    markGigSongAsSelected(pendingResendGigSongId, { forceResend: true })
                  }
                  setShowGigLockedSongWarning(false)
                  setPendingResendGigSongId(null)
                }}
              >
                Re-send anyway
              </button>
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

      {showDocInstrumentWarning && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowDocInstrumentWarning(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Choose instrument(s)</h3>
            <p className="mt-2 text-sm text-slate-300">
              Charts require at least one instrument selection before saving.
            </p>
            <button
              className="mt-4 w-full rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
              onClick={() => setShowDocInstrumentWarning(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {showDocUrlAccessWarning && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowDocUrlAccessWarning(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Shared URL check</h3>
            <p className="mt-2 text-sm text-slate-300">
              Please make sure the shared chart URL original source is viewable for everyone,
              otherwise it will not load properly.
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Uploading a PDF is the most secure way for all musicians to see your chart.
            </p>
            <button
              className="mt-4 w-full rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
              onClick={() => setShowDocUrlAccessWarning(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {showSectionAddSongsModal && currentSetlist && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowSectionAddSongsModal(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Add song(s)</h3>
              <p className="mt-1 text-sm text-slate-300">
                Add songs not already in this gig. Default setlist: {sectionAddSongsSource}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setShowSectionAddSongsModal(false)}
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
                <button
                  className="min-w-[120px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={addSelectedSongsToTargetSetlists}
                >
                  Add selected
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
              <input
                className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-2 text-sm"
                placeholder="Search songs"
                value={sectionAddSongsSearch}
                onChange={(event) => setSectionAddSongsSearch(event.target.value)}
              />
              <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                  Add selected songs to setlist(s)
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      orderedSetSections.length > 0 &&
                      orderedSetSections.every((section) =>
                        sectionAddSongsTargets.some(
                          (item) => item.toLowerCase() === section.toLowerCase(),
                        ),
                      )
                        ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                        : 'border-white/10 text-slate-300'
                    }`}
                    onClick={() =>
                      setSectionAddSongsTargets((current) => {
                        const allSelected =
                          orderedSetSections.length > 0 &&
                          orderedSetSections.every((section) =>
                            current.some(
                              (item) => item.toLowerCase() === section.toLowerCase(),
                            ),
                          )
                        if (allSelected) {
                          return sectionAddSongsSource ? [sectionAddSongsSource] : []
                        }
                        return [...orderedSetSections]
                      })
                    }
                  >
                    All
                  </button>
                  {orderedSetSections.map((section) => {
                    const active = sectionAddSongsTargets.some(
                      (item) => item.toLowerCase() === section.toLowerCase(),
                    )
                    return (
                      <button
                        key={`target-${section}`}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          active
                            ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                            : 'border-white/10 text-slate-300'
                        }`}
                        onClick={() =>
                          setSectionAddSongsTargets((current) => {
                            const allSelected =
                              orderedSetSections.length > 0 &&
                              orderedSetSections.every((itemSection) =>
                                current.some(
                                  (item) => item.toLowerCase() === itemSection.toLowerCase(),
                                ),
                              )
                            // If currently "All", tapping a section means "only this section".
                            if (allSelected) {
                              return [section]
                            }
                            const isSelected = current.some(
                              (item) => item.toLowerCase() === section.toLowerCase(),
                            )
                            if (isSelected) {
                              const next = current.filter(
                                (item) => item.toLowerCase() !== section.toLowerCase(),
                              )
                              return next.length > 0
                                ? next
                                : sectionAddSongsSource
                                ? [sectionAddSongsSource]
                                : [section]
                            }
                            return [...current, section]
                          })
                        }
                      >
                        {section}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                {sectionAddSongsAvailableSongs.map((song) => (
                  <label
                    key={`section-add-song-${song.id}`}
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
                {sectionAddSongsAvailableSongs.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-300">
                    No available songs to add for this gig.
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <button
                  className="rounded-full border border-white/10 px-3 py-1"
                  onClick={() =>
                    setSelectedSongIds(sectionAddSongsAvailableSongs.map((song) => song.id))
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
            </div>
          </div>
        </div>
      )}

      {showManualSectionOrderModal && currentSetlist && manualSectionOrderSection && (
        <div
          className="fixed inset-0 z-[92] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={closeManualSectionOrderModal}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Manual Order: {manualSectionOrderSection}</h3>
              <p className="mt-1 text-sm text-slate-300">
                Pick as many top positions as you want (Position 1, 2, 3...). Remaining songs stay in
                current order.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={closeManualSectionOrderModal}
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
                <button
                  className="min-w-[140px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={applyManualSectionOrder}
                >
                  Apply order
                </button>
                <button
                  className="min-w-[100px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() =>
                    setManualSectionOrderSelections(
                      Array.from({ length: manualSectionOrderSongs.length }, () => ''),
                    )
                  }
                >
                  Clear all
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="space-y-2">
                {manualSectionOrderSelections.map((songId, index) => (
                  <div
                    key={`manual-order-slot-${index}`}
                    className="grid items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-3 md:grid-cols-[96px_1fr]"
                  >
                    <div className="text-xs font-semibold text-slate-300">Position {index + 1}</div>
                    <select
                      className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-300"
                      value={songId}
                      disabled={index > 0 && !manualSectionOrderSelections[index - 1]}
                      onChange={(event) => {
                        const value = event.target.value
                        setManualSectionOrderError('')
                        setManualSectionOrderSelections((current) =>
                          current.map((item, itemIndex) => (itemIndex === index ? value : item)),
                        )
                      }}
                    >
                      <option value="">Select song...</option>
                      {manualSectionOrderSongs.map((song) => {
                        const alreadyUsedAtOtherPosition = manualSectionOrderSelections.some(
                          (selectedId, selectedIndex) => selectedId === song.id && selectedIndex !== index,
                        )
                        return (
                          <option
                            key={`${manualSectionOrderSection}-${song.id}`}
                            value={song.id}
                            disabled={alreadyUsedAtOtherPosition}
                          >
                            {song.title}
                            {song.artist ? ` - ${song.artist}` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                ))}
              </div>
              {manualSectionOrderError && (
                <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {manualSectionOrderError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSpecialRequestModal && currentSetlist && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => {
            resetPendingSpecialRequest()
            setShowSpecialRequestModal(false)
          }}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">
                {editingSpecialRequestId ? 'Edit special request' : 'Add special request'}
              </h3>
              <p className="mt-1 text-sm text-slate-300">
                {editingSpecialRequestId
                  ? 'Update request details and save changes.'
                  : 'Enter request details. New songs are automatically saved to the song library.'}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => {
                    resetPendingSpecialRequest()
                    setShowSpecialRequestModal(false)
                  }}
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
                <button
                  className="min-w-[120px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={saveSpecialRequest}
                >
                  {editingSpecialRequestId ? 'Save changes' : 'Save request'}
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wide text-slate-400">
                    Request type
                  </label>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    placeholder="Type a request type"
                    list="special-type-list-modal"
                    value={pendingSpecialType}
                    onChange={(event) => {
                      setPendingSpecialType(event.target.value)
                      if (specialRequestError) setSpecialRequestError('')
                    }}
                  />
                  <datalist id="special-type-list-modal">
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
                    list="special-song-list-modal"
                    value={pendingSpecialSong}
                    onChange={(event) => {
                      setPendingSpecialSong(event.target.value)
                      if (specialRequestError) setSpecialRequestError('')
                    }}
                  />
                  <datalist id="special-song-list-modal">
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
                  {specialRequestSingerOptions.length === 0 && (
                    <div className="text-xs text-slate-400">
                      No gig singers assigned yet. Add musicians first.
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {specialRequestSingerOptions.map((singer) => (
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
                    <span className="text-xs text-slate-300">This request is DJ only</span>
                  </div>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    placeholder="Audio link (YouTube, Spotify, MP3)"
                    value={pendingSpecialExternalUrl}
                    onChange={(event) => setPendingSpecialExternalUrl(event.target.value)}
                  />
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
                <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                  Charts & lyrics
                </div>
                <p className="mt-2 text-xs text-slate-300">
                  Use the same song editor flow to add lyrics/charts/lead sheets for this request song.
                </p>
                <button
                  className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200"
                  onClick={openSongEditorFromSpecialRequest}
                  disabled={!pendingSpecialSong.trim()}
                >
                  {pendingSpecialSongMatch
                    ? 'Edit song charts/lyrics'
                    : 'Create song and add charts/lyrics'}
                </button>
              </div>
              {specialRequestError && (
                <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {specialRequestError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showDeleteSetlistSectionConfirm && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={cancelDeleteSetlistSection}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-red-400/30 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-red-200">Delete setlist section?</h3>
            {pendingDeleteSetlistSection?.toLowerCase().startsWith('special request') ? (
              <p className="mt-2 text-sm text-slate-300">
                This hides <span className="font-semibold">Special Requests</span> for this gig.
                Existing special request entries stay saved.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-300">
                This removes <span className="font-semibold">{pendingDeleteSetlistSection}</span>{' '}
                from this gig view. Songs stay in the gig and can still appear in other setlists.
              </p>
            )}
            <div className="mt-4 flex items-center gap-2">
              <button
                className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                onClick={cancelDeleteSetlistSection}
              >
                Cancel
              </button>
              <button
                className="min-w-[120px] rounded-xl bg-red-500/90 px-4 py-2 text-sm font-semibold text-white"
                onClick={confirmDeleteSetlistSection}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSetlistModal && currentSetlist && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowAddSetlistModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Add Setlist</h3>
            <p className="mt-2 text-sm text-slate-300">
              Choose a set type or create your own label. Admin can drag to reorder setlists.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['Special Requests', 'Dinner', 'Latin', 'Dance'].map((template) => (
                <button
                  key={template}
                  className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200"
                  onClick={() => {
                    addGigSetlistSectionFromTemplate(template)
                    setShowAddSetlistModal(false)
                  }}
                >
                  {template}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
              <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Custom label</div>
              <input
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                placeholder="Example: Cocktail Set"
                value={newSetlistLabel}
                onChange={(event) => setNewSetlistLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  const value = normalizeSetlistSectionLabel(newSetlistLabel)
                  if (!value) return
                  addGigSetlistSection(value)
                  setShowAddSetlistModal(false)
                  setNewSetlistLabel('')
                }}
              />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                onClick={() => setShowAddSetlistModal(false)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
              <button
                className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                onClick={() => {
                  const value = normalizeSetlistSectionLabel(newSetlistLabel)
                  if (!value) return
                  addGigSetlistSection(value)
                  setShowAddSetlistModal(false)
                  setNewSetlistLabel('')
                }}
              >
                Add
              </button>
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
                  aria-label="Close"
                  title="Close"
                >
                  ✕
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
                {assignSingerOptions.length === 0 ? (
                  <div className="mt-3 text-xs text-slate-400">
                    No singers assigned to this gig yet.
                  </div>
                ) : (
                  <>
                    {gigSingerOptions.length === 0 && (
                      <div className="mt-3 text-xs text-amber-200">
                        No gig vocalists assigned. You can still choose Instrumental.
                      </div>
                    )}
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
                    <div className="mt-4">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        Select singers
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {assignSingerOptions.map((singer) => {
                          const active = (pendingSingerAssignments[singerModalSong.id] ?? []).some(
                            (row) => row.singer.toLowerCase() === singer.toLowerCase(),
                          )
                          return (
                            <button
                              key={`assign-${singer}`}
                              className={`rounded-full border px-3 py-1 text-xs ${
                                active
                                  ? singer === INSTRUMENTAL_LABEL
                                    ? 'border-fuchsia-300 bg-fuchsia-400/10 text-fuchsia-200'
                                    : 'border-teal-300 bg-teal-400/10 text-teal-200'
                                  : singer === INSTRUMENTAL_LABEL
                                    ? 'border-fuchsia-400/40 text-fuchsia-200'
                                    : 'border-white/10 text-slate-300'
                              }`}
                              onClick={() =>
                                setPendingSingerAssignments((prev) => {
                                  const rows = prev[singerModalSong.id] ?? []
                                  const exists = rows.some(
                                    (row) => row.singer.toLowerCase() === singer.toLowerCase(),
                                  )
                                  if (exists) {
                                    return {
                                      ...prev,
                                      [singerModalSong.id]: rows.filter(
                                        (row) => row.singer.toLowerCase() !== singer.toLowerCase(),
                                      ),
                                    }
                                  }
                                  const existing = singerModalSong.keys.find(
                                    (key) => key.singer.toLowerCase() === singer.toLowerCase(),
                                  )
                                  return {
                                    ...prev,
                                    [singerModalSong.id]: [
                                      ...rows,
                                      {
                                        singer,
                                        key:
                                          existing?.gigOverrides[currentSetlist.id] ??
                                          existing?.defaultKey ??
                                          singerModalSong.originalKey ??
                                          '',
                                      },
                                    ],
                                  }
                                })
                              }
                            >
                              {singer}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {(pendingSingerAssignments[singerModalSong.id] ?? []).map((pending, index) => {
                        const selectedKey = singerModalSong.keys.find(
                          (key) => key.singer.toLowerCase() === pending.singer.toLowerCase(),
                        )
                        const suggestion =
                          selectedKey?.defaultKey || singerModalSong.originalKey || ''
                        return (
                          <div
                            key={`${singerModalSong.id}-${pending.singer}-${index}`}
                            className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_auto_auto]"
                          >
                            <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                              {pending.singer}
                            </div>
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
                            <button
                              className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200"
                              onClick={() =>
                                setPendingSingerAssignments((prev) => ({
                                  ...prev,
                                  [singerModalSong.id]: (prev[singerModalSong.id] ?? []).filter(
                                    (row) =>
                                      row.singer.toLowerCase() !== pending.singer.toLowerCase(),
                                  ),
                                }))
                              }
                            >
                              Remove
                            </button>
                          </div>
                        )
                      })}
                      {(pendingSingerAssignments[singerModalSong.id] ?? []).length === 0 && (
                        <div className="text-xs text-slate-400">
                          Tap singer buttons above to select one or more singers.
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-[10px] text-slate-400">Multiple singers supported.</div>
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
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-4 py-6"
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
                  aria-label="Close"
                  title="Close"
                >
                  ✕
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
                  aria-label="Close"
                  title="Close"
                >
                  ✕
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
              {!isSpecialSectionHidden && (
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
                          <div
                            className={`text-xs ${
                              !request.djOnly &&
                              request.singers.some(
                                (singer) =>
                                  singer.trim().toLowerCase() === INSTRUMENTAL_LABEL.toLowerCase(),
                              )
                                ? 'text-fuchsia-200'
                                : 'text-slate-300'
                            }`}
                          >
                            {request.djOnly ? 'DJ' : request.singers.join(', ')}
                          </div>
                          <div className="text-xs text-slate-200">
                            {request.djOnly ? '—' : request.key}
                          </div>
                          <div className="flex items-center justify-start gap-2 text-xs text-slate-400">
                            {request.note ? 'ℹ️' : ''}
                            {!gigMode && (
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-slate-300"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openSpecialRequestEditor(request)
                                }}
                                aria-label="Edit special request"
                                title="Edit special request"
                              >
                                ✎
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
              )}

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {orderedSetSections.map((section) => (
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
                        {section}
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
                            role="button"
                            tabIndex={0}
                            className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs"
                            onClick={() => openDocsForSong(song.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                openDocsForSong(song.id)
                              }
                            }}
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
                                  const hasInstrumental = assignments.some(
                                    (entry) =>
                                      entry.singer.trim().toLowerCase() ===
                                      INSTRUMENTAL_LABEL.toLowerCase(),
                                  )
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
                                          : hasInstrumental
                                            ? 'text-fuchsia-200'
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
                                    className="relative z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
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
                                    className="relative z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px] text-slate-200"
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

      {showGigModeLaunchModal && screen === 'builder' && currentSetlist && (
        <div
          className="fixed inset-0 z-[97] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowGigModeLaunchModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Choose Gig Mode View</h3>
            <p className="mt-1 text-sm text-slate-300">
              Start gig mode in your current builder layout or open the Setlist Sheet view.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100"
                onClick={() => {
                  setGigMode(true)
                  setShowGigSetlistSheet(false)
                  setShowGigModeLaunchModal(false)
                }}
              >
                Use Current View
              </button>
              <button
                className="rounded-xl bg-teal-400/90 px-4 py-3 text-sm font-semibold text-slate-950"
                onClick={() => {
                  setGigMode(true)
                  setShowGigSetlistSheet(true)
                  setShowGigModeLaunchModal(false)
                }}
              >
                Open Setlist Sheet
              </button>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300"
                onClick={() => setShowGigModeLaunchModal(false)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {showGigSetlistSheet && gigMode && currentSetlist && (
        <div className="fixed inset-0 z-[98] bg-gradient-to-b from-slate-950 via-yellow-900/50 to-slate-950 backdrop-blur-sm">
          <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-slate-950/55">
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-3 backdrop-blur">
              <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-[1fr_minmax(260px,1.3fr)_1fr] md:items-center">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold">Setlist Sheet</h3>
                  <div className="text-xs text-slate-400">
                    {currentSetlist.gigName} · {formatGigDate(currentSetlist.date)}
                  </div>
                  <label className="mt-1.5 block">
                    <span className="sr-only">Search songs by title or artist</span>
                    <input
                      type="text"
                      value={gigSheetSongSearch}
                      onChange={(event) => setGigSheetSongSearch(event.target.value)}
                      placeholder="Search by song or artist"
                      className="w-full max-w-xs rounded-xl border border-white/15 bg-slate-950/45 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-teal-300/60 focus:outline-none"
                    />
                  </label>
                </div>
                <div
                  className={`gig-sheet-upnext rounded-2xl border px-2.5 py-1.5 ${
                    gigSheetQueuedSong
                      ? 'liquid-button upnext-flash border-emerald-300/60 bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 text-slate-950 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                      : 'border-teal-300/35 bg-teal-400/10'
                  }`}
                >
                  <div className="flex min-h-[34px] items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${
                        gigSheetQueuedSong ? 'text-slate-950/80' : 'text-teal-200/90'
                      }`}
                    >
                      Up Next
                    </span>
                    <div className="grid w-[250px] shrink-0 grid-cols-2 items-center gap-2 md:w-[280px]">
                        <button
                          className={`gig-sheet-clear-upnext relative z-10 flex h-8 w-full items-center justify-center whitespace-nowrap rounded-xl border border-slate-900/30 bg-slate-950/25 px-2 py-1 text-[11px] font-semibold text-slate-950 transition-opacity ${
                            gigSheetQueuedSong ? 'opacity-100' : 'pointer-events-none opacity-0'
                          }`}
                          onClick={finishGigQueuedSong}
                        >
                          Finished Song
                        </button>
                        <button
                          className={`gig-sheet-clear-upnext relative z-10 flex h-8 w-full items-center justify-center whitespace-nowrap rounded-xl border border-red-400/35 bg-red-500/25 px-2 py-1 text-[11px] font-semibold text-red-100 transition-opacity ${
                            gigSheetQueuedSong ? 'opacity-100' : 'pointer-events-none opacity-0'
                          }`}
                          onClick={clearGigQueuedSong}
                        >
                          Take Back
                        </button>
                    </div>
                  </div>
                  <div
                    className={`mt-0.5 truncate text-sm font-semibold leading-tight md:text-base ${
                      gigSheetQueuedSong ? 'text-slate-950' : 'text-teal-50'
                    }`}
                  >
                    {gigSheetQueuedSong?.title ?? 'No song queued'}
                  </div>
                </div>
                <div className="flex items-center justify-start gap-2 md:justify-end">
                  {isAdmin && (
                    <button
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                      onClick={() => setShowAddSetlistModal(true)}
                    >
                      Add Setlist Type
                    </button>
                  )}
                  <button
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300"
                    onClick={closeGigSetlistSheet}
                    aria-label="Close"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-4 md:px-6"
              data-drag-scroll-container="build-panel"
            >
              <div className="grid grid-cols-1 gap-4 md:flex md:h-full md:flex-nowrap md:items-stretch md:gap-4 md:overflow-x-auto md:overflow-y-hidden md:snap-x md:snap-mandatory">
                <div
                  className={`print-section-box gig-sheet-card ${getPrintToneClass('special requests')} md:min-w-[340px] md:w-[340px] md:shrink-0 md:snap-start`}
                >
                  <div className="print-section-title flex items-center justify-between gap-2">
                    <span>Special Requests</span>
                    {isAdmin && (
                      <button
                        className="rounded-lg border border-white/20 px-2 py-1 text-[10px]"
                        onClick={() => {
                          resetPendingSpecialRequest()
                          setShowSpecialRequestModal(true)
                        }}
                      >
                        Add
                      </button>
                    )}
                  </div>
                  <div className="print-list">
                    {getOrderedSpecialRequests(currentSetlist.id).map((request) => {
                      const isLocked = request.songId ? isGigSongLocked(request.songId) : false
                      return (
                        <div
                          key={`gig-sheet-special-${request.id}`}
                          role={request.songId ? 'button' : undefined}
                          tabIndex={request.songId ? 0 : -1}
                          className={`print-row ${isLocked ? 'opacity-45' : ''} ${
                            request.songId && appState.currentSongId === request.songId
                              ? 'ring-2 ring-emerald-300/80 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                              : ''
                          }`}
                          onMouseDown={() => request.songId && startGigSheetLongPress(request.songId)}
                          onMouseUp={endGigSheetLongPress}
                          onMouseLeave={endGigSheetLongPress}
                          onTouchStart={() => request.songId && startGigSheetLongPress(request.songId)}
                          onTouchEnd={endGigSheetLongPress}
                          onTouchCancel={endGigSheetLongPress}
                          onClick={() => {
                            if (sheetLongPressTriggeredRef.current) {
                              sheetLongPressTriggeredRef.current = false
                              return
                            }
                            if (request.songId) {
                              markGigSongAsSelected(request.songId)
                            }
                          }}
                          onKeyDown={(event) => {
                            if (!request.songId) return
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              markGigSongAsSelected(request.songId)
                            }
                          }}
                        >
                          <div className="print-row-title">
                            <div className="song-title-stack">
                              <span className="song-name text-slate-900">{request.songTitle}</span>
                            </div>
                          </div>
                          <div className="print-row-subtitle print-song-meta">
                            <span>{request.type}</span>
                            <span className="print-assignee-names">
                              {request.djOnly
                                ? 'DJ'
                                : request.singers.length
                                  ? formatSingerAssignmentNames(request.singers)
                                  : 'No singers'}
                            </span>
                            <span className="musical-key">{request.djOnly ? '—' : request.key || 'No key'}</span>
                            {isAdmin && (
                              <span className="mt-1 inline-flex items-center gap-1 self-end">
                                <button
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 text-[11px] text-slate-200"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openSpecialRequestEditor(request)
                                  }}
                                  aria-label="Edit special request"
                                  title="Edit special request"
                                >
                                  ✎
                                </button>
                                <button
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-400/40 text-[11px] text-red-200"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    deleteSpecialRequest(request.id)
                                  }}
                                  aria-label="Delete special request"
                                  title="Delete special request"
                                >
                                  ✕
                                </button>
                              </span>
                            )}
                          </div>
                          {request.note ? <div className="print-row-note">{request.note}</div> : null}
                        </div>
                      )
                    })}
                    {getOrderedSpecialRequests(currentSetlist.id).length === 0 && (
                      <div className="print-empty">No special requests.</div>
                    )}
                  </div>
                </div>

                {orderedSetSections.map((section) => {
                  const sectionSongs = getSectionSongs(section).filter((song) => {
                    if (!gigSheetSongSearchQuery) return true
                    const titleArtist = `${song.title} ${song.artist ?? ''}`.toLowerCase()
                    return titleArtist.includes(gigSheetSongSearchQuery)
                  })
                  const toneClass = getPrintToneClass(section)
                  return (
                    <div
                      key={`gig-sheet-${section}`}
                      className={`print-section-box gig-sheet-card ${toneClass} md:min-w-[340px] md:w-[340px] md:shrink-0 md:snap-start`}
                      onDragOver={(event) => {
                        if (!isAdmin) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        autoScrollDragContainer(event)
                        updateSheetDragHover(section, null)
                      }}
                      onDrop={(event) => {
                        if (!isAdmin) return
                        event.preventDefault()
                        const fromSongId = sheetDraggedSongId ?? event.dataTransfer.getData('text/plain')
                        const fromSection = sheetDraggedFromSection ?? ''
                        if (!fromSongId || !fromSection) return
                        moveSongToGigSection(fromSection, section, fromSongId)
                        setSheetDraggedSongId(null)
                        setSheetDraggedFromSection(null)
                        clearSheetDragHover()
                      }}
                    >
                      <div className="print-section-title flex items-center justify-between gap-2">
                        <span>{section}</span>
                        {isAdmin && (
                          <div className="flex items-center gap-1">
                            <button
                              className="rounded-lg border border-white/20 px-2 py-1 text-[10px]"
                              onClick={() => openAddSongsForSection(section)}
                            >
                              Add
                            </button>
                            <button
                              className="rounded-lg border border-white/20 px-2 py-1 text-[10px]"
                              onClick={() => requestDeleteSetlistSection(section)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="print-list">
                        {sheetDragOverSection === section && !sheetDragOverSongId && isAdmin && (
                          <div className="h-3 rounded-xl border border-dashed border-teal-300/70 bg-teal-300/15" />
                        )}
                        {sectionSongs.map((song) => {
                          const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
                          const singers = assignments.map((entry) => entry.singer)
                          const isLocked = isGigSongLocked(song.id)
                          const isQueuedOrPlayed = isLocked || appState.currentSongId === song.id
                          return (
                            <div key={`gig-sheet-song-${section}-${song.id}`}>
                              {sheetDraggedSongId &&
                                sheetDraggedSongId !== song.id &&
                                sheetDragOverSongId === song.id &&
                                isAdmin && (
                                  <div className="mb-2 h-3 rounded-xl border border-dashed border-teal-300/70 bg-teal-300/15" />
                                )}
                              <div
                                role="button"
                                tabIndex={0}
                                draggable={isAdmin}
                                className={`print-row song-row gig-sheet-row transition-all duration-300 ${isLocked ? 'opacity-45' : ''} ${
                                  appState.currentSongId === song.id
                                    ? 'ring-2 ring-emerald-300/80 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                                    : ''
                                } ${
                                  recentlyMovedSongId === song.id
                                    ? 'ring-2 ring-teal-300/80 bg-teal-300/20'
                                    : ''
                                }`}
                                onMouseDown={() => startGigSheetLongPress(song.id)}
                                onMouseUp={endGigSheetLongPress}
                                onMouseLeave={endGigSheetLongPress}
                                onTouchStart={() => startGigSheetLongPress(song.id)}
                                onTouchEnd={endGigSheetLongPress}
                                onTouchCancel={endGigSheetLongPress}
                                onDragStart={(event) => {
                                  if (!isAdmin) return
                                  clearSheetLongPress()
                                  setSheetDraggedSongId(song.id)
                                  setSheetDraggedFromSection(section)
                                  updateSheetDragHover(section, null)
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData('text/plain', song.id)
                                }}
                                onDragOver={(event) => {
                                  if (!isAdmin) return
                                  event.preventDefault()
                                  event.dataTransfer.dropEffect = 'move'
                                  autoScrollDragContainer(event)
                                  updateSheetDragHover(section, song.id)
                                }}
                                onDrop={(event) => {
                                  if (!isAdmin) return
                                  event.preventDefault()
                                  event.stopPropagation()
                                  const fromSongId =
                                    sheetDraggedSongId ?? event.dataTransfer.getData('text/plain')
                                  const fromSection = sheetDraggedFromSection ?? ''
                                  if (!fromSongId || !fromSection) return
                                  if (fromSection.toLowerCase() === section.toLowerCase()) {
                                    reorderSectionSongs(section, fromSongId, song.id)
                                    flashMovedSong(fromSongId)
                                  } else {
                                    moveSongToGigSection(fromSection, section, fromSongId, song.id)
                                  }
                                  setSheetDraggedSongId(null)
                                  setSheetDraggedFromSection(null)
                                  clearSheetDragHover()
                                }}
                                onDragEnd={() => {
                                  setSheetDraggedSongId(null)
                                  setSheetDraggedFromSection(null)
                                  clearSheetDragHover()
                                }}
                                onClick={() => {
                                  if (sheetLongPressTriggeredRef.current) {
                                    sheetLongPressTriggeredRef.current = false
                                    return
                                  }
                                  markGigSongAsSelected(song.id)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    markGigSongAsSelected(song.id)
                                  }
                                }}
                              >
                                <div className="gig-sheet-song-main">
                                  <div
                                    className={`song-name text-slate-900 ${
                                      isQueuedOrPlayed ? 'line-through decoration-2 opacity-70' : ''
                                    }`}
                                  >
                                    <span className="gig-sheet-title-inline">{song.title}</span>{' '}
                                    <span className="gig-sheet-artist-inline">- {song.artist || 'Unknown'}</span>
                                  </div>
                                  <div
                                    className={`gig-sheet-singer-line ${
                                      isQueuedOrPlayed ? 'line-through decoration-2 opacity-70' : ''
                                    }`}
                                  >
                                    {singers.length ? formatSingerFirstNames(singers) : 'No singers'}
                                  </div>
                                </div>
                                {isAdmin && !isQueuedOrPlayed && (
                                  <button
                                    className="gig-sheet-remove-inline"
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
                          )
                        })}
                        {sectionSongs.length === 0 && (
                          <div className="print-empty">
                            {gigSheetSongSearchQuery ? 'No matching songs.' : 'No songs.'}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {showPlaylistModal && currentSetlist && (
        <div
          className="fixed inset-0 z-[98] bg-slate-950/90 backdrop-blur-sm"
        >
          <div
            className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">
                    {activeBandName || 'Band'} · {currentSetlist.gigName} ·{' '}
                    {formatGigDate(currentSetlist.date)}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">
                    {visiblePlaylistEntries.length
                      ? `${playlistIndex + 1} / ${visiblePlaylistEntries.length}`
                      : 'No playable songs'}
                  </span>
                  <button
                    type="button"
                    className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300"
                    onClick={() => setShowPlaylistModal(false)}
                    aria-label="Close"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-2 gap-2 md:hidden">
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                  disabled={visiblePlaylistEntries.length === 0}
                  onClick={() => movePlaylistBy(-1)}
                >
                  ⏮ Prev
                </button>
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                  disabled={visiblePlaylistEntries.length === 0}
                  onClick={() => movePlaylistBy(1)}
                >
                  ⏭ Next
                </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className={`min-h-[44px] rounded-xl border px-2 py-2 text-xs ${
                    playlistAutoAdvance
                      ? 'border-teal-300/60 bg-teal-400/10 text-teal-100'
                      : 'border-white/10 text-slate-300'
                  }`}
                  onClick={() => setPlaylistAutoAdvance((current) => !current)}
                >
                  Auto-next: {playlistAutoAdvance ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl border border-indigo-300/60 bg-indigo-500/20 px-2 py-2 text-xs text-indigo-100"
                  onClick={() => void copyPlaylistShareLink()}
                >
                  Share Link
                </button>
                <select
                  className="min-h-[44px] rounded-xl border border-white/10 bg-slate-900/80 px-2 py-2 text-xs text-slate-100 outline-none focus:border-teal-300"
                  value={playlistSingerFilter}
                  onChange={(event) => setPlaylistSingerFilter(event.target.value)}
                >
                  <option value="__all__">All singers</option>
                  {playlistSingerOptions.map((singer) => (
                    <option key={`playlist-singer-${singer}`} value={singer}>
                      {singer}
                    </option>
                  ))}
                </select>
                </div>
                {playlistShareStatus && (
                  <span className="text-xs text-teal-200">{playlistShareStatus}</span>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden px-5 pb-6 pt-4">
              <div className="relative h-full min-h-0 md:flex md:gap-4">
              <div
                ref={playlistPlayerBlockRef}
                className={`relative z-10 transition-opacity duration-200 md:flex-1 ${
                  playlistDrawerOverlay
                    ? 'pointer-events-none opacity-0 md:pointer-events-auto md:opacity-100'
                    : 'opacity-100'
                }`}
              >
              {currentPlaylistEntry ? (
                <div className="rounded-2xl bg-gradient-to-b from-slate-900/70 to-slate-950/60 p-4 shadow-[0_12px_36px_rgba(2,6,23,0.45)] ring-1 ring-white/10 transition-all duration-300">
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
                          className={`rounded-full px-2 py-1 text-[10px] font-semibold ${getPlaylistTagClasses(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl bg-slate-950/35 p-3">
                    {!currentPlaylistEntry.audioUrl ? (
                      <div className="text-sm text-slate-400">
                        No audio URL saved for this song yet.
                      </div>
                    ) : isSpotifyUrl(currentPlaylistEntry.audioUrl) ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/70 p-3 ring-1 ring-white/10">
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
                          if (!playlistAutoAdvance || visiblePlaylistEntries.length <= 1) return
                          movePlaylistBy(1)
                        }}
                      />
                    ) : isYouTubeUrl(currentPlaylistEntry.audioUrl) ? (
                      <iframe
                        key={`${currentPlaylistEntry.key}-${playlistPlayNonce}`}
                        className="h-[180px] w-full rounded-xl ring-1 ring-white/10 md:h-[min(58vh,520px)]"
                        src={getYouTubeEmbedUrl(currentPlaylistEntry.audioUrl)}
                        title="YouTube playlist item"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/70 p-3 ring-1 ring-white/10">
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
                <div className="rounded-2xl bg-gradient-to-b from-slate-900/70 to-slate-950/60 p-4 text-sm text-slate-300 shadow-[0_12px_36px_rgba(2,6,23,0.45)] ring-1 ring-white/10">
                  No playlist songs found for this gig yet.
                </div>
              )}
              <div className="mt-3 hidden grid-cols-2 gap-2 md:grid">
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                  disabled={visiblePlaylistEntries.length === 0}
                  onClick={() => movePlaylistBy(-1)}
                >
                  ⏮ Prev
                </button>
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm"
                  disabled={visiblePlaylistEntries.length === 0}
                  onClick={() => movePlaylistBy(1)}
                >
                  ⏭ Next
                </button>
              </div>
              </div>

              <div
                className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl transition-all duration-300 md:static md:inset-auto md:bottom-auto md:h-full md:w-[300px] md:shrink-0"
                style={{
                  top: playlistDrawerOverlay ? 0 : playlistDrawerDockTop,
                }}
                onTouchStart={handlePlaylistDrawerTouchStart}
                onTouchMove={handlePlaylistDrawerTouchMove}
                onTouchEnd={handlePlaylistDrawerTouchEnd}
              >
                <div className="flex items-center justify-center py-2 md:hidden">
                  <div className="h-1 w-12 rounded-full bg-white/25" />
                </div>
                <div
                  className="max-h-full overflow-y-auto px-2 pb-2 md:h-full md:max-h-none"
                  onScroll={handlePlaylistDrawerScroll}
                >
                  <div className="space-y-3 pb-2">
                    {groupedPlaylistSections.map((group) => (
                      <div
                        key={`playlist-group-${group.section}`}
                        className={getPlaylistSectionCardClasses(group.section)}
                      >
                        <div className={playlistSectionHeaderClasses}>
                          {group.section}
                        </div>
                        <div className="space-y-2">
                          {group.items.map(({ entry: item, index }) => (
                            <button
                              type="button"
                              key={item.key}
                              className={getPlaylistQueueItemButtonClasses(index === playlistIndex)}
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
                                      className={`rounded-full px-2 py-1 text-[10px] font-semibold ${getPlaylistTagClasses(tag)}`}
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
                    ))}
                  </div>
                </div>
              </div>
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
                      aria-label="Close"
                      title="Close"
                    >
                      ✕
                    </button>
                    <button
                      className="min-w-[120px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
                      onClick={handlePrintSetlistPDF}
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
                  <div id="printable-setlist-preview" className="print-container">
                    <div className="print-header">
                      {activeBandName && <div className="print-band-name">{activeBandName}</div>}
                      <div className="print-header-details">
                        <div className="print-title">{currentSetlist.gigName}</div>
                        <div className="print-subtitle">{formatGigDate(currentSetlist.date)}</div>
                        {currentSetlist.venueAddress && (
                          <div className="print-subtitle">{currentSetlist.venueAddress}</div>
                        )}
                      </div>
                      <div className="print-badge">Setlist</div>
                    </div>

                    <div className="print-layout">
                      <div
                        className={`print-section-box ${getPrintToneClass('musicians')} ${getPrintLayoutClass('musicians')}`}
                      >
                        <div className="print-section-title">Musicians</div>
                        <div className="print-grid">
                          {printableGigMusicians.map((musician) => (
                            <div key={musician.id} className="print-card">
                              <div className="print-musician-row">
                                <div className="print-musician-name">{musician.name}</div>
                                <div className="print-musician-instruments">
                                  {(musician.instruments ?? []).join(', ') || 'No instruments'}
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
                          {printableGigMusicians.length === 0 && (
                            <div className="print-empty">No musicians have been assigned yet.</div>
                          )}
                        </div>
                      </div>

                      <div
                        className={`print-section-box ${getPrintToneClass('special requests')} ${getPrintLayoutClass('special requests')}`}
                      >
                        <div className="print-section-title">Special Requests</div>
                        <div className="print-list">
                          {getOrderedSpecialRequests(currentSetlist.id)
                            .map((request) => {
                              const song = appState.songs.find((item) => item.id === request.songId)
                              return (
                                <div key={request.id} className="print-row">
                                  <div className="print-row-title">
                                    <span className="print-title-line">
                                      {request.djOnly ? <span className="print-pill">DJ Only</span> : null}
                                      {request.externalAudioUrl || song?.youtubeUrl ? (
                                        <a
                                          className="print-link song-name"
                                          href={request.externalAudioUrl ?? song?.youtubeUrl ?? ''}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {request.songTitle}
                                        </a>
                                      ) : (
                                        <span className="song-name">{request.songTitle}</span>
                                      )}
                                    </span>
                                  </div>
                                  <div className="print-row-subtitle">
                                    {request.type} ·{' '}
                                        <span className="print-assignee-names">
                                          {request.djOnly
                                            ? 'DJ'
                                            : request.singers.length
                                              ? formatSingerAssignmentNames(request.singers)
                                              : 'No singers'}
                                        </span>{' '}
                                    · {request.djOnly ? '—' : request.key || 'No key'}
                                  </div>
                                  {request.note && <div className="print-row-note">{request.note}</div>}
                                </div>
                              )
                            })}
                          {getOrderedSpecialRequests(currentSetlist.id).length === 0 && (
                            <div className="print-empty">No special requests.</div>
                          )}
                        </div>
                      </div>

                      {orderedPrintableSongSections.flatMap((section) => {
                        const songs = currentSetlist.songIds
                          .map((songId) => appState.songs.find((song) => song.id === songId))
                          .filter((song): song is Song => Boolean(song))
                          .filter((song) => hasSongTag(song, section))
                        const isDanceSection = section.toLowerCase().includes('dance')
                        const sectionChunks = isDanceSection ? [songs] : chunkList(songs, 20)
                        const sectionTitle = section.toLowerCase().includes('set')
                          ? section
                          : `${section} Set`
                        return sectionChunks.map((songChunk, chunkIndex) => (
                          <div
                            key={`stacked-${section}-${chunkIndex}`}
                            className={`print-section-box ${getPrintToneClass(section)} ${getPrintLayoutClass(section)}`}
                          >
                            <div className="print-section-title">
                              {sectionTitle}
                            </div>
                            <div className="print-list">
                              {songChunk.map((song) => {
                                const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
                                const singers = assignments.map((entry) => entry.singer)
                                const keys = Array.from(new Set(assignments.map((entry) => entry.key)))
                                const keyLabel =
                                  keys.length === 0 ? 'No key' : keys.length === 1 ? keys[0] : 'Multi'
                                return (
                                  <div key={song.id} className="print-row song-row">
                                    <div className="print-row-title">
                                      <div className="song-title-stack">
                                        {song.youtubeUrl ? (
                                          <a
                                            className="print-link song-name"
                                            href={song.youtubeUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {song.title}
                                          </a>
                                        ) : (
                                          <span className="song-name">{song.title}</span>
                                        )}
                                        <span className="artist-name">{song.artist || 'Unknown'}</span>
                                      </div>
                                    </div>
                                    <div className="print-row-subtitle print-song-meta">
                                      <span className="musical-key">{keyLabel}</span>
                                      <span className="print-assignee-names">
                                        {singers.length ? formatSingerAssignmentNames(singers) : 'No singers'}
                                      </span>
                                    </div>
                                  </div>
                                )
                              })}
                              {songChunk.length === 0 && <div className="print-empty">No songs.</div>}
                            </div>
                          </div>
                        ))
                      })}
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

      {showAddMusicianModal && isAdmin && (
        <div
          className="fixed inset-0 z-[87] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setShowAddMusicianModal(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 className="text-lg font-semibold">Add musician</h3>
              <p className="mt-1 text-sm text-slate-300">
                Mark core members or subs. Add contact info and instruments.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                  onClick={() => setShowAddMusicianModal(false)}
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  placeholder="Musician name"
                  value={newMusicianName}
                  onChange={(event) => setNewMusicianName(event.target.value)}
                />
                <select
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  value={newMusicianRoster}
                  onChange={(event) => setNewMusicianRoster(event.target.value as 'core' | 'sub')}
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
                <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm md:col-span-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Instruments</div>
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
                              ? newMusicianInstruments.filter((item) => item !== instrument)
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
                      setNewMusicianSinger(event.target.value as 'male' | 'female' | 'other' | '')
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
                onClick={() => {
                  if (!newMusicianName.trim()) return
                  addMusician()
                  setShowAddMusicianModal(false)
                }}
              >
                Add musician
              </button>
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
                  aria-label="Close"
                  title="Close"
                >
                  ✕
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
                    {setlistTypeTags.map((tag) => {
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
                  aria-label="Close"
                  title="Close"
                >
                  ✕
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
                  {isEditSongDirty || hasPendingDocDraft ? 'Save' : '✕'}
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
                {setlistTypeTags.map((tag) => {
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
                          {doc.type} · {formatDocumentInstruments(doc.instrument)}
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
                    {(isAdmin
                      ? (['Chart', 'Lyrics', 'Lead Sheet'] as const)
                      : (['Chart', 'Lyrics'] as const)
                    ).map((type) => {
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
                      Instruments
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {instrumentCatalog.map((instrument) => {
                        const active = newDocInstruments.includes(instrument)
                        return (
                          <button
                            key={instrument}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                              active
                                ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                                : 'border-white/10 text-slate-300'
                            }`}
                            onClick={() =>
                              setNewDocInstruments((current) => {
                                const has = current.includes(instrument)
                                const next = has
                                  ? current.filter((item) => item !== instrument)
                                  : [...current, instrument]
                                return normalizeTagList(next)
                              })
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
                    placeholder="Or paste file link(s). Use a new line per page."
                    value={newDocUrl}
                    onChange={(event) => {
                      const nextUrl = event.target.value
                      const wasEmpty = !newDocUrl.trim()
                      setNewDocUrl(nextUrl)
                      if (wasEmpty && nextUrl.trim()) {
                        setShowDocUrlAccessWarning(true)
                      }
                    }}
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
                      : getSectionFromPanel(activeBuildPanel) ?? 'Setlist'}
              </h3>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                    onClick={() => setActiveBuildPanel(null)}
                    aria-label={buildPanelDirty ? 'Save' : 'Close'}
                    title={buildPanelDirty ? 'Save' : 'Close'}
                  >
                    {buildPanelDirty ? 'Save' : '✕'}
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
                  {(getSectionFromPanel(activeBuildPanel) || activeBuildPanel === 'special') && (
                    <button
                      className="rounded-full border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-200"
                      onClick={() => {
                        if (activeBuildPanel === 'special') {
                          requestDeleteSetlistSection('Special Requests')
                          return
                        }
                        requestDeleteSetlistSection(getSectionFromPanel(activeBuildPanel) ?? '')
                      }}
                    >
                      Delete setlist
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
                      {setlistTypeTags.map((tag) => (
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

              {activeBuildPanel === 'special' && !isSpecialSectionHidden && (
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
                        onClick={() => {
                          resetPendingSpecialRequest()
                          setShowSpecialRequestModal(true)
                        }}
                      >
                        Add request
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
                    {getOrderedSpecialRequests(currentSetlist.id)
                      .map((request) => {
                        const song = appState.songs.find(
                          (item) => item.id === request.songId,
                        )
                        const isLockedInGigMode =
                          gigMode && request.songId ? isGigSongLocked(request.songId) : false
                        return (
                          <div key={request.id} className="space-y-2">
                            {draggedSpecialRequestId &&
                              draggedSpecialRequestId !== request.id &&
                              dragOverSpecialRequestId === request.id && (
                                <div className="h-4 rounded-xl border border-dashed border-teal-300/70 bg-teal-300/15" />
                            )}
                            <div
                              role="button"
                              tabIndex={0}
                              draggable={!gigMode}
                              className={`grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr] ${
                                gigMode ? 'cursor-pointer' : ''
                              } ${
                                isLockedInGigMode ? 'opacity-45' : ''
                              }`}
                              onDragStart={(event) => {
                                if (gigMode) {
                                  event.preventDefault()
                                  return
                                }
                                setDraggedSpecialRequestId(request.id)
                                setDragOverSpecialRequestId(null)
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', request.id)
                              }}
                              onDragOver={(event) => {
                                if (gigMode) return
                                event.preventDefault()
                                event.dataTransfer.dropEffect = 'move'
                                autoScrollDragContainer(event)
                                setDragOverSpecialRequestId(request.id)
                              }}
                              onDrop={(event) => {
                                if (gigMode) return
                                event.preventDefault()
                                const fromId =
                                  draggedSpecialRequestId ?? event.dataTransfer.getData('text/plain')
                                if (!fromId) return
                                reorderSpecialRequests(fromId, request.id)
                                setDraggedSpecialRequestId(null)
                                setDragOverSpecialRequestId(null)
                              }}
                              onDragEnd={() => {
                                setDraggedSpecialRequestId(null)
                                setDragOverSpecialRequestId(null)
                              }}
                              onClick={() => {
                                if (gigMode && request.songId) {
                                  markGigSongAsSelected(request.songId)
                                  return
                                }
                                if (!gigMode && request.songId) {
                                  openSingerModal(request.songId)
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  if (gigMode && request.songId) {
                                    markGigSongAsSelected(request.songId)
                                  } else if (!gigMode && request.songId) {
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
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
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
                                {(hasDocsForSong(song?.id) || (isAdmin && Boolean(song))) && (
                                  <button
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-slate-200"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      if (!song) return
                                      if (hasDocsForSong(song.id)) {
                                        openDocsForSong(song.id)
                                      } else if (isAdmin) {
                                        openSongEditor(song)
                                      }
                                    }}
                                    aria-label={hasDocsForSong(song?.id) ? 'Documents' : 'Add lyrics/charts'}
                                    title={hasDocsForSong(song?.id) ? 'Documents' : 'Add lyrics/charts'}
                                  >
                                    📄
                                  </button>
                                )}
                              </div>
                            </div>
                            <div
                              className={`text-xs ${
                                !request.djOnly &&
                                request.singers.some(
                                  (singer) =>
                                    singer.trim().toLowerCase() ===
                                    INSTRUMENTAL_LABEL.toLowerCase(),
                                )
                                  ? 'text-fuchsia-200'
                                  : 'text-slate-300'
                              }`}
                            >
                              {request.djOnly ? 'DJ' : request.singers.join(', ')}
                            </div>
                            <div className="text-xs text-slate-200">
                              {request.djOnly ? '—' : request.key}
                            </div>
                            <div className="flex items-center justify-start gap-2 text-xs text-slate-400">
                              {request.note ? 'ℹ️' : ''}
                              {!gigMode && (
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-slate-300"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openSpecialRequestEditor(request)
                                  }}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  aria-label="Edit special request"
                                  title="Edit special request"
                                >
                                  ✎
                                </button>
                              )}
                            </div>
                            </div>
                          </div>
                        )
                      })}
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

              {getSectionFromPanel(activeBuildPanel) &&
                (() => {
                  const section = getSectionFromPanel(activeBuildPanel) ?? ''
                  const completionKey = setlistPanelKey(section)
                  const sectionSongs = getSectionSongs(section)
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
                          {section}
                        </h3>
                        {!buildCompletion[completionKey] && !gigMode && (
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
                      {!buildCompletion[completionKey] && !gigMode && (
                        <p className="mt-1 text-[10px] text-slate-500">
                          Drag songs to reorder this section.
                        </p>
                      )}
                      {!buildCompletion[completionKey] && !gigMode && (
                        <div className="mt-3 space-y-3">
                          <div className="flex items-center gap-2">
                            {!starterPasteOpen[section] ? (
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
                                aria-label="Close"
                                title="Close"
                              >
                                ✕
                              </button>
                            )}
                            <button
                              className="inline-flex min-w-[130px] items-center justify-center whitespace-nowrap rounded-xl border border-white/10 px-4 py-2 text-center text-sm font-semibold text-slate-200"
                              onClick={() => openAddSongsForSection(section)}
                            >
                              Add song(s)
                            </button>
                            <button
                              className="inline-flex min-w-[130px] items-center justify-center whitespace-nowrap rounded-xl border border-white/10 px-4 py-2 text-center text-sm font-semibold text-slate-200"
                              onClick={() => openManualSectionOrderModal(section)}
                            >
                              Manual order
                            </button>
                          </div>
                          {starterPasteOpen[section] && (
                            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-[10px] text-slate-200">
                              <div className="text-[10px] text-slate-400">
                                One song per line. Format: Title – Artist (singers optional).
                              </div>
                              <textarea
                                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
                                rows={6}
                                placeholder={`Example:\nSeptember – Earth, Wind & Fire\nUptown Funk – Mark Ronson ft. Bruno Mars`}
                                value={
                                  starterPasteBySection[section] ?? ''
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
                                      section,
                                      starterPasteBySection[section] ?? '',
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
                        {sectionSongs.map((song) => {
                            const isLockedInGigMode = gigMode && isGigSongLocked(song.id)
                            return (
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
                                  !buildCompletion[completionKey]
                                }
                                className={`rounded-2xl border px-3 py-2 text-xs transition-all duration-300 ${
                                  gigMode ? 'cursor-pointer' : ''
                                } ${
                                  appState.currentSongId === song.id
                                    ? 'border-emerald-300/70 bg-emerald-400/15 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                                    : 'border-white/10 bg-slate-950/40'
                                } ${
                                  isLockedInGigMode ? 'opacity-45' : ''
                                } ${
                                  recentlyMovedSongId === song.id
                                    ? 'ring-2 ring-teal-300/80 bg-teal-300/20'
                                    : ''
                                }`}
                                onDragStart={(event) => {
                                  if (
                                    gigMode ||
                                    buildCompletion[completionKey]
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
                                    buildCompletion[completionKey]
                                  ) {
                                    return
                                  }
                                  event.preventDefault()
                                  event.dataTransfer.dropEffect = 'move'
                                autoScrollDragContainer(event)
                                  setDragOverSectionSongId(song.id)
                                }}
                                onDrop={(event) => {
                                  if (
                                    gigMode ||
                                    buildCompletion[completionKey]
                                  ) {
                                    return
                                  }
                                  event.preventDefault()
                                  const fromId =
                                    draggedSectionSongId ?? event.dataTransfer.getData('text/plain')
                                  if (!fromId) return
                                  reorderSectionSongs(
                                    section,
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
                                    markGigSongAsSelected(song.id)
                                    if (isLockedInGigMode) return
                                  }
                                  openDocsForSong(song.id)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    if (gigMode) {
                                      markGigSongAsSelected(song.id)
                                      if (isLockedInGigMode) return
                                    }
                                    openDocsForSong(song.id)
                                  }
                                }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2">
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
                                    const hasInstrumental = assignments.some(
                                      (entry) =>
                                        entry.singer.trim().toLowerCase() ===
                                        INSTRUMENTAL_LABEL.toLowerCase(),
                                    )
                                    const keys = Array.from(
                                      new Set(assignments.map((entry) => entry.key)),
                                    )
                                    const label = !assignments.length
                                      ? 'No singers assigned?'
                                      : keys.length === 1
                                        ? `${singers.join(', ')} · Key: ${keys[0]}`
                                        : `${singers.join(', ')} · Multiple keys`
                                    return (
                                      <button
                                        type="button"
                                        className={`mt-2 text-[10px] ${
                                          assignments.length === 0
                                            ? 'text-red-300'
                                            : hasInstrumental
                                              ? 'text-fuchsia-200'
                                              : 'text-teal-200'
                                        }`}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          openSingerModal(song.id)
                                        }}
                                      >
                                        {label}
                                      </button>
                                    )
                                  })()}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {song.youtubeUrl && (
                                    <button
                                      className="relative z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[14px] text-slate-200"
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
                                      className="relative z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[12px] text-slate-200"
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
                                    !buildCompletion[completionKey] && (
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
                        )})}
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

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function encodeSharePayloadBase64Url(payload: unknown) {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeSharePayloadBase64Url(raw: string) {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4)
  const padded = `${normalized}${'='.repeat(padLength)}`
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function parseSharedPlaylistPayload(raw: string) {
  const candidates = [raw, safeDecodeURIComponent(raw)]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as SharedPlaylistView
      if (parsed && Array.isArray(parsed.entries)) return parsed
    } catch {
      // Continue to base64 decode attempts.
    }
    try {
      const decoded = decodeSharePayloadBase64Url(candidate)
      const parsed = JSON.parse(decoded) as SharedPlaylistView
      if (parsed && Array.isArray(parsed.entries)) return parsed
    } catch {
      // Continue to next candidate.
    }
  }
  return null
}

function parseSharedMusiciansPayload(raw: string | null) {
  if (!raw) return []
  const candidates = [raw, safeDecodeURIComponent(raw)]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Musician[]
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Continue to base64 decode attempts.
    }
    try {
      const decoded = decodeSharePayloadBase64Url(candidate)
      const parsed = JSON.parse(decoded) as Musician[]
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Continue to next candidate.
    }
  }
  return []
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
  } catch {
    return url ?? ''
  }
  return url ?? ''
}

function isYouTubeUrl(url: string | null) {
  try {
    if (!url) return false
    const parsed = new URL(url)
    return parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')
  } catch {
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
  } catch {
    return url ?? ''
  }
  return url ?? ''
}

export default App
