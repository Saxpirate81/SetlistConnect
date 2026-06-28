import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { PlaylistYouTubePlayer, type PlaylistYouTubePlayerHandle } from './PlaylistYouTubePlayer'
import { isSupabaseEnabled, supabase, supabaseEnvStatus } from './lib/supabaseClient'
import { logger } from './lib/logger'
import { useDebounce } from './hooks/useDebounce'
import { CloseButton } from './components/ui/CloseButton'
import { AppIcon } from './components/ui/AppIcon'
import { SkeletonAppShell } from './components/ui/Skeleton'
import { AuthScreen } from './screens/AuthScreen'
import { CreateBandScreen } from './screens/CreateBandScreen'
import { TierLimitModal } from './components/modals/TierLimitModal'
import { InfoModal } from './components/modals/InfoModal'
import { ConfirmModal } from './components/modals/ConfirmModal'
import { AppProvider } from './context/AppContext'
import { QuickAddSong } from './components/QuickAddSong'
import { FreshSongBrowser } from './components/FreshSongBrowser'
import { DuplicateSongMerger } from './components/DuplicateSongMerger'
import { SongMetadataBackfill } from './components/SongMetadataBackfill'
import {
  SESSION_TIMEOUT_MS,
  INSTRUMENTS,
  INSTRUMENTAL_LABEL,
  DEFAULT_TAGS,
  DEFAULT_SPECIAL_TYPES,
  REQUEST_TYPE_TAG_EXCLUSIONS,
  SETLIST_PANEL_PREFIX,
  GIG_SECTION_TAG_PREFIX,
  GIG_SECTION_DELETED_TAG_PREFIX,
  PRINT_SPECIAL_REQUESTS_PER_SECTION,
  PRINT_DEFAULT_SONGS_PER_SECTION,
  PRINT_DANCE_SONGS_PER_SECTION,
  BILLING_TEST_EMAILS,
  BAND_TIER_DETAILS,
  LYRICS_COLOR_SWATCHES,
  DEFAULT_LYRICS_USER_PREFS,
} from './lib/constants'
import {
  isAdminMembershipRole,
  getPreferredMembership,
  isMainNavScreen,
  isLocalhostOrigin,
  parseOriginFromUrl,
  parseEmailRateLimitSeconds,
  isEmailRateLimitErrorMessage,
  resolveAuthRedirectOrigin,
  getOperationalDateISO,
  normalizeGigDateISO,
  chunkList,
} from './lib/utils'
import type {
  Role,
  Screen,
  QaViewPreset,
  BandTier,
  SongKey,
  Song,
  Setlist,
  SpecialRequest,
  Chart,
  Musician,
  GigMusician,
  Band,
  BandMembership,
  Document,
  PlaylistEntry,
  SharedPlaylistView,
  DocumentSelectionItem,
  BeforeInstallPromptEvent,
  LyricsHighlightRange,
  LyricsStrokePoint,
  LyricsStroke,
  LyricsDocState,
  LyricsUserPrefs,
  LyricsUndoState,
  LyricsToolPanelKey,
  LyricsToolPanelPosition,
  AppState,
  HistoryEntry,
} from './types'
import { getYouTubeEmbedUrl, isYouTubeUrl } from './lib/youtube'
import downloadPdfIcon from './assets/download-pdf-icon.png'
import openPlaylistIcon from './assets/open-playlist-icon.png'
import setlistConnectLogo from './assets/setlist-connect-logo.png'

// isAdminMembershipRole, getPreferredMembership, isMainNavScreen imported from ./lib/utils
// BILLING_TEST_EMAILS imported from ./lib/constants
const SHARED_SIGNUP_RETURN_KEY = 'setlist:sharedSignupReturnView'

// CloseButton and AppIcon imported from ./components/ui/

// Constants imported from ./lib/constants and ./lib/utils
// Storage keys still used directly here (will move to storage.ts in later pass)
const LAST_ACTIVE_KEY = 'setlist:lastActive'
const LAST_MAIN_SCREEN_KEY = 'setlist:lastMainScreen'
const ACTIVE_BAND_KEY = 'setlist:activeBandId'
const GIG_LOCKED_SONGS_KEY = 'setlist:gigLockedSongs'
const GIG_LAST_LOCKED_SONG_KEY = 'setlist:gigLastLockedSong'
const SHARED_LYRICS_THEME_KEY = 'setlist:sharedLyricsTheme'
const SHARED_LYRICS_FONT_KEY = 'setlist:sharedLyricsFont'
const LYRICS_DOC_STATE_KEY = 'setlist:lyricsDocState:v1'
const LYRICS_USER_PREFS_KEY = 'setlist:lyricsUserPrefs:v1'
const LYRICS_VIEWER_ID_KEY = 'setlist:lyricsViewerId'
const GIG_DELETED_SECTION_SONGS_KEY = 'setlist:gigDeletedSectionSongs:v1'

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

// chunkList, PRINT_* constants, getOperationalDateISO, normalizeGigDateISO
// imported from ./lib/utils and ./lib/constants

// ── OfflineBanner ──────────────────────────────────────────────────────────
// Shows a sticky warning at the top of the screen when the device is offline.
// Disappears automatically when connectivity is restored.
function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div
      role="alert"
      className="fixed left-0 right-0 top-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 shadow-md"
    >
      <span>⚠</span>
      <span>You&apos;re offline — changes won&apos;t be saved until you reconnect.</span>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────
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
  const [musicianSearch, setMusicianSearch] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<string | null>(null)
  const [authEmailCooldownSeconds, setAuthEmailCooldownSeconds] = useState(0)
  const [authLoading, setAuthLoading] = useState(false)
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(false)
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState('')
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null)
  const [bands, setBands] = useState<Band[]>([])
  const [memberships, setMemberships] = useState<BandMembership[]>([])
  const [bandContextLoading, setBandContextLoading] = useState(Boolean(supabase))
  const [showCreateBandOnboarding, setShowCreateBandOnboarding] = useState(false)
  const [activeBandId, setActiveBandId] = useState<string>(() =>
    localStorage.getItem(ACTIVE_BAND_KEY) ?? '',
  )
  const [newBandName, setNewBandName] = useState('')
  const [accountBandNameDraft, setAccountBandNameDraft] = useState('')
  const [accountSaveStatus, setAccountSaveStatus] = useState('')
  const [bandSubscriptionTierByBandId, setBandSubscriptionTierByBandId] = useState<Record<string, BandTier>>(
    {},
  )
  const [bandPendingTierChangeByBandId, setBandPendingTierChangeByBandId] = useState<
    Record<string, { pendingTier: BandTier; effectiveAt: string }>
  >({})
  const [showTierLimitModal, setShowTierLimitModal] = useState<{
    resource: 'songs' | 'musicians' | 'gigs'
    message: string
  } | null>(null)
  const [showTierDetailsModal, setShowTierDetailsModal] = useState<BandTier | null>(null)
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteMusicianId, setInviteMusicianId] = useState('')
  const [inviteCreateResult, setInviteCreateResult] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>(() => {
    const saved = localStorage.getItem(LAST_MAIN_SCREEN_KEY)
    return saved && isMainNavScreen(saved) ? saved : 'setlists'
  })
  const [pastGigUnlockedByGigId, setPastGigUnlockedByGigId] = useState<Record<string, boolean>>({})
  const [appState, setAppState] = useState<AppState>(
    isSupabaseEnabled ? { ...initialState } : initialState,
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
  const [pendingSpecialArtist, setPendingSpecialArtist] = useState('')
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
  const [isStandaloneDisplayMode, setIsStandaloneDisplayMode] = useState(false)
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
  const [adminUpNextBannerBottom, setAdminUpNextBannerBottom] = useState(0)
  const adminUpNextBannerRef = useRef<HTMLDivElement | null>(null)
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
  const [pendingRemoveSongSection, setPendingRemoveSongSection] = useState<string | null>(null)
  const [singerModalSongId, setSingerModalSongId] = useState<string | null>(null)
  const [showAddSongModal, setShowAddSongModal] = useState(false)
  const [songLibraryTags, setSongLibraryTags] = useState<string[]>([])
  const [songLibrarySearch, setSongLibrarySearch] = useState('')

  // Debounced search values — use these for filtering, not the raw state above.
  // This prevents a re-render on every keystroke.
  const debouncedSongSearch = useDebounce(songSearch, 200)
  const debouncedMusicianSearch = useDebounce(musicianSearch, 200)
  const debouncedGigSheetSongSearch = useDebounce(gigSheetSongSearch, 200)
  const debouncedSongLibrarySearch = useDebounce(songLibrarySearch, 200)
  const debouncedInstrumentFilter = useDebounce(instrumentFilter, 200)

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
  const [playlistModalTab, setPlaylistModalTab] = useState<'setlist' | 'playlist'>('setlist')
  const [playlistIndex, setPlaylistIndex] = useState(0)
  const [playlistAutoAdvance, setPlaylistAutoAdvance] = useState(true)
  const [playlistPlayNonce, setPlaylistPlayNonce] = useState(0)
  const [qaPreset, setQaPreset] = useState<QaViewPreset>('off')
  const [sharedPlaylistView, setSharedPlaylistView] = useState<SharedPlaylistView | null>(null)
  const [sharedPlaylistLoading, setSharedPlaylistLoading] = useState(false)
  const [sharedPlaylistError, setSharedPlaylistError] = useState<string | null>(null)
  const [showSharedInstrumentPrompt, setShowSharedInstrumentPrompt] = useState(false)
  const [sharedSignupReturnView, setSharedSignupReturnView] = useState<SharedPlaylistView | null>(() => {
    try {
      const raw = localStorage.getItem(SHARED_SIGNUP_RETURN_KEY)
      const parsed = raw ? parseSharedPlaylistPayload(raw) : null
      if (!parsed && raw) {
        localStorage.removeItem(SHARED_SIGNUP_RETURN_KEY)
      }
      return parsed
    } catch {
      return null
    }
  })
  const [sharedImportSaving, setSharedImportSaving] = useState(false)
  const [sharedImportStatus, setSharedImportStatus] = useState('')
  const [sharedPublicTab, setSharedPublicTab] = useState<'setlist' | 'playlist'>('setlist')
  const [sharedWelcomeStep, setSharedWelcomeStep] = useState<'hidden' | 'cta' | 'learn'>('hidden')
  const [sharedWelcomeCompletedSetlistId, setSharedWelcomeCompletedSetlistId] = useState<string | null>(null)
  const qaToolsEnabled = (() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    if (params.get('qa') === '1') return true
    if (import.meta.env.DEV) return true
    const host = window.location.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1'
  })()
  const playlistModalYtHandleRef = useRef<PlaylistYouTubePlayerHandle | null>(null)
  const sharedPublicYtHandleRef = useRef<PlaylistYouTubePlayerHandle | null>(null)
  const [sharedGigMusicians, setSharedGigMusicians] = useState<Musician[]>([])
  const [sharedDocuments, setSharedDocuments] = useState<Document[]>([])
  const [sharedDocsLoading, setSharedDocsLoading] = useState(false)
  const [sharedDocsError, setSharedDocsError] = useState<string | null>(null)
  const [sharedNowPlayingSongId, setSharedNowPlayingSongId] = useState<string | null>(null)
  const [sharedSongDisplayByAnyId, setSharedSongDisplayByAnyId] = useState<
    Record<string, { title: string; singers: string[]; keys: string[] }>
  >({})
  const [sharedNowPlayingFallback, setSharedNowPlayingFallback] = useState<{
    title: string
    singers: string[]
    keys: string[]
  } | null>(null)
  const [sharedDismissedUpNextId, setSharedDismissedUpNextId] = useState<string | null>(null)
  const [sharedBannerTouchStartX, setSharedBannerTouchStartX] = useState<number | null>(null)
  const [sharedLyricsTheme, setSharedLyricsTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem(SHARED_LYRICS_THEME_KEY)
    return stored === 'light' ? 'light' : 'dark'
  })
  const [sharedLyricsFont, setSharedLyricsFont] = useState<'sans' | 'serif' | 'mono'>(() => {
    const stored = localStorage.getItem(SHARED_LYRICS_FONT_KEY)
    if (stored === 'serif' || stored === 'mono') return stored
    return 'sans'
  })
  const [lyricsGlobalFontScale, setLyricsGlobalFontScale] = useState(1)
  const [lyricsCenterAligned, setLyricsCenterAligned] = useState(false)
  const [lyricsUserPrefsByViewer, setLyricsUserPrefsByViewer] = useState<Record<string, LyricsUserPrefs>>(
    () => {
      try {
        const raw = localStorage.getItem(LYRICS_USER_PREFS_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as Record<string, Partial<LyricsUserPrefs>>
        const next: Record<string, LyricsUserPrefs> = {}
        Object.entries(parsed).forEach(([viewerId, value]) => {
          next[viewerId] = {
            theme: value.theme === 'light' ? 'light' : 'dark',
            font: value.font === 'serif' || value.font === 'mono' ? value.font : 'sans',
            fontScale:
              typeof value.fontScale === 'number' && Number.isFinite(value.fontScale)
                ? Math.min(1.8, Math.max(0.75, value.fontScale))
                : 1,
            centered: Boolean(value.centered),
          }
        })
        return next
      } catch {
        return {}
      }
    },
  )
  const [lyricsDocStateByKey, setLyricsDocStateByKey] = useState<Record<string, LyricsDocState>>(() => {
    try {
      const raw = localStorage.getItem(LYRICS_DOC_STATE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, Partial<LyricsDocState>>
      const next: Record<string, LyricsDocState> = {}
      Object.entries(parsed).forEach(([key, value]) => {
        next[key] = {
          fontScale:
            typeof value.fontScale === 'number' && Number.isFinite(value.fontScale)
              ? Math.min(1.8, Math.max(0.75, value.fontScale))
              : 1,
          highlights: Array.isArray(value.highlights)
            ? value.highlights.filter(
                (item): item is LyricsHighlightRange =>
                  Boolean(
                    item &&
                      typeof item.id === 'string' &&
                      typeof item.start === 'number' &&
                      typeof item.end === 'number' &&
                      typeof item.color === 'string',
                  ),
              )
            : [],
          strokes: Array.isArray(value.strokes)
            ? value.strokes
                .filter(
                  (item): item is LyricsStroke =>
                    Boolean(
                      item &&
                        typeof item.id === 'string' &&
                        typeof item.color === 'string' &&
                        typeof item.width === 'number' &&
                        Array.isArray(item.points),
                    ),
                )
                .map((stroke) => {
                  const points = stroke.points.filter(
                    (point): point is LyricsStrokePoint =>
                      Boolean(
                        point &&
                          typeof point.x === 'number' &&
                          Number.isFinite(point.x) &&
                          typeof point.y === 'number' &&
                          Number.isFinite(point.y),
                      ),
                  )
                  if (!points.length) {
                    return { ...stroke, width: 0.004, points: [] }
                  }
                  const maxX = Math.max(...points.map((point) => point.x))
                  const maxY = Math.max(...points.map((point) => point.y))
                  const needsNormalization = maxX > 1.2 || maxY > 1.2
                  const normalizedPoints = needsNormalization
                    ? points.map((point) => ({
                        x: maxX > 0 ? point.x / maxX : 0,
                        y: maxY > 0 ? point.y / maxY : 0,
                      }))
                    : points
                  return {
                    ...stroke,
                    width: needsNormalization
                      ? Math.min(0.02, Math.max(0.0015, stroke.width / Math.max(maxX, maxY, 1)))
                      : Math.min(0.02, Math.max(0.0015, stroke.width)),
                    points: normalizedPoints,
                  }
                })
            : [],
          editedText: typeof value.editedText === 'string' ? value.editedText : undefined,
        }
      })
      return next
    } catch {
      return {}
    }
  })
  const [anonymousLyricsViewerId] = useState(() => {
    try {
      const existing = localStorage.getItem(LYRICS_VIEWER_ID_KEY)
      if (existing) return existing
      const created = crypto.randomUUID()
      localStorage.setItem(LYRICS_VIEWER_ID_KEY, created)
      return created
    } catch {
      return 'anon-viewer'
    }
  })
  const [lyricsActiveColor, setLyricsActiveColor] = useState(LYRICS_COLOR_SWATCHES[0])
  const [lyricsDrawMode, setLyricsDrawMode] = useState(false)
  const [selectedLyricsStrokeId, setSelectedLyricsStrokeId] = useState<string | null>(null)
  const [showLyricsToolbar, setShowLyricsToolbar] = useState(false)
  const [showFontTools, setShowFontTools] = useState(false)
  const [showEditTools, setShowEditTools] = useState(false)
  const [showDrawTools, setShowDrawTools] = useState(false)
  const [lyricsToolPanelPositions, setLyricsToolPanelPositions] = useState<
    Record<LyricsToolPanelKey, LyricsToolPanelPosition>
  >({
    font: { x: 16, y: 84 },
    edit: { x: 16, y: 148 },
    draw: { x: 16, y: 212 },
  })
  const [lyricsEditMode, setLyricsEditMode] = useState(false)
  const [lyricsEditDraft, setLyricsEditDraft] = useState('')
  const [lyricsSelectionRange, setLyricsSelectionRange] = useState<{ start: number; end: number } | null>(
    null,
  )
  const [lyricsUndoState, setLyricsUndoState] = useState<LyricsUndoState | null>(null)
  const [lyricsDocUndoStackByKey, setLyricsDocUndoStackByKey] = useState<Record<string, LyricsDocState[]>>({})
  const lyricsTextContainerRef = useRef<HTMLDivElement | null>(null)
  const activeStrokeRef = useRef<LyricsStroke | null>(null)
  const activeStrokePathRef = useRef<SVGPathElement | null>(null)
  const lastAppliedLyricsViewerIdRef = useRef<string | null>(null)
  const panelDragStateRef = useRef<{
    panel: LyricsToolPanelKey
    offsetX: number
    offsetY: number
  } | null>(null)
  const [playlistSingerFilter, setPlaylistSingerFilter] = useState('__all__')
  const [playlistShareStatus, setPlaylistShareStatus] = useState('')
  const playlistShareTimerRef = useRef<number | null>(null)
  const [setlistCopyStatus, setSetlistCopyStatus] = useState<string | null>(null)
  const setlistCopyTimerRef = useRef<number | null>(null)
  const [playlistDrawerOverlay, setPlaylistDrawerOverlay] = useState(false)
  const [sharedPlaylistDrawerOverlay, setSharedPlaylistDrawerOverlay] = useState(false)
  const [collapsedSharedAudioSections, setCollapsedSharedAudioSections] = useState<Record<string, boolean>>({})
  const [playlistDrawerDockTop, setPlaylistDrawerDockTop] = useState(240)
  const playlistPlayerBlockRef = useRef<HTMLDivElement | null>(null)
  const sharedPlaylistPlayerBlockRef = useRef<HTMLDivElement | null>(null)
  const playlistDrawerTouchStartYRef = useRef<number | null>(null)
  const playlistDrawerAutoCloseTimerRef = useRef<number | null>(null)
  const setlistSectionSaveInProgressRef = useRef(false)
  const [widePlaylistUi, setWidePlaylistUi] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  )
  const sharedNowPlayingSongIdRef = useRef<string | null>(null)
  const [showAddMusicianModal, setShowAddMusicianModal] = useState(false)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [pdfDownloadLoading, setPdfDownloadLoading] = useState(false)
  const [pdfDownloadStatus, setPdfDownloadStatus] = useState<string | null>(null)
  const [offlineExportStatus, setOfflineExportStatus] = useState<string | null>(null)
  const [draggedSectionSongId, setDraggedSectionSongId] = useState<string | null>(null)
  const [dragOverSectionSongId, setDragOverSectionSongId] = useState<string | null>(null)
  const [sheetDraggedSongId, setSheetDraggedSongId] = useState<string | null>(null)
  const [sheetDraggedFromSection, setSheetDraggedFromSection] = useState<string | null>(null)
  const [sheetDragOverSongId, setSheetDragOverSongId] = useState<string | null>(null)
  const [sheetDragOverSection, setSheetDragOverSection] = useState<string | null>(null)
  const [recentlyMovedSongId, setRecentlyMovedSongId] = useState<string | null>(null)
  const movedSongTimerRef = useRef<number | null>(null)
  const [activeBuildPanel, setActiveBuildPanel] = useState<string | null>(null)
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
  const [importReview, setImportReview] = useState<{
    section: string
    sourceGigId: string
    selectedSongIds: string[]
  } | null>(null)
  const [sectionSaveStatus, setSectionSaveStatus] = useState<string | null>(null)
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
  useEffect(() => {
    if (authEmailCooldownSeconds <= 0) return
    const timer = window.setInterval(() => {
      setAuthEmailCooldownSeconds((current) => (current <= 1 ? 0 : current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [authEmailCooldownSeconds])
  const triggerAuthEmailCooldownFromMessage = useCallback((message: string) => {
    if (!isEmailRateLimitErrorMessage(message)) return false
    const seconds = parseEmailRateLimitSeconds(message)
    setAuthEmailCooldownSeconds((current) => Math.max(current, seconds))
    const waitMinutes = Math.max(1, Math.ceil(seconds / 60))
    setAuthError(`Too many email requests. Please wait about ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'} and try again.`)
    return true
  }, [])
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
    Record<string, Record<string, string[]>>
  >({})
  const [gigDeletedSectionSongs, setGigDeletedSectionSongs] = useState<
    Record<string, Record<string, string[]>>
  >(() => {
    const stored = localStorage.getItem(GIG_DELETED_SECTION_SONGS_KEY)
    if (!stored) return {}
    try {
      return JSON.parse(stored)
    } catch {
      localStorage.removeItem(GIG_DELETED_SECTION_SONGS_KEY)
      return {}
    }
  })
  const [authEntryView, setAuthEntryView] = useState<'home' | 'auth'>('home')
  const [authIntroPhase, setAuthIntroPhase] = useState<'welcome' | 'fading' | 'login'>('welcome')
  const [showAuthLearnMore, setShowAuthLearnMore] = useState(false)
  const [, setLoginPhase] = useState<'login' | 'transition' | 'app'>('login')
  const loginTimerRef = useRef<number | null>(null)
  const authIntroTimerRef = useRef<number | null>(null)
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
    const displayModeMedia = window.matchMedia('(display-mode: standalone)')
    const syncInstallState = () => {
      const standaloneMatch = displayModeMedia.matches
      const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
      const standaloneMode = Boolean(standaloneMatch || iosStandalone)
      setIsStandaloneDisplayMode(standaloneMode)
      if (standaloneMode) {
        setIsInstalled(true)
      }
    }
    syncInstallState()

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
    }

    const handleDisplayModeChange = () => {
      syncInstallState()
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('pageshow', handleDisplayModeChange)
    window.addEventListener('orientationchange', handleDisplayModeChange)
    if (typeof displayModeMedia.addEventListener === 'function') {
      displayModeMedia.addEventListener('change', handleDisplayModeChange)
    } else {
      displayModeMedia.addListener(handleDisplayModeChange)
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('pageshow', handleDisplayModeChange)
      window.removeEventListener('orientationchange', handleDisplayModeChange)
      if (typeof displayModeMedia.removeEventListener === 'function') {
        displayModeMedia.removeEventListener('change', handleDisplayModeChange)
      } else {
        displayModeMedia.removeListener(handleDisplayModeChange)
      }
    }
  }, [])

  useEffect(() => {
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!manifestLink) return
    const gigDateName = sharedPlaylistView?.date
      ? formatGigDate(sharedPlaylistView.date)
      : ''
    const appName = gigDateName || 'Setlist Connect'
    const manifest = {
      name: appName,
      short_name: gigDateName || 'Setlist',
      start_url: `${window.location.pathname}${window.location.search || ''}`,
      scope: '/',
      display: 'standalone',
      background_color: '#050816',
      theme_color: '#050816',
      icons: [
        { src: '/logo-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/logo-512.png', sizes: '512x512', type: 'image/png' },
      ],
    }
    const manifestUrl = URL.createObjectURL(
      new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }),
    )
    const priorHref = manifestLink.href
    manifestLink.href = manifestUrl
    document.title = appName
    return () => {
      manifestLink.href = priorHref
      URL.revokeObjectURL(manifestUrl)
      document.title = 'Setlist Connect'
    }
  }, [sharedPlaylistView])

  useEffect(() => {
    const syncIconTitles = (root: ParentNode = document) => {
      root.querySelectorAll<HTMLElement>('[aria-label]').forEach((element) => {
        const label = element.getAttribute('aria-label')?.trim()
        if (!label) return
        const currentTitle = element.getAttribute('title')?.trim()
        if (!currentTitle) {
          element.setAttribute('title', label)
        }
      })
    }

    syncIconTitles()
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          const label = mutation.target.getAttribute('aria-label')?.trim()
          if (!label) return
          const currentTitle = mutation.target.getAttribute('title')?.trim()
          if (!currentTitle) {
            mutation.target.setAttribute('title', label)
          }
          return
        }

        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return
          if (node.hasAttribute('aria-label')) {
            const label = node.getAttribute('aria-label')?.trim()
            if (label && !node.getAttribute('title')?.trim()) {
              node.setAttribute('title', label)
            }
          }
          syncIconTitles(node)
        })
      })
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title'],
    })

    return () => observer.disconnect()
  }, [])

  const isAdmin = role === 'admin'

  // ── General toast (used by context consumers) ──────────────────────────────
  const [generalToast, setGeneralToast] = useState<string | null>(null)
  const showToast = useCallback((message: string) => {
    setGeneralToast(message)
    window.setTimeout(() => setGeneralToast(null), 3000)
  }, [])

  // ── updateSong — patch a single song in appState ───────────────────────────
  const updateSong = useCallback((songId: string, updates: Partial<import('./types').Song>) => {
    setAppState((prev) => ({
      ...prev,
      songs: prev.songs.map((s) => (s.id === songId ? { ...s, ...updates } : s)),
    }))
  }, [])

  const withBandId = <T extends Record<string, unknown>>(payload: T): T & { band_id: string } => ({
    ...payload,
    band_id: activeBandId,
  })

  const filteredInstruments = useMemo(
    () =>
      instrumentCatalog.filter((instrument) =>
        instrument.toLowerCase().includes(debouncedInstrumentFilter.toLowerCase()),
      ),
    [instrumentCatalog, debouncedInstrumentFilter],
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
  const normalizeInstrumentName = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.toLowerCase() === 'saxophone') return 'Sax'
    return trimmed
  }, [])
  const normalizeSharedMusicians = useCallback(
    (musicians: Musician[]) => {
      const seen = new Set<string>()
      const normalized: Musician[] = []
      musicians.forEach((musician) => {
        if (!musician?.id) return
        const key = musician.id.trim().toLowerCase()
        if (!key || seen.has(key)) return
        seen.add(key)
        normalized.push({
          ...musician,
          instruments: (musician.instruments ?? []).map((item) => normalizeInstrumentName(item)).filter(Boolean),
        })
      })
      return normalized
    },
    [normalizeInstrumentName],
  )
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
  const activeInstruments = useMemo(
    () => (appState.instrument && appState.instrument.length > 0 ? appState.instrument : ['All']),
    [appState.instrument],
  )
  const documentMatchesActiveInstruments = useCallback(
    (doc: Document) => {
      if (role === 'admin') return true
      if (activeInstruments.includes('All')) return true
      const docInstruments = parseDocumentInstruments(doc.instrument)
      return docInstruments.includes('All')
        ? true
        : docInstruments.some((item) => activeInstruments.includes(item))
    },
    [activeInstruments, parseDocumentInstruments, role],
  )
  const getDocumentSelectionItems = useCallback((songId: string) => {
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
  }, [appState.documents, documentMatchesActiveInstruments, parseDocumentInstruments])
  const getSharedDocumentSelectionItems = useCallback(
    (songId: string) => {
      const docs = sharedDocuments
        .filter((doc) => doc.songId === songId)
        .filter((doc) => {
          if (activeInstruments.includes('All')) return true
          const docInstruments = parseDocumentInstruments(doc.instrument)
          return docInstruments.includes('All')
            ? true
            : docInstruments.some((item) => activeInstruments.includes(item))
        })
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
    },
    [activeInstruments, parseDocumentInstruments, sharedDocuments],
  )
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
  const normalizeSetlistSectionLabel = useCallback(
    (value: string) => value.replace(/\s+/g, ' ').trim(),
    [],
  )
  const makeGigSectionTag = (gigId: string, section: string) =>
    `${GIG_SECTION_TAG_PREFIX}${gigId}::${encodeURIComponent(normalizeSetlistSectionLabel(section))}`
  const getSectionDeleteKey = useCallback(
    (section: string) => normalizeSetlistSectionLabel(section).toLowerCase(),
    [normalizeSetlistSectionLabel],
  )
  const makeGigSectionDeletedTag = (gigId: string, section: string) =>
    `${GIG_SECTION_DELETED_TAG_PREFIX}${gigId}::${encodeURIComponent(normalizeSetlistSectionLabel(section))}`
  const parseGigSectionTag = useCallback(
    (value: string): { gigId: string; section: string } | null => {
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
    },
    [normalizeSetlistSectionLabel],
  )
  const parseGigSectionDeletedTag = useCallback(
    (value: string): { gigId: string; section: string } | null => {
      if (!value.startsWith(GIG_SECTION_DELETED_TAG_PREFIX)) return null
      const payload = value.slice(GIG_SECTION_DELETED_TAG_PREFIX.length)
      const separatorIndex = payload.indexOf('::')
      if (separatorIndex <= 0) return null
      const gigId = payload.slice(0, separatorIndex)
      const encodedSection = payload.slice(separatorIndex + 2)
      const decodedSection = normalizeSetlistSectionLabel(
        decodeURIComponent(encodedSection || ''),
      )
      if (!gigId || !decodedSection) return null
      return { gigId, section: decodedSection }
    },
    [normalizeSetlistSectionLabel],
  )
  const getGigSongSections = useCallback(
    (gigId: string, songId: string) => {
      const overrides = gigSongSectionOverrides[gigId]?.[songId] ?? []
      const seen = new Set<string>()
      const normalized: string[] = []
      overrides.forEach((override) => {
        const value = normalizeSetlistSectionLabel(override)
        if (!value) return
        const key = value.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        normalized.push(value)
      })
      return normalized
    },
    [gigSongSectionOverrides, normalizeSetlistSectionLabel],
  )
  const getGigSongSectionOverride = useCallback(
    (gigId: string, songId: string) => getGigSongSections(gigId, songId)[0] ?? '',
    [getGigSongSections],
  )
  const getDeletedSectionSongIds = useCallback(
    (gigId: string, section: string) =>
      new Set(gigDeletedSectionSongs[gigId]?.[getSectionDeleteKey(section)] ?? []),
    [gigDeletedSectionSongs, getSectionDeleteKey],
  )
  const songMatchesGigSection = useCallback(
    (
      song: Song,
      section: string,
      gigId: string,
      options: { ignoreOverride?: boolean } = {},
    ) => {
      const normalizedSection = normalizeSetlistSectionLabel(section).toLowerCase()
      if (!normalizedSection) return false
      if (getDeletedSectionSongIds(gigId, section).has(song.id)) return false
      if (!options.ignoreOverride) {
        const overrideSections = getGigSongSections(gigId, song.id)
        if (
          overrideSections.some(
            (overrideSection) => overrideSection.trim().toLowerCase() === normalizedSection,
          )
        ) {
          return true
        }
        // Section membership is controlled by explicit gig assignments only.
        // Song tags are reference metadata and should not route songs into sections.
        return false
      }
      return false
    },
    [getDeletedSectionSongIds, getGigSongSections, normalizeSetlistSectionLabel],
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
  const isDjRequestType = useCallback(
    (value: string) => {
      const identity = normalizeTagIdentity(value)
      if (!identity) return false
      return identity === 'djonly' || identity === 'djtrack' || identity === 'djset'
    },
    [],
  )
  const pendingSpecialForcesDjOnly = useMemo(
    () => isDjRequestType(pendingSpecialType),
    [isDjRequestType, pendingSpecialType],
  )
  const isPendingSpecialDjOnly = pendingSpecialDjOnly || pendingSpecialForcesDjOnly
  const requestTypeIdentitySet = useMemo(
    () => new Set(REQUEST_TYPE_TAG_EXCLUSIONS.map((value) => normalizeTagIdentity(value))),
    [],
  )
  const isSetlistTypeTag = useCallback((value: string) => {
    const normalized = normalizeSetlistSectionLabel(value)
    if (!normalized) return false
    if (normalized.startsWith(GIG_SECTION_TAG_PREFIX)) return false
    if (normalized.startsWith(GIG_SECTION_DELETED_TAG_PREFIX)) return false
    const lower = normalized.toLowerCase()
    if (lower === 'special request' || lower === 'special requests') return false
    const identity = normalizeTagIdentity(normalized)
    if (!identity) return false
    if (identity === 'djonly') return true
    if (requestTypeIdentitySet.has(identity)) return false
    return !specialTypeIdentitySet.has(identity)
  }, [normalizeSetlistSectionLabel, requestTypeIdentitySet, specialTypeIdentitySet])
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
  const operationalTodayISO = getOperationalDateISO()
  const currentSetlistDateISO = normalizeGigDateISO(currentSetlist?.date)
  const isCurrentSetlistPast = Boolean(
    currentSetlistDateISO && currentSetlistDateISO < operationalTodayISO,
  )
  const isPastGigLockedForAdmin = Boolean(
    isAdmin &&
      screen === 'builder' &&
      currentSetlist &&
      isCurrentSetlistPast &&
      !pastGigUnlockedByGigId[currentSetlist.id],
  )
  const gigSheetQueuedSong = useMemo(
    () => appState.songs.find((song) => song.id === appState.currentSongId) ?? null,
    [appState.currentSongId, appState.songs],
  )
  const gigSheetSongSearchQuery = useMemo(() => debouncedGigSheetSongSearch.trim().toLowerCase(), [debouncedGigSheetSongSearch])
  const activeBandName = useMemo(
    () => bands.find((band) => band.id === activeBandId)?.name ?? '',
    [bands, activeBandId],
  )
  const userFirstName = useMemo(() => {
    const emailName = authUserEmail?.split('@')[0]?.trim() ?? ''
    const firstChunk = emailName.split(/[._\-\s]+/).find(Boolean) ?? ''
    return firstChunk ? firstChunk.charAt(0).toUpperCase() + firstChunk.slice(1).toLowerCase() : ''
  }, [authUserEmail])
  const visibleMusicians = useMemo(() => {
    const terms = debouncedMusicianSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    return appState.musicians
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((musician) => {
        if (!terms.length) return true
        const searchable = [
          musician.name,
          musician.roster,
          musician.email,
          musician.phone,
          musician.singer,
          ...(musician.instruments ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return terms.every((term) => searchable.includes(term))
      })
  }, [appState.musicians, debouncedMusicianSearch])
  const editingMusicianOriginal = useMemo(
    () => appState.musicians.find((musician) => musician.id === editingMusicianId) ?? null,
    [appState.musicians, editingMusicianId],
  )
  const hasEditingMusicianChanges = useMemo(() => {
    if (!editingMusicianOriginal) return false
    const normalizeList = (values: string[]) =>
      values.map((value) => value.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
    return (
      editingMusicianName.trim() !== editingMusicianOriginal.name ||
      editingMusicianRoster !== editingMusicianOriginal.roster ||
      editingMusicianEmail.trim() !== (editingMusicianOriginal.email ?? '') ||
      editingMusicianPhone.trim() !== (editingMusicianOriginal.phone ?? '') ||
      editingMusicianSinger !== (editingMusicianOriginal.singer ?? '') ||
      normalizeList(editingMusicianInstruments).join('||') !==
        normalizeList(editingMusicianOriginal.instruments ?? []).join('||')
    )
  }, [
    editingMusicianEmail,
    editingMusicianInstruments,
    editingMusicianName,
    editingMusicianOriginal,
    editingMusicianPhone,
    editingMusicianRoster,
    editingMusicianSinger,
  ])
  const isBillingTestAccount =
    import.meta.env.DEV && BILLING_TEST_EMAILS.has((authUserEmail ?? '').trim().toLowerCase())
  const activeBandTier: BandTier = isBillingTestAccount
    ? 'pro'
    : activeBandId
    ? (bandSubscriptionTierByBandId[activeBandId] ?? 'free')
    : 'free'
  const activeBandPendingTierChange = activeBandId
    ? (bandPendingTierChangeByBandId[activeBandId] ?? null)
    : null
  const tierRank: Record<BandTier, number> = { free: 0, pro: 1 }
  const selectedTier = showTierDetailsModal
  const selectedTierDetails = selectedTier ? BAND_TIER_DETAILS[selectedTier] : null
  const currentTierDetails = BAND_TIER_DETAILS[activeBandTier]
  const tierGainItems = useMemo(() => {
    if (!selectedTierDetails) return []
    const currentSet = new Set(currentTierDetails.includes)
    return selectedTierDetails.includes.filter((item) => !currentSet.has(item))
  }, [currentTierDetails.includes, selectedTierDetails])
  const isSelectedCurrentTier = Boolean(selectedTier && selectedTier === activeBandTier)
  const isSelectedUpgrade = Boolean(
    selectedTier && tierRank[selectedTier] > tierRank[activeBandTier],
  )
  const isSelectedDowngrade = Boolean(
    selectedTier && tierRank[selectedTier] < tierRank[activeBandTier],
  )
  const canCreateSongs = useCallback((nextSongCount = 1) => {
    void nextSongCount
    return true
  }, [])
  const canCreateMusicians = useCallback((nextMusicianCount = 1) => {
    void nextMusicianCount
    return true
  }, [])
  const canCreateGigs = useCallback(() => true, [])
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
      return getGigSongSections(currentSetlist.id, song.id)
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
    getGigSongSections,
    normalizeSetlistSectionLabel,
  ])
  const printableSetSections = useMemo(() => {
    if (!currentSetlist) return []
    // Printable view should mirror the setup setlist sections exactly.
    return [...orderedSetSections]
  }, [currentSetlist, orderedSetSections])
  const orderedPrintableSongSections = useMemo(() => {
    if (!currentSetlist) return []
    return [...printableSetSections]
  }, [currentSetlist, printableSetSections])
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
  const normalizedAuthEmail = (authUserEmail ?? '').trim().toLowerCase()
  const currentUserMusicianIds = useMemo(() => {
    const ids = new Set<string>()
    memberships.forEach((membership) => {
      if (membership.bandId !== activeBandId || membership.status !== 'active') return
      if (membership.musicianId) ids.add(membership.musicianId)
    })
    if (normalizedAuthEmail) {
      appState.musicians.forEach((musician) => {
        if ((musician.email ?? '').trim().toLowerCase() === normalizedAuthEmail) {
          ids.add(musician.id)
        }
      })
    }
    return ids
  }, [activeBandId, appState.musicians, memberships, normalizedAuthEmail])
  const currentUserMusician = useMemo(() => {
    const [firstMusicianId] = Array.from(currentUserMusicianIds)
    return firstMusicianId
      ? appState.musicians.find((musician) => musician.id === firstMusicianId) ?? null
      : null
  }, [appState.musicians, currentUserMusicianIds])
  const assignedGigIdsForCurrentUser = useMemo(() => {
    const ids = new Set<string>()
    if (currentUserMusicianIds.size === 0) return ids
    appState.gigMusicians.forEach((row) => {
      if (row.status === 'out') return
      if (currentUserMusicianIds.has(row.musicianId)) ids.add(row.gigId)
    })
    return ids
  }, [appState.gigMusicians, currentUserMusicianIds])
  const visibleSetlists = useMemo(() => {
    if (qaPreset === 'newUser') return []
    if (qaPreset === 'member') {
      return appState.setlists.filter((setlist) => assignedGigIdsForCurrentUser.has(setlist.id))
    }
    if (isAdmin) return appState.setlists
    const assignedSetlists = appState.setlists.filter((setlist) =>
      assignedGigIdsForCurrentUser.has(setlist.id),
    )
    return assignedSetlists.length > 0 ? assignedSetlists : appState.setlists
  }, [appState.setlists, assignedGigIdsForCurrentUser, isAdmin, qaPreset])
  const getPrintToneClass = (section: string) => {
    const normalized = section.trim().toLowerCase()
    if (normalized === 'special requests' || normalized === 'special request') {
      return 'print-tone-special'
    }
    if (isDjRequestType(section)) return 'print-tone-dj'
    if (normalized === 'dj only') return 'print-tone-dj'
    if (normalized.includes('dinner')) return 'print-tone-dinner'
    if (normalized.includes('dance')) return 'print-tone-dance'
    if (normalized.includes('latin')) return 'print-tone-latin'
    if (normalized.includes('musician')) return 'print-tone-musicians'
    return 'print-tone-default'
  }
  const getPrintLayoutClass = (section: string) => {
    const normalized = section.trim().toLowerCase()
    if (normalized === 'special requests' || normalized === 'special request') return 'print-special'
    if (normalized === 'dj only') return 'print-dj'
    if (normalized.includes('musician')) return 'print-musicians'
    if (normalized.includes('dinner')) return 'print-dinner'
    if (normalized.includes('dance')) return 'print-dance'
    if (normalized.includes('latin')) return 'print-latin'
    return 'print-generic-set'
  }
  const getPrintableSongChunkSize = (section: string) =>
    section.trim().toLowerCase().includes('dance')
      ? PRINT_DANCE_SONGS_PER_SECTION
      : PRINT_DEFAULT_SONGS_PER_SECTION
  const getPrintableSectionTitle = (section: string, continued = false) => {
    return continued ? `${section} (continued)` : section
  }
  const normalizePlaylistSection = useCallback((value: string) => {
    const normalized = normalizeSetlistSectionLabel(value)
    if (!normalized) return ''
    const lower = normalized.toLowerCase()
    if (lower === 'special request' || lower === 'special requests') return 'Special Requests'
    if (lower === 'additional request' || lower === 'additional requests') return 'Additional Requests'
    if (lower === 'dj only') return 'DJ Only'
    return normalized
  }, [normalizeSetlistSectionLabel])
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
      return lower === 'special requests' || lower === 'dj only' || isSetlistTypeTag(tag)
    })
    return sections.length ? sections : ['Setlist']
  }, [isSetlistTypeTag, normalizePlaylistSection])
  const getPlaylistToneClasses = (section: string) => {
    const tone = getPrintToneClass(section)
    if (tone === 'print-tone-special') {
      return 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-100'
    }
    if (tone === 'print-tone-dj') {
      return 'border-rose-300/40 bg-rose-900/40 text-rose-100'
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
    if (isDjRequestType(tag)) {
      return 'border border-rose-300/35 bg-rose-900/45 text-rose-100'
    }
    if (normalized === 'dj only') {
      return 'border border-rose-300/35 bg-rose-900/45 text-rose-100'
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
      isActive ? 'border-teal-300/80 bg-teal-950' : 'border-white/10 bg-slate-950'
    }`
  const getPlaylistSectionCardClasses = (section: string) =>
    `rounded-2xl border p-2 ${getPlaylistToneClasses(section)} bg-slate-950`
  const playlistSectionHeaderClasses =
    'mb-2 rounded-lg bg-slate-950 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]'
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
      `${song.title} ${song.artist}`.toLowerCase().includes(debouncedSongSearch.toLowerCase()),
    )
    const byTag =
      activeTags.length === 0
        ? bySearch
        : bySearch.filter((song) => activeTags.some((tag) => hasSongTag(song, tag)))
    return byTag.filter((song) => !setlistSongIds.has(song.id))
  }, [appState.songs, currentSetlist?.songIds, debouncedSongSearch, activeTags])

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
      .filter((song) => songMatchesGigSection(song, section, currentSetlist.id)).length
    return { label: 'Songs', value: count }
  }, [
    activeBuildPanel,
    appState.gigMusicians,
    appState.musicians,
    appState.specialRequests,
    appState.songs,
    currentSetlist,
    songMatchesGigSection,
  ])
  const pendingDeleteSetlistSectionImpact = useMemo(() => {
    if (!currentSetlist || !pendingDeleteSetlistSection) {
      return { exclusiveSongCount: 0, totalSectionSongCount: 0 }
    }
    const section = pendingDeleteSetlistSection
    const normalized = normalizeSetlistSectionLabel(section).toLowerCase()
    if (normalized === 'special request' || normalized === 'special requests' || normalized === 'dj only') {
      return { exclusiveSongCount: 0, totalSectionSongCount: 0 }
    }
    const sectionSongIds = currentSetlist.songIds.filter((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      return song ? songMatchesGigSection(song, section, currentSetlist.id) : false
    })
    const remainingSections = orderedSetSections.filter(
      (item) => item.trim().toLowerCase() !== section.trim().toLowerCase(),
    )
    const exclusiveSongCount = sectionSongIds.filter((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      if (!song) return false
      return !remainingSections.some((remainingSection) =>
        songMatchesGigSection(song, remainingSection, currentSetlist.id),
      )
    }).length
    return { exclusiveSongCount, totalSectionSongCount: sectionSongIds.length }
  }, [
    appState.songs,
    currentSetlist,
    normalizeSetlistSectionLabel,
    orderedSetSections,
    pendingDeleteSetlistSection,
    songMatchesGigSection,
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
        .filter((song) => songMatchesGigSection(song, section, currentSetlist.id)).length
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
    songMatchesGigSection,
  ])

  const filteredSongLibrary = useMemo(() => {
    const base = appState.songs.filter((song) => {
      const searchTerm = debouncedSongLibrarySearch.trim().toLowerCase()
      if (searchTerm) {
        const haystack = `${song.title} ${song.artist} ${song.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(searchTerm)) return false
      }
      if (songLibraryTags.length === 0) return true
      return songLibraryTags.some((tag) => hasSongTag(song, tag))
    })
    return [...base].sort((a, b) => a.title.localeCompare(b.title))
  }, [appState.songs, debouncedSongLibrarySearch, songLibraryTags])

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
    const getLibrarySeedTags = (section: string) => {
      const normalized = normalizeSetlistSectionLabel(section)
      const lower = normalized.toLowerCase()
      if (lower.startsWith('dance set ')) return ['Dance']
      if (lower.startsWith('dinner set ')) return ['Dinner']
      if (lower.startsWith('latin set ')) return ['Latin']
      return [normalized]
    }
    return appState.songs
      .filter((song) =>
        includeAllBySection
          ? true
          : filterSections.some((section) =>
              getLibrarySeedTags(section).some((tag) => hasSongTag(song, tag)),
            ),
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
    normalizeSetlistSectionLabel,
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

  const getGigAllowedSingerSet = useCallback((gigId: string) => {
    const activeRows = appState.gigMusicians.filter(
      (row) => row.gigId === gigId && row.status !== 'out',
    )
    const fallbackRows = appState.gigMusicians.filter((row) => row.gigId === gigId)
    const rowsToUse = activeRows.length > 0 ? activeRows : fallbackRows
    const names = rowsToUse
      .map((row) => appState.musicians.find((musician) => musician.id === row.musicianId))
      .filter((musician): musician is Musician => Boolean(musician))
      .filter(
        (musician) =>
          Boolean(musician.singer) ||
          (musician.instruments ?? []).some(
            (instrument) => instrument.trim().toLowerCase() === 'vocals',
          ),
      )
      .map((musician) => musician.name.trim().toLowerCase())
      .filter(Boolean)
    return new Set(names)
  }, [appState.gigMusicians, appState.musicians])
  const filterSingersForGig = useCallback(
    (gigId: string, singers: string[]) => {
      const allowedSingers = getGigAllowedSingerSet(gigId)
      if (allowedSingers.size === 0) {
        return normalizeTagList(singers)
      }
      return normalizeTagList(singers).filter((singer) => {
        const normalized = singer.trim().toLowerCase()
        if (!normalized) return false
        if (normalized === INSTRUMENTAL_LABEL.toLowerCase()) return true
        return allowedSingers.has(normalized)
      })
    },
    [getGigAllowedSingerSet],
  )
  const getGigSingerAssignments = useCallback((songId: string, gigId: string) => {
    const song = appState.songs.find((item) => item.id === songId)
    if (!song) return []
    const allowedSingers = new Set(
      filterSingersForGig(gigId, song.keys.map((key) => key.singer)).map((name) =>
        name.trim().toLowerCase(),
      ),
    )
    const shouldKeepSinger = (singer: string) => allowedSingers.has(singer.trim().toLowerCase())
    const savedAssignments = song.keys
      .map((key) => ({
        singer: key.singer,
        key: key.gigOverrides[gigId] ?? key.defaultKey ?? '',
      }))
      .filter((entry) => shouldKeepSinger(entry.singer))
      .filter((entry) => entry.key.trim())
    if (savedAssignments.length) return savedAssignments
    return appState.specialRequests
      .filter((request) => request.gigId === gigId && request.songId === songId && !request.djOnly)
      .flatMap((request) =>
        filterSingersForGig(gigId, request.singers ?? [])
          .filter((singer) => shouldKeepSinger(singer))
          .map((singer) => ({
            singer,
            key: request.key || '',
          })),
      )
      .filter((entry) => entry.singer && entry.key)
  }, [appState.songs, appState.specialRequests, filterSingersForGig])

  const getSpecialRequestDisplayAssignments = useCallback((request: SpecialRequest) => {
    if (request.djOnly) {
      return { singers: ['DJ'], keys: [] }
    }
    const directSingers = filterSingersForGig(request.gigId, request.singers ?? [])
    const directKeys = normalizeTagList(request.key ? [request.key] : [])
    const savedAssignments = request.songId
      ? getGigSingerAssignments(request.songId, request.gigId)
      : []
    const savedSingers = normalizeTagList(savedAssignments.map((entry) => entry.singer))
    const savedKeys = normalizeTagList(savedAssignments.map((entry) => entry.key))
    return {
      singers: directSingers.length ? directSingers : savedSingers,
      keys: directKeys.length ? directKeys : savedKeys,
    }
  }, [filterSingersForGig, getGigSingerAssignments])

  const formatSpecialRequestKeyLabel = (request: SpecialRequest) => {
    if (request.djOnly) return '—'
    const { keys } = getSpecialRequestDisplayAssignments(request)
    if (keys.length === 0) return 'No key'
    if (keys.length === 1) return keys[0]
    return 'Multi'
  }

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
      .forEach((request) => {
        const linkedSong = appState.songs.find((song) => song.id === request.songId)
        const key = `special-request:${request.id}`
        const displayAssignments = getSpecialRequestDisplayAssignments(request)
        addOrMerge({
          key,
          title: linkedSong?.title || request.songTitle,
          artist: request.artist || linkedSong?.artist || '',
          audioUrl: (request.externalAudioUrl || linkedSong?.youtubeUrl || '').trim(),
          tags: request.djOnly ? [request.type || 'DJ Only'] : ['Special Request'],
          songId: request.songId,
          assignmentSingers: displayAssignments.singers,
          assignmentKeys: displayAssignments.keys,
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
        const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
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
    const isAlwaysVisibleSpecialEntry = (entry: PlaylistEntry) =>
      entry.tags.some((tag) => {
        const normalized = tag.trim().toLowerCase()
        return normalized === 'special request' || normalized === 'special requests' || normalized === 'dj only'
      })
    return ordered.filter(
      (entry) => Boolean(entry.audioUrl && entry.audioUrl.trim()) || isAlwaysVisibleSpecialEntry(entry),
    )
  }, [
    appState.songs,
    currentSetlist,
    getSpecialRequestDisplayAssignments,
    getGigSongSectionOverride,
    getOrderedSpecialRequests,
    isSetlistTypeTag,
    normalizePlaylistSection,
  ])

  const clearSharedPlaylistQaState = useCallback(() => {
    setSharedPlaylistView(null)
    setSharedPlaylistLoading(false)
    setSharedPlaylistError(null)
    setSharedWelcomeStep('hidden')
    setSharedWelcomeCompletedSetlistId(null)
  }, [])
  const buildQaSharedPlaylistView = useCallback((): SharedPlaylistView | null => {
    if (!currentSetlist || playlistEntries.length === 0) return null
    return {
      setlistId: currentSetlist.id,
      bandName: activeBandName || 'Setlist Connect QA',
      gigName: currentSetlist.gigName,
      date: currentSetlist.date,
      venueAddress: currentSetlist.venueAddress,
      musicians: appState.musicians.slice(0, 12),
      entries: playlistEntries,
      allEntries: playlistEntries,
    }
  }, [activeBandName, appState.musicians, currentSetlist, playlistEntries])
  const activateQaMasterView = useCallback(() => {
    setQaPreset('master')
    clearSharedPlaylistQaState()
    setRole('admin')
    setScreen('setlists')
    setShowCreateBandOnboarding(false)
  }, [clearSharedPlaylistQaState])
  const activateQaMemberView = useCallback(() => {
    setQaPreset('member')
    clearSharedPlaylistQaState()
    setRole('user')
    setScreen('setlists')
    setShowCreateBandOnboarding(false)
  }, [clearSharedPlaylistQaState])
  const activateQaNewUserView = useCallback(() => {
    setQaPreset('newUser')
    clearSharedPlaylistQaState()
    setRole('user')
    setScreen('setlists')
    setShowCreateBandOnboarding(true)
  }, [clearSharedPlaylistQaState])
  const activateQaSharedGuestView = useCallback(() => {
    const qaSharedView = buildQaSharedPlaylistView()
    if (!qaSharedView) return
    setQaPreset('sharedGuest')
    setSharedPlaylistView(qaSharedView)
    setSharedPlaylistLoading(false)
    setSharedPlaylistError(null)
    setSharedPublicTab('setlist')
    setPlaylistIndex(0)
    setPlaylistAutoAdvance(true)
    setPlaylistPlayNonce((nonce) => nonce + 1)
    setShowSharedInstrumentPrompt(true)
    setSharedWelcomeStep('cta')
    setSharedWelcomeCompletedSetlistId(null)
  }, [buildQaSharedPlaylistView])
  const resetQaView = useCallback(() => {
    setQaPreset('off')
    clearSharedPlaylistQaState()
    setShowSharedInstrumentPrompt(false)
  }, [clearSharedPlaylistQaState])

  const sharedAllPlaylistEntries = useMemo(
    () => sharedPlaylistView?.allEntries ?? sharedPlaylistView?.entries ?? [],
    [sharedPlaylistView],
  )
  const activePlaylistEntries = sharedPlaylistView ? sharedAllPlaylistEntries : playlistEntries
  const fallbackSharedUpNextEntry = useMemo(
    () => sharedAllPlaylistEntries[playlistIndex] ?? activePlaylistEntries[playlistIndex] ?? null,
    [activePlaylistEntries, playlistIndex, sharedAllPlaylistEntries],
  )
  const sharedNowPlayingEntry = useMemo(
    () =>
      sharedNowPlayingSongId
        ? (
            sharedAllPlaylistEntries.find((entry) => entry.songId === sharedNowPlayingSongId) ??
            activePlaylistEntries.find((entry) => entry.songId === sharedNowPlayingSongId) ??
            null
          )
        : null,
    [activePlaylistEntries, sharedAllPlaylistEntries, sharedNowPlayingSongId],
  )
  const sharedResolvedUpNextEntry = sharedNowPlayingEntry ?? fallbackSharedUpNextEntry
  const sharedNowPlayingSong = useMemo(
    () =>
      sharedNowPlayingSongId
        ? appState.songs.find((song) => song.id === sharedNowPlayingSongId) ?? null
        : null,
    [appState.songs, sharedNowPlayingSongId],
  )
  const sharedNowPlayingTitle =
    sharedResolvedUpNextEntry?.title ??
    sharedNowPlayingSong?.title ??
    sharedSongDisplayByAnyId[sharedNowPlayingSongId ?? '']?.title ??
    sharedNowPlayingFallback?.title ??
    'Song selected'
  const getPlaylistEntryAssignments = useCallback((entry: PlaylistEntry) => {
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
    return { singers, keys }
  }, [currentSetlist, getGigSingerAssignments])
  const sharedNowPlayingAssignments = useMemo(() => {
    const display = sharedSongDisplayByAnyId[sharedNowPlayingSongId ?? '']
    if (display) {
      return { singers: display.singers, keys: display.keys }
    }
    if (sharedResolvedUpNextEntry) {
      return getPlaylistEntryAssignments(sharedResolvedUpNextEntry)
    }
    if (!sharedNowPlayingSong || !sharedPlaylistView) {
      if (sharedNowPlayingFallback) {
        return { singers: sharedNowPlayingFallback.singers, keys: sharedNowPlayingFallback.keys }
      }
      return { singers: [], keys: [] }
    }
    const singers: string[] = []
    const keys: string[] = []
    sharedNowPlayingSong.keys
      .map((item) => ({
        singer: item.singer,
        key: item.gigOverrides[sharedPlaylistView.setlistId] ?? '',
      }))
      .filter((item) => item.key)
      .forEach((item) => {
        if (item.singer && !singers.some((value) => value.toLowerCase() === item.singer.toLowerCase())) {
          singers.push(item.singer)
        }
        if (item.key && !keys.some((value) => value.toLowerCase() === item.key.toLowerCase())) {
          keys.push(item.key)
        }
      })
    return { singers, keys }
  }, [
    getPlaylistEntryAssignments,
    sharedSongDisplayByAnyId,
    sharedNowPlayingFallback,
    sharedNowPlayingSong,
    sharedNowPlayingSongId,
    sharedPlaylistView,
    sharedResolvedUpNextEntry,
  ])
  const sharedNowPlayingIsDjOnly = useMemo(() => {
    const hasDjOnlyTag = (entry?: PlaylistEntry | null) =>
      Boolean(
        entry?.tags.some((tag) => {
          const normalized = tag.trim().toLowerCase()
          return normalized === 'dj only'
        }),
      )
    if (hasDjOnlyTag(sharedResolvedUpNextEntry)) return true
    if (!sharedNowPlayingSongId) return false
    const bySongId =
      sharedAllPlaylistEntries.find((entry) => entry.songId === sharedNowPlayingSongId) ??
      activePlaylistEntries.find((entry) => entry.songId === sharedNowPlayingSongId) ??
      null
    return hasDjOnlyTag(bySongId)
  }, [activePlaylistEntries, sharedAllPlaylistEntries, sharedNowPlayingSongId, sharedResolvedUpNextEntry])
  const sharedNowPlayingKeyLabel = sharedNowPlayingAssignments.keys.length
    ? sharedNowPlayingAssignments.keys.join(', ')
    : '—'
  const sharedNowPlayingSingerLabel = sharedNowPlayingIsDjOnly
    ? 'DJ ONLY'
    : sharedNowPlayingAssignments.singers.length
    ? sharedNowPlayingAssignments.singers.join(', ')
    : 'Unassigned'
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
      'DJ Only',
      'Special Requests',
      ...orderedSetSections
        .map(normalizePlaylistSection)
        .filter((section) => section && section.toLowerCase() !== 'dj only'),
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
  const isSharedAudioSectionCollapsed = useCallback(
    (section: string) => collapsedSharedAudioSections[section] ?? false,
    [collapsedSharedAudioSections],
  )
  const toggleSharedAudioSection = useCallback((section: string) => {
    setCollapsedSharedAudioSections((prev) => ({ ...prev, [section]: !(prev[section] ?? false) }))
  }, [])
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
  const isSharedPublicDocsMode = Boolean(sharedPlaylistView)
  const docModalSelectionItems = useMemo(() => {
    if (!docModalSongId) return []
    return isSharedPublicDocsMode
      ? getSharedDocumentSelectionItems(docModalSongId)
      : getDocumentSelectionItems(docModalSongId)
  }, [
    docModalSongId,
    getSharedDocumentSelectionItems,
    getDocumentSelectionItems,
    isSharedPublicDocsMode,
  ])
  const isLyricsDoc = docModalContent?.type === 'Lyrics'
  const sharedLyricsContainerClasses = isLyricsDoc
    ? sharedLyricsTheme === 'light'
      ? 'border-slate-300/80 bg-white text-slate-900'
      : 'border-white/10 bg-slate-950/50 text-slate-200'
    : 'border-white/10 bg-slate-950/50 text-slate-200'
  const sharedLyricsPreClasses =
    sharedLyricsFont === 'serif' ? 'font-serif' : sharedLyricsFont === 'mono' ? 'font-mono' : 'font-sans'
  const lyricsViewerId = authUserId ? `auth:${authUserId}` : `anon:${anonymousLyricsViewerId}`
  const sharedLyricsAlignmentClass = lyricsCenterAligned ? 'text-center' : 'text-left'
  const lyricsBodySurfaceClasses =
    sharedLyricsTheme === 'light'
      ? 'border-slate-300/80 bg-white text-slate-900'
      : 'border-white/10 bg-black/20 text-slate-200'
  const snapshotLyricsPrefsForUndo = useCallback(
    (): LyricsUserPrefs => ({
      theme: sharedLyricsTheme,
      font: sharedLyricsFont,
      fontScale: lyricsGlobalFontScale,
      centered: lyricsCenterAligned,
    }),
    [lyricsCenterAligned, lyricsGlobalFontScale, sharedLyricsFont, sharedLyricsTheme],
  )
  const queueLyricsPrefsUndo = useCallback(() => {
    setLyricsUndoState({ kind: 'prefs', viewerId: lyricsViewerId, prev: snapshotLyricsPrefsForUndo() })
  }, [lyricsViewerId, snapshotLyricsPrefsForUndo])
  const activeLyricsDocKey = useMemo(() => {
    if (!docModalSongId || !docModalContent?.id) return null
    return `${lyricsViewerId}:${isSharedPublicDocsMode ? 'shared' : 'app'}:${docModalSongId}:${docModalContent.id}`
  }, [docModalSongId, docModalContent?.id, isSharedPublicDocsMode, lyricsViewerId])
  const activeLyricsDocState = useMemo<LyricsDocState>(() => {
    if (!activeLyricsDocKey) return { fontScale: 1, highlights: [], strokes: [] }
    return lyricsDocStateByKey[activeLyricsDocKey] ?? { fontScale: 1, highlights: [], strokes: [] }
  }, [activeLyricsDocKey, lyricsDocStateByKey])
  const activeLyricsDocUndoStack = useMemo(
    () => (activeLyricsDocKey ? lyricsDocUndoStackByKey[activeLyricsDocKey] ?? [] : []),
    [activeLyricsDocKey, lyricsDocUndoStackByKey],
  )
  const isTextLyricsDoc = Boolean(docModalContent?.type === 'Lyrics' && docModalContent?.content)
  const baseLyricsText = isTextLyricsDoc ? docModalContent?.content ?? '' : ''
  const resolvedLyricsText =
    isTextLyricsDoc && typeof activeLyricsDocState.editedText === 'string'
      ? activeLyricsDocState.editedText
      : baseLyricsText
  const lyricsFontSizeRem = useMemo(
    () => Number((0.92 * lyricsGlobalFontScale).toFixed(2)),
    [lyricsGlobalFontScale],
  )
  const updateActiveLyricsDocState = useCallback(
    (
      updater: (current: LyricsDocState) => LyricsDocState,
      options?: { trackUndo?: boolean },
    ) => {
      if (!activeLyricsDocKey) return
      setLyricsDocStateByKey((prev) => {
        const current = prev[activeLyricsDocKey] ?? { fontScale: 1, highlights: [], strokes: [] }
        if (options?.trackUndo) {
          setLyricsDocUndoStackByKey((stackPrev) => {
            const existing = stackPrev[activeLyricsDocKey] ?? []
            const nextStack = [...existing, current]
            const bounded = nextStack.length > 150 ? nextStack.slice(nextStack.length - 150) : nextStack
            return { ...stackPrev, [activeLyricsDocKey]: bounded }
          })
        }
        const next = updater(current)
        return {
          ...prev,
          [activeLyricsDocKey]: {
            fontScale: Math.min(1.8, Math.max(0.75, next.fontScale)),
            highlights: next.highlights,
            strokes: next.strokes,
            editedText: next.editedText,
          },
        }
      })
    },
    [activeLyricsDocKey],
  )
  const undoActiveLyricsDocAction = useCallback(() => {
    if (!activeLyricsDocKey) return
    setLyricsDocUndoStackByKey((prev) => {
      const stack = prev[activeLyricsDocKey] ?? []
      if (!stack.length) return prev
      const restored = stack[stack.length - 1]
      setLyricsDocStateByKey((docPrev) => ({ ...docPrev, [activeLyricsDocKey]: restored }))
      return {
        ...prev,
        [activeLyricsDocKey]: stack.slice(0, -1),
      }
    })
  }, [activeLyricsDocKey])
  const clearAllActiveLyricsChanges = useCallback(() => {
    updateActiveLyricsDocState(
      (current) => ({
        ...current,
        highlights: [],
        strokes: [],
        editedText: baseLyricsText,
      }),
      { trackUndo: true },
    )
    setSelectedLyricsStrokeId(null)
  }, [baseLyricsText, updateActiveLyricsDocState])
  const applyLyricsHighlightSelection = useCallback(() => {
    if (!isTextLyricsDoc || !lyricsSelectionRange || lyricsSelectionRange.end <= lyricsSelectionRange.start) {
      return
    }
    updateActiveLyricsDocState(
      (current) => ({
        ...current,
        highlights: [
          ...current.highlights,
          {
            id: crypto.randomUUID(),
            start: lyricsSelectionRange.start,
            end: lyricsSelectionRange.end,
            color: lyricsActiveColor,
          },
        ],
      }),
      { trackUndo: true },
    )
    setLyricsSelectionRange(null)
    const selection = window.getSelection()
    selection?.removeAllRanges()
  }, [isTextLyricsDoc, lyricsSelectionRange, lyricsActiveColor, updateActiveLyricsDocState])
  const renderHighlightedLyrics = useCallback((text: string, highlights: LyricsHighlightRange[]) => {
    if (!highlights.length) return text
    const normalized = [...highlights]
      .filter((item) => item.end > item.start && item.start < text.length && item.end > 0)
      .map((item) => ({
        ...item,
        start: Math.max(0, Math.min(text.length, item.start)),
        end: Math.max(0, Math.min(text.length, item.end)),
      }))
      .sort((a, b) => a.start - b.start)
    if (!normalized.length) return text
    const nodes: ReactNode[] = []
    let cursor = 0
    normalized.forEach((item) => {
      if (item.start > cursor) nodes.push(text.slice(cursor, item.start))
      const segment = text.slice(Math.max(cursor, item.start), Math.max(cursor, item.end))
      if (segment) {
        nodes.push(
          <mark
            key={item.id}
            className="lyrics-highlight-mark"
            style={{ backgroundColor: item.color, color: item.color === '#ffffff' ? '#111827' : undefined }}
          >
            {segment}
          </mark>,
        )
      }
      cursor = Math.max(cursor, item.end)
    })
    if (cursor < text.length) nodes.push(text.slice(cursor))
    return nodes
  }, [])
  const handleLyricsSelectionCapture = useCallback(() => {
    if (!isTextLyricsDoc || !lyricsTextContainerRef.current) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setLyricsSelectionRange(null)
      return
    }
    const range = selection.getRangeAt(0)
    const container = lyricsTextContainerRef.current
    if (!container.contains(range.commonAncestorContainer)) {
      setLyricsSelectionRange(null)
      return
    }
    const prefixRange = range.cloneRange()
    prefixRange.selectNodeContents(container)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    const start = prefixRange.toString().length
    const selectedLength = range.toString().length
    const end = start + selectedLength
    if (end <= start) {
      setLyricsSelectionRange(null)
      return
    }
    setLyricsSelectionRange({ start, end })
  }, [isTextLyricsDoc])
  const toSvgPath = useCallback((points: LyricsStrokePoint[]) => {
    if (!points.length) return ''
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  }, [])
  const handleLyricsDrawPointerStart = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!lyricsDrawMode) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const nextStroke: LyricsStroke = {
        id: crypto.randomUUID(),
        color: lyricsActiveColor,
        width: Math.min(0.02, Math.max(0.0015, 3 / Math.max(rect.width, rect.height))),
        points: [
          {
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height,
          },
        ],
      }
      activeStrokeRef.current = nextStroke
      if (activeStrokePathRef.current) {
        activeStrokePathRef.current.setAttribute('stroke', nextStroke.color)
        activeStrokePathRef.current.setAttribute('stroke-width', String(nextStroke.width))
        activeStrokePathRef.current.setAttribute('d', toSvgPath(nextStroke.points))
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [lyricsActiveColor, lyricsDrawMode, toSvgPath],
  )
  const handleLyricsDrawPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!lyricsDrawMode || !activeStrokeRef.current) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const point = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      }
      const current = activeStrokeRef.current
      current.points.push(point)
      if (activeStrokePathRef.current) {
        activeStrokePathRef.current.setAttribute('d', toSvgPath(current.points))
      }
      event.preventDefault()
    },
    [lyricsDrawMode, toSvgPath],
  )
  const commitActiveStroke = useCallback(() => {
    const stroke = activeStrokeRef.current
    if (!stroke || stroke.points.length < 2) {
      activeStrokeRef.current = null
      if (activeStrokePathRef.current) {
        activeStrokePathRef.current.setAttribute('d', '')
      }
      return
    }
    updateActiveLyricsDocState(
      (current) => ({ ...current, strokes: [...current.strokes, stroke] }),
      { trackUndo: true },
    )
    activeStrokeRef.current = null
    if (activeStrokePathRef.current) {
      activeStrokePathRef.current.setAttribute('d', '')
    }
  }, [updateActiveLyricsDocState])
  const handleLyricsDrawPointerEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!lyricsDrawMode) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      commitActiveStroke()
      event.preventDefault()
    },
    [commitActiveStroke, lyricsDrawMode],
  )
  const renderLyricsStrokeOverlay = useCallback(
    () => (
      <div
        className={`lyrics-draw-layer ${lyricsDrawMode ? 'is-active' : ''} ${
          showDrawTools && !lyricsDrawMode ? 'is-select-active' : ''
        }`}
        onPointerDown={(event) => {
          if (showDrawTools && !lyricsDrawMode) {
            setSelectedLyricsStrokeId(null)
          }
          handleLyricsDrawPointerStart(event)
        }}
        onPointerMove={handleLyricsDrawPointerMove}
        onPointerUp={handleLyricsDrawPointerEnd}
        onPointerCancel={handleLyricsDrawPointerEnd}
      >
        <svg className="lyrics-draw-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
          {activeLyricsDocState.strokes.map((stroke) => (
            <path
              key={stroke.id}
              d={toSvgPath(
                stroke.points.map((point) => ({
                  x: point.x,
                  y: point.y,
                })),
              )}
              stroke={stroke.color}
              strokeWidth={selectedLyricsStrokeId === stroke.id ? stroke.width + 0.0025 : stroke.width}
              opacity={selectedLyricsStrokeId === stroke.id ? 1 : 0.95}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              vectorEffect="none"
              onPointerDown={(event) => {
                if (lyricsDrawMode || !showDrawTools) return
                event.stopPropagation()
                setSelectedLyricsStrokeId(stroke.id)
              }}
            />
          ))}
          <path
            ref={activeStrokePathRef}
            d=""
            stroke="transparent"
            strokeWidth="0.004"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            vectorEffect="none"
          />
        </svg>
      </div>
    ),
    [
      activeLyricsDocState.strokes,
      handleLyricsDrawPointerEnd,
      handleLyricsDrawPointerMove,
      handleLyricsDrawPointerStart,
      lyricsDrawMode,
      showDrawTools,
      selectedLyricsStrokeId,
      toSvgPath,
    ],
  )
  const beginLyricsPanelDrag = useCallback(
    (panel: LyricsToolPanelKey, event: PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      panelDragStateRef.current = {
        panel,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [],
  )
  useEffect(() => {
    const handleMove = (event: globalThis.PointerEvent) => {
      if (!panelDragStateRef.current) return
      const { panel, offsetX, offsetY } = panelDragStateRef.current
      setLyricsToolPanelPositions((prev) => ({
        ...prev,
        [panel]: {
          x: Math.max(8, Math.round(event.clientX - offsetX)),
          y: Math.max(8, Math.round(event.clientY - offsetY)),
        },
      }))
    }
    const handleUp = () => {
      panelDragStateRef.current = null
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [])
  const renderLyricsTools = useCallback(
    () => (
      <div className="lyrics-tools-shell">
        <button
          type="button"
          className="lyrics-tools-btn"
          onClick={() => {
            setShowLyricsToolbar((current) => {
              const next = !current
              if (!next) {
                setShowFontTools(false)
                setShowEditTools(false)
                setShowDrawTools(false)
              }
              return next
            })
          }}
        >
          {showLyricsToolbar ? 'Hide tools' : 'Show tools'}
        </button>
        {showLyricsToolbar && (
          <div className="lyrics-tools-bar">
            <button
              type="button"
              className="lyrics-tools-btn icon-only"
              onClick={() => {
                queueLyricsPrefsUndo()
                setSharedLyricsTheme((current) => (current === 'dark' ? 'light' : 'dark'))
              }}
              title="Toggle dark/light lyrics mode"
            >
              {sharedLyricsTheme === 'dark' ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f3f31a"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-sun-icon lucide-sun"
                  aria-label="Light mode icon"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f3f31a"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-moon-icon lucide-moon"
                  aria-label="Dark mode icon"
                >
                  <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className={`lyrics-tools-btn icon-only ${showFontTools ? 'is-active' : ''}`}
              onClick={() => {
                setShowFontTools((current) => !current)
                setShowEditTools(false)
                setShowDrawTools(false)
              }}
              title="Font and layout options"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f3f31a"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-type-icon lucide-type"
                aria-label="Edit font icon"
              >
                <path d="M12 4v16" />
                <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
                <path d="M9 20h6" />
              </svg>
            </button>
            <button
              type="button"
              className={`lyrics-tools-btn icon-only ${showEditTools ? 'is-active' : ''}`}
              onClick={() => {
                setShowEditTools((current) => !current)
                setShowFontTools(false)
                setShowDrawTools(false)
              }}
              title="Edit and highlight options"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f3f31a"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-pencil-icon lucide-pencil"
                aria-label="Edit icon"
              >
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
            <button
              type="button"
              className={`lyrics-tools-btn icon-only ${showDrawTools || lyricsDrawMode ? 'is-active' : ''}`}
              onClick={() => {
                setShowDrawTools((current) => !current)
                setShowEditTools(false)
                setShowFontTools(false)
              }}
              title="Drawing tools"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f3f31a"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-brush-icon lucide-brush"
                aria-label="Draw icon"
              >
                <path d="m11 10 3 3" />
                <path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z" />
                <path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031" />
              </svg>
            </button>
            <button
              type="button"
              className="lyrics-tools-btn icon-only"
              onClick={() => {
                if (activeLyricsDocUndoStack.length > 0) {
                  undoActiveLyricsDocAction()
                  return
                }
                if (!lyricsUndoState) return
                {
                  setSharedLyricsTheme(lyricsUndoState.prev.theme)
                  setSharedLyricsFont(lyricsUndoState.prev.font)
                  setLyricsGlobalFontScale(lyricsUndoState.prev.fontScale)
                  setLyricsCenterAligned(lyricsUndoState.prev.centered)
                }
                setLyricsUndoState(null)
              }}
              disabled={activeLyricsDocUndoStack.length === 0 && !lyricsUndoState}
              title="Undo last action"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f3f31a"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-undo-icon lucide-undo"
                aria-label="Undo icon"
              >
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
              </svg>
            </button>
          </div>
        )}

        {showLyricsToolbar && showFontTools && (
          <div
            className="lyrics-floating-panel lyrics-floating-panel--font"
            style={{ left: `${lyricsToolPanelPositions.font.x}px`, top: `${lyricsToolPanelPositions.font.y}px` }}
          >
            <div className="lyrics-floating-panel-handle" onPointerDown={(event) => beginLyricsPanelDrag('font', event)}>
              Font
              <CloseButton
                className="lyrics-floating-panel-close"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  setShowFontTools(false)
                }}
                ariaLabel="Close font tools"
                alignRight={false}
              />
            </div>
            <div className="lyrics-floating-panel-body">
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Font family</p>
                <select
                  className="w-full rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none"
                  value={sharedLyricsFont}
                  onChange={(event) => {
                    const nextFont = event.target.value as 'sans' | 'serif' | 'mono'
                    if (nextFont === sharedLyricsFont) return
                    queueLyricsPrefsUndo()
                    setSharedLyricsFont(nextFont)
                  }}
                >
                  <option value="sans">Sans</option>
                  <option value="serif">Serif</option>
                  <option value="mono">Mono</option>
                </select>
              </div>
              <div className="lyrics-tools-row">
                <button
                  type="button"
                  className="lyrics-tools-btn text-red-200"
                  onClick={() => {
                    queueLyricsPrefsUndo()
                    setLyricsGlobalFontScale((current) => Math.min(1.8, current + 0.08))
                  }}
                  aria-label="Increase font size"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#f3f31a"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-aarrow-up-icon lucide-a-arrow-up"
                  >
                    <path d="m14 11 4-4 4 4" />
                    <path d="M18 16V7" />
                    <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
                    <path d="M3.304 13h6.392" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="lyrics-tools-btn"
                  onClick={() => {
                    queueLyricsPrefsUndo()
                    setLyricsGlobalFontScale((current) => Math.max(0.75, current - 0.08))
                  }}
                  aria-label="Decrease font size"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#f3f31a"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-aarrow-down-icon lucide-a-arrow-down"
                  >
                    <path d="m14 12 4 4 4-4" />
                    <path d="M18 16V7" />
                    <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
                    <path d="M3.304 13h6.392" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`lyrics-tools-btn icon-only ${!lyricsCenterAligned ? 'is-active' : ''}`}
                  onClick={() => {
                    queueLyricsPrefsUndo()
                    setLyricsCenterAligned(false)
                  }}
                  title="Left align"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#f3f31a"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-text-align-start-icon lucide-text-align-start"
                    aria-label="Left align icon"
                  >
                    <path d="M21 5H3" />
                    <path d="M15 12H3" />
                    <path d="M17 19H3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`lyrics-tools-btn icon-only ${lyricsCenterAligned ? 'is-active' : ''}`}
                  onClick={() => {
                    queueLyricsPrefsUndo()
                    setLyricsCenterAligned(true)
                  }}
                  title="Center align"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#f3f31a"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-text-align-center-icon lucide-text-align-center"
                    aria-label="Center align icon"
                  >
                    <path d="M21 5H3" />
                    <path d="M17 12H7" />
                    <path d="M19 19H5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {showLyricsToolbar && showEditTools && (
          <div
            className="lyrics-floating-panel lyrics-floating-panel--edit"
            style={{ left: `${lyricsToolPanelPositions.edit.x}px`, top: `${lyricsToolPanelPositions.edit.y}px` }}
          >
            <div className="lyrics-floating-panel-handle" onPointerDown={(event) => beginLyricsPanelDrag('edit', event)}>
              Edit
              <CloseButton
                className="lyrics-floating-panel-close"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  setShowEditTools(false)
                }}
                ariaLabel="Close edit tools"
                alignRight={false}
              />
            </div>
            <div className="lyrics-floating-panel-body">
              <div className="lyrics-color-swatches">
                {LYRICS_COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`lyrics-color-chip ${lyricsActiveColor === color ? 'is-active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setLyricsActiveColor(color)}
                    title={`Color ${color}`}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
              <div className="lyrics-tools-row">
                <button
                  type="button"
                  className="lyrics-tools-btn"
                  onClick={applyLyricsHighlightSelection}
                  disabled={!isTextLyricsDoc || !lyricsSelectionRange}
                >
                  Highlight
                </button>
                <button
                  type="button"
                  className="lyrics-tools-btn"
                  onClick={clearAllActiveLyricsChanges}
                  title="Clear all highlights, drawings, and text edits for this lyrics doc"
                >
                  Clear All
                </button>
                {isTextLyricsDoc && (
                  <button
                    type="button"
                    className={`lyrics-tools-btn ${lyricsEditMode ? 'is-active' : ''}`}
                    onClick={() => {
                      if (lyricsEditMode) {
                        setLyricsEditMode(false)
                        return
                      }
                      setLyricsEditDraft(resolvedLyricsText)
                      setLyricsEditMode(true)
                      setLyricsDrawMode(false)
                    }}
                  >
                    Edit Text
                  </button>
                )}
              </div>
              {isTextLyricsDoc && lyricsEditMode && (
                <div className="lyrics-tools-row">
                  <button
                    type="button"
                    className="lyrics-tools-btn"
                    onClick={() => {
                      updateActiveLyricsDocState(
                        (current) => ({ ...current, editedText: lyricsEditDraft }),
                        { trackUndo: true },
                      )
                      setLyricsEditMode(false)
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="lyrics-tools-btn"
                    onClick={() => {
                      setLyricsEditMode(false)
                      setLyricsEditDraft(resolvedLyricsText)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="lyrics-tools-btn"
                    onClick={() => {
                      updateActiveLyricsDocState(
                        (current) => ({ ...current, editedText: baseLyricsText }),
                        { trackUndo: true },
                      )
                      setLyricsEditDraft(baseLyricsText)
                    }}
                  >
                    Revert
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {showLyricsToolbar && showDrawTools && (
          <div
            className="lyrics-floating-panel lyrics-floating-panel--draw"
            style={{ left: `${lyricsToolPanelPositions.draw.x}px`, top: `${lyricsToolPanelPositions.draw.y}px` }}
          >
            <div className="lyrics-floating-panel-handle" onPointerDown={(event) => beginLyricsPanelDrag('draw', event)}>
              Draw
              <CloseButton
                className="lyrics-floating-panel-close"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  setShowDrawTools(false)
                  setLyricsDrawMode(false)
                }}
                ariaLabel="Close draw tools"
                alignRight={false}
              />
            </div>
            <div className="lyrics-floating-panel-body">
              <div className="lyrics-color-swatches">
                {LYRICS_COLOR_SWATCHES.map((color) => (
                  <button
                    key={`draw-${color}`}
                    type="button"
                    className={`lyrics-color-chip ${lyricsActiveColor === color ? 'is-active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setLyricsActiveColor(color)}
                    title={`Color ${color}`}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
              <div className="lyrics-tools-row">
                <button
                  type="button"
                  className={`lyrics-tools-btn ${lyricsDrawMode ? 'is-active' : ''}`}
                  onClick={() => {
                    setLyricsDrawMode((current) => !current)
                    setSelectedLyricsStrokeId(null)
                    setLyricsEditMode(false)
                  }}
                >
                  {lyricsDrawMode ? 'Drawing On' : 'Drawing Off'}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedLyricsStrokeId && (
          <div className="lyrics-floating-panel lyrics-floating-panel--ink" style={{ left: '16px', bottom: '16px' }}>
            <div className="lyrics-floating-panel-body">
              <div className="lyrics-tools-row">
                <CloseButton
                  className="lyrics-floating-panel-close inline-close"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={() => setSelectedLyricsStrokeId(null)}
                  ariaLabel="Close ink actions"
                  alignRight={false}
                />
              </div>
              <div className="lyrics-tools-row">
                <button
                  type="button"
                  className="lyrics-tools-btn"
                  onClick={() => {
                    updateActiveLyricsDocState(
                      (current) => ({
                        ...current,
                        strokes: current.strokes.filter((stroke) => stroke.id !== selectedLyricsStrokeId),
                      }),
                      { trackUndo: true },
                    )
                    setSelectedLyricsStrokeId(null)
                  }}
                >
                  Delete One
                </button>
                <button
                  type="button"
                  className="lyrics-tools-btn"
                  onClick={() =>
                    updateActiveLyricsDocState((current) => ({ ...current, strokes: [] }), { trackUndo: true })
                  }
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    ),
    [
      activeLyricsDocUndoStack.length,
      applyLyricsHighlightSelection,
      baseLyricsText,
      beginLyricsPanelDrag,
      clearAllActiveLyricsChanges,
      isTextLyricsDoc,
      lyricsActiveColor,
      lyricsCenterAligned,
      lyricsDrawMode,
      lyricsEditDraft,
      lyricsEditMode,
      lyricsSelectionRange,
      lyricsToolPanelPositions.draw.x,
      lyricsToolPanelPositions.draw.y,
      lyricsToolPanelPositions.edit.x,
      lyricsToolPanelPositions.edit.y,
      lyricsToolPanelPositions.font.x,
      lyricsToolPanelPositions.font.y,
      sharedLyricsTheme,
      selectedLyricsStrokeId,
      lyricsUndoState,
      undoActiveLyricsDocAction,
      queueLyricsPrefsUndo,
      resolvedLyricsText,
      showDrawTools,
      showEditTools,
      showFontTools,
      showLyricsToolbar,
      sharedLyricsFont,
      updateActiveLyricsDocState,
    ],
  )
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
    const selectedEntry = visiblePlaylistEntries[index]
    if (!selectedEntry) return
    const selectedUrl = (selectedEntry.audioUrl ?? '').trim()
    flushSync(() => {
      setPlaylistIndex(index)
      if (isPlaylistEntryPlayable(selectedEntry)) {
        setPlaylistPlayNonce((current) => current + 1)
      }
    })
    if (isPlaylistEntryPlayable(selectedEntry)) {
      if (isYouTubeUrl(selectedUrl)) {
        const activeYtHandle = sharedPlaylistView
          ? sharedPublicYtHandleRef.current
          : playlistModalYtHandleRef.current
        activeYtHandle?.loadAndPlayUrl(selectedUrl)
      } else if (!isAudioFileUrl(selectedUrl) && selectedUrl) {
        // Non-embedded sources (Spotify/external links) should start immediately on selection.
        openExternalUrlSafely(selectedUrl)
      }
    }
  }
  const playPlaylistFromStart = () => {
    if (!visiblePlaylistEntries.length) return
    const firstPlayable = findNextPlayableIndex(0, 1)
    if (firstPlayable >= 0) {
      setPlaylistIndex(firstPlayable)
    } else {
      setPlaylistIndex(0)
    }
    setPlaylistPlayNonce((current) => current + 1)
  }
  const resolveFirstYoutubeInPlaylist = () => {
    if (!visiblePlaylistEntries.length) return null
    const idx = visiblePlaylistEntries.findIndex((entry) => isYouTubeUrl(entry.audioUrl ?? null))
    if (idx < 0) return null
    const url = visiblePlaylistEntries[idx]?.audioUrl?.trim()
    if (!url || !isYouTubeUrl(url)) return null
    return { idx, url }
  }
  /** Shared “Audio” tab: switching from Setlist counts as the user gesture for YouTube playback (no overlay). */
  const handleSharedPublicAudioTabClick = () => {
    const wasSetlist = sharedPublicTab === 'setlist'
    setPlaylistSingerFilter('__all__')
    const resolved = resolveFirstYoutubeInPlaylist()
    flushSync(() => {
      setSharedPublicTab('playlist')
      if (!wasSetlist) return
      if (resolved) {
        setPlaylistIndex(resolved.idx)
      } else {
        playPlaylistFromStart()
      }
    })
    if (!wasSetlist || !resolved) return
    sharedPublicYtHandleRef.current?.loadAndPlayUrl(resolved.url)
  }
  const youtubePlaylistAdvanceRef = useRef<() => void>(() => {})
  youtubePlaylistAdvanceRef.current = () => {
    if (!playlistAutoAdvance || visiblePlaylistEntries.length <= 1) return
    if (sharedPlaylistView && !authUserId) {
      const nextYoutubeIdx = visiblePlaylistEntries.findIndex(
        (entry, i) => i > playlistIndex && isYouTubeUrl(entry.audioUrl ?? null),
      )
      if (nextYoutubeIdx >= 0) {
        setPlaylistIndex(nextYoutubeIdx)
        setPlaylistPlayNonce((current) => current + 1)
        return
      }
    }
    movePlaylistBy(1)
  }
  const handlePlaylistYoutubeEnded = useCallback(() => {
    youtubePlaylistAdvanceRef.current()
  }, [])
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
    if (!widePlaylistUi) {
      playlistDrawerTouchStartYRef.current = null
      return
    }
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
  const jumpToSharedPlaylistIndex = (index: number) => {
    jumpToPlaylistIndex(index)
    setSharedPlaylistDrawerOverlay(false)
  }
  const copyPlaylistShareLink = async (options?: { fromFirstSong?: boolean }) => {
    if (!currentSetlist) return
    const shareStartIndex = options?.fromFirstSong
      ? 0
      : (() => {
          const currentShareEntry = visiblePlaylistEntries[playlistIndex]
          return currentShareEntry
            ? Math.max(
                0,
                activePlaylistEntries.findIndex((entry) => entry.key === currentShareEntry.key),
              )
            : 0
        })()
    const sharedMusicians = normalizeSharedMusicians(
      appState.gigMusicians
        .filter((row) => row.gigId === currentSetlist.id && row.status !== 'out')
        .map((row) => appState.musicians.find((musician) => musician.id === row.musicianId))
        .filter((musician): musician is Musician => Boolean(musician)),
    )
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
      setStatus(options?.fromFirstSong ? 'Guest link copied (starts at first song).' : 'Link copied.')
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

  const getGigKeySummary = (songId: string, gigId: string) => {
    const song = appState.songs.find((item) => item.id === songId)
    if (!song) return ''
    const keys = Array.from(
      new Set(
        song.keys
          .map((key) => (key.gigOverrides[gigId] ?? '').trim())
          .filter(Boolean),
      ),
    )
    return keys.join(', ')
  }

  const getPlaylistAssignmentText = (entry: PlaylistEntry) => {
    if (
      entry.tags.some((tag) => {
        const normalized = tag.trim().toLowerCase()
        return normalized === 'dj only'
      })
    ) {
      return 'DJ only track - no learning needed'
    }
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
      const hasRawSongAssignment = (song: Song) =>
        song.keys.some((key) => Boolean((key.gigOverrides[currentSetlist.id] ?? key.defaultKey ?? '').trim())) ||
        appState.specialRequests.some(
          (request) =>
            request.gigId === currentSetlist.id &&
            request.songId === song.id &&
            !request.djOnly &&
            normalizeTagList(request.singers ?? []).length > 0 &&
            Boolean((request.key ?? '').trim()),
        )
      const hasRawSpecialRequestAssignment = (request: SpecialRequest) =>
        request.djOnly ||
        (normalizeTagList(request.singers ?? []).length > 0 && Boolean((request.key ?? '').trim())) ||
        (request.songId
          ? (() => {
              const song = appState.songs.find((item) => item.id === request.songId)
              if (!song) return false
              return song.keys.some((key) =>
                Boolean((key.gigOverrides[currentSetlist.id] ?? key.defaultKey ?? '').trim()),
              )
            })()
          : false)
      const hasMissingSingers =
        panel === 'special'
          ? appState.specialRequests.some(
              (request) =>
                request.gigId === currentSetlist.id &&
                !hasRawSpecialRequestAssignment(request),
            )
          : currentSetlist.songIds
              .map((songId) => appState.songs.find((song) => song.id === songId))
              .filter((song): song is Song => Boolean(song))
              .filter((song) => songMatchesGigSection(song, sectionPanel ?? '', currentSetlist.id))
              .some((song) => !hasRawSongAssignment(song))
      if (hasMissingSingers) {
        setShowMissingSingerWarning(true)
        return
      }
    }
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
    setPdfDownloadStatus(null)
    setShowPrintPreview(true)
  }
  const copySetlistForExcel = async () => {
    if (!currentSetlist) return
    const rows: string[] = ['Section\tTitle\tArtist\tKey\tSingers']
    orderedSetSections.forEach((section) => {
      const sectionSongs = currentSetlist.songIds
        .map((songId) => appState.songs.find((song) => song.id === songId))
        .filter((song): song is Song => Boolean(song))
        .filter((song) => songMatchesGigSection(song, section, currentSetlist.id))
      if (sectionSongs.length === 0) {
        rows.push(`${section}\t\t\t\t`)
        return
      }
      sectionSongs.forEach((song) => {
        const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
        const singers = assignments.map((entry) => entry.singer)
        const keys = Array.from(new Set(assignments.map((entry) => entry.key).filter(Boolean)))
        const keyLabel = keys.length === 0 ? '' : keys.length === 1 ? keys[0] : keys.join(', ')
        rows.push(
          [
            section,
            song.title ?? '',
            song.artist ?? '',
            keyLabel,
            singers.length ? formatSingerAssignmentNames(singers) : '',
          ].join('\t'),
        )
      })
    })
    const payload = rows.join('\n')
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = payload
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        textArea.remove()
      }
      setSetlistCopyStatus('Setlist copied for Excel.')
      if (setlistCopyTimerRef.current) window.clearTimeout(setlistCopyTimerRef.current)
      setlistCopyTimerRef.current = window.setTimeout(() => setSetlistCopyStatus(null), 2600)
    } catch {
      setSupabaseError('Unable to copy setlist. Please try again.')
    }
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
    if (!currentSetlist) return false
    if (!ensureVocalistsReady()) return false
    const song = appState.songs.find((item) => item.id === songId)
    if (!song) return false
    const existingKey = song.keys.find((key) => key.singer === singerName)
    const normalizedKey =
      keyValue.trim() || existingKey?.defaultKey?.trim() || song.originalKey?.trim() || 'TBD'
    if (!singerName) return false
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
        index === rowIndex ? { singer: singerName, key: normalizedKey } : row,
      ),
    }))
    setSingerModalSongId(null)
    return true
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
    if (!supabase) return 0
    const { error: claimError } = await supabase.rpc('claim_musician_memberships_for_current_user')
    if (
      claimError &&
      !/claim_musician_memberships_for_current_user|function .* does not exist|schema cache/i.test(
        claimError.message ?? '',
      )
    ) {
      setSupabaseError(`Musician gig match failed: ${claimError.message}`)
    }
    const { data: membershipsData, error: membershipsError } = await supabase
      .from('band_memberships')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
    if (membershipsError) {
      setSupabaseError(`Band membership load failed: ${membershipsError.message}`)
      return 0
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
      setBandSubscriptionTierByBandId({})
      setBandPendingTierChangeByBandId({})
      setActiveBandId('')
      setRole(null)
      return 0
    }
    const { data: bandsData, error: bandsError } = await supabase
      .from('bands')
      .select('*')
      .in('id', bandIds)
    if (bandsError) {
      setSupabaseError(`Band load failed: ${bandsError.message}`)
      return 0
    }
    const mappedBands: Band[] = (bandsData ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      createdBy: row.created_by ?? undefined,
    }))
    setBands(mappedBands)
    const { data: subscriptionsData, error: subscriptionsError } = await supabase
      .from('SetlistBandSubscriptions')
      .select('band_id,tier,status,current_period_end,metadata')
      .in('band_id', bandIds)
    if (!subscriptionsError) {
      const nextSubscriptionTiers: Record<string, BandTier> = {}
      const nextPendingTierChanges: Record<string, { pendingTier: BandTier; effectiveAt: string }> = {}
      ;(subscriptionsData ?? []).forEach((row) => {
        const bandId = String(row.band_id ?? '')
        const rawTier = String(row.tier ?? '').toLowerCase()
        const normalizedTier: BandTier =
          rawTier === 'pro'
            ? 'pro'
            : 'free'
        if (!bandId) return
        const normalizedStatus = String(row.status ?? 'active').toLowerCase()
        if (normalizedStatus !== 'active' && normalizedStatus !== 'trialing') return
        const pendingTierRaw = String((row.metadata as { pending_tier?: string } | null)?.pending_tier ?? '')
          .toLowerCase()
          .trim()
        const pendingTier: BandTier =
          pendingTierRaw === 'pro'
            ? 'pro'
            : 'free'
        const periodEndIso = String(row.current_period_end ?? '').trim()
        const periodEndMs = periodEndIso ? new Date(periodEndIso).getTime() : 0
        const shouldApplyPendingTier =
          Boolean(pendingTierRaw) &&
          pendingTier !== normalizedTier &&
          Boolean(periodEndMs && periodEndMs <= Date.now())
        nextSubscriptionTiers[bandId] = shouldApplyPendingTier ? pendingTier : normalizedTier
        const hasFuturePendingTier =
          Boolean(pendingTierRaw) &&
          pendingTier !== normalizedTier &&
          Boolean(periodEndMs && periodEndMs > Date.now()) &&
          Boolean(periodEndIso)
        if (hasFuturePendingTier && periodEndIso) {
          nextPendingTierChanges[bandId] = {
            pendingTier,
            effectiveAt: periodEndIso,
          }
        }
      })
      setBandSubscriptionTierByBandId(nextSubscriptionTiers)
      setBandPendingTierChangeByBandId(nextPendingTierChanges)
    }
    const storedBandId = localStorage.getItem(ACTIVE_BAND_KEY) ?? ''
    const resolvedBandId = mappedBands.some((band) => band.id === storedBandId)
      ? storedBandId
      : mappedBands[0]?.id ?? ''
    setActiveBandId(resolvedBandId)
    const membership = getPreferredMembership(mappedMemberships, resolvedBandId)
    setRole(isAdminMembershipRole(membership?.role) ? 'admin' : 'user')
    return mappedBands.length
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
    const inviteRoleForMusician: 'member' | 'admin' = isAdminMembershipRole(membership?.role)
      ? 'admin'
      : 'member'
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
      setAuthError('Supabase is not configured. Check your environment setup.')
      return
    }
    setAuthError(null)
    setAuthStatus(null)
    setSupabaseError(null)
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError('Enter email and password.')
      return
    }
    setAuthLoading(true)
    try {
      const authTimeoutMs = 12000
      const resolveAuthEmailRedirectUrl = () => {
        const currentOrigin = window.location.origin
        const configuredAppUrl = String(import.meta.env.VITE_APP_URL ?? '').trim()
        return resolveAuthRedirectOrigin(currentOrigin, configuredAppUrl, {
          isProd: import.meta.env.PROD,
        })
      }
      if (authMode === 'signup') {
        if (isSharedLinkAuthContext) {
          setAuthError('Account signup is disabled from shared gig links. Please ask the band leader for access.')
          setAuthLoading(false)
          return
        }
        const signUpPromise = supabase.auth.signUp({
          email: authEmail.trim().toLowerCase(),
          password: authPassword,
          options: {
            emailRedirectTo: resolveAuthEmailRedirectUrl(),
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
          if (triggerAuthEmailCooldownFromMessage(error.message ?? '')) return
          setAuthError(error.message)
          return
        }
        if (data.session) {
          setShowCreateBandOnboarding(true)
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
        logger.setContext(userId, activeBandId || null)
        logger.log('login', { email: userEmail ?? undefined })
        await loadBandContext(userId)
      }
    } catch (error) {
      console.error('Auth request failed:', error)
      const message = error instanceof Error ? error.message : ''
      setAuthError(
        message.toLowerCase().includes('failed to fetch')
          ? 'Cannot reach Supabase. Check your internet/DNS connection or Supabase project URL, then try again.'
          : 'Authentication failed. Please try again.',
      )
    } finally {
      setAuthLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!supabase) return
    const email = authEmail.trim().toLowerCase()
    setAuthError(null)
    setAuthStatus(null)
    if (!email) {
      setAuthError('Enter your email, then tap Forgot password.')
      return
    }
    setAuthLoading(true)
    try {
      const redirectTo = resolveAuthRedirectOrigin(
        window.location.origin,
        String(import.meta.env.VITE_APP_URL ?? '').trim(),
        { isProd: import.meta.env.PROD },
      )
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      })
      if (error) {
        if (triggerAuthEmailCooldownFromMessage(error.message ?? '')) return
        setAuthError(error.message)
        return
      }
      setAuthStatus('Password reset email sent. Check your inbox.')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setAuthError(message || 'Could not send reset email. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleResetPasswordSubmit = async () => {
    if (!supabase) return
    setAuthError(null)
    setAuthStatus(null)
    const nextPassword = recoveryPassword.trim()
    const confirmPassword = recoveryPasswordConfirm.trim()
    if (!nextPassword || !confirmPassword) {
      setAuthError('Enter and confirm your new password.')
      return
    }
    if (nextPassword.length < 8) {
      setAuthError('Password must be at least 8 characters.')
      return
    }
    if (nextPassword !== confirmPassword) {
      setAuthError('Passwords do not match.')
      return
    }
    setAuthLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: nextPassword })
      if (error) {
        setAuthError(error.message)
        return
      }
      setPasswordRecoveryMode(false)
      setRecoveryPassword('')
      setRecoveryPasswordConfirm('')
      setAuthMode('login')
      setAuthStatus('Password updated. You can now log in.')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setAuthError(message || 'Could not reset password. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    logger.log('logout')
    logger.clearContext()
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
    if (!canCreateGigs()) return
    const uniqueSourceSongIds = Array.from(new Set(source.songIds))
    const sourceGigSectionOverrides = gigSongSectionOverrides[source.id] ?? {}
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

        const sectionOverrideTagRows = Object.entries(sourceGigSectionOverrides)
          .flatMap(([songId, sections]) =>
            (sections ?? []).map((section) => ({
              id: createId(),
              song_id: songId,
              tag: makeGigSectionTag(newId, section),
            })),
          )
          .filter((row) => row.song_id && row.tag)
        if (sectionOverrideTagRows.length) {
          const { error: sectionTagInsertError } = await supabase.from('SetlistSongTags').insert(
            sectionOverrideTagRows.map((row) => withBandId(row)),
          )
          reportSupabaseError(sectionTagInsertError)
        }
      })()
    }
    if (Object.keys(sourceGigSectionOverrides).length > 0) {
      setGigSongSectionOverrides((prev) => ({
        ...prev,
        [newId]: { ...sourceGigSectionOverrides },
      }))
    }
    setGigHiddenSpecialSection((prev) => ({ ...prev, [newId]: false }))
  }

  const createBlankSetlist = () => {
    if (!canCreateGigs()) return
    const newId = createId()
    logger.log('gig_created', { gigId: newId })
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
    setGigDeletedSectionSongs((prev) => {
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

  const setSongsForGigSection = (
    gigId: string,
    songIds: string[],
    section: string,
    options: { persist?: boolean } = {},
  ) => {
    const normalizedSection = normalizeSetlistSectionLabel(section)
    const uniqueSongIds = Array.from(new Set(songIds.filter(Boolean)))
    if (!normalizedSection || uniqueSongIds.length === 0) return
    setGigSongSectionOverrides((prev) => ({
      ...prev,
      [gigId]: {
        ...(prev[gigId] ?? {}),
        ...Object.fromEntries(
          uniqueSongIds.map((songId) => {
            const currentSections = (prev[gigId]?.[songId] ?? []).map(normalizeSetlistSectionLabel)
            const mergedSections = Array.from(
              new Set([...currentSections.filter(Boolean), normalizedSection]),
            )
            return [songId, mergedSections]
          }),
        ),
      },
    }))
    const deleteKey = getSectionDeleteKey(normalizedSection)
    const uniqueSongIdSet = new Set(uniqueSongIds)
    setGigDeletedSectionSongs((prev) => {
      const bySection = prev[gigId]
      if (!bySection?.[deleteKey]) return prev
      return {
        ...prev,
        [gigId]: {
          ...bySection,
          [deleteKey]: bySection[deleteKey].filter((songId) => !uniqueSongIdSet.has(songId)),
        },
      }
    })
    if (options.persist === false || !supabase) return
    const client = supabase
    const deletedTag = makeGigSectionDeletedTag(gigId, normalizedSection)
    uniqueSongIds.forEach((songId) => {
      runSupabase(
        (async () => {
          const { error: clearDeletedError } = await client
            .from('SetlistSongTags')
            .delete()
            .eq('song_id', songId)
            .eq('tag', deletedTag)
          if (clearDeletedError) return { error: clearDeletedError }
          const sectionTag = makeGigSectionTag(gigId, normalizedSection)
          const existingTagQuery = client
            .from('SetlistSongTags')
            .select('id')
            .eq('song_id', songId)
            .eq('tag', sectionTag)
            .limit(1)
          const existingTagRes = activeBandId
            ? await existingTagQuery.eq('band_id', activeBandId)
            : await existingTagQuery
          if (existingTagRes.error) return { error: existingTagRes.error }
          if ((existingTagRes.data ?? []).length > 0) return { error: null }
          const { error: insertError } = await client.from('SetlistSongTags').insert(withBandId({
            id: createId(),
            song_id: songId,
            tag: sectionTag,
          }))
          return { error: insertError }
        })(),
      )
    })
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
    const normalizedTargets = normalizeTagList(sectionAddSongsTargets).filter(Boolean)
    const assignmentSection = normalizeSetlistSectionLabel(
      (normalizedTargets.length === 1 ? normalizedTargets[0] : '') ||
        sectionAddSongsSource ||
        normalizedTargets[0] ||
        '',
    )
    if (!assignmentSection) return
    const selectedUniqueSongIds = Array.from(new Set(selectedSongIds))
    const songsToAdd = selectedUniqueSongIds.filter((songId) => !currentSetlist.songIds.includes(songId))

    commitChange('Add songs to setlists', (prev) => ({
      ...prev,
      songs: prev.songs,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id
          ? { ...setlist, songIds: [...setlist.songIds, ...songsToAdd] }
          : setlist,
      ),
      tagsCatalog: prev.tagsCatalog,
    }))
    setSongsForGigSection(currentSetlist.id, selectedUniqueSongIds, assignmentSection)

    if (supabase) {
      if (songsToAdd.length) {
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
    }

    setSelectedSongIds([])
    setShowSectionAddSongsModal(false)
  }

  const removeSongFromSetlist = (songId: string, sectionOverride?: string) => {
    if (!currentSetlist) return
    const activeSection = normalizeSetlistSectionLabel(
      sectionOverride || getSectionFromPanel(activeBuildPanel) || '',
    )
    let shouldOnlyRemoveFromSection = false
    if (activeSection) {
      const song = appState.songs.find((item) => item.id === songId)
      if (song) {
        const remainingSections = orderedSetSections.filter(
          (section) => section.trim().toLowerCase() !== activeSection.trim().toLowerCase(),
        )
        shouldOnlyRemoveFromSection = remainingSections.some((section) =>
          songMatchesGigSection(song, section, currentSetlist.id),
        )
      }
      const deleteKey = getSectionDeleteKey(activeSection)
      setGigDeletedSectionSongs((prev) => {
        const bySection = prev[currentSetlist.id] ?? {}
        const existing = bySection[deleteKey] ?? []
        return {
          ...prev,
          [currentSetlist.id]: {
            ...bySection,
            [deleteKey]: Array.from(new Set([...existing, songId])),
          },
        }
      })
      setGigSongSectionOverrides((prev) => {
        const bySong = prev[currentSetlist.id]
        const normalizedActiveSection = normalizeSetlistSectionLabel(activeSection)
        if (!bySong?.[songId] || !normalizedActiveSection) return prev
        const existingSections = (bySong[songId] ?? []).map(normalizeSetlistSectionLabel).filter(Boolean)
        const nextSections = existingSections.filter(
          (section) => section.trim().toLowerCase() !== normalizedActiveSection.trim().toLowerCase(),
        )
        const nextBySong = { ...bySong }
        if (nextSections.length === 0) {
          delete nextBySong[songId]
        } else {
          nextBySong[songId] = nextSections
        }
        return {
          ...prev,
          [currentSetlist.id]: nextBySong,
        }
      })
      if (supabase) {
        runSupabase(
          supabase.from('SetlistSongTags').insert(withBandId({
            id: createId(),
            song_id: songId,
            tag: makeGigSectionDeletedTag(currentSetlist.id, activeSection),
          })),
        )
        runSupabase(
          supabase
            .from('SetlistSongTags')
            .delete()
            .eq('song_id', songId)
            .eq('tag', makeGigSectionTag(currentSetlist.id, activeSection)),
        )
      }
      if (shouldOnlyRemoveFromSection) return
    }
    commitChange('Remove song', (prev) => ({
      ...prev,
      songs: prev.songs.map((song) => {
        if (song.id !== songId) return song
        return {
          ...song,
          keys: song.keys.map((key) => {
            const remainingGigOverrides = { ...key.gigOverrides }
            delete remainingGigOverrides[currentSetlist.id]
            return { ...key, gigOverrides: remainingGigOverrides }
          }),
        }
      }),
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
      runSupabase(
        supabase
          .from('SetlistGigSingerKeys')
          .delete()
          .eq('gig_id', currentSetlist.id)
          .eq('song_id', songId),
      )
    }
  }

  const requestRemoveSong = (songId: string, section?: string) => {
    setPendingRemoveSongId(songId)
    setPendingRemoveSongSection(section ? normalizeSetlistSectionLabel(section) : null)
    setShowRemoveSongConfirm(true)
  }

  const openSingerModal = (songId: string) => {
    if (!currentSetlist) return
    const existingAssignments = getGigSingerAssignments(songId, currentSetlist.id)
    setPendingSingerAssignments((prev) => ({
      ...prev,
      [songId]: existingAssignments.map((assignment) => ({
        singer: assignment.singer,
        key: assignment.key,
      })),
    }))
    setSingerModalSongId(songId)
  }

  const removeSingerAssignment = (songId: string, singerName: string) => {
    if (!currentSetlist) return
    const normalizedSinger = singerName.trim().toLowerCase()
    if (!normalizedSinger) return
    commitChange('Remove singer key', (prev) => ({
      ...prev,
      songs: prev.songs.map((song) => {
        if (song.id !== songId) return song
        return {
          ...song,
          keys: song.keys.map((key) => {
            if (key.singer.trim().toLowerCase() !== normalizedSinger) return key
            const remainingGigOverrides = { ...key.gigOverrides }
            delete remainingGigOverrides[currentSetlist.id]
            return { ...key, gigOverrides: remainingGigOverrides }
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
            .eq('singer_name', singerName)
          const { error } = activeBandId ? await deleteQuery.eq('band_id', activeBandId) : await deleteQuery
          return { error }
        })(),
      )
    }
    setPendingSingerAssignments((prev) => ({
      ...prev,
      [songId]: (prev[songId] ?? []).filter(
        (row) => row.singer.trim().toLowerCase() !== normalizedSinger,
      ),
    }))
  }

  const confirmRemoveSong = () => {
    if (!pendingRemoveSongId) return
    removeSongFromSetlist(pendingRemoveSongId, pendingRemoveSongSection ?? undefined)
    setPendingRemoveSongId(null)
    setPendingRemoveSongSection(null)
    setShowRemoveSongConfirm(false)
  }

  const cancelRemoveSong = () => {
    setPendingRemoveSongId(null)
    setPendingRemoveSongSection(null)
    setShowRemoveSongConfirm(false)
  }

  const getSourceSectionSongIds = (section: string, source: Setlist) => {
    const normalizedSection = normalizeSetlistSectionLabel(section)
    if (!normalizedSection) return []
    const normalizedSectionLower = normalizedSection.toLowerCase()
    const sourceHasExplicitSectionSongs = source.songIds.some((songId) =>
      getGigSongSections(source.id, songId).some(
        (override) => override.trim().toLowerCase() === normalizedSectionLower,
      ),
    )
    const matchesLibrarySectionTag = (song: Song) => {
      if (normalizedSectionLower.startsWith('dance set ')) return hasSongTag(song, 'Dance')
      if (normalizedSectionLower.startsWith('dinner set ')) return hasSongTag(song, 'Dinner')
      if (normalizedSectionLower.startsWith('latin set ')) return hasSongTag(song, 'Latin')
      return hasSongTag(song, normalizedSection)
    }
    return source.songIds.filter((songId) => {
      const song = appState.songs.find((item) => item.id === songId)
      if (!song) return false
      return sourceHasExplicitSectionSongs
        ? songMatchesGigSection(song, normalizedSection, source.id)
        : matchesLibrarySectionTag(song)
    })
  }

  const openImportReviewFromGig = (section: string, gigId: string) => {
    const source = appState.setlists.find((setlist) => setlist.id === gigId)
    if (!source || !currentSetlist) return
    const deletedSongIds = getDeletedSectionSongIds(currentSetlist.id, section)
    const candidateSongIds = getSourceSectionSongIds(section, source).filter(
      (songId) => !currentSetlist.songIds.includes(songId),
    )
    setImportReview({
      section,
      sourceGigId: gigId,
      selectedSongIds: candidateSongIds.filter((songId) => !deletedSongIds.has(songId)),
    })
  }

  const clearDeletedSectionSongMemory = (
    gigId: string,
    section: string,
    songIds: string[],
    options: { persist?: boolean } = {},
  ) => {
    if (songIds.length === 0) return
    const deleteKey = getSectionDeleteKey(section)
    const songIdSet = new Set(songIds)
    setGigDeletedSectionSongs((prev) => {
      const bySection = prev[gigId]
      if (!bySection?.[deleteKey]) return prev
      return {
        ...prev,
        [gigId]: {
          ...bySection,
          [deleteKey]: bySection[deleteKey].filter((songId) => !songIdSet.has(songId)),
        },
      }
    })
    if (options.persist === false || !supabase) return
    const client = supabase
    const deletedTag = makeGigSectionDeletedTag(gigId, section)
    songIds.forEach((songId) => {
      runSupabase(
        client
          .from('SetlistSongTags')
          .delete()
          .eq('song_id', songId)
          .eq('tag', deletedTag),
      )
    })
  }

  const importSectionFromGig = async (
    section: string,
    gigId: string,
    selectedSongIds?: string[],
  ) => {
    const source = appState.setlists.find((setlist) => setlist.id === gigId)
    if (!source || !currentSetlist) return false
    const normalizedSection = normalizeSetlistSectionLabel(section)
    if (!normalizedSection) return false
    const activeSingerNames = new Set(
      appState.gigMusicians
        .filter((entry) => entry.gigId === currentSetlist.id && entry.status !== 'out')
        .map((entry) => appState.musicians.find((musician) => musician.id === entry.musicianId))
        .filter((musician): musician is Musician => Boolean(musician))
        .filter(
          (musician) =>
            Boolean(musician.singer) ||
            (musician.instruments ?? []).some(
              (instrument) => instrument.toLowerCase() === 'vocals',
            ),
        )
        .map((musician) => musician.name.trim().toLowerCase()),
    )
    activeSingerNames.add(INSTRUMENTAL_LABEL.toLowerCase())
    const gigDateRank = new Map(
      appState.setlists.map((setlist) => [setlist.id, normalizeGigDateISO(setlist.date) || setlist.date || '']),
    )
    const getHistoricalSingerKey = (key: SongKey) => {
      const rankedOverrides = Object.entries(key.gigOverrides)
        .filter(([overrideGigId, value]) => overrideGigId !== currentSetlist.id && value.trim())
        .sort((a, b) => (gigDateRank.get(b[0]) ?? '').localeCompare(gigDateRank.get(a[0]) ?? ''))
      return rankedOverrides[0]?.[1]?.trim() || key.defaultKey?.trim() || ''
    }
    const allowedSongIds = selectedSongIds ? new Set(selectedSongIds) : null
    const sectionSongIds = getSourceSectionSongIds(normalizedSection, source).filter(
      (songId) => !allowedSongIds || allowedSongIds.has(songId),
    )
    if (sectionSongIds.length === 0) {
      setSectionSaveStatus('Select at least one song to save.')
      window.setTimeout(() => setSectionSaveStatus(null), 2200)
      return false
    }
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
          const isActiveSinger = activeSingerNames.has(key.singer.trim().toLowerCase())
          if (!isActiveSinger) {
            const remainingGigOverrides = { ...key.gigOverrides }
            delete remainingGigOverrides[currentSetlist.id]
            return {
              ...key,
              gigOverrides: remainingGigOverrides,
            }
          }
          const keyForCurrentGig = sourceKey?.trim() || getHistoricalSingerKey(key)
          if (!keyForCurrentGig) return key
          return {
            ...key,
            gigOverrides: {
              ...key.gigOverrides,
              [currentSetlist.id]: keyForCurrentGig,
            },
          }
        })
        return { ...song, keys: nextKeys }
      }),
    }))
    clearDeletedSectionSongMemory(currentSetlist.id, normalizedSection, sectionSongIds, {
      persist: false,
    })
    setSongsForGigSection(currentSetlist.id, sectionSongIds, normalizedSection, { persist: false })
    const client = supabase
    if (!client) {
      setSectionSaveStatus(`Saved ${sectionSongIds.length} song${sectionSongIds.length === 1 ? '' : 's'} locally.`)
      window.setTimeout(() => setSectionSaveStatus(null), 2600)
      return true
    }

    setlistSectionSaveInProgressRef.current = true
    setSectionSaveStatus('Saving setlist...')
    try {
      const requireSave = async (
        promise: PromiseLike<{ error: { message?: string } | null }>,
      ) => {
        const { error } = await promise
        if (error) throw error
      }
      const gigSongIdsToSave = sectionSongIds
      if (gigSongIdsToSave.length) {
        const existingGigSongQuery = client
          .from('SetlistGigSongs')
          .delete()
          .eq('gig_id', currentSetlist.id)
          .in('song_id', gigSongIdsToSave)
        await requireSave(
          activeBandId ? existingGigSongQuery.eq('band_id', activeBandId) : existingGigSongQuery,
        )
        await requireSave(
          client.from('SetlistGigSongs').insert(
            gigSongIdsToSave.map((songId, index) =>
              withBandId({
                id: createId(),
                gig_id: currentSetlist.id,
                song_id: songId,
                sort_order: currentSetlist.songIds.length + index,
              }),
            ),
          ),
        )
      }
      const tagPrefix = `${GIG_SECTION_TAG_PREFIX}${currentSetlist.id}::%`
      const deletedTag = makeGigSectionDeletedTag(currentSetlist.id, normalizedSection)
      const clearSectionTagsQuery = client
        .from('SetlistSongTags')
        .delete()
        .in('song_id', sectionSongIds)
        .like('tag', tagPrefix)
      await requireSave(
        activeBandId ? clearSectionTagsQuery.eq('band_id', activeBandId) : clearSectionTagsQuery,
      )
      const clearDeletedTagsQuery = client
        .from('SetlistSongTags')
        .delete()
        .in('song_id', sectionSongIds)
        .eq('tag', deletedTag)
      await requireSave(
        activeBandId ? clearDeletedTagsQuery.eq('band_id', activeBandId) : clearDeletedTagsQuery,
      )
      await requireSave(
        client.from('SetlistSongTags').insert(
          sectionSongIds.map((songId) =>
            withBandId({
              id: createId(),
              song_id: songId,
              tag: makeGigSectionTag(currentSetlist.id, normalizedSection),
            }),
          ),
        ),
      )

      const clearSingerKeysQuery = client
        .from('SetlistGigSingerKeys')
        .delete()
        .eq('gig_id', currentSetlist.id)
        .in('song_id', sectionSongIds)
      await requireSave(
        activeBandId ? clearSingerKeysQuery.eq('band_id', activeBandId) : clearSingerKeysQuery,
      )
      const singerKeyRows = sectionSongIds.flatMap((songId) => {
        const song = appState.songs.find((item) => item.id === songId)
        if (!song) return []
        return song.keys.flatMap((key) => {
          const sourceKey = key.gigOverrides[gigId]
          const isActiveSinger = activeSingerNames.has(key.singer.trim().toLowerCase())
          if (!isActiveSinger) return []
          const keyForCurrentGig = sourceKey?.trim() || getHistoricalSingerKey(key)
          if (!keyForCurrentGig) return []
          return [
            withBandId({
              id: createId(),
              gig_id: currentSetlist.id,
              song_id: songId,
              singer_name: key.singer,
              gig_key: keyForCurrentGig,
            }),
          ]
        })
      })
      if (singerKeyRows.length) {
        await requireSave(client.from('SetlistGigSingerKeys').insert(singerKeyRows))
      }
      await loadSupabaseData()
      setSectionSaveStatus(`Saved ${sectionSongIds.length} song${sectionSongIds.length === 1 ? '' : 's'} to ${normalizedSection}.`)
      window.setTimeout(() => setSectionSaveStatus(null), 2600)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Setlist save failed.'
      setSupabaseError(message)
      setSectionSaveStatus('Save failed. Please try again.')
      window.setTimeout(() => setSectionSaveStatus(null), 3200)
      return false
    } finally {
      setlistSectionSaveInProgressRef.current = false
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
    const songIdsForSection = new Set<string>()
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
        songIdsForSection.add(found.id)
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
      songIdsForSection.add(id)
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
    const uniqueSongIdsForSection = Array.from(songIdsForSection)
    if (newSongs.length > 0 && !canCreateSongs(newSongs.length)) return

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
    setSongsForGigSection(currentSetlist.id, uniqueSongIdsForSection, section)

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
      if (!song || !songMatchesGigSection(song, section, currentSetlist.id)) return songId
      const nextId = reorderedSectionSongIds[cursor]
      cursor += 1
      return nextId
    })
    const dedupedNextSongIds = Array.from(new Set(nextSongIds))

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
        [songId]: Array.from(
          new Set([...(prev[gigId]?.[songId] ?? []), normalizedSection]),
        ),
      },
    }))
    const deleteKey = getSectionDeleteKey(normalizedSection)
    setGigDeletedSectionSongs((prev) => {
      const bySection = prev[gigId]
      if (!bySection?.[deleteKey]) return prev
      return {
        ...prev,
        [gigId]: {
          ...bySection,
          [deleteKey]: bySection[deleteKey].filter((id) => id !== songId),
        },
      }
    })
    if (!supabase) return
    const client = supabase
    void (async () => {
      const sectionTag = makeGigSectionTag(gigId, normalizedSection)
      const deletedTag = makeGigSectionDeletedTag(gigId, normalizedSection)
      const { error: clearDeletedError } = await client
        .from('SetlistSongTags')
        .delete()
        .eq('song_id', songId)
        .eq('tag', deletedTag)
      reportSupabaseError(clearDeletedError)
      const existingQuery = client
        .from('SetlistSongTags')
        .select('id')
        .eq('song_id', songId)
        .eq('tag', sectionTag)
        .limit(1)
      const existingRes = activeBandId ? await existingQuery.eq('band_id', activeBandId) : await existingQuery
      reportSupabaseError(existingRes.error)
      if ((existingRes.data ?? []).length > 0) return
      const { error: insertError } = await client.from('SetlistSongTags').insert(withBandId({
        id: createId(),
        song_id: songId,
        tag: sectionTag,
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

    commitChange(`Move song to ${normalizedToSection}`, (prev) => ({
      ...prev,
      setlists: prev.setlists.map((setlist) =>
        setlist.id === currentSetlist.id ? { ...setlist, songIds: nextSongIds } : setlist,
      ),
    }))
    const normalizedFromSection = normalizeSetlistSectionLabel(fromSection)
    setGigSongSectionOverrides((prev) => {
      const gigOverrides = prev[currentSetlist.id] ?? {}
      const currentSections = (gigOverrides[songId] ?? [])
        .map(normalizeSetlistSectionLabel)
        .filter(Boolean)
      const withoutSource = normalizedFromSection
        ? currentSections.filter(
            (section) =>
              section.trim().toLowerCase() !== normalizedFromSection.trim().toLowerCase(),
          )
        : currentSections
      const nextSections = Array.from(new Set([...withoutSource, normalizedToSection]))
      return {
        ...prev,
        [currentSetlist.id]: {
          ...gigOverrides,
          [songId]: nextSections,
        },
      }
    })
    if (supabase && normalizedFromSection) {
      runSupabase(
        supabase
          .from('SetlistSongTags')
          .delete()
          .eq('song_id', songId)
          .eq('tag', makeGigSectionTag(currentSetlist.id, normalizedFromSection)),
      )
    }
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
    if (supabase) {
      const client = supabase
      reordered.forEach((request, index) => {
        if (request.origin === 'dj_track') {
          runSupabase(
            client
              .from('SetlistGigDjTracks')
              .update({ sort_order: index })
              .eq('id', request.id),
          )
        }
      })
    }
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
        Object.entries(bySong).map(([songId, sections]) => [
          songId,
          (sections ?? []).map((section) =>
            section.toLowerCase() === normalizedFrom.toLowerCase() ? normalizedTo : section,
          ),
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
    const sectionSongIds = getSectionSongIds(section)
    // Only remove songs from the gig if they do not belong to any other remaining section.
    const remainingSections = orderedSetSections.filter(
      (item) => item.trim().toLowerCase() !== section.trim().toLowerCase(),
    )
    const sectionExclusiveSongIdSet = new Set(
      sectionSongIds.filter((songId) => {
        const song = appState.songs.find((item) => item.id === songId)
        if (!song) return false
        return !remainingSections.some((remainingSection) =>
          songMatchesGigSection(song, remainingSection, currentSetlist.id),
        )
      }),
    )
    if (sectionSongIds.length > 0) {
      commitChange(`Delete ${section} songs`, (prev) => ({
        ...prev,
        setlists: prev.setlists.map((setlist) =>
          setlist.id === currentSetlist.id
            ? {
                ...setlist,
                songIds: setlist.songIds.filter((songId) => !sectionExclusiveSongIdSet.has(songId)),
              }
            : setlist,
        ),
      }))
    }
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
    setGigSongSectionOverrides((prev) => {
      const bySong = prev[currentSetlist.id]
      if (!bySong) return prev
      const nextBySong = { ...bySong }
      Object.entries(bySong).forEach(([songId, assignedSections]) => {
        const remainingSections = (assignedSections ?? []).filter(
          (assignedSection) =>
            assignedSection.trim().toLowerCase() !== section.trim().toLowerCase(),
        )
        if (sectionExclusiveSongIdSet.has(songId) || remainingSections.length === 0) {
          delete nextBySong[songId]
        } else {
          nextBySong[songId] = remainingSections
        }
      })
      return {
        ...prev,
        [currentSetlist.id]: nextBySong,
      }
    })
    if (supabase && sectionSongIds.length > 0) {
      const client = supabase
      const sectionTag = makeGigSectionTag(currentSetlist.id, section)
      sectionSongIds.forEach((songId) => {
        if (sectionExclusiveSongIdSet.has(songId)) {
          runSupabase(
            client
              .from('SetlistGigSongs')
              .delete()
              .eq('gig_id', currentSetlist.id)
              .eq('song_id', songId),
          )
          runSupabase(
            client
              .from('SetlistGigSingerKeys')
              .delete()
              .eq('gig_id', currentSetlist.id)
              .eq('song_id', songId),
          )
        }
        runSupabase(
          client
            .from('SetlistSongTags')
            .delete()
            .eq('song_id', songId)
            .eq('tag', sectionTag),
        )
      })
    }
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
    if (!canCreateMusicians()) return
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
    if (!canCreateMusicians()) return
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
    setNewSongArtist(pendingSpecialArtist.trim())
    setNewSongAudio(pendingSpecialExternalUrl.trim())
    setNewSongOriginalKey(isPendingSpecialDjOnly ? '' : pendingSpecialKey.trim())
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
    if (!canCreateSongs()) return
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
    logger.log('song_added', { songId: id, title: draft.title, artist: draft.artist })
    commitChange('Add song', (prev) => ({
      ...prev,
      songs: [createdSong, ...prev.songs],
      tagsCatalog: Array.from(new Set([...prev.tagsCatalog, ...draft.tags])),
    }))
    if (supabase) {
      runSupabase(
        (async () => {
          const { error: songInsertError } = await supabase.from('SetlistSongs').insert(withBandId({
            id,
            title: draft.title,
            artist: draft.artist || null,
            audio_url: draft.audioUrl || null,
            original_key: draft.originalKey || null,
          }))
          if (songInsertError) return { error: songInsertError }
          if (!draft.tags.length) return { error: null }
          const { error: tagInsertError } = await supabase.from('SetlistSongTags').insert(
            draft.tags.map((tag) => withBandId({
              id: createId(),
              song_id: id,
              tag,
            })),
          )
          return { error: tagInsertError }
        })(),
      )
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
    setPendingSpecialArtist('')
    setPendingSpecialSingers([])
    setPendingSpecialKey('')
    setPendingSpecialNote('')
    setPendingSpecialDjOnly(false)
    setPendingSpecialExternalUrl('')
    setSpecialRequestError('')
    setEditingSpecialRequestId(null)
  }

  const openSpecialRequestEditor = (request: SpecialRequest) => {
    const linkedSong = request.songId
      ? appState.songs.find((song) => song.id === request.songId)
      : null
    setPendingSpecialType(request.type ?? '')
    setPendingSpecialSong(request.songTitle ?? '')
    setPendingSpecialArtist(request.artist ?? linkedSong?.artist ?? '')
    const displayAssignments = getSpecialRequestDisplayAssignments(request)
    setPendingSpecialSingers(request.djOnly ? [] : displayAssignments.singers)
    setPendingSpecialKey(request.djOnly ? '' : displayAssignments.keys[0] ?? '')
    setPendingSpecialNote(request.note ?? '')
    setPendingSpecialDjOnly(Boolean(request.djOnly))
    setPendingSpecialExternalUrl(request.externalAudioUrl ?? '')
    setSpecialRequestError('')
    setEditingSpecialRequestId(request.id)
    setShowSpecialRequestModal(true)
  }
  const deleteSpecialRequest = (requestId: string) => {
    if (!currentSetlist) return
    const targetRequest = appState.specialRequests.find((request) => request.id === requestId)
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
      if (targetRequest?.origin === 'dj_track') {
        runSupabase(supabase.from('SetlistGigDjTracks').delete().eq('id', requestId))
      } else {
        runSupabase(supabase.from('SetlistSpecialRequests').delete().eq('id', requestId))
      }
    }
  }

  const syncSpecialRequestSingerKeys = async (
    gigId: string,
    songId: string | undefined,
    singers: string[],
    keyValue: string,
  ) => {
    if (!supabase || !songId) return { error: null }
    const deleteQuery = supabase
      .from('SetlistGigSingerKeys')
      .delete()
      .eq('gig_id', gigId)
      .eq('song_id', songId)
    const { error: deleteError } = activeBandId
      ? await deleteQuery.eq('band_id', activeBandId)
      : await deleteQuery
    if (deleteError) return { error: deleteError }
    const normalizedSingers = normalizeTagList(singers)
    const normalizedKey = keyValue.trim()
    if (!normalizedSingers.length || !normalizedKey) return { error: null }
    const { error: insertError } = await supabase.from('SetlistGigSingerKeys').insert(
      normalizedSingers.map((singer) => withBandId({
        id: createId(),
        gig_id: gigId,
        song_id: songId,
        singer_name: singer,
        gig_key: normalizedKey,
      })),
    )
    return { error: insertError }
  }

  const updateSpecialRequest = () => {
    if (!currentSetlist || !editingSpecialRequestId) return
    const existingRequest =
      appState.specialRequests.find((request) => request.id === editingSpecialRequestId) ?? null
    setSpecialRequestError('')
    const type = pendingSpecialType.trim()
    const customSong = pendingSpecialSong.trim()
    const shouldPersistAsDjTrack =
      isPendingSpecialDjOnly || isDjRequestType(type) || existingRequest?.origin === 'dj_track'
    const normalizedType = type || (shouldPersistAsDjTrack ? 'DJ Only' : '')
    if (!normalizedType || !customSong) {
      setSpecialRequestError('Request type and song title are required.')
      return
    }
    const matchingSong = appState.songs.find(
      (song) => song.title.trim().toLowerCase() === customSong.toLowerCase(),
    )
    const normalizedSingers = shouldPersistAsDjTrack ? [] : normalizeTagList(pendingSpecialSingers)
    const normalizedKey = shouldPersistAsDjTrack ? '' : pendingSpecialKey.trim()
    const normalizedArtist = pendingSpecialArtist.trim()
    const nextSongId = matchingSong?.id ?? existingRequest?.songId
    const djSongId = shouldPersistAsDjTrack
      ? matchingSong?.id ?? existingRequest?.songId ?? createId()
      : undefined
    commitChange('Update special request', (prev) => ({
      ...prev,
      specialRequests: prev.specialRequests.map((request) =>
        request.id === editingSpecialRequestId
          ? {
              ...request,
              type: normalizedType,
              songTitle: customSong,
              artist: normalizedArtist || undefined,
              songId: shouldPersistAsDjTrack ? djSongId : nextSongId,
              singers: normalizedSingers,
              key: normalizedKey,
              note: pendingSpecialNote.trim() || undefined,
              djOnly: shouldPersistAsDjTrack ? true : isPendingSpecialDjOnly,
              externalAudioUrl: pendingSpecialExternalUrl.trim() || undefined,
              sourceType: shouldPersistAsDjTrack
                ? getDjSourceTypeFromUrl(pendingSpecialExternalUrl)
                : undefined,
              origin: shouldPersistAsDjTrack ? 'dj_track' : 'special_request',
            }
          : request,
      ),
      specialTypes: prev.specialTypes.includes(normalizedType)
        ? prev.specialTypes
        : [...prev.specialTypes, normalizedType],
    }))
    if (supabase) {
      if (shouldPersistAsDjTrack) {
        const orderedRequests = getOrderedSpecialRequests(currentSetlist.id)
        const sortOrder = Math.max(
          0,
          orderedRequests.findIndex((request) => request.id === editingSpecialRequestId),
        )
        runSupabase(
          (async () => {
            if (existingRequest?.origin !== 'dj_track') {
              const { error: deleteSpecialError } = await supabase
                .from('SetlistSpecialRequests')
                .delete()
                .eq('id', editingSpecialRequestId)
              if (deleteSpecialError) return { error: deleteSpecialError }
            }
            const { error: upsertDjError } = await supabase.from('SetlistGigDjTracks').upsert(
              withBandId({
                id: editingSpecialRequestId,
                gig_id: currentSetlist.id,
                sort_order: sortOrder,
                title: customSong,
                artist: normalizedArtist,
                notes: pendingSpecialNote.trim(),
                source_type: getDjSourceTypeFromUrl(pendingSpecialExternalUrl),
                source_url: pendingSpecialExternalUrl.trim(),
                status: 'active',
                metadata: { type: normalizedType, song_id: djSongId },
              }),
              { onConflict: 'id' },
            )
            if (upsertDjError) return { error: upsertDjError }
            if (!djSongId) return { error: null }

            const { error: ensureSongError } = await supabase.from('SetlistSongs').upsert(
              withBandId({
                id: djSongId,
                title: customSong,
                artist: normalizedArtist,
                audio_url: pendingSpecialExternalUrl.trim() || null,
                original_key: null,
                deleted_at: null,
              }),
              { onConflict: 'id' },
            )
            if (ensureSongError) return { error: ensureSongError }

            const djTags = ['Special Request', 'DJ Only']
            const { data: existingTags, error: tagReadError } = await supabase
              .from('SetlistSongTags')
              .select('tag')
              .eq('song_id', djSongId)
              .in('tag', djTags)
            if (tagReadError) return { error: tagReadError }
            const existingTagSet = new Set(
              (existingTags ?? []).map((row) => String(row.tag ?? '').trim().toLowerCase()),
            )
            const missingTags = djTags.filter((tag) => !existingTagSet.has(tag.toLowerCase()))
            if (missingTags.length > 0) {
              const { error: tagInsertError } = await supabase.from('SetlistSongTags').insert(
                missingTags.map((tag) => withBandId({
                  id: createId(),
                  song_id: djSongId,
                  tag,
                })),
              )
              if (tagInsertError) return { error: tagInsertError }
            }
            return { error: null }
          })(),
        )
      } else {
        runSupabase(
          (async () => {
            if (existingRequest?.origin === 'dj_track') {
              const { error: deleteDjError } = await supabase
                .from('SetlistGigDjTracks')
                .delete()
                .eq('id', editingSpecialRequestId)
              if (deleteDjError) return { error: deleteDjError }
            }
            const { error: updateSpecialError } = await updateSpecialRequestRowWithFallback(
              editingSpecialRequestId,
              {
                request_type: normalizedType,
                song_title: customSong,
                song_id: nextSongId ?? null,
                singers: normalizedSingers,
                song_key: normalizedKey || null,
                note: pendingSpecialNote.trim() || null,
                dj_only: isPendingSpecialDjOnly,
                external_audio_url: pendingSpecialExternalUrl.trim() || null,
              },
            )
            if (updateSpecialError) return { error: updateSpecialError }
            if (nextSongId) {
              const { error: upsertSongError } = await supabase.from('SetlistSongs').upsert(
                withBandId({
                  id: nextSongId,
                  title: customSong,
                  artist: normalizedArtist || matchingSong?.artist || existingRequest?.artist || '',
                  audio_url: pendingSpecialExternalUrl.trim() || matchingSong?.youtubeUrl || null,
                  original_key: matchingSong?.originalKey ?? null,
                  deleted_at: null,
                }),
                { onConflict: 'id' },
              )
              if (upsertSongError) return { error: upsertSongError }
            }
            return syncSpecialRequestSingerKeys(
              currentSetlist.id,
              nextSongId ?? existingRequest?.songId,
              normalizedSingers,
              normalizedKey,
            )
          })(),
        )
      }
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
    setSpecialRequestError('')
    const type = pendingSpecialType.trim()
    const customSong = pendingSpecialSong.trim()
    const normalizedArtist = pendingSpecialArtist.trim()
    const shouldPersistAsDjTrack = isPendingSpecialDjOnly || isDjRequestType(type)
    const normalizedType = type || (shouldPersistAsDjTrack ? 'DJ Only' : '')
    const existingSong = appState.songs.find(
      (song) => song.title.toLowerCase() === customSong.toLowerCase(),
    )
    const songTitle = existingSong?.title ?? customSong
    const normalizedSingers = shouldPersistAsDjTrack ? [] : normalizeTagList(pendingSpecialSingers)
    const normalizedKey = shouldPersistAsDjTrack ? '' : pendingSpecialKey.trim()
    if (!normalizedType || !songTitle) {
      setSpecialRequestError('Request type and song title are required.')
      return
    }
    const requestId = createId()
    const createdSongId = existingSong?.id ?? createId()
    if (!shouldPersistAsDjTrack && !existingSong && customSong && !canCreateSongs()) return
    const requestTags = normalizeTagList(
      shouldPersistAsDjTrack ? ['Special Request', 'DJ Only'] : ['Special Request'],
    )
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
                artist: normalizedArtist,
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
            type: normalizedType,
            songTitle,
            artist: normalizedArtist || existingSong?.artist || undefined,
            songId: shouldPersistAsDjTrack ? undefined : createdSongId,
            singers: shouldPersistAsDjTrack ? ['DJ'] : normalizedSingers,
            key: shouldPersistAsDjTrack ? '' : normalizedKey,
            note: pendingSpecialNote.trim() || undefined,
              djOnly: shouldPersistAsDjTrack ? true : isPendingSpecialDjOnly,
            externalAudioUrl: pendingSpecialExternalUrl.trim() || undefined,
            sourceType: shouldPersistAsDjTrack
              ? getDjSourceTypeFromUrl(pendingSpecialExternalUrl)
              : undefined,
            origin: shouldPersistAsDjTrack ? 'dj_track' : 'special_request',
          },
          ...prev.specialRequests,
        ],
        songs: nextSongs,
        specialTypes: prev.specialTypes.includes(normalizedType)
          ? prev.specialTypes
          : [...prev.specialTypes, normalizedType],
      }
    })
    setSpecialRequestOrderByGig((prev) => ({
      ...prev,
      [currentSetlist.id]: [requestId, ...(prev[currentSetlist.id] ?? []).filter((id) => id !== requestId)],
    }))
    resetPendingSpecialRequest()
    setShowSpecialRequestModal(false)
    if (supabase) {
      if (shouldPersistAsDjTrack) {
        runSupabase(
          (async () => {
            const { error: ensureSongError } = await supabase.from('SetlistSongs').upsert(
              withBandId({
                id: createdSongId,
                title: songTitle,
                artist: normalizedArtist,
                audio_url: pendingSpecialExternalUrl.trim() || null,
                original_key: null,
                deleted_at: null,
              }),
              { onConflict: 'id' },
            )
            if (ensureSongError) return { error: ensureSongError }

            const djTags = ['Special Request', 'DJ Only']
            const { data: existingTags, error: tagReadError } = await supabase
              .from('SetlistSongTags')
              .select('tag')
              .eq('song_id', createdSongId)
              .in('tag', djTags)
            if (tagReadError) return { error: tagReadError }
            const existingTagSet = new Set(
              (existingTags ?? []).map((row) => String(row.tag ?? '').trim().toLowerCase()),
            )
            const missingTags = djTags.filter((tag) => !existingTagSet.has(tag.toLowerCase()))
            if (missingTags.length > 0) {
              const { error: tagInsertError } = await supabase.from('SetlistSongTags').insert(
                missingTags.map((tag) => withBandId({
                  id: createId(),
                  song_id: createdSongId,
                  tag,
                })),
              )
              if (tagInsertError) return { error: tagInsertError }
            }

            const { error: djInsertError } = await supabase.from('SetlistGigDjTracks').insert(
              withBandId({
                id: requestId,
                gig_id: currentSetlist.id,
                sort_order: getOrderedSpecialRequests(currentSetlist.id).length,
                title: songTitle,
                artist: normalizedArtist,
                notes: pendingSpecialNote.trim(),
                source_type: getDjSourceTypeFromUrl(pendingSpecialExternalUrl),
                source_url: pendingSpecialExternalUrl.trim(),
                status: 'active',
                metadata: { type: normalizedType, song_id: createdSongId },
              }),
            )
            return { error: djInsertError }
          })(),
        )
        return
      }
      runSupabase(
        (async () => {
          // Ensure the referenced song row exists in Supabase before inserting special request.
          // This protects against legacy local-only songs causing FK failures.
          const { error: ensureSongError } = await supabase.from('SetlistSongs').upsert(
            withBandId({
              id: createdSongId,
              title: songTitle,
              artist: normalizedArtist || existingSong?.artist || '',
              audio_url: pendingSpecialExternalUrl.trim() || existingSong?.youtubeUrl || null,
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

          const { error: requestInsertError } = await insertSpecialRequestRowWithFallback({
            id: requestId,
            gig_id: currentSetlist.id,
            request_type: normalizedType,
            song_title: songTitle,
            song_id: createdSongId,
            singers: normalizedSingers,
            song_key: normalizedKey || null,
            note: pendingSpecialNote.trim() || null,
            dj_only: isPendingSpecialDjOnly,
            external_audio_url: pendingSpecialExternalUrl.trim() || null,
          })
          if (requestInsertError) return { error: requestInsertError }
          return syncSpecialRequestSingerKeys(
            currentSetlist.id,
            createdSongId,
            normalizedSingers,
            normalizedKey,
          )
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
  const getDjSourceTypeFromUrl = (
    url: string,
  ): 'spotify_playlist' | 'spotify_track' | 'youtube' | 'apple_music' | 'external' => {
    const normalized = url.trim().toLowerCase()
    if (!normalized) return 'external'
    if (normalized.includes('spotify.com/playlist')) return 'spotify_playlist'
    if (normalized.includes('spotify.com/track')) return 'spotify_track'
    if (
      normalized.includes('youtube.com') ||
      normalized.includes('youtu.be') ||
      normalized.includes('music.youtube.com')
    ) {
      return 'youtube'
    }
    if (normalized.includes('music.apple.com')) return 'apple_music'
    return 'external'
  }

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
  const hasSharedLyricsForSong = useCallback(
    (songId?: string) => {
      if (!songId) return false
      return getSharedDocumentSelectionItems(songId).some((doc) => doc.type === 'Lyrics')
    },
    [getSharedDocumentSelectionItems],
  )
  const hasSharedChartsForSong = useCallback(
    (songId?: string) => {
      if (!songId) return false
      return getSharedDocumentSelectionItems(songId).some(
        (doc) => doc.type === 'Chart' || doc.type === 'Lead Sheet',
      )
    },
    [getSharedDocumentSelectionItems],
  )
  const openSharedLyricsForSong = useCallback(
    (songId?: string) => {
      if (!songId) return
      const lyricsDoc = getSharedDocumentSelectionItems(songId).find((doc) => doc.type === 'Lyrics')
      if (!lyricsDoc) return
      setShowInstrumentPrompt(false)
      setPendingDocSongId(null)
      setDocModalSongId(songId)
      setDocModalPageIndex(0)
      setDocModalContent(lyricsDoc)
    },
    [getSharedDocumentSelectionItems],
  )
  const openSharedDocsForSong = useCallback(
    (songId?: string) => {
      if (!songId) return
      const matchingDocs = getSharedDocumentSelectionItems(songId)
      if (matchingDocs.length === 0) return
      setShowInstrumentPrompt(false)
      setPendingDocSongId(null)
      setDocModalSongId(songId)
      setDocModalPageIndex(0)
      setDocModalContent(null)
    },
    [getSharedDocumentSelectionItems],
  )

  const createId = () => crypto.randomUUID()
  const getSchemaCacheMissingColumn = (message?: string | null) => {
    if (!message) return null
    const match = message.match(/Could not find the '([^']+)' column/i)
    return match?.[1] ?? null
  }
  const updateSpecialRequestRowWithFallback = async (
    requestId: string,
    payload: Record<string, unknown>,
  ) => {
    if (!supabase) return { error: null as { message?: string } | null }
    let nextPayload = { ...payload }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { error } = await supabase
        .from('SetlistSpecialRequests')
        .update(withBandId(nextPayload))
        .eq('id', requestId)
      if (!error) return { error: null as { message?: string } | null }
      const missingColumn = getSchemaCacheMissingColumn(error.message)
      if (!missingColumn || !(missingColumn in nextPayload)) return { error }
      const { [missingColumn]: _removed, ...rest } = nextPayload
      nextPayload = rest
      if (Object.keys(nextPayload).length === 0) return { error }
    }
    return { error: { message: 'SetlistSpecialRequests update failed after schema fallback retries.' } }
  }
  const insertSpecialRequestRowWithFallback = async (payload: Record<string, unknown>) => {
    if (!supabase) return { error: null as { message?: string } | null }
    let nextPayload = { ...payload }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { error } = await supabase
        .from('SetlistSpecialRequests')
        .insert(withBandId(nextPayload))
      if (!error) return { error: null as { message?: string } | null }
      const missingColumn = getSchemaCacheMissingColumn(error.message)
      if (!missingColumn || !(missingColumn in nextPayload)) return { error }
      const { [missingColumn]: _removed, ...rest } = nextPayload
      nextPayload = rest
      if (Object.keys(nextPayload).length === 0) return { error }
    }
    return { error: { message: 'SetlistSpecialRequests insert failed after schema fallback retries.' } }
  }
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
      djTracksRes,
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
      supabase.from('SetlistGigDjTracks').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistDocuments').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistMusicians').select('*').eq('band_id', activeBandId).is('deleted_at', null),
      supabase.from('SetlistGigMusicians').select('*').eq('band_id', activeBandId),
      supabase.from('SetlistGigNowPlaying').select('*').eq('band_id', activeBandId),
    ])

    const canIgnoreDjTracksError = Boolean(
      djTracksRes.error &&
      /SetlistGigDjTracks|does not exist|schema cache/i.test(djTracksRes.error.message ?? ''),
    )
    const firstError =
      songsRes.error ||
      tagsRes.error ||
      keysRes.error ||
      gigsRes.error ||
      gigSongsRes.error ||
      gigSingerKeysRes.error ||
      specialReqRes.error ||
      (canIgnoreDjTracksError ? null : djTracksRes.error) ||
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
    const djTrackTypes = (djTracksRes.data ?? [])
      .map((row) => {
        const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : null
        const value = metadata && typeof metadata.type === 'string' ? metadata.type.trim() : ''
        return value
      })
      .filter(Boolean)
    const specialTypes = Array.from(
      new Set([
        ...DEFAULT_SPECIAL_TYPES,
        ...(specialReqRes.data ?? []).map((r) => r.request_type),
        ...djTrackTypes,
        ...((djTracksRes.data ?? []).length ? ['DJ Only'] : []),
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
      if (identity === 'djonly') return false
      if (reservedSetlistTagIdentities.has(identity)) return false
      return specialTypeIdentities.has(identity)
    }

    const tagsBySong = new Map<string, string[]>()
    const gigSectionOverrideMap = new Map<string, Record<string, string[]>>()
    const gigDeletedSectionSongMap = new Map<string, Record<string, string[]>>()
    tagsRes.data?.forEach((row) => {
      const deletedSectionTag = parseGigSectionDeletedTag(row.tag)
      if (deletedSectionTag) {
        const bySection = gigDeletedSectionSongMap.get(deletedSectionTag.gigId) ?? {}
        const key = getSectionDeleteKey(deletedSectionTag.section)
        bySection[key] = Array.from(new Set([...(bySection[key] ?? []), row.song_id]))
        gigDeletedSectionSongMap.set(deletedSectionTag.gigId, bySection)
        return
      }
      const gigSectionTag = parseGigSectionTag(row.tag)
      if (gigSectionTag) {
        const bySong = gigSectionOverrideMap.get(gigSectionTag.gigId) ?? {}
        const existingSections = bySong[row.song_id] ?? []
        const normalizedSection = normalizeSetlistSectionLabel(gigSectionTag.section)
        if (normalizedSection) {
          bySong[row.song_id] = Array.from(new Set([...existingSections, normalizedSection]))
        }
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

    gigSingerKeysRes.data?.forEach((row) => {
      const list = keysBySong.get(row.song_id) ?? []
      const hasSinger = list.some(
        (entry) => entry.singer.trim().toLowerCase() === row.singer_name.trim().toLowerCase(),
      )
      if (!hasSinger) {
        list.push({
          singer: row.singer_name,
          defaultKey: '',
          gigOverrides: {},
        })
        keysBySong.set(row.song_id, list)
      }
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
    const gigSongSortOrderMaxByGig = new Map<string, number>()
    ;[...(gigSongsRes.data ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .forEach((row) => {
      if (!songIdSet.has(row.song_id)) return
      const list = gigSongsByGig.get(row.gig_id) ?? []
      list.push(row.song_id)
      gigSongsByGig.set(row.gig_id, list)
      const currentMax = gigSongSortOrderMaxByGig.get(row.gig_id) ?? -1
      const rowSortOrder = row.sort_order ?? 0
      if (rowSortOrder > currentMax) {
        gigSongSortOrderMaxByGig.set(row.gig_id, rowSortOrder)
      }
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
    const validGigIdSet = new Set((gigsRes.data ?? []).map((row) => row.id))
    // Recovery path: if songs have explicit gig-section assignments but lost gig-song rows,
    // restore membership so section playlists stay intact.
    const recoveredGigSongRows: Array<{
      id: string
      gig_id: string
      song_id: string
      sort_order: number
    }> = []
    gigSectionOverrideMap.forEach((bySong, gigId) => {
      if (!validGigIdSet.has(gigId)) return
      Object.entries(bySong).forEach(([songId, assignedSections]) => {
        if (!songIdSet.has(songId)) return
        if (!assignedSections?.length) return
        const list = gigSongsByGig.get(gigId) ?? []
        if (list.includes(songId)) return
        list.push(songId)
        gigSongsByGig.set(gigId, list)
        const nextSortOrder = (gigSongSortOrderMaxByGig.get(gigId) ?? list.length - 2) + 1
        gigSongSortOrderMaxByGig.set(gigId, nextSortOrder)
        recoveredGigSongRows.push({
          id: createId(),
          gig_id: gigId,
          song_id: songId,
          sort_order: nextSortOrder,
        })
      })
    })
    if (recoveredGigSongRows.length > 0) {
      const { error: recoveredGigSongsError } = await supabase
        .from('SetlistGigSongs')
        .insert(recoveredGigSongRows.map((row) => withBandId(row)))
      reportSupabaseError(recoveredGigSongsError)
    }

    const setlists: Setlist[] =
      gigsRes.data?.map((row) => ({
        id: row.id,
        gigName: row.gig_name,
        date: typeof row.gig_date === 'string' ? row.gig_date.slice(0, 10) : '',
        songIds: gigSongsByGig.get(row.id) ?? [],
        venueAddress: row.venue_address ?? '',
      })) ?? []

    // One-time compatibility backfill:
    // Legacy gigs sometimes used Dance/Dinner/Latin tags to imply set membership.
    // Now that tags are reference-only, convert those legacy hints into explicit
    // per-gig section assignments so past gigs render consistently.
    const songsByIdForBackfill = new Map(songs.map((song) => [song.id, song]))
    const existingGigSectionTags = new Set(
      (tagsRes.data ?? [])
        .map((row) => `${row.song_id}::${row.tag}`)
        .filter((value) => value.includes(`${GIG_SECTION_TAG_PREFIX}`)),
    )
    const backfillSectionRows: Array<{ id: string; song_id: string; tag: string }> = []
    const ensureKnownLegacySection = (
      knownSections: Map<string, string>,
      family: 'dance' | 'dinner' | 'latin',
      rawTag: string,
    ) => {
      const normalized = normalizeSetlistSectionLabel(rawTag)
      if (!normalized) return
      const normalizedLower = normalized.toLowerCase()
      if (!new RegExp(`^${family}(?:\\s+set\\s+\\d+)?$`, 'i').test(normalized)) return
      if (!knownSections.has(normalizedLower)) {
        knownSections.set(normalizedLower, normalized)
      }
    }
    setlists.forEach((setlist) => {
      const existingBySong = gigSectionOverrideMap.get(setlist.id) ?? {}
      const knownSections = new Map<string, string>()
      Object.values(existingBySong).forEach((sections) => {
        sections.forEach((section) => {
          const normalized = normalizeSetlistSectionLabel(section)
          if (!normalized) return
          knownSections.set(normalized.toLowerCase(), normalized)
        })
      })
      setlist.songIds.forEach((songId) => {
        const song = songsByIdForBackfill.get(songId)
        if (!song) return
        song.tags.forEach((tag) => {
          ensureKnownLegacySection(knownSections, 'dance', tag)
          ensureKnownLegacySection(knownSections, 'dinner', tag)
          ensureKnownLegacySection(knownSections, 'latin', tag)
        })
      })

      setlist.songIds.forEach((songId) => {
        if ((existingBySong[songId] ?? []).length > 0) return
        const song = songsByIdForBackfill.get(songId)
        if (!song) return
        const inferredSections: string[] = []
        const tagSet = new Set(song.tags.map((tag) => normalizeSetlistSectionLabel(tag).toLowerCase()))
        const addInferred = (section: string) => {
          const normalized = normalizeSetlistSectionLabel(section)
          if (!normalized) return
          if (inferredSections.some((value) => value.toLowerCase() === normalized.toLowerCase())) return
          inferredSections.push(normalized)
        }
        const inferFamily = (family: 'dance' | 'dinner' | 'latin') => {
          let matchedSpecific = false
          tagSet.forEach((tagLower) => {
            const match = tagLower.match(new RegExp(`^${family}\\s+set\\s+\\d+$`, 'i'))
            if (!match) return
            matchedSpecific = true
            const known = knownSections.get(tagLower)
            addInferred(known ?? normalizeSetlistSectionLabel(tagLower))
          })
          if (matchedSpecific) return
          if (!tagSet.has(family)) return
          const preferredSet1 = knownSections.get(`${family} set 1`)
          const preferredBase = knownSections.get(family)
          addInferred(preferredSet1 ?? preferredBase ?? family.charAt(0).toUpperCase() + family.slice(1))
        }
        inferFamily('dance')
        inferFamily('dinner')
        inferFamily('latin')
        if (inferredSections.length === 0) return
        existingBySong[songId] = inferredSections
        inferredSections.forEach((section) => {
          const sectionTag = makeGigSectionTag(setlist.id, section)
          const dedupeKey = `${songId}::${sectionTag}`
          if (existingGigSectionTags.has(dedupeKey)) return
          existingGigSectionTags.add(dedupeKey)
          backfillSectionRows.push({
            id: createId(),
            song_id: songId,
            tag: sectionTag,
          })
        })
      })
      gigSectionOverrideMap.set(setlist.id, existingBySong)
    })

    const songsById = new Map(songs.map((song) => [song.id, song]))
    const specialRequestsFromLegacy: SpecialRequest[] =
      [...(specialReqRes.data ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((row) => {
        const linkedSong = row.song_id ? songsById.get(row.song_id) : undefined
        const savedAssignments = linkedSong
          ? linkedSong.keys
              .map((key) => ({
                singer: key.singer,
                key: key.gigOverrides[row.gig_id] ?? '',
              }))
              .filter((entry) => entry.key)
          : []
        const savedSingers = normalizeTagList(savedAssignments.map((entry) => entry.singer))
        const savedKeys = normalizeTagList(savedAssignments.map((entry) => entry.key))
        const rowSingers = normalizeTagList(row.singers ?? [])
        const rowKey = (row.song_key ?? '').trim()
        return {
          id: row.id,
          gigId: row.gig_id,
          type: row.request_type,
          songTitle: row.song_title,
          artist: linkedSong?.artist ?? undefined,
          songId: row.song_id ?? undefined,
          singers: rowSingers.length ? rowSingers : savedSingers,
          key: rowKey || savedKeys[0] || '',
          note: row.note ?? undefined,
          djOnly: row.dj_only ?? false,
          externalAudioUrl: row.external_audio_url ?? undefined,
          origin: 'special_request',
        }
      })
    const djTracksAsRequests: SpecialRequest[] = (djTracksRes.data ?? [])
      .filter((row) => row.status !== 'archived')
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((row) => {
        const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : null
        const customType = metadata && typeof metadata.type === 'string' ? metadata.type.trim() : ''
        const metadataSongId =
          metadata && typeof metadata.song_id === 'string' ? metadata.song_id.trim() : ''
        const linkedSong = metadataSongId ? songsById.get(metadataSongId) : undefined
        return {
          id: row.id,
          gigId: row.gig_id,
          type: customType || 'DJ Only',
          songTitle: row.title || linkedSong?.title || 'DJ Track',
          artist: row.artist ?? linkedSong?.artist ?? undefined,
          songId: metadataSongId || undefined,
          singers: ['DJ'],
          key: '',
          note: row.notes ?? undefined,
          djOnly: true,
          externalAudioUrl: row.source_url ?? undefined,
          sourceType: row.source_type ?? 'external',
          origin: 'dj_track' as const,
        }
      })
    const specialRequests: SpecialRequest[] = [...specialRequestsFromLegacy, ...djTracksAsRequests]
    const specialOrderFromSupabase = specialRequests.reduce<Record<string, string[]>>((acc, request) => {
      const list = acc[request.gigId] ?? []
      list.push(request.id)
      acc[request.gigId] = list
      return acc
    }, {})

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
        ...(tagsRes.data ?? [])
          .map((t) => t.tag)
          .filter(
            (tag) =>
              !tag.startsWith(GIG_SECTION_TAG_PREFIX) &&
              !tag.startsWith(GIG_SECTION_DELETED_TAG_PREFIX),
          ),
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
      Array.from(gigSectionOverrideMap.entries()).reduce<Record<string, Record<string, string[]>>>(
        (acc, [gigId, bySong]) => {
          acc[gigId] = bySong
          return acc
        },
        {},
      ),
    )
    setGigDeletedSectionSongs(
      Array.from(gigDeletedSectionSongMap.entries()).reduce<Record<string, Record<string, string[]>>>(
        (acc, [gigId, bySection]) => {
          acc[gigId] = bySection
          return acc
        },
        {},
      ),
    )
    setSpecialRequestOrderByGig(specialOrderFromSupabase)

    if (backfillSectionRows.length > 0 && supabase && activeBandId) {
      void supabase.from('SetlistSongTags').insert(backfillSectionRows.map((row) => withBandId(row)))
    }

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
  }, [
    activeBandId,
    getSectionDeleteKey,
    normalizeInstrumentName,
    parseDocumentInstruments,
    parseGigSectionDeletedTag,
    parseGigSectionTag,
  ])

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
    if (!canCreateSongs()) return
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

  const installAppLabel = sharedPlaylistView
    ? `Install ${formatGigDate(sharedPlaylistView.date) || 'Gig'}`
    : 'Install App'

  const handlePrintSetlistPDF = () => {
    if (!currentSetlist) return
    window.requestAnimationFrame(() => {
      window.print()
    })
  }

  const handleDownloadOfflineGig = () => {
    if (!currentSetlist) return
    const escapeHtml = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    const escapeScriptJson = (value: unknown) =>
      JSON.stringify(value, null, 2).replace(/</g, '\\u003c')
    const safeFilename = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'setlist'
    const gigMusicians = appState.gigMusicians
      .filter((row) => row.gigId === currentSetlist.id)
      .map((row) => appState.musicians.find((musician) => musician.id === row.musicianId))
      .filter((musician): musician is Musician => Boolean(musician))
      .sort((a, b) => a.name.localeCompare(b.name))
    const gigSongs = currentSetlist.songIds
      .map((songId) => appState.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
    const sectionPayload = orderedSetSections.map((section) => ({
      section,
      songs: gigSongs
        .filter((song) => {
          const overrideSection = getGigSongSectionOverride(currentSetlist.id, song.id)
          if (overrideSection) return overrideSection.trim().toLowerCase() === section.trim().toLowerCase()
          return hasSongTag(song, section)
        })
        .map((song) => {
          const assignments = getGigSingerAssignments(song.id, currentSetlist.id)
          return {
            id: song.id,
            title: song.title,
            artist: song.artist,
            audioUrl: song.youtubeUrl,
            originalKey: song.originalKey,
            singers: assignments.map((entry) => entry.singer),
            keys: Array.from(new Set(assignments.map((entry) => entry.key).filter(Boolean))),
            documents: appState.documents
              .filter((doc) => doc.songId === song.id)
              .map((doc) => ({
                type: doc.type,
                title: doc.title,
                instrument: doc.instrument,
                url: doc.url,
                content: doc.content,
              })),
          }
        }),
    }))
    const specialRequests = getOrderedSpecialRequests(currentSetlist.id).map((request) => {
      const displayAssignments = getSpecialRequestDisplayAssignments(request)
      return {
        type: request.type,
        title: request.songTitle,
        artist: request.artist,
        key: request.djOnly ? '' : displayAssignments.keys.join(', '),
        singers: displayAssignments.singers,
        note: request.note,
        djOnly: request.djOnly,
        audioUrl: request.externalAudioUrl,
      }
    })
    const payload = {
      exportedAt: new Date().toISOString(),
      bandName: activeBandName,
      gig: {
        id: currentSetlist.id,
        name: currentSetlist.gigName,
        date: currentSetlist.date,
        venueAddress: currentSetlist.venueAddress,
      },
      musicians: gigMusicians,
      specialRequests,
      sections: sectionPayload,
    }
    const musicianHtml = gigMusicians.length
      ? gigMusicians
          .map(
            (musician) => `
              <li>
                <strong>${escapeHtml(musician.name)}</strong>
                <span>${escapeHtml((musician.instruments ?? []).join(', ') || 'Musician')}</span>
              </li>`,
          )
          .join('')
      : '<li><strong>No musicians assigned</strong><span></span></li>'
    const specialHtml = specialRequests.length
      ? `<section class="card special"><h2>Special Requests</h2><div class="grid">${specialRequests
          .map(
            (request) => `
              <article class="song">
                <div>
                  <h3>${escapeHtml(request.title)}</h3>
                  <p>${escapeHtml([request.artist, request.type].filter(Boolean).join(' · '))}</p>
                  ${request.note ? `<p class="note">${escapeHtml(request.note)}</p>` : ''}
                </div>
                <div class="meta">
                  <strong>${escapeHtml(request.djOnly ? 'DJ' : request.singers.join(', ') || 'No singers')}</strong>
                  <span>${escapeHtml(request.djOnly ? 'DJ Only' : request.key || 'No key')}</span>
                </div>
              </article>`,
          )
          .join('')}</div></section>`
      : ''
    const sectionsHtml = sectionPayload
      .filter((section) => section.songs.length > 0)
      .map(
        (section) => `
          <section class="card">
            <h2>${escapeHtml(section.section)}</h2>
            <div class="grid">
              ${section.songs
                .map(
                  (song) => `
                    <article class="song">
                      <div>
                        <h3>${escapeHtml(song.title)}</h3>
                        <p>${escapeHtml(song.artist || 'Unknown artist')}</p>
                        ${
                          song.documents.length
                            ? `<p class="note">${escapeHtml(
                                `${song.documents.length} saved document${song.documents.length === 1 ? '' : 's'}`,
                              )}</p>`
                            : ''
                        }
                      </div>
                      <div class="meta">
                        <strong>${escapeHtml(song.singers.join(', ') || 'No singers')}</strong>
                        <span>${escapeHtml(song.keys.length ? `Key: ${song.keys.join(', ')}` : song.originalKey ? `Original: ${song.originalKey}` : 'No key')}</span>
                      </div>
                    </article>`,
                )
                .join('')}
            </div>
          </section>`,
      )
      .join('')
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(activeBandName || 'Setlist')} · ${escapeHtml(currentSetlist.gigName)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #020617; color: #f8fafc; }
    body { margin: 0; background: #020617; }
    main { max-width: 920px; margin: 0 auto; padding: 24px 16px 48px; }
    header { padding: 18px 0 22px; border-bottom: 1px solid rgba(148,163,184,.22); }
    .eyebrow { margin: 0 0 6px; color: #5eead4; font-size: 11px; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(28px, 8vw, 54px); line-height: .95; }
    .details { margin: 12px 0 0; color: #cbd5e1; }
    .card { margin-top: 16px; border: 1px solid rgba(148,163,184,.22); border-radius: 18px; background: rgba(15,23,42,.82); padding: 16px; }
    h2 { margin: 0 0 12px; font-size: 17px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    li, .song { border: 1px solid rgba(148,163,184,.16); border-radius: 14px; background: rgba(2,6,23,.52); padding: 11px 12px; }
    li { display: flex; justify-content: space-between; gap: 12px; }
    li span, p, .meta span { color: #94a3b8; }
    .grid { display: grid; gap: 8px; }
    .song { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
    .song h3 { margin: 0 0 3px; font-size: 15px; }
    .song p { margin: 0; font-size: 12px; }
    .note { margin-top: 7px !important; color: #bae6fd; }
    .meta { min-width: 120px; text-align: right; font-size: 12px; }
    .meta strong, .meta span { display: block; }
    .special { border-color: rgba(251,191,36,.28); }
    footer { margin-top: 18px; color: #64748b; font-size: 11px; }
    @media (max-width: 640px) { main { padding-inline: 12px; } .song { grid-template-columns: 1fr; } .meta { text-align: left; } li { display: block; } li span { display: block; margin-top: 2px; } }
    @media print { body { background: #fff; color: #111827; } main { max-width: none; padding: 0; } .card, li, .song { border-color: #d1d5db; background: #fff; } p, li span, .meta span, footer { color: #4b5563; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">${escapeHtml(activeBandName || 'Setlist Connect')}</p>
      <h1>${escapeHtml(currentSetlist.gigName)}</h1>
      <p class="details">${escapeHtml([formatGigDate(currentSetlist.date), currentSetlist.venueAddress].filter(Boolean).join(' · '))}</p>
    </header>
    <section class="card"><h2>Musicians</h2><ul>${musicianHtml}</ul></section>
    ${specialHtml}
    ${sectionsHtml}
    <footer>Saved from Setlist Connect on ${escapeHtml(new Date().toLocaleString())}. This file works offline. Full structured data is embedded at the bottom of the file.</footer>
    <script type="application/json" id="setlist-connect-data">${escapeScriptJson(payload)}</script>
  </main>
</body>
</html>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFilename(activeBandName || 'band')}_${safeFilename(currentSetlist.gigName)}_${safeFilename(currentSetlist.date || 'date')}_offline.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    setOfflineExportStatus('Offline copy saved.')
  }

  const getPrintableSetlistElement = () => {
    const preview = document.getElementById('printable-setlist-preview')
    return preview instanceof HTMLElement ? preview : null
  }

  const handleDownloadPDF = async () => {
    if (!currentSetlist || pdfDownloadLoading) return
    const element = getPrintableSetlistElement()
    if (!element) {
      setSupabaseError('Unable to generate PDF preview. Please reopen the preview and try again.')
      return
    }
    const safeBand = (activeBandName || 'band').replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const safeGig = currentSetlist.gigName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const safeDate = (currentSetlist.date || '').replace(/[^0-9-]/g, '')
    const exportName = `${safeBand}_${safeGig}_${safeDate || 'date'}_setlist.pdf`
    const pdfWindow = window.open('', '_blank')
    pdfWindow?.document.write(
      '<!doctype html><title>Preparing PDF</title><body style="font-family: system-ui; padding: 24px;">Preparing setlist PDF...</body>',
    )
    setPdfDownloadLoading(true)
    setPdfDownloadStatus('Preparing PDF...')
    setSupabaseError(null)
    try {
      const html2pdf = (await import('html2pdf.js')).default
      const pdfOptions = {
        margin: 0.2,
        filename: exportName,
        enableLinks: true,
        image: { type: 'png', quality: 1 },
        pagebreak: {
          mode: ['avoid-all', 'css', 'legacy'],
          avoid: [
            '.print-section-box',
            '.print-row',
            '.print-card',
            '.print-section-title',
            '.print-row-note',
          ],
        },
        html2canvas: {
          scale: 2,
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
      const pdfBlob = (await html2pdf()
        .set(pdfOptions as unknown as Record<string, unknown>)
        .from(element)
        .outputPdf('blob')) as Blob
      const pdfUrl = URL.createObjectURL(pdfBlob)
      const downloadLink = document.createElement('a')
      downloadLink.href = pdfUrl
      downloadLink.download = exportName
      document.body.appendChild(downloadLink)
      downloadLink.click()
      downloadLink.remove()
      if (pdfWindow) {
        pdfWindow.location.href = pdfUrl
      }
      setPdfDownloadStatus('PDF ready. If it did not save automatically, use Print and choose Save as PDF.')
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000)
    } catch (error) {
      console.error('PDF download failed:', error)
      pdfWindow?.close()
      setPdfDownloadStatus('Opening Print. Choose Save as PDF.')
      setSupabaseError('Download failed. Opening Print instead; choose "Save as PDF".')
      window.requestAnimationFrame(() => {
        window.print()
      })
    } finally {
      setPdfDownloadLoading(false)
    }
  }

  const screenHeader = (
    <div className="fixed top-0 left-0 right-0 z-[70]">
      <header className="border-b border-white/10 bg-slate-950/90 backdrop-blur-md">
        <div className="relative mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-3 rounded-xl transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
            aria-label="Refresh Setlist Connect"
            title="Refresh app"
          >
            <img
              src={setlistConnectLogo}
              alt="Setlist Connect logo"
              className="h-10 w-10 rounded-xl object-contain"
            />
            <div className="text-left">
              <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
                Setlist Connect
              </p>
              <h1 className="text-lg font-semibold text-white">Gig Center</h1>
            </div>
          </button>
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
                {installAppLabel}
              </button>
            )}
            {role && (
              <>
                {activeBandTier === 'pro' && (
                  <span className="rounded-full border border-emerald-300/45 bg-emerald-400/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-100">
                    Pro
                  </span>
                )}
                {authUserEmail && <span className="hidden sm:inline">{authUserEmail}</span>}
                {screen === 'builder' && (
                  <button
                    className={`liquid-button whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold ${
                      gigMode
                        ? 'bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-300 text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.45)]'
                        : 'bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 text-slate-950 shadow-[0_0_18px_rgba(74,222,128,0.45)]'
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
              </>
            )}
          </div>
        </div>
      </header>
      {appState.currentSongId && appState.currentSongId !== dismissedUpNextId && (
        <div
          ref={adminUpNextBannerRef}
          role="button"
          tabIndex={0}
          className="liquid-button upnext-flash w-full cursor-pointer border-y border-emerald-300/45 bg-black text-emerald-100 shadow-[0_0_18px_rgba(74,222,128,0.45)]"
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
            if (Math.abs(endX - bannerTouchStartX) > 60) {
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
              <div className="pointer-events-none inline-flex items-center gap-1 rounded-full border border-emerald-300/35 bg-emerald-400/15 px-3 py-2 text-xs text-emerald-100">
                <span className="text-base">↔</span>
                <span>Swipe</span>
              </div>
              <button
                className="relative z-10 inline-flex min-h-[44px] items-center rounded-full border border-emerald-300/35 bg-emerald-400/15 px-4 py-2 text-sm text-emerald-100"
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
                  className="relative z-10 inline-flex min-h-[44px] items-center rounded-full border border-emerald-300/35 bg-emerald-400/15 px-4 py-2 text-sm text-emerald-100"
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

  const hasTodayGig = visibleSetlists.some(
    (setlist) => normalizeGigDateISO(setlist.date) === operationalTodayISO,
  )
  const compareGigsByDateAsc = (a: Setlist, b: Setlist) => {
    const dateA = normalizeGigDateISO(a.date)
    const dateB = normalizeGigDateISO(b.date)
    if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB)
    if (dateA && !dateB) return -1
    if (!dateA && dateB) return 1
    return a.gigName.localeCompare(b.gigName)
  }
  const upcomingGigs = visibleSetlists
    .filter((setlist) => {
      const gigDate = normalizeGigDateISO(setlist.date)
      return gigDate ? gigDate >= operationalTodayISO : true
    })
    .sort(compareGigsByDateAsc)
  const pastGigs = visibleSetlists
    .filter((setlist) => {
      const gigDate = normalizeGigDateISO(setlist.date)
      return gigDate ? gigDate < operationalTodayISO : false
    })
    .sort((a, b) => compareGigsByDateAsc(b, a))

  const SESSION_WARNING_MS = SESSION_TIMEOUT_MS - 5 * 60 * 1000 // warn 5 min before expiry
  const [showSessionExpiryWarning, setShowSessionExpiryWarning] = useState(false)

  useEffect(() => {
    if (!role) return
    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
      setShowSessionExpiryWarning(false)
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((event) => window.addEventListener(event, updateActivity))

    const interval = window.setInterval(() => {
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) ?? 0)
      const elapsed = Date.now() - lastActive
      if (elapsed > SESSION_TIMEOUT_MS) {
        logger.log('session_expired')
        logger.clearContext()
        setRole(null)
        setShowSessionExpiryWarning(false)
      } else if (elapsed > SESSION_WARNING_MS) {
        setShowSessionExpiryWarning(true)
      }
    }, 30_000)

    return () => {
      events.forEach((event) => window.removeEventListener(event, updateActivity))
      window.clearInterval(interval)
    }
  }, [role, SESSION_WARNING_MS])

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
    if (isAdmin) return
    if (visibleSetlists.length === 0) {
      setSelectedSetlistId('')
      setActiveGigId('')
      return
    }
    if (!visibleSetlists.some((setlist) => setlist.id === selectedSetlistId)) {
      const nextGigId = visibleSetlists[0]?.id ?? ''
      setSelectedSetlistId(nextGigId)
      setActiveGigId(nextGigId)
    }
  }, [isAdmin, selectedSetlistId, visibleSetlists])

  useEffect(() => {
    if (!activeBandId) return
    localStorage.setItem(ACTIVE_BAND_KEY, activeBandId)
    const membership = getPreferredMembership(memberships, activeBandId)
    setRole(isAdminMembershipRole(membership?.role) ? 'admin' : membership ? 'user' : null)
  }, [activeBandId, memberships])

  useEffect(() => {
    if (!authUserId) return
    if (!isMainNavScreen(screen)) return
    localStorage.setItem(LAST_MAIN_SCREEN_KEY, screen)
    logger.log('screen_viewed', { screen })
  }, [authUserId, screen])

  useEffect(() => {
    if (isAdmin || !role) return
    if (screen === 'song' || screen === 'musicians' || screen === 'builder') {
      setScreen('setlists')
    }
  }, [isAdmin, role, screen])

  useEffect(() => {
    setAccountBandNameDraft(activeBandName)
  }, [activeBandName])

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
        setShowCreateBandOnboarding(false)
        setBandContextLoading(false)
        setLoginPhase('login')
        return
      }
      setBandContextLoading(true)
      setLoginPhase('app')
      const bandCount = await loadBandContext(user.id)
      // Ignore stale async completions when another auth event has fired.
      if (cancelled || token !== syncToken) return
      setBandContextLoading(false)
      if (bandCount > 0) {
        setShowCreateBandOnboarding(false)
      } else {
        setShowCreateBandOnboarding(true)
      }
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      void syncAuthState(data.session?.user ?? null)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true)
        setAuthEntryView('auth')
        setAuthMode('login')
        setAuthError(null)
        setAuthStatus('Reset link verified. Set your new password.')
      }
      void syncAuthState(session?.user ?? null)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadBandContext])

  const saveActiveBandName = async () => {
    if (!activeBandId || !authUserId) return
    const trimmed = accountBandNameDraft.trim()
    if (!trimmed) {
      setAccountSaveStatus('Band name cannot be empty.')
      return
    }
    setAccountSaveStatus('')
    setBands((prev) =>
      prev.map((band) => (band.id === activeBandId ? { ...band, name: trimmed } : band)),
    )
    if (!supabase) {
      setAccountSaveStatus('Band name saved.')
      return
    }
    const { error } = await supabase.from('bands').update({ name: trimmed }).eq('id', activeBandId)
    if (error) {
      setAccountSaveStatus(`Band name update failed: ${error.message}`)
      return
    }
    setAccountSaveStatus('Band name updated.')
  }

  const clearSharedSignupReturnView = useCallback(() => {
    setSharedSignupReturnView(null)
    try {
      localStorage.removeItem(SHARED_SIGNUP_RETURN_KEY)
    } catch {
      // ignore storage errors
    }
  }, [])

  const invalidateSharedSignupReturnView = useCallback(
    (message?: string) => {
      clearSharedSignupReturnView()
      if (message) {
        setSharedImportStatus(message)
      }
    },
    [clearSharedSignupReturnView],
  )

  const restoreSharedViewFromSignup = () => {
    const sanitizedView = sanitizeSharedPlaylistView(sharedSignupReturnView)
    if (!sanitizedView) {
      invalidateSharedSignupReturnView('This shared gig data is invalid. Please open a fresh shared link.')
      return
    }
    setSharedPlaylistLoading(false)
    setSharedPlaylistError(null)
    setSharedPlaylistView(sanitizedView)
    invalidateSharedSignupReturnView()
  }

  const saveSharedGigToAccount = async () => {
    const sourceView = sanitizeSharedPlaylistView(sharedSignupReturnView)
    if (!sourceView) {
      invalidateSharedSignupReturnView('This shared gig data is invalid. Please open a fresh shared link.')
      return
    }
    if (!supabase || !authUserId) return
    setSharedImportSaving(true)
    setSharedImportStatus('')
    try {
      let targetBandId = activeBandId
      if (!targetBandId) {
        const fallbackBandName = authUserEmail?.split('@')[0]?.trim() || 'My'
        const { data: createdBand, error: bandError } = await supabase
          .from('bands')
          .insert({ name: `${fallbackBandName} Setlists`, created_by: authUserId })
          .select('*')
          .single()
        if (bandError || !createdBand) {
          setSharedImportStatus(`Could not create your setlist workspace: ${bandError?.message ?? 'Unknown error'}`)
          return
        }
        const { error: membershipError } = await supabase.from('band_memberships').insert({
          band_id: createdBand.id,
          user_id: authUserId,
          role: 'admin',
          status: 'active',
        })
        if (membershipError) {
          setSharedImportStatus(`Could not finish your workspace setup: ${membershipError.message}`)
          return
        }
        targetBandId = createdBand.id
        setBands((prev) => [{ id: createdBand.id, name: createdBand.name, createdBy: createdBand.created_by }, ...prev])
        setMemberships((prev) => [
          {
            id: crypto.randomUUID(),
            bandId: createdBand.id,
            userId: authUserId,
            role: 'admin',
            status: 'active',
          },
          ...prev,
        ])
        setActiveBandId(createdBand.id)
        localStorage.setItem(ACTIVE_BAND_KEY, createdBand.id)
        setRole('admin')
        setShowCreateBandOnboarding(false)
      }

      const withTargetBandId = <T extends Record<string, unknown>>(payload: T): T & { band_id: string } => ({
        ...payload,
        band_id: targetBandId,
      })
      const sourceEntries = sourceView.allEntries?.length ? sourceView.allEntries : sourceView.entries
      const songRowsByKey = new Map<
        string,
        {
          id: string
          title: string
          artist: string
          audioUrl: string
          tags: string[]
          singers: string[]
          keys: string[]
        }
      >()
      sourceEntries.forEach((entry) => {
        const title = entry.title.trim()
        if (!title) return
        const artist = (entry.artist ?? '').trim()
        const key = `${title.toLowerCase()}|${artist.toLowerCase()}`
        const existing = songRowsByKey.get(key)
        if (existing) {
          existing.tags = normalizeTagList([...existing.tags, ...(entry.tags ?? [])])
          existing.singers = normalizeTagList([...existing.singers, ...(entry.assignmentSingers ?? [])])
          existing.keys = normalizeTagList([...existing.keys, ...(entry.assignmentKeys ?? [])])
          if (!existing.audioUrl && entry.audioUrl) existing.audioUrl = entry.audioUrl
          return
        }
        songRowsByKey.set(key, {
          id: createId(),
          title,
          artist,
          audioUrl: (entry.audioUrl ?? '').trim(),
          tags: normalizeTagList(entry.tags ?? []),
          singers: normalizeTagList(entry.assignmentSingers ?? []),
          keys: normalizeTagList(entry.assignmentKeys ?? []),
        })
      })
      const savedSongs = [...songRowsByKey.values()]
      if (!savedSongs.length) {
        setSharedImportStatus('This shared gig does not have songs to save yet.')
        return
      }

      const newGigId = createId()
      const newMusicians = normalizeSharedMusicians(sourceView.musicians ?? []).map((musician) => ({
        ...musician,
        id: createId(),
      }))
      const { error: gigError } = await supabase.from('SetlistGigs').insert(withTargetBandId({
        id: newGigId,
        gig_name: sourceView.gigName || 'Shared Gig',
        gig_date: sourceView.date || new Date().toISOString().slice(0, 10),
        venue_address: sourceView.venueAddress ?? '',
      }))
      if (gigError) {
        setSharedImportStatus(`Could not save the gig: ${gigError.message}`)
        return
      }
      const { error: songError } = await supabase.from('SetlistSongs').insert(
        savedSongs.map((song) => withTargetBandId({
          id: song.id,
          title: song.title,
          artist: song.artist || null,
          audio_url: song.audioUrl || null,
          original_key: song.keys[0] || null,
        })),
      )
      if (songError) {
        setSharedImportStatus(`Could not save the songs: ${songError.message}`)
        return
      }
      const { error: gigSongError } = await supabase.from('SetlistGigSongs').insert(
        savedSongs.map((song, index) => withTargetBandId({
          id: createId(),
          gig_id: newGigId,
          song_id: song.id,
          sort_order: index,
        })),
      )
      if (gigSongError) {
        setSharedImportStatus(`Could not attach songs to the gig: ${gigSongError.message}`)
        return
      }
      const tagRows = savedSongs.flatMap((song) => {
        const sections = normalizeTagList(song.tags.filter((tag) => isSetlistTypeTag(tag)))
        const regularTags = normalizeTagList(song.tags.filter((tag) => !tag.startsWith(GIG_SECTION_TAG_PREFIX)))
        return [
          ...regularTags.map((tag) => ({
            id: createId(),
            song_id: song.id,
            tag,
          })),
          ...sections.slice(0, 1).map((section) => ({
            id: createId(),
            song_id: song.id,
            tag: makeGigSectionTag(newGigId, section),
          })),
        ]
      })
      if (tagRows.length) {
        const { error: tagError } = await supabase.from('SetlistSongTags').insert(
          tagRows.map((row) => withTargetBandId(row)),
        )
        if (tagError) {
          setSharedImportStatus(`Could not save setlist sections: ${tagError.message}`)
          return
        }
      }
      const singerKeyRows = savedSongs.flatMap((song) => {
        const singers = song.singers.length ? song.singers : ['']
        return singers
          .map((singer, index) => ({
            id: createId(),
            gig_id: newGigId,
            song_id: song.id,
            singer_name: singer || 'TBD',
            gig_key: song.keys[index] ?? song.keys[0] ?? 'TBD',
          }))
          .filter((row) => row.singer_name.trim())
      })
      if (singerKeyRows.length) {
        const { error: singerKeyError } = await supabase.from('SetlistGigSingerKeys').insert(
          singerKeyRows.map((row) => withTargetBandId(row)),
        )
        if (singerKeyError) {
          setSharedImportStatus(`Could not save singer/key notes: ${singerKeyError.message}`)
          return
        }
      }
      if (newMusicians.length) {
        const { error: musicianError } = await supabase.from('SetlistMusicians').insert(
          newMusicians.map((musician) => withTargetBandId({
            id: musician.id,
            name: musician.name,
            roster: musician.roster ?? 'sub',
            email: musician.email ?? null,
            phone: musician.phone ?? null,
            instruments: musician.instruments ?? [],
            singer: musician.singer ?? null,
          })),
        )
        if (musicianError) {
          setSharedImportStatus(`The setlist saved, but musician contacts could not be copied: ${musicianError.message}`)
        } else {
          const { error: gigMusicianError } = await supabase.from('SetlistGigMusicians').insert(
            newMusicians.map((musician) => withTargetBandId({
              id: createId(),
              gig_id: newGigId,
              musician_id: musician.id,
              status: 'active',
              note: null,
            })),
          )
          if (gigMusicianError) {
            setSharedImportStatus(`The setlist saved, but gig musician assignments could not be copied: ${gigMusicianError.message}`)
          }
        }
      }

      const importedSetlist: Setlist = {
        id: newGigId,
        gigName: sourceView.gigName || 'Shared Gig',
        date: sourceView.date || new Date().toISOString().slice(0, 10),
        venueAddress: sourceView.venueAddress ?? '',
        songIds: savedSongs.map((song) => song.id),
      }
      const importedSongs: Song[] = savedSongs.map((song) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        originalKey: song.keys[0] ?? '',
        youtubeUrl: song.audioUrl,
        tags: song.tags,
        keys: song.singers.map((singer, index) => ({
          singer,
          defaultKey: song.keys[index] ?? song.keys[0] ?? 'TBD',
          gigOverrides: { [newGigId]: song.keys[index] ?? song.keys[0] ?? 'TBD' },
        })),
        specialPlayedCount: 0,
      }))
      commitChange('Save shared gig', (prev) => ({
        ...prev,
        setlists: [importedSetlist, ...prev.setlists],
        songs: [...importedSongs, ...prev.songs],
        musicians: [...newMusicians, ...prev.musicians],
        gigMusicians: [
          ...newMusicians.map((musician) => ({
            gigId: newGigId,
            musicianId: musician.id,
            status: 'active' as const,
          })),
          ...prev.gigMusicians,
        ],
        tagsCatalog: normalizeTagList([
          ...prev.tagsCatalog,
          ...savedSongs.flatMap((song) => song.tags),
        ]),
      }))
      setSelectedSetlistId(newGigId)
      setActiveGigId(newGigId)
      clearSharedSignupReturnView()
      setSharedImportStatus('Saved to your account.')
      setScreen('setlists')
    } catch (error) {
      console.error('Save shared gig failed:', error)
      setSharedImportStatus('Could not save this shared gig. Please try again.')
    } finally {
      setSharedImportSaving(false)
    }
  }

  const openAssignedGigView = (setlistId: string) => {
    setSelectedSetlistId(setlistId)
    setActiveGigId(setlistId)
    setPlaylistModalTab('setlist')
    setShowPlaylistModal(true)
    setShowSetlistModal(false)
    setShowGigMusiciansModal(false)
  }

  useEffect(() => {
    try {
      if (!sharedSignupReturnView) {
        localStorage.removeItem(SHARED_SIGNUP_RETURN_KEY)
        return
      }
      const sanitized = sanitizeSharedPlaylistView(sharedSignupReturnView)
      if (!sanitized) {
        clearSharedSignupReturnView()
        return
      }
      localStorage.setItem(SHARED_SIGNUP_RETURN_KEY, JSON.stringify(sanitized))
    } catch {
      // ignore storage errors
    }
  }, [clearSharedSignupReturnView, sharedSignupReturnView])

  useEffect(() => {
    if (!supabase || !authUserId) return
    const params = new URLSearchParams(window.location.search)
    const inviteToken = (params.get('invite') ?? '').trim()
    if (!inviteToken) return
    if (inviteToken.length > 512) {
      params.delete('invite')
      replaceHistorySearchParams(params)
      setSupabaseError('Invite link is invalid. Please request a fresh invite.')
      return
    }
    void (async () => {
      const { error } = await supabase.rpc('accept_band_invite', { p_token: inviteToken })
      if (error) {
        setSupabaseError(`Invite accept failed: ${error.message}`)
        return
      }
      params.delete('invite')
      replaceHistorySearchParams(params)
      await loadBandContext(authUserId)
    })()
  }, [authUserId, loadBandContext])

  useEffect(() => {
    const parsedShareQuery = parseSharedPlaylistQuery(window.location.search)
    if (!parsedShareQuery) return
    const { setlistId, requestedIndex, sharedBandNameParam, sharedMusiciansParam, parsedPayload } =
      parsedShareQuery
    if (parsedPayload) {
      const payloadDisplayMap: Record<string, { title: string; singers: string[]; keys: string[] }> = {}
      parsedPayload.entries.forEach((entry) => {
        const id = (entry.songId ?? '').trim()
        if (!id) return
        payloadDisplayMap[id] = {
          title: entry.title?.trim?.() || 'Song selected',
          singers: normalizeTagList(entry.assignmentSingers ?? []),
          keys: normalizeTagList(entry.assignmentKeys ?? []),
        }
      })
      setSharedSongDisplayByAnyId(payloadDisplayMap)
      setSharedPlaylistView({
        setlistId: parsedPayload.setlistId || setlistId,
        bandName: parsedPayload.bandName ?? sharedBandNameParam ?? activeBandName ?? 'Band',
        gigName: parsedPayload.gigName || 'Shared Gig',
        date: parsedPayload.date || '',
        venueAddress: parsedPayload.venueAddress ?? '',
        musicians: parsedPayload.musicians ?? sharedMusiciansParam,
        entries: parsedPayload.entries,
        allEntries: parsedPayload.entries,
      })
      setSharedPlaylistError(null)
      setSharedPlaylistLoading(false)
      setPlaylistIndex(Math.min(requestedIndex, Math.max(0, parsedPayload.entries.length - 1)))
      setPlaylistAutoAdvance(true)
      setSharedWelcomeStep('cta')
      setSharedWelcomeCompletedSetlistId((current) =>
        current === (parsedPayload.setlistId || setlistId) ? null : current,
      )
    }
    const targetSetlist = appState.setlists.find((setlist) => setlist.id === setlistId)
    if (targetSetlist) {
      const params = new URLSearchParams(window.location.search)
      setSharedPlaylistView(null)
      setSharedPlaylistError(null)
      setSharedPlaylistLoading(false)
      setSelectedSetlistId(setlistId)
      setScreen('builder')
      setPlaylistIndex(Math.min(requestedIndex, Math.max(0, targetSetlist.songIds.length - 1)))
      setPlaylistAutoAdvance(true)
      setPlaylistModalTab('playlist')
      setShowPlaylistModal(true)
      params.delete('playlist')
      params.delete('setlist')
      params.delete('item')
      replaceHistorySearchParams(params)
      return
    }
    if (!supabase) {
      if (parsedPayload) return
      setSharedPlaylistError('Shared playlist is unavailable right now.')
      setSharedPlaylistLoading(false)
      return
    }
    let cancelled = false
    setSharedPlaylistLoading(true)
    setSharedPlaylistError(null)
    void (async () => {
      const [gigRes, gigSongsRes, songsRes, specialReqRes, djTracksRes, gigMusiciansRes] = await Promise.all([
        supabase
          .from('SetlistGigs')
          .select('id, band_id, gig_name, gig_date, venue_address')
          .eq('id', setlistId)
          .single(),
        supabase
          .from('SetlistGigSongs')
          .select('id, song_id, sort_order')
          .eq('gig_id', setlistId)
          .order('sort_order', { ascending: true }),
        supabase
          .from('SetlistSongs')
          .select('id, title, artist, audio_url')
          .is('deleted_at', null),
        supabase
          .from('SetlistSpecialRequests')
          .select('id, request_type, song_id, song_title, singers, song_key, external_audio_url, dj_only')
          .eq('gig_id', setlistId),
        supabase
          .from('SetlistGigDjTracks')
          .select('id, title, artist, notes, source_type, source_url, sort_order, status, metadata')
          .eq('gig_id', setlistId)
          .order('sort_order', { ascending: true }),
        supabase
          .from('SetlistGigMusicians')
          .select('musician_id, status')
          .eq('gig_id', setlistId),
      ])
      if (cancelled) return
      const firstError = gigRes.error || gigSongsRes.error || songsRes.error
      if (firstError) {
        if (parsedPayload) {
          setSharedPlaylistLoading(false)
          return
        }
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
          .from('bands')
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
      const tagsBySong = new Map<string, string[]>()
      const sharedGigSectionOverrides = new Map<string, string>()
      ;(tagsRes.error ? [] : (tagsRes.data ?? [])).forEach((row) => {
        if (row.tag.startsWith(GIG_SECTION_DELETED_TAG_PREFIX)) return
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
      const songDefaultKeysRes = orderedSongIds.length
        ? await supabase
            .from('SetlistSongKeys')
            .select('song_id, singer_name, default_key')
            .in('song_id', orderedSongIds)
        : { data: [], error: null as { message?: string } | null }
      const singerKeysRes = await supabase
        .from('SetlistGigSingerKeys')
        .select('song_id, singer_name, gig_key')
        .eq('gig_id', setlistId)
      if (cancelled) return
      const mergedAssignmentsBySong = new Map<
        string,
        Map<string, { singer: string; key: string }>
      >()
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
        const { data: sharedMusicianRows, error: sharedMusiciansError } = await supabase
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
      const sharedDisplayMap: Record<string, { title: string; singers: string[]; keys: string[] }> = {}
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
      setSharedSongDisplayByAnyId(sharedDisplayMap)
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
          const savedAssignments = request.song_id
            ? gigSingerKeyAssignments.get(request.song_id) ?? []
            : []
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
            assignmentSingers: request.dj_only
              ? ['DJ']
              : directSingers.length
                ? directSingers
                : savedSingers,
            assignmentKeys: request.dj_only
              ? []
              : directKeys.length
                ? directKeys
                : savedKeys,
          })
        })
      ;(djTracksRes.error ? [] : (djTracksRes.data ?? []))
        .filter((track) => track.status !== 'archived')
        .forEach((track) => {
          const metadata =
            track.metadata && typeof track.metadata === 'object' ? (track.metadata as Record<string, unknown>) : null
          const customType =
            metadata && typeof metadata.type === 'string' ? metadata.type.trim() : ''
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
      const isSpecialRequestEntry = (entry: PlaylistEntry) =>
        entry.tags.some((tag) => {
          const normalized = tag.trim().toLowerCase()
          return normalized === 'special request' || normalized === 'special requests'
        })
      const playableEntries = entries.filter(
        (entry) => Boolean(entry.audioUrl && entry.audioUrl.trim()) || isSpecialRequestEntry(entry),
      )
      setSharedPlaylistView({
        setlistId: gig.id,
        bandName: sharedBandName,
        gigName: gig.gig_name,
        date: typeof gig.gig_date === 'string' ? gig.gig_date.slice(0, 10) : '',
        venueAddress: gig.venue_address ?? '',
        musicians: sharedMusiciansParam,
        entries: playableEntries,
        allEntries: entries,
      })
      setPlaylistIndex(Math.min(requestedIndex, Math.max(0, entries.length - 1)))
      setPlaylistAutoAdvance(true)
      setSharedWelcomeStep('cta')
      setSharedWelcomeCompletedSetlistId((current) => (current === gig.id ? null : current))
      setSharedPlaylistLoading(false)
    })().catch((error) => {
      if (cancelled) return
      setSharedPlaylistError(
        error instanceof Error ? error.message : 'Shared playlist failed to load.',
      )
      setSharedPlaylistView(null)
      setSharedPlaylistLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [
    activeBandName,
    appState.setlists,
    isSetlistTypeTag,
    normalizePlaylistSection,
    parseGigSectionTag,
  ])

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
      new Set((sharedPlaylistView.allEntries ?? sharedPlaylistView.entries).map((entry) => entry.songId).filter(Boolean)),
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
  }, [parseDocumentInstruments, sharedPlaylistView])

  useEffect(() => {
    if (!sharedPlaylistView) {
      setSharedGigMusicians([])
      return
    }
    const payloadMusicians = normalizeSharedMusicians(sharedPlaylistView.musicians ?? [])
    const applySharedGigMusicians = (next: Musician[]) => {
      setSharedGigMusicians((prev) => {
        if (prev.length === next.length && prev.every((item, index) => item.id === next[index]?.id)) {
          return prev
        }
        return next
      })
    }
    applySharedGigMusicians(payloadMusicians)
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
        applySharedGigMusicians(payloadMusicians)
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
        applySharedGigMusicians(payloadMusicians)
        return
      }
      const { data: musicianRows, error: musiciansError } = await supabase
        .from('SetlistMusicians')
        .select('id, name, roster, email, phone, instruments, singer, deleted_at')
        .in('id', activeMusicianIds)
        .is('deleted_at', null)
      if (cancelled || musiciansError) {
        applySharedGigMusicians(payloadMusicians)
        return
      }
      const musicians: Musician[] = normalizeSharedMusicians((musicianRows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        roster: row.roster,
        email: row.email ?? undefined,
        phone: row.phone ?? undefined,
        instruments: row.instruments ?? [],
        singer: row.singer ?? undefined,
      })))
      const rank = new Map(activeMusicianIds.map((id, index) => [id, index]))
      musicians.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
      applySharedGigMusicians(musicians)
    })()
    return () => {
      cancelled = true
    }
  }, [normalizeSharedMusicians, sharedPlaylistView])

  useEffect(() => {
    if (!sharedPlaylistView || !sharedNowPlayingSongId || !supabase) {
      setSharedNowPlayingFallback(null)
      return
    }
    let cancelled = false
    void (async () => {
      let resolvedSongId = sharedNowPlayingSongId
      let songRes = await supabase
        .from('SetlistSongs')
        .select('title')
        .eq('id', resolvedSongId)
        .maybeSingle()
      if (!songRes.data?.title) {
        const gigSongLookup = await supabase
          .from('SetlistGigSongs')
          .select('song_id')
          .eq('gig_id', sharedPlaylistView.setlistId)
          .eq('id', sharedNowPlayingSongId)
          .maybeSingle()
        const mappedSongId = (gigSongLookup.data?.song_id ?? '').trim()
        if (mappedSongId) {
          resolvedSongId = mappedSongId
          songRes = await supabase
            .from('SetlistSongs')
            .select('title')
            .eq('id', resolvedSongId)
            .maybeSingle()
        }
      }
      const keysRes = await supabase
        .from('SetlistGigSingerKeys')
        .select('singer_name, gig_key')
        .eq('gig_id', sharedPlaylistView.setlistId)
        .eq('song_id', resolvedSongId)
      if (cancelled) return
      const title = (songRes.data?.title ?? '').trim()
      const singers = Array.from(
        new Set(
          (keysRes.data ?? [])
            .map((row) => (row.singer_name ?? '').trim())
            .filter(Boolean),
        ),
      )
      const keys = Array.from(
        new Set(
          (keysRes.data ?? [])
            .map((row) => (row.gig_key ?? '').trim())
            .filter(Boolean),
        ),
      )
      if (!title && singers.length === 0 && keys.length === 0) {
        setSharedNowPlayingFallback(null)
        return
      }
      setSharedNowPlayingFallback({ title, singers, keys })
    })()
    return () => {
      cancelled = true
    }
  }, [sharedNowPlayingSongId, sharedPlaylistView])

  useEffect(() => {
    if (lastAppliedLyricsViewerIdRef.current === lyricsViewerId) return
    lastAppliedLyricsViewerIdRef.current = lyricsViewerId
    const prefs = lyricsUserPrefsByViewer[lyricsViewerId] ?? DEFAULT_LYRICS_USER_PREFS
    setSharedLyricsTheme(prefs.theme)
    setSharedLyricsFont(prefs.font)
    setLyricsGlobalFontScale(prefs.fontScale)
    setLyricsCenterAligned(prefs.centered)
  }, [lyricsUserPrefsByViewer, lyricsViewerId])

  useEffect(() => {
    setLyricsUserPrefsByViewer((prev) => {
      const current = prev[lyricsViewerId]
      const nextPrefs: LyricsUserPrefs = {
        theme: sharedLyricsTheme,
        font: sharedLyricsFont,
        fontScale: Math.min(1.8, Math.max(0.75, lyricsGlobalFontScale)),
        centered: lyricsCenterAligned,
      }
      if (
        current &&
        current.theme === nextPrefs.theme &&
        current.font === nextPrefs.font &&
        current.fontScale === nextPrefs.fontScale &&
        current.centered === nextPrefs.centered
      ) {
        return prev
      }
      return { ...prev, [lyricsViewerId]: nextPrefs }
    })
  }, [lyricsCenterAligned, lyricsGlobalFontScale, lyricsViewerId, sharedLyricsFont, sharedLyricsTheme])

  useEffect(() => {
    localStorage.setItem(LYRICS_USER_PREFS_KEY, JSON.stringify(lyricsUserPrefsByViewer))
  }, [lyricsUserPrefsByViewer])

  useEffect(() => {
    localStorage.setItem(LYRICS_DOC_STATE_KEY, JSON.stringify(lyricsDocStateByKey))
  }, [lyricsDocStateByKey])

  useEffect(() => {
    setLyricsDrawMode(false)
    setSelectedLyricsStrokeId(null)
    setLyricsEditMode(false)
    setLyricsSelectionRange(null)
    activeStrokeRef.current = null
    if (activeStrokePathRef.current) {
      activeStrokePathRef.current.setAttribute('d', '')
    }
  }, [activeLyricsDocKey])

  useEffect(() => {
    if (!selectedLyricsStrokeId) return
    if (!activeLyricsDocState.strokes.some((stroke) => stroke.id === selectedLyricsStrokeId)) {
      setSelectedLyricsStrokeId(null)
    }
  }, [activeLyricsDocState.strokes, selectedLyricsStrokeId])

  useEffect(() => {
    if (!sharedPlaylistView || !supabase) return
    const client = supabase
    const gigId = sharedPlaylistView.setlistId
    const applySharedNowPlaying = (songId: string | null) => {
      if (!songId) {
        sharedNowPlayingSongIdRef.current = null
        setSharedNowPlayingSongId(null)
        return
      }
      const isSameSong = sharedNowPlayingSongIdRef.current === songId
      sharedNowPlayingSongIdRef.current = songId
      setSharedNowPlayingSongId(songId)
      if (!isSameSong) {
        const visibleIndex = visiblePlaylistEntries.findIndex((entry) => entry.songId === songId)
        if (visibleIndex >= 0) {
          setPlaylistIndex(visibleIndex)
        } else {
          const activeIndex = sharedAllPlaylistEntries.findIndex((entry) => entry.songId === songId)
          if (activeIndex >= 0) {
            if (playlistSingerFilter !== '__all__') {
              setPlaylistSingerFilter('__all__')
            }
            setPlaylistIndex(activeIndex)
          }
        }
        setPlaylistPlayNonce((current) => current + 1)
      }
    }

    let cancelled = false
    const fetchLatestNowPlaying = async () => {
      const { data, error } = await client
        .from('SetlistGigNowPlaying')
        .select('song_id, updated_at')
        .eq('gig_id', gigId)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      if (error) {
        return
      }
      const row = (data?.[0] ?? null) as { song_id?: string | null } | null
      const directSongId = (row?.song_id ?? '').trim() || null
      if (directSongId) {
        applySharedNowPlaying(directSongId)
        return
      }
      // If no now-playing row exists, treat that as "take back/cleared".
      applySharedNowPlaying(null)
    }
    void fetchLatestNowPlaying()

    const channel = client
      .channel(`shared-now-playing-${gigId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigNowPlaying', filter: `gig_id=eq.${gigId}` },
        (payload) => {
          const nextSongId =
            payload.eventType === 'DELETE'
              ? null
              : (
                  ((payload.new as { song_id?: string | null } | null)?.song_id ??
                    (payload.new as { current_song_id?: string | null } | null)?.current_song_id ??
                    null)
                )
          applySharedNowPlaying(nextSongId)
        },
      )
      .subscribe()

    // Fallback poll keeps clients healthy after offline/online transitions.
    const pollIntervalId = window.setInterval(() => {
      void fetchLatestNowPlaying()
    }, 15000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchLatestNowPlaying()
      }
    }
    const handleNetworkOnline = () => {
      void fetchLatestNowPlaying()
    }
    const handleWindowFocus = () => {
      void fetchLatestNowPlaying()
    }
    const handlePageShow = () => {
      void fetchLatestNowPlaying()
    }
    window.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleNetworkOnline)
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      cancelled = true
      window.clearInterval(pollIntervalId)
      window.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleNetworkOnline)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('pageshow', handlePageShow)
      void client.removeChannel(channel)
    }
  }, [
    activePlaylistEntries,
    playlistSingerFilter,
    sharedAllPlaylistEntries,
    sharedPlaylistView,
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
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => setWidePlaylistUi(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (widePlaylistUi) return
    setPlaylistDrawerOverlay(false)
    setSharedPlaylistDrawerOverlay(false)
  }, [widePlaylistUi])

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
    localStorage.setItem(GIG_DELETED_SECTION_SONGS_KEY, JSON.stringify(gigDeletedSectionSongs))
  }, [gigDeletedSectionSongs])

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
    if (!sharedNowPlayingSongId) {
      setSharedDismissedUpNextId(null)
      return
    }
    if (sharedNowPlayingSongId !== sharedDismissedUpNextId) {
      setSharedDismissedUpNextId(null)
    }
  }, [sharedNowPlayingSongId, sharedDismissedUpNextId])

  useEffect(() => {
    const isAdminUpNextVisible = Boolean(
      appState.currentSongId && appState.currentSongId !== dismissedUpNextId,
    )
    if (!isAdminUpNextVisible) {
      setAdminUpNextBannerBottom(0)
      return
    }
    const syncBannerBottom = () => {
      const rect = adminUpNextBannerRef.current?.getBoundingClientRect()
      setAdminUpNextBannerBottom(rect ? Math.max(0, Math.ceil(rect.bottom)) : 0)
    }
    syncBannerBottom()
    window.addEventListener('resize', syncBannerBottom)
    return () => {
      window.removeEventListener('resize', syncBannerBottom)
    }
  }, [appState.currentSongId, dismissedUpNextId, screen])

  useEffect(() => {
    const client = supabase
    if (!client || !authUserId) return
    const handleRealtimeChange = () => {
      if (setlistSectionSaveInProgressRef.current) return
      void loadSupabaseData()
    }
    const channel = client
      .channel('setlist-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSongs' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSongTags' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSongKeys' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigs' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigSongs' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigSingerKeys' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigNowPlaying' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistSpecialRequests' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigDjTracks' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistDocuments' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistMusicians' },
        handleRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistGigMusicians' },
        handleRealtimeChange,
      )

    channel.subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [authUserId, loadSupabaseData])

  useEffect(() => {
    const client = supabase
    if (!client || !authUserId) return
    const channel = client
      .channel('band-subscription-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SetlistBandSubscriptions' },
        () => void loadBandContext(authUserId),
      )
    channel.subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [authUserId, loadBandContext])

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
  }, [
    appState.documents,
    newDocInstruments,
    newDocSongId,
    newDocType,
    normalizeInstrumentName,
    parseDocumentInstruments,
  ])

  const isAuthScreen =
    ((!supabase && !role) || (supabase && !authUserId)) &&
    !sharedPlaylistView &&
    !sharedPlaylistLoading &&
    !sharedPlaylistError
  const isSharedLinkAuthContext = Boolean(sharedSignupReturnView)
  const authRedirectDiagnostics = useMemo(() => {
    const currentOrigin = window.location.origin
    const configuredAppUrl = String(import.meta.env.VITE_APP_URL ?? '').trim()
    const configuredOrigin = parseOriginFromUrl(configuredAppUrl)
    if (!configuredAppUrl) {
      const resolvedOrigin = resolveAuthRedirectOrigin(currentOrigin, configuredAppUrl, {
        isProd: import.meta.env.PROD,
      })
      return {
        currentOrigin,
        configuredOrigin,
        resolvedOrigin,
        missingConfig: true,
        invalidConfig: false,
        isConfiguredLocal: configuredOrigin ? isLocalhostOrigin(configuredOrigin) : false,
      }
    }
    if (!configuredOrigin) {
      return {
        currentOrigin,
        configuredOrigin: '',
        resolvedOrigin: currentOrigin,
        missingConfig: false,
        invalidConfig: true,
        isConfiguredLocal: false,
      }
    }
    const isConfiguredLocal = isLocalhostOrigin(configuredOrigin)
    const resolvedOrigin = resolveAuthRedirectOrigin(currentOrigin, configuredAppUrl, {
      isProd: import.meta.env.PROD,
    })
    return {
      currentOrigin,
      configuredOrigin,
      resolvedOrigin,
      missingConfig: false,
      invalidConfig: false,
      isConfiguredLocal,
    }
  }, [])
  const isIOSStandaloneMode = useMemo(() => {
    const platform = window.navigator.platform ?? ''
    const ua = window.navigator.userAgent ?? ''
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    return isIOSDevice && isStandaloneDisplayMode
  }, [isStandaloneDisplayMode])
  const showLegacyPanels = useMemo(() => false, [])

  useEffect(() => {
    let fadeTimer: number | null = null
    if (!isAuthScreen) {
      setAuthEntryView('home')
      setAuthIntroPhase('welcome')
      setShowAuthLearnMore(false)
      if (authIntroTimerRef.current) {
        window.clearTimeout(authIntroTimerRef.current)
        authIntroTimerRef.current = null
      }
      return
    }
    if (authEntryView !== 'auth') {
      setAuthIntroPhase('welcome')
      if (authIntroTimerRef.current) {
        window.clearTimeout(authIntroTimerRef.current)
        authIntroTimerRef.current = null
      }
      return
    }
    setAuthIntroPhase('welcome')
    if (authIntroTimerRef.current) {
      window.clearTimeout(authIntroTimerRef.current)
      authIntroTimerRef.current = null
    }
    authIntroTimerRef.current = window.setTimeout(() => {
      setAuthIntroPhase('fading')
      fadeTimer = window.setTimeout(() => {
        setAuthIntroPhase('login')
      }, 450)
    }, 1250)
    return () => {
      if (authIntroTimerRef.current) {
        window.clearTimeout(authIntroTimerRef.current)
        authIntroTimerRef.current = null
      }
      if (fadeTimer) {
        window.clearTimeout(fadeTimer)
      }
    }
  }, [authEntryView, isAuthScreen])

  useEffect(() => {
    if (isAuthScreen) {
      document.body.style.overflow = ''
      return
    }
    const hasPopup =
      (role !== 'admin' && appState.instrument === null && !authUserId) ||
      showPlaylistModal ||
      showInstrumentPrompt ||
      Boolean(docModalSongId) ||
      Boolean(audioModalUrl) ||
      showDeleteGigConfirm ||
      Boolean(showTierLimitModal) ||
      Boolean(showTierDetailsModal) ||
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
    authUserId,
    appState.instrument,
    showPlaylistModal,
    showInstrumentPrompt,
    docModalSongId,
    audioModalUrl,
    role,
    showDeleteGigConfirm,
    showTierLimitModal,
    showTierDetailsModal,
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

  useEffect(() => {
    if (!isSharedLinkAuthContext) return
    if (authMode === 'signup') {
      setAuthMode('login')
    }
  }, [authMode, isSharedLinkAuthContext])

  useEffect(() => {
    document.documentElement.classList.toggle('ios-standalone-mode', isIOSStandaloneMode)
    return () => {
      document.documentElement.classList.remove('ios-standalone-mode')
    }
  }, [isIOSStandaloneMode])

  if (sharedPlaylistView || sharedPlaylistLoading || sharedPlaylistError) {
    return (
      <div
        className={`shared-public-mode relative min-h-dvh overflow-x-hidden overflow-y-hidden md:overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-3 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-4 text-white sm:px-4 sm:pt-5 ${
          isIOSStandaloneMode ? 'shared-ios-standalone' : ''
        }`}
      >
        {showSharedInstrumentPrompt && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-3 py-[calc(0.75rem+env(safe-area-inset-top))]"
            onClick={() => setShowSharedInstrumentPrompt(false)}
          >
            <div
              className="mx-auto flex max-h-[min(90dvh,760px)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-slate-900 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="shrink-0 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
                <h2 className="text-lg font-semibold">Select your instrument</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Pick one or more instruments to view matching charts and lyrics.
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-3">
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {INSTRUMENTS.map((instrument) => (
                    <button
                      key={`shared-instrument-${instrument}`}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        instrumentSelectionDraft.includes(instrument)
                          ? 'border-teal-300 bg-teal-400/10 text-teal-100'
                          : 'border-white/10 bg-white/5'
                      }`}
                      onClick={() => {
                        setInstrumentSelectionDraft([instrument])
                        setAppState((prev) => ({
                          ...prev,
                          instrument: [instrument],
                        }))
                        setShowSharedInstrumentPrompt(false)
                      }}
                    >
                      {instrument}
                    </button>
                  ))}
                </div>
              </div>
              <div className="shrink-0 border-t border-white/10 bg-slate-900/95 px-6 py-3 backdrop-blur">
                <button
                  className="w-full rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                  onClick={() => {
                    setInstrumentSelectionDraft(['All'])
                    setAppState((prev) => ({
                      ...prev,
                      instrument: ['All'],
                    }))
                    setShowSharedInstrumentPrompt(false)
                  }}
                >
                  Skip selecting instrument
                </button>
              </div>
            </div>
          </div>
        )}
        <div
          className={`mx-auto flex min-h-[calc(100dvh-9rem)] w-full flex-col ${
            sharedPublicTab === 'playlist' ? 'max-w-[1480px]' : 'max-w-5xl'
          }`}
        >
          <div
            className="flex min-h-0 flex-1 flex-col overflow-visible p-3 md:pb-[calc(3rem+env(safe-area-inset-bottom))] sm:rounded-3xl sm:border sm:border-white/10 sm:bg-slate-900/90 sm:p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 pr-2">
                <h2 className="text-lg font-semibold">Active Setlist</h2>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 pt-1 text-right">
                <div className="flex items-center justify-end gap-2">
                  {installPrompt && !isInstalled && (
                    <button
                      type="button"
                      className="min-h-[36px] shrink-0 whitespace-nowrap rounded-lg border border-teal-300/50 bg-teal-500/20 px-3 py-1.5 text-[11px] font-semibold text-teal-100"
                      onClick={handleInstallClick}
                    >
                      {installAppLabel}
                    </button>
                  )}
                  <button
                    type="button"
                    className="min-h-[36px] min-w-[92px] shrink-0 whitespace-nowrap rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-[11px] font-semibold text-slate-200"
                    onClick={() => {
                      setInstrumentSelectionDraft(appState.instrument ?? [])
                      setShowSharedInstrumentPrompt(true)
                    }}
                  >
                    Instrument
                  </button>
                </div>
                {playlistShareStatus ? (
                  <span className="max-w-[220px] text-[11px] text-teal-200">{playlistShareStatus}</span>
                ) : null}
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
                {sharedPublicTab === 'setlist' ? (
                  <div className="shared-public-setlist-scroll mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-none bg-transparent p-0 pb-4 md:mb-4 md:h-[calc(100dvh-14rem)] md:max-h-[calc(100dvh-14rem)] md:pb-4 sm:mt-4 sm:rounded-2xl sm:bg-slate-950/50 sm:p-4 sm:pb-[calc(2rem+env(safe-area-inset-bottom))]">
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
                    <div className="w-full bg-white shared-setlist-shell sm:p-6">
                      <div className="print-container shared-setlist-container">
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
                                  const isDjOnly =
                                    item.tags.some((tag) => tag.trim().toLowerCase() === 'dj only') ||
                                    singerNames.some((name) => name.trim().toLowerCase() === 'dj')
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
                                        sharedNowPlayingSongId === item.songId
                                          ? 'ring-2 ring-emerald-300/80'
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
                                        {hasSharedLyricsForSong(item.songId) && (
                                          <button
                                            type="button"
                                            className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300/70 bg-white text-[13px] text-slate-700"
                                            title="Open lyrics"
                                            aria-label="Open lyrics"
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              openSharedLyricsForSong(item.songId)
                                            }}
                                          >
                                            📜
                                          </button>
                                        )}
                                      </div>
                                      <div className="print-row-subtitle print-song-meta">
                                        <span className="musical-key text-[0.72em]">{keyLabel}</span>
                                        <span
                                          className={`print-assignee-names text-[0.62em] ${
                                            isDjOnly
                                              ? 'rounded-full border border-rose-300/35 bg-rose-900/45 px-2 py-0.5 text-rose-100'
                                              : ''
                                          }`}
                                        >
                                          {isDjOnly
                                            ? 'DJ ONLY'
                                            : singerNames.length
                                              ? formatSingerAssignmentNames(singerNames)
                                              : 'No singers'}
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
                    <div
                      className="relative order-1 mt-3 flex flex-col overflow-visible md:order-2 md:mb-4 md:mt-4 md:h-[calc(100dvh-13.6rem)] md:min-h-0 md:max-h-[calc(100dvh-13.6rem)] md:flex-1 md:flex-row md:gap-4 md:overflow-hidden"
                    >
                      <div
                        ref={sharedPlaylistPlayerBlockRef}
                        className={`sticky top-3 z-10 flex min-h-0 w-full flex-col md:relative md:top-auto md:h-full md:min-h-0 md:flex-1 ${
                          widePlaylistUi && sharedPlaylistDrawerOverlay
                            ? 'pointer-events-none opacity-0 md:pointer-events-auto md:opacity-100'
                            : 'opacity-100'
                        }`}
                      >
                          {currentPlaylistEntry ? (
                            <div className="min-h-0 w-full shrink-0 overflow-visible md:flex-1 md:overflow-y-auto md:pr-1">
                            <div
                              className="rounded-none border-0 bg-transparent p-0 transition-all duration-150 sm:rounded-2xl sm:border sm:border-white/10 sm:bg-slate-950/40 sm:p-4"
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
                              <div className="mt-2 rounded-none border-0 bg-transparent p-0 sm:mt-3 sm:rounded-xl sm:border sm:border-white/10 sm:bg-slate-950/40 sm:p-3">
                                {!currentPlaylistEntry.audioUrl ? (
                                  <div className="text-sm text-slate-400">
                                    No audio URL saved for this song yet.
                                  </div>
                                ) : isSpotifyUrl(currentPlaylistEntry.audioUrl) ? (
                                  <div className="flex items-center justify-between gap-3 rounded-xl border-0 bg-slate-900/50 p-3 sm:border sm:border-white/10 sm:bg-slate-900/60">
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
                                  <div className="relative aspect-video w-full max-h-[min(48vh,320px)] overflow-hidden rounded-xl border-0 sm:max-h-[min(56vh,520px)] sm:border sm:border-white/10">
                                    <div className="absolute inset-0 z-0 min-h-[160px]">
                                      <PlaylistYouTubePlayer
                                        ref={sharedPublicYtHandleRef}
                                        key={`${currentPlaylistEntry.key}-${playlistPlayNonce}-shared-yt`}
                                        watchUrl={currentPlaylistEntry.audioUrl}
                                        playNonce={playlistPlayNonce}
                                        className="h-full w-full"
                                        onEnded={handlePlaylistYoutubeEnded}
                                        autoplay={sharedPublicTab === 'playlist'}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-3 rounded-xl border-0 bg-slate-900/50 p-3 sm:border sm:border-white/10 sm:bg-slate-900/60">
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
                            </div>
                          ) : (
                            <div className="shrink-0 rounded-xl border-0 bg-slate-900/40 p-3 text-sm text-slate-300 sm:rounded-2xl sm:border sm:border-white/10 sm:bg-slate-950/40 sm:p-4">
                              No playlist songs found for this gig yet.
                            </div>
                          )}
                      </div>
                      <div className="order-2 mt-3 grid grid-cols-2 gap-2 md:hidden">
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
                      <button
                        type="button"
                        className="order-3 mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-teal-300/50 bg-slate-900/95 px-3 py-2 text-sm font-semibold text-teal-100 shadow-lg backdrop-blur md:hidden"
                        onClick={() => setSharedPlaylistDrawerOverlay(true)}
                        aria-label="Open song list"
                      >
                        <span className="text-base leading-none" aria-hidden>
                          ☰
                        </span>
                        Songs
                      </button>
                      {sharedPlaylistDrawerOverlay && (
                        <button
                          type="button"
                          className="fixed inset-0 z-[325] bg-slate-950/45 backdrop-blur-[1px] md:hidden"
                          onClick={() => setSharedPlaylistDrawerOverlay(false)}
                          aria-label="Close song list"
                        />
                      )}
                        <div
                          className={`${
                            sharedPlaylistDrawerOverlay ? 'fixed' : 'hidden'
                          } bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-3 right-3 top-[calc(1rem+env(safe-area-inset-top))] z-[330] order-4 flex flex-col overflow-hidden rounded-3xl border border-teal-300/40 bg-slate-900 shadow-2xl md:static md:order-none md:mb-1 md:mt-0 md:flex md:h-[calc(100%-0.25rem)] md:max-h-[calc(100%-0.25rem)] md:w-[320px] md:max-w-none md:shrink-0 md:self-start md:rounded-2xl md:shadow-xl lg:w-[340px] ${
                            sharedPlaylistDrawerOverlay ? '' : 'md:flex'
                          } ${widePlaylistUi ? 'md:static' : 'md:min-h-0'}`}
                        >
                          <div className="flex shrink-0 items-center justify-center py-2 md:hidden">
                            <div className="h-1 w-12 rounded-full bg-white/25" />
                          </div>
                          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 pb-3 md:hidden">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200">
                              Song List
                            </div>
                            <button
                              type="button"
                              className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-200"
                              onClick={() => setSharedPlaylistDrawerOverlay(false)}
                            >
                              Close
                            </button>
                          </div>
                          <div className="shrink-0 border-b border-white/10 bg-slate-900/95 px-2 pb-2 pt-2 backdrop-blur">
                            <select
                              className="min-h-[38px] w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus:border-teal-300"
                              value={playlistSingerFilter}
                              onChange={(event) => setPlaylistSingerFilter(event.target.value)}
                              aria-label="Filter songs by singer"
                            >
                              <option value="__all__">All singers</option>
                              {playlistSingerOptions.map((singer) => (
                                <option key={`shared-playlist-singer-${singer}`} value={singer}>
                                  {singer}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div
                            className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-2 pb-[calc(7.75rem+env(safe-area-inset-bottom))] md:h-full md:min-h-0 md:flex-1 md:max-h-full md:overflow-y-auto md:pb-2"
                          >
                            <div className="space-y-3 py-2">
                              {groupedPlaylistSections.map((group) => (
                                <div
                                  key={`shared-playlist-group-${group.section}`}
                                  className={getPlaylistSectionCardClasses(group.section)}
                                >
                                  <button
                                    type="button"
                                    className={`${playlistSectionHeaderClasses} flex w-full items-center justify-between gap-2 text-left`}
                                    onClick={() => toggleSharedAudioSection(group.section)}
                                  >
                                    <span>{group.section}</span>
                                    <span className="text-xs">{isSharedAudioSectionCollapsed(group.section) ? '▸' : '▾'}</span>
                                  </button>
                                  {!isSharedAudioSectionCollapsed(group.section) && (
                                    <div className="space-y-2">
                                    {group.items.map(({ entry: item, index }) => (
                                      <button
                                        type="button"
                                        key={`${item.key}-shared-list`}
                                        className={getPlaylistQueueItemButtonClasses(index === playlistIndex)}
                                        onClick={() => jumpToSharedPlaylistIndex(index)}
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0 flex-1">
                                            <div className="text-sm font-semibold text-slate-100">{item.title}</div>
                                            <div className="text-[11px] text-slate-400">{item.artist || ' '}</div>
                                            <div className="mt-0.5 text-[11px] text-teal-200">
                                              {getPlaylistAssignmentText(item)}
                                            </div>
                                          </div>
                                          <div className="flex flex-wrap items-center justify-end gap-1">
                                            {hasSharedLyricsForSong(item.songId) && (
                                              <button
                                                type="button"
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 text-[12px] text-slate-100"
                                                title="Open lyrics"
                                                aria-label="Open lyrics"
                                                onClick={(event) => {
                                                  event.stopPropagation()
                                                  openSharedLyricsForSong(item.songId)
                                                }}
                                              >
                                                📜
                                              </button>
                                            )}
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
                                  )}
                                </div>
                              ))}
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
        {(sharedPlaylistView || sharedPlaylistLoading || sharedPlaylistError) && (
          <nav
            className={`shared-bottom-nav fixed inset-x-0 bottom-0 z-[320] border-t border-white/10 bg-slate-950 px-3 pb-[env(safe-area-inset-bottom)] ${
              isIOSStandaloneMode ? 'shared-bottom-nav-ios' : ''
            }`}
          >
            <div
              className={`mx-auto flex w-full items-center justify-between gap-2 py-3 ${
                sharedPublicTab === 'playlist' ? 'max-w-[980px]' : 'max-w-3xl'
              }`}
            >
              <button
                type="button"
                className={`flex min-w-[140px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold shadow-lg transition ${
                  sharedPublicTab === 'setlist'
                    ? 'border-teal-300/70 bg-teal-500 text-slate-950'
                    : 'border-white/10 bg-slate-900 text-slate-200'
                }`}
                disabled={!sharedPlaylistView}
                onClick={() => setSharedPublicTab('setlist')}
              >
                <img src={downloadPdfIcon} alt="" className="h-5 w-5 object-contain" />
                Setlist
              </button>
              <button
                type="button"
                className={`flex min-w-[140px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold shadow-lg transition ${
                  sharedPublicTab === 'playlist'
                    ? 'border-teal-300/70 bg-teal-500 text-slate-950'
                    : 'border-white/10 bg-slate-900 text-slate-200'
                }`}
                disabled={!sharedPlaylistView}
                onClick={handleSharedPublicAudioTabClick}
              >
                <img src={openPlaylistIcon} alt="" className="h-5 w-5 object-contain" />
                Audio
              </button>
            </div>
          </nav>
        )}
        {sharedPlaylistView &&
          sharedWelcomeStep !== 'hidden' &&
          sharedWelcomeCompletedSetlistId !== sharedPlaylistView.setlistId && (
            <div className="fixed inset-0 z-[340] flex items-center justify-center bg-slate-950/88 px-4 py-[calc(1.25rem+env(safe-area-inset-top))] backdrop-blur-xl">
              <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-3xl border border-white/15 bg-slate-900 p-5 text-slate-100 shadow-2xl sm:p-7">
                {sharedWelcomeStep === 'learn' ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-200">
                          Setlist Connect
                        </p>
                        <h3 className="mt-2 text-2xl font-semibold">A cleaner way to walk into the gig.</h3>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-2xl leading-none text-slate-200"
                        onClick={() => setSharedWelcomeStep('cta')}
                        aria-label="Back"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
                      <p>
                        This shared gig page keeps the details musicians usually hunt for in one place:
                        the setlist, singer assignments, keys, charts, lyrics, musician contacts, and
                        rehearsal audio.
                      </p>
                      <p>
                        Use Setlist for the printable gig sheet. Use Audio to rehearse or jump to a song
                        during prep. No account is needed from this shared link right now.
                      </p>
                      <p>
                        The bandleader can keep making updates, and the shared link opens the latest saved
                        version for this specific gig.
                      </p>
                    </div>
                    <div className="mt-6 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className="min-h-[46px] rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200"
                        onClick={() => setSharedWelcomeStep('cta')}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="min-h-[46px] rounded-xl bg-teal-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-500/20"
                        onClick={() => {
                          setSharedWelcomeCompletedSetlistId(sharedPlaylistView.setlistId)
                          setSharedWelcomeStep('hidden')
                        }}
                      >
                        Continue to Gig
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-200">
                      Shared gig link
                    </p>
                    <h3 className="mt-3 text-3xl font-semibold leading-tight">
                      {sharedPlaylistView.gigName || 'Shared Setlist'}
                    </h3>
                    <p className="mt-2 text-sm text-slate-400">
                      {formatGigDate(sharedPlaylistView.date)}
                      {sharedPlaylistView.venueAddress ? ` · ${sharedPlaylistView.venueAddress}` : ''}
                    </p>
                    <div className="mt-5 rounded-2xl border border-teal-300/25 bg-teal-400/10 p-4 text-sm leading-6 text-teal-50">
                      Open the gig setlist and audio without creating an account. This link is your access
                      pass for the band’s saved gig details.
                    </div>
                    <div className="mt-6 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className="min-h-[46px] rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200"
                        onClick={() => setSharedWelcomeStep('learn')}
                      >
                        Learn More
                      </button>
                      <button
                        type="button"
                        className="min-h-[46px] rounded-xl bg-teal-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-500/20"
                        onClick={() => {
                          setSharedWelcomeCompletedSetlistId(sharedPlaylistView.setlistId)
                          setSharedWelcomeStep('hidden')
                        }}
                      >
                        Open Setlist
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        {sharedNowPlayingSongId && sharedNowPlayingSongId !== sharedDismissedUpNextId && (
          <div
            className="shared-upnext-banner shared-upnext-banner-pulse liquid-button upnext-flash fixed inset-x-0 top-0 z-[260] border-y border-emerald-300/45 bg-black px-3 pb-2 pt-[calc(0.55rem+env(safe-area-inset-top))] text-emerald-100 shadow-[0_0_18px_rgba(74,222,128,0.45)] transition-all duration-150"
            style={{ position: 'fixed', top: 0, right: 0, left: 0, bottom: 'auto' }}
            onTouchStart={(event) => setSharedBannerTouchStartX(event.touches[0]?.clientX ?? null)}
            onTouchEnd={(event) => {
              if (sharedBannerTouchStartX === null) return
              const endX = event.changedTouches[0]?.clientX ?? sharedBannerTouchStartX
              if (Math.abs(endX - sharedBannerTouchStartX) > 60 && sharedNowPlayingSongId) {
                setSharedDismissedUpNextId(sharedNowPlayingSongId)
              }
              setSharedBannerTouchStartX(null)
            }}
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-1 pb-1">
              <div className="flex items-center justify-between gap-3 text-base font-semibold">
                <div className="pointer-events-none flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="whitespace-nowrap text-base">Up next</span>
                  <span className="min-w-0 flex-1 truncate text-center text-lg font-semibold">
                    {sharedNowPlayingTitle}
                  </span>
                  <span className="whitespace-nowrap text-sm">Key: {sharedNowPlayingKeyLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  {hasSharedLyricsForSong(sharedNowPlayingSongId) && (
                    <button
                      type="button"
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-300/40 bg-emerald-400/15 px-3 text-xs font-semibold text-emerald-100"
                      onClick={() => openSharedLyricsForSong(sharedNowPlayingSongId)}
                      title="Open lyrics"
                      aria-label="Open lyrics"
                    >
                      📜
                    </button>
                  )}
                  {hasSharedChartsForSong(sharedNowPlayingSongId) && (
                    <button
                      type="button"
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-300/40 bg-emerald-400/15 px-3 text-xs font-semibold text-emerald-100"
                      onClick={() => openSharedDocsForSong(sharedNowPlayingSongId)}
                      title="Open charts"
                      aria-label="Open charts"
                    >
                      📄
                    </button>
                  )}
                </div>
              </div>
              <div className="min-w-0 truncate text-center text-xs font-semibold text-emerald-200/90">
                Singer: {sharedNowPlayingSingerLabel}
              </div>
            </div>
          </div>
        )}
        {docModalSongId && (
          <div
            className="fixed inset-x-0 bottom-0 z-[420] bg-slate-950/95"
            style={{
              top:
                sharedNowPlayingSongId && sharedNowPlayingSongId !== sharedDismissedUpNextId
                  ? 'calc(3.6rem + env(safe-area-inset-top))'
                  : '0',
            }}
            onClick={() => {
              setDocModalSongId(null)
              setDocModalContent(null)
              setDocModalPageIndex(0)
            }}
          >
            <div
              className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-900"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">
                    {docModalContent
                      ? docModalContent.type === 'Lyrics'
                        ? 'Song Lyrics'
                        : 'Song Chart'
                      : 'Song documents'}
                  </h3>
                  <div className="flex shrink-0 items-center gap-2">
                    {docModalContent && (
                      <button
                        className="icon-header-btn rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200"
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
                    <CloseButton
                      onClick={() => {
                        setDocModalSongId(null)
                        setDocModalContent(null)
                        setDocModalPageIndex(0)
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
                {!docModalContent && (
                  <div className="mt-4 space-y-2">
                    {docModalSelectionItems.map((doc) => (
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
                        </div>
                      </div>
                    ))}
                    {docModalSelectionItems.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
                        No charts or lyrics found for selected instruments.
                      </div>
                    )}
                  </div>
                )}
                {docModalContent && (
                  <div
                    className={`relative mt-2 flex h-full min-h-0 flex-col rounded-2xl border p-4 ${sharedLyricsContainerClasses}`}
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
                    {renderLyricsTools()}
                    {docModalContent.content ? (
                      <div
                        className={`relative min-h-0 flex-1 overflow-hidden rounded-xl border ${lyricsBodySurfaceClasses}`}
                      >
                        {lyricsEditMode && isTextLyricsDoc ? (
                          <textarea
                            className={`h-full w-full resize-none overflow-auto bg-transparent p-3 pb-4 text-sm leading-relaxed outline-none ${sharedLyricsPreClasses} ${sharedLyricsAlignmentClass}`}
                            style={{ fontSize: `${lyricsFontSizeRem}rem` }}
                            value={lyricsEditDraft}
                            onChange={(event) => setLyricsEditDraft(event.target.value)}
                          />
                        ) : (
                          <div
                            ref={lyricsTextContainerRef}
                            className={`h-full overflow-auto whitespace-pre-wrap p-3 pb-4 text-sm leading-relaxed ${sharedLyricsPreClasses} ${sharedLyricsAlignmentClass}`}
                            style={{ fontSize: `${lyricsFontSizeRem}rem` }}
                            onMouseUp={handleLyricsSelectionCapture}
                            onTouchEnd={handleLyricsSelectionCapture}
                          >
                            {renderHighlightedLyrics(`${resolvedLyricsText}\n\n\n`, activeLyricsDocState.highlights)}
                          </div>
                        )}
                        {renderLyricsStrokeOverlay()}
                      </div>
                    ) : activeDocModalPage ? (
                      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black">
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
                        {renderLyricsStrokeOverlay()}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-300">No document available.</div>
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
      </div>
    )
  }

  // Show skeleton shell while band context is loading to avoid blank screen
  if (supabase && authUserId && bandContextLoading) {
    return <SkeletonAppShell />
  }

  if (isAuthScreen) {
    return (
      <AuthScreen
        authEntryView={authEntryView}
        setAuthEntryView={setAuthEntryView}
        authIntroPhase={authIntroPhase}
        showAuthLearnMore={showAuthLearnMore}
        setShowAuthLearnMore={setShowAuthLearnMore}
        isSharedLinkAuthContext={isSharedLinkAuthContext}
        sharedSignupReturnView={sharedSignupReturnView}
        authMode={authMode}
        setAuthMode={setAuthMode}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        passwordRecoveryMode={passwordRecoveryMode}
        setPasswordRecoveryMode={setPasswordRecoveryMode}
        recoveryPassword={recoveryPassword}
        setRecoveryPassword={setRecoveryPassword}
        recoveryPasswordConfirm={recoveryPasswordConfirm}
        setRecoveryPasswordConfirm={setRecoveryPasswordConfirm}
        authLoading={authLoading}
        authError={authError}
        authStatus={authStatus}
        setAuthStatus={setAuthStatus}
        authEmailCooldownSeconds={authEmailCooldownSeconds}
        onLogin={() => void handleLogin()}
        onResetPasswordSubmit={() => void handleResetPasswordSubmit()}
        onForgotPassword={() => void handleForgotPassword()}
        onRestoreSharedView={restoreSharedViewFromSignup}
      />
    )
  }

  if (supabase && authUserId && !activeBandId && !bandContextLoading && showCreateBandOnboarding) {
    return (
      <CreateBandScreen
        newBandName={newBandName}
        setNewBandName={setNewBandName}
        supabaseError={supabaseError}
        setSupabaseError={setSupabaseError}
        authLoading={authLoading}
        onCreateBand={() => void createBandAsFirstAdmin()}
      />
    )
  }

  // ── AppContext value ──────────────────────────────────────────────────────
  const appContextValue = {
    authUserId,
    authUserEmail,
    activeBandId,
    role,
    isAdmin,
    activeBand: bands.find((b) => b.id === activeBandId) ?? null,
    bandMemberships: memberships,
    songs: appState.songs,
    setlists: appState.setlists,
    musicians: appState.musicians,
    gigMusicians: appState.gigMusicians,
    charts: appState.charts,
    documents: appState.documents,
    specialRequests: appState.specialRequests,
    tagsCatalog: appState.tagsCatalog,
    specialTypes: appState.specialTypes,
    singersCatalog: appState.singersCatalog,
    currentSetlist: currentSetlist ?? null,
    currentSongId: appState.currentSongId,
    appState,
    showToast,
    updateSong,
  } as const

  return (
    <AppProvider value={appContextValue}>
    <div className="relative min-h-screen bg-slate-950 text-white fade-in">
      {/* ── Offline banner ── */}
      <OfflineBanner />

      {/* ── Session expiry warning ── */}
      {showSessionExpiryWarning && (
        <div
          role="alert"
          className="fixed bottom-20 left-1/2 z-[9998] -translate-x-1/2 flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-slate-900/95 px-5 py-3 text-sm text-amber-100 shadow-xl backdrop-blur"
        >
          <span>⏱</span>
          <span>Your session will expire in 5 minutes.</span>
          <button
            type="button"
            className="ml-1 rounded-lg bg-teal-400/90 px-3 py-1 text-xs font-semibold text-slate-950"
            onClick={() => {
              localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
              setShowSessionExpiryWarning(false)
            }}
          >
            Stay logged in
          </button>
        </div>
      )}

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
            <div
              className={`rounded-2xl border px-4 py-2 text-xs ${
                supabaseEnvStatus.forceLocalMode && !supabaseError
                  ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100'
                  : 'border-red-500/30 bg-red-500/10 text-red-200'
              }`}
            >
              {!isSupabaseEnabled
                ? supabaseEnvStatus.forceLocalMode
                  ? 'Local mode is on. Online login and sync are paused while you work on this computer.'
                  : `Supabase offline: ${
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

      {appState.instrument === null && role !== 'admin' && !authUserId && (
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
                    onClick={() => {
                      setInstrumentSelectionDraft([instrument])
                      setAppState((prev) => ({
                        ...prev,
                        instrument: [instrument],
                      }))
                    }}
                  >
                    {instrument}
                  </button>
                ))}
              </div>
              <button
                className="mt-4 w-full rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                onClick={() => {
                  setInstrumentSelectionDraft(['All'])
                  setAppState((prev) => ({
                    ...prev,
                    instrument: ['All'],
                  }))
                }}
              >
                Continue without Selecting Instrument
              </button>
            </div>
          </div>
        </div>
      )}

      <main
        className={`mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-24 pt-6 ${
          isAdmin && screen === 'builder' && currentSetlist && isCurrentSetlistPast
            ? 'rounded-2xl border border-[#5a1f2a]/50 bg-[#16070b]'
            : ''
        }`}
      >
        {isAdmin && screen === 'builder' && currentSetlist && isCurrentSetlistPast && (
          <div className="sticky top-[74px] z-[66] rounded-2xl border border-[#7a2a3a]/65 bg-[#22090f]/95 px-4 py-3 text-xs text-rose-100 shadow-[0_0_20px_rgba(127,29,29,0.35)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] sm:text-xs">
                This is a past gig. Editing is locked to prevent accidental changes. Toggle to unlock if you need
                to make updates.
              </p>
              <button
                type="button"
                className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border px-1 transition ${
                  isPastGigLockedForAdmin
                    ? 'border-rose-300/40 bg-[#3a121b]'
                    : 'border-emerald-300/40 bg-emerald-500/30'
                }`}
                onClick={() => {
                  if (!currentSetlist) return
                  setPastGigUnlockedByGigId((prev) => ({
                    ...prev,
                    [currentSetlist.id]: Boolean(isPastGigLockedForAdmin),
                  }))
                }}
                aria-label={isPastGigLockedForAdmin ? 'Unlock past gig editing' : 'Lock past gig editing'}
                title={isPastGigLockedForAdmin ? 'Unlock past gig editing' : 'Lock past gig editing'}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                    isPastGigLockedForAdmin ? 'translate-x-0' : 'translate-x-7'
                  }`}
                />
              </button>
            </div>
          </div>
        )}
        {screen === 'setlists' && (
          <section className="flex flex-col gap-5">
            <div className="rounded-3xl border border-teal-300/20 bg-teal-400/10 px-5 py-4 shadow-[0_0_20px_rgba(20,184,166,0.12)]">
              <p className="text-xs uppercase tracking-[0.28em] text-teal-200/80">
                {isAdmin ? 'Home' : 'My Gigs'}
              </p>
              <h2 className="mt-1 text-2xl font-semibold leading-tight">
                Welcome{userFirstName ? `, ${userFirstName}` : ' back'}
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                {isAdmin
                  ? "Here's what's ready for your next gig."
                  : currentUserMusician
                    ? `Showing gigs assigned to ${currentUserMusician.name}.`
                    : 'Showing gigs assigned to your account email.'}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-white/0 p-5">
              <h2 className="text-xl font-semibold">Upcoming gigs</h2>
              <p className="mt-1 text-sm text-slate-300">
                {isAdmin
                  ? 'Duplicate a previous setlist, or jump straight into editing.'
                  : 'Open a gig to view the setlist, musicians, charts, lyrics, and audio.'}
              </p>
              <div className="mt-4 flex flex-col gap-3">
                {upcomingGigs.map((setlist) => {
                  const isToday = normalizeGigDateISO(setlist.date) === operationalTodayISO
                  return (
	                  <div
	                    key={setlist.id}
	                    className={`rounded-2xl border p-4 ${
	                      isToday
	                        ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
	                        : 'border-white/10 bg-slate-900/60'
	                    }`}
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
	                      <div className="mt-4 grid grid-cols-2 gap-2">
                          <button
                            className="min-h-[44px] rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                            onClick={() => {
                              setSelectedSetlistId(setlist.id)
                              setScreen('builder')
                            }}
                          >
                            Open gig
                          </button>
	                          <button
	                            className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200"
	                            onClick={() => duplicateGig(setlist.id)}
	                          >
	                            Duplicate
	                          </button>
	                      </div>
	                    )}
                    {!isAdmin && (
                      <button
                        className="mt-4 w-full rounded-xl bg-teal-400/90 px-3 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(45,212,191,0.25)]"
                        onClick={() => openAssignedGigView(setlist.id)}
                      >
                        Open Gig View
                      </button>
                    )}
                  </div>
                )})}
              </div>
              {!isAdmin && upcomingGigs.length === 0 && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4 text-sm text-slate-300">
                  No upcoming gigs are assigned to this email yet. Ask your band leader to assign the musician record
                  with this account email.
                </div>
              )}
              {isAdmin && (
                <button
                  className="liquid-button mt-4 w-full rounded-xl bg-gradient-to-r from-emerald-400 via-lime-400 to-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(74,222,128,0.45)]"
                  onClick={createBlankSetlist}
                >
                  <span>Create New Gig</span>
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
                <h3 className="font-semibold">Library + gig totals</h3>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <Stat label="Upcoming gigs" value={upcomingGigs.length} />
                  <Stat label="Past gigs" value={pastGigs.length} />
                  <Stat label="Songs in library" value={appState.songs.length} />
                  <Stat label="Musicians" value={appState.musicians.length} />
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="rounded-3xl border border-slate-600/30 bg-gradient-to-br from-slate-800/45 via-slate-950/70 to-indigo-950/25 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500">Archive</p>
                    <h3 className="font-semibold text-slate-100">Past gigs</h3>
                    <p className="mt-1 text-xs text-slate-400">Older gigs live here for reference and duplication.</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3">
                  {pastGigs.map((setlist) => (
	                    <div
	                      key={setlist.id}
	                      className="rounded-2xl border border-slate-600/30 bg-slate-950/65 p-4"
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
	                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <button
                            className="min-h-[44px] rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950"
                            onClick={() => {
                              setSelectedSetlistId(setlist.id)
                              setScreen('builder')
                            }}
                          >
                            Open gig
                          </button>
	                          <button
	                            className="min-h-[44px] rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200"
	                            onClick={() => duplicateGig(setlist.id)}
	                          >
	                            Duplicate
	                          </button>
	                        </div>
	                      )}
                      {!isAdmin && (
                        <button
                          className="mt-3 w-full rounded-xl border border-teal-300/50 bg-teal-400/10 px-3 py-2 text-sm font-semibold text-teal-100"
                          onClick={() => openAssignedGigView(setlist.id)}
                        >
                          Open Gig View
                        </button>
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
                  <span>Create New Gig</span>
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
              className={`sticky ${
                isAdmin && isCurrentSetlistPast ? 'top-[130px]' : 'top-[72px]'
              } z-20 rounded-3xl border p-4 backdrop-blur transition-all duration-150 sm:p-5 ${
                currentSetlistDateISO === operationalTodayISO
                  ? 'border-teal-300/60 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]'
                  : 'border-white/10 bg-slate-950/90'
              } ${
                hideGigHeader
                  ? 'pointer-events-none -translate-y-4 opacity-0'
                  : 'translate-y-0 opacity-100'
              }`}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    {isAdmin ? 'Setlist' : 'Gig Info'}
                  </p>
                  {isAdmin ? (
                    <div className="mt-3 flex flex-col gap-1 text-left sm:max-w-[min(100%,620px)]">
                      <input
                        readOnly={isPastGigLockedForAdmin}
                        className={`block w-full appearance-none border-b border-white/10 bg-transparent px-0 py-1 text-left text-2xl font-semibold leading-tight outline-none focus:border-teal-300 ${
                          isPastGigLockedForAdmin
                            ? 'cursor-default text-slate-200'
                            : 'text-white'
                        }`}
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
                      <div className="flex flex-col gap-1">
                        <div className="flex w-full items-center gap-2 md:w-[200px]">
                          {isPastGigLockedForAdmin ? (
                            <p className="w-full border-b border-white/10 py-1 text-left text-sm text-slate-300">
                              {formatGigDate(currentSetlist.date)}
                            </p>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="w-full border-b border-white/10 bg-transparent px-0 py-1 text-left text-sm text-slate-200 outline-none focus:border-teal-300"
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
                            </>
                          )}
                        </div>
                        <div className="flex w-full items-center gap-2">
                          <input
                            readOnly={isPastGigLockedForAdmin}
                            className={`block w-full appearance-none border-b border-white/10 bg-transparent px-0 py-1 text-left text-sm outline-none focus:border-teal-300 ${
                              isPastGigLockedForAdmin
                                ? 'cursor-default text-slate-300 placeholder:text-slate-500'
                                : 'text-slate-200'
                            }`}
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
                    </div>
                  ) : (
                    <div className="mt-3 flex w-full flex-col items-start gap-1 text-left">
                      <h2 className="text-xl font-semibold">{currentSetlist.gigName}</h2>
                      <p className="text-xs text-slate-400">
                        {formatGigDate(currentSetlist.date)}
                      </p>
                      {currentSetlist.venueAddress && (
                        <a
                          className="mt-1 inline-flex rounded-full border border-white/10 px-3 py-1 text-left text-xs text-slate-200"
                          href={`https://maps.apple.com/?q=${encodeURIComponent(
                            currentSetlist.venueAddress,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {currentSetlist.venueAddress}
                        </a>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-400">
                    Tap a song in Gig mode to flash it at the top for the band.
                  </p>
                </div>
                <div className="flex min-w-0 items-center justify-end gap-2">
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-indigo-300/60 bg-indigo-500/20 px-3 text-sm font-semibold text-indigo-100 shadow-[0_0_18px_rgba(99,102,241,0.28)]"
                    onClick={() => {
                      setPlaylistIndex(0)
                      setPlaylistAutoAdvance(true)
                      setPlaylistModalTab('setlist')
                      setShowPlaylistModal(true)
                    }}
                    title="Setlist"
                    aria-label="Setlist"
                  >
                    <AppIcon name="setlist" className="text-lg" />
                    <span>Setlist</span>
                    <img src={openPlaylistIcon} alt="" className="h-5 w-5 object-contain opacity-90" />
                  </button>
                  {currentSetlist.venueAddress && (
                    <a
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 text-base text-slate-200"
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        currentSetlist.venueAddress,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Maps"
                      aria-label="Open venue in maps"
                      onClick={(event) => event.stopPropagation()}
                    >
                      📍
                    </a>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={isPastGigLockedForAdmin}
                    className="min-h-[44px] min-w-[92px] rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => deleteGig(currentSetlist.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            <div
              className={`flex flex-col gap-6 ${isPastGigLockedForAdmin ? 'past-gig-locked-surface' : ''}`}
            >
            {isAdmin && (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    key: 'musicians',
                    label: 'Assign Musicians',
                    icon: <AppIcon name="mic" />,
                    tint: 'from-indigo-500/30 via-slate-900/40 to-slate-900/60',
                    complete: Boolean(buildCompletion.musicians),
                    count: buildCardCounts.musicians ?? 0,
                  },
                  ...(!isSpecialSectionHidden
                    ? [
                        {
                          key: 'special',
                          label: 'Special Requests',
                          icon: <AppIcon name="sparkle" />,
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
                      <span className="text-[1.75rem] text-slate-100/95">{item.icon}</span>
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
                    ? <AppIcon name="dinner" />
                    : lower.includes('latin')
                      ? <AppIcon name="latin" />
                      : lower.includes('dance')
                        ? <AppIcon name="dance" />
                        : <AppIcon name="music" />
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
                          <span className="text-[1.75rem] text-slate-100/95">{icon}</span>
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
                    <span className="text-[1.75rem] text-teal-100/90"><AppIcon name="plus" /></span>
                  </div>
                  <span className="text-sm font-semibold">Add Section</span>
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
                    const displayAssignments = getSpecialRequestDisplayAssignments(request)
                    return (
                      <div
                        key={request.id}
                        className="grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr]"
                      >
                        <div className="text-xs text-teal-300">
                          {request.djOnly || request.origin === 'dj_track'
                            ? request.type || 'DJ Only'
                            : 'Special Request'}
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
                          {(request.artist || song?.artist) && (
                            <div className="text-[10px] text-slate-400">{request.artist || song?.artist}</div>
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
                            displayAssignments.singers.some(
                              (singer) =>
                                singer.trim().toLowerCase() === INSTRUMENTAL_LABEL.toLowerCase(),
                            )
                              ? 'text-fuchsia-200'
                              : 'text-slate-300'
                          }`}
                        >
                          {request.djOnly
                            ? 'DJ ONLY'
                            : displayAssignments.singers.length
                              ? displayAssignments.singers.join(', ')
                              : 'No singers'}
                        </div>
                        <div className="text-xs text-slate-200">
                          {formatSpecialRequestKeyLabel(request)}
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
                        Artist
                      </label>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
                        placeholder="Optional artist"
                        value={pendingSpecialArtist}
                        onChange={(event) => setPendingSpecialArtist(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wide text-slate-400">
                        Singers
                      </label>
                    <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                            isPendingSpecialDjOnly
                              ? 'border-rose-300 bg-rose-400/10 text-rose-200'
                              : 'border-white/10 text-slate-300'
                          }`}
                          onClick={() => {
                            const next = !isPendingSpecialDjOnly
                            setPendingSpecialDjOnly(next)
                            if (next) {
                              setPendingSpecialSingers([])
                              setPendingSpecialKey('')
                            }
                          }}
                          disabled={pendingSpecialForcesDjOnly}
                          title={
                            pendingSpecialForcesDjOnly
                              ? 'This request type is DJ-only'
                              : 'Mark this request as DJ-only'
                          }
                        >
                          DJ
                        </button>
                        {gigVocalists.map((musician) => {
                          const singer = musician.name
                          const active = pendingSpecialSingers.includes(singer)
                          return (
                            <button
                              type="button"
                              key={singer}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                                active
                                  ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                                  : 'border-white/10 text-slate-300'
                              }`}
                              onClick={() => {
                                if (isPendingSpecialDjOnly && !pendingSpecialForcesDjOnly) {
                                  setPendingSpecialDjOnly(false)
                                }
                                setPendingSpecialSingers((current) =>
                                  current.includes(singer)
                                    ? current.filter((item) => item !== singer)
                                    : [...current, singer],
                                )
                              }}
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
                      disabled={isPendingSpecialDjOnly}
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
                      DJ mode
                    </label>
                    <div className="text-xs text-slate-300">
                      Use the <span className="font-semibold">DJ</span> tag in Singers to toggle DJ-only mode.
                    </div>
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
                      className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                      onClick={addSpecialRequest}
                    >
                      Add Request
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
                      className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                      onClick={addSubAndAssign}
                    >
                      Add New Sub
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── Fresh Songs Browser ── */}
            {isAdmin && (
              <FreshSongBrowser
                currentGigId={currentSetlist.id}
                currentSetlistSongIds={currentSetlist.songIds}
                onAddSong={(songId) => {
                  if (currentSetlist.songIds.includes(songId)) return
                  setAppState((prev) => ({
                    ...prev,
                    setlists: prev.setlists.map((sl) =>
                      sl.id === currentSetlist.id
                        ? { ...sl, songIds: [...sl.songIds, songId] }
                        : sl,
                    ),
                  }))
                  if (supabase) {
                    runSupabase(
                      supabase.from('SetlistGigSongs').insert(
                        withBandId({
                          id: createId(),
                          gig_id: currentSetlist.id,
                          song_id: songId,
                          sort_order: currentSetlist.songIds.length,
                        }),
                      ),
                    )
                  }
                }}
              />
            )}

            </div>
          </section>
        )}

        {screen === 'song' && (
          <section className="flex flex-col gap-6">
            <div className="sticky top-[72px] z-20 rounded-3xl border border-white/10 bg-slate-900/90 p-5 backdrop-blur">
              <div className="flex items-start">
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
              <div className="flex items-start">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Musicians
                  </p>
                  <h2 className="text-xl font-semibold">Band roster</h2>
                  <p className="text-xs text-slate-400">
                    Add, edit, and manage your musician contacts.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {isAdmin && (
                  <button
                    className="w-full rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
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
                <label className="block">
                  <span className="sr-only">Search musicians</span>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-300/70"
                    placeholder="Search musicians by name, instrument, email, phone, core, sub..."
                    value={musicianSearch}
                    onChange={(event) => setMusicianSearch(event.target.value)}
                  />
                </label>
                <div className="mt-4 space-y-2">
                  {visibleMusicians.map((musician) => (
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
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-3">
                        <div className="w-full min-w-0 md:pr-2">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-sm font-semibold text-teal-100">
                              {musician.name}
                            </div>
                            <span
                              className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
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
                        <div className="mt-0.5 flex w-full justify-end md:mt-0 md:w-auto">
                          <div className="flex flex-wrap items-center justify-end gap-2 text-sm md:flex-nowrap">
                          {isAdmin && (
                            <button
                              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold sm:px-3 sm:text-[11px] ${
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
                    </div>
                  ))}
                  {visibleMusicians.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-4 text-sm text-slate-400">
                      No musicians match that search.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {screen === 'account' && (
          <section className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Account</p>
                  <h2 className="text-xl font-semibold">
                    {isAdmin ? 'Band leader settings' : 'Musician account'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {isAdmin
                      ? 'Manage your band name and choose a paid tier.'
                      : 'Your gigs are matched from the email on your musician record.'}
                  </p>
                </div>
                <button
                  className="min-w-[92px] rounded-xl border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-200"
                  onClick={() => void handleLogout()}
                >
                  Log out
                </button>
              </div>

              {!isAdmin ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Signed in as</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">{authUserEmail}</div>
                    {currentUserMusician ? (
                      <div className="mt-3 rounded-xl border border-teal-300/30 bg-teal-400/10 px-3 py-2 text-sm text-teal-100">
                        Matched to {currentUserMusician.name}
                        {currentUserMusician.instruments.length
                          ? ` · ${currentUserMusician.instruments.join(', ')}`
                          : ''}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                        No musician record matches this email yet.
                      </div>
                    )}
                    <div className="mt-3 text-xs text-slate-400">
                      Assigned gigs: <span className="font-semibold text-slate-200">{visibleSetlists.length}</span>
                    </div>
                  </div>
                </div>
              ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Band name</div>
                  <input
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                    placeholder="Band name"
                    value={accountBandNameDraft}
                    onChange={(event) => {
                      setAccountBandNameDraft(event.target.value)
                      setAccountSaveStatus('')
                    }}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                      onClick={() => void saveActiveBandName()}
                      disabled={!activeBandId}
                    >
                      Save band name
                    </button>
                    {!activeBandId && (
                      <button
                        className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                        onClick={() => void createBandAsFirstAdmin()}
                      >
                        Create first band
                      </button>
                    )}
                  </div>
                  {accountSaveStatus && (
                    <div className="mt-2 text-xs text-slate-300">{accountSaveStatus}</div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Beta access</div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">
                    Setlist Connect is free during beta while the app is being tightened up for real gigs.
                    Paid plans will come later for expanded storage, advanced collaboration, and pro workflow tools.
                  </p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {([
                      {
                        id: 'free',
                        name: 'Beta Free',
                        detail: 'Unlimited testing during beta',
                      },
                      {
                        id: 'pro',
                        name: 'Pro',
                        detail: 'Coming after beta',
                      },
                    ] as const).map((tier) => (
                      <button
                        type="button"
                        key={tier.id}
                        className={`rounded-xl border px-3 py-3 text-left text-sm ${
                          activeBandTier === tier.id
                            ? 'border-teal-300 bg-teal-400/10 text-teal-100'
                            : 'border-white/10 bg-slate-900/70 text-slate-300 hover:border-cyan-300/40'
                        }`}
                        onClick={() => {
                          setShowTierDetailsModal(tier.id)
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{tier.name}</span>
                          {tier.id === 'pro' && isBillingTestAccount && (
                            <span className="rounded-full border border-teal-300/30 bg-teal-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-100">
                              Testing
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{tier.detail}</div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-slate-400">
                    Current access: <span className="font-semibold text-slate-200">BETA FREE</span>
                    {isBillingTestAccount ? (
                      <span className="ml-2 text-teal-200">(testing account)</span>
                    ) : null}
                  </div>
                  {activeBandPendingTierChange && (
                    <div className="mt-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                      Downgrade scheduled to{' '}
                      <span className="font-semibold">{activeBandPendingTierChange.pendingTier.toUpperCase()}</span>{' '}
                      on{' '}
                      <span className="font-semibold">
                        {new Date(activeBandPendingTierChange.effectiveAt).toLocaleDateString()}
                      </span>
                      . Your current tier stays active until then.
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-xl border border-teal-300/30 bg-teal-400/10 px-4 py-2 text-sm font-semibold text-teal-100"
                      disabled
                    >
                      Purchases paused during beta
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>No payment is required during beta.</span>
                    <a className="font-semibold text-slate-300 hover:text-teal-200" href="/terms.html" target="_blank">
                      Terms
                    </a>
                    <a className="font-semibold text-slate-300 hover:text-teal-200" href="/privacy.html" target="_blank">
                      Privacy
                    </a>
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-300/25 bg-cyan-400/10 p-4">
                  <div className="text-[10px] uppercase tracking-wide text-cyan-200">Auth redirect diagnostics</div>
                  <p className="mt-2 text-xs text-cyan-100/90">
                    Shows where signup verification emails will return users after they click the link.
                  </p>
                  <div className="mt-3 space-y-2 text-xs text-slate-200">
                    <div>
                      Current origin: <span className="font-semibold">{authRedirectDiagnostics.currentOrigin}</span>
                    </div>
                    <div>
                      VITE_APP_URL origin:{' '}
                      <span className="font-semibold">
                        {authRedirectDiagnostics.configuredOrigin || '(not configured)'}
                      </span>
                    </div>
                    <div>
                      Resolved signup redirect:{' '}
                      <span className="font-semibold text-cyan-100">
                        {authRedirectDiagnostics.resolvedOrigin}
                      </span>
                    </div>
                  </div>
                  {(authRedirectDiagnostics.missingConfig || authRedirectDiagnostics.invalidConfig) && (
                    <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                      {authRedirectDiagnostics.invalidConfig
                        ? 'VITE_APP_URL is invalid. Set a full URL (for example https://yourdomain.com).'
                        : 'VITE_APP_URL is not set. Verification links may resolve to the current origin.'}
                    </div>
                  )}
                  {import.meta.env.PROD && authRedirectDiagnostics.isConfiguredLocal && (
                    <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                      Production is using localhost in VITE_APP_URL. Update it to your production URL.
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>

            {/* ── AI & Admin Tools (admins only) ── */}
            {isAdmin && (
              <div className="flex flex-col gap-4">
                <SongMetadataBackfill />
                <DuplicateSongMerger />
              </div>
            )}

          </section>
        )}
      </main>

      {/* Quick-add floating button — only in builder with an active setlist */}
      {screen === 'builder' && currentSetlist && (
        <QuickAddSong
          gigId={currentSetlist.id}
          onSongAdded={(songId, songTitle, songArtist) => {
            setAppState((prev) => ({
              ...prev,
              songs: [
                ...prev.songs,
                {
                  id: songId,
                  title: songTitle,
                  artist: songArtist,
                  tags: [],
                  keys: [],
                  specialPlayedCount: 0,
                  youtubeVerified: false,
                } as import('./types').Song,
              ],
              setlists: prev.setlists.map((sl) =>
                sl.id === currentSetlist.id
                  ? { ...sl, songIds: [...sl.songIds, songId] }
                  : sl,
              ),
            }))
          }}
        />
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-sm">
          <NavButton
            active={screen === 'setlists'}
            onClick={() => setScreen('setlists')}
            icon={<AppIcon name="home" />}
            label={isAdmin ? 'Home' : 'My Gigs'}
          />
          {isAdmin && (
            <NavButton
              active={screen === 'song'}
              onClick={() => setScreen('song')}
              icon={<AppIcon name="songs" />}
              label="Songs"
            />
          )}
          {isAdmin && (
            <NavButton
              active={screen === 'musicians'}
              onClick={() => setScreen('musicians')}
              icon={<AppIcon name="mic" />}
              label="Musicians"
            />
          )}
          {role && (
            <NavButton
              active={screen === 'account'}
              onClick={() => setScreen('account')}
              icon={<AppIcon name="account" />}
              label="Account"
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

              {getOrderedSpecialRequests(currentSetlist.id).length > 0 && (
                <div className="print-section-box print-special">
                  <div className="print-section-title">Special Requests</div>
                  <div className="print-list">
                    {getOrderedSpecialRequests(currentSetlist.id)
                      .map((request) => {
                        const song = appState.songs.find((item) => item.id === request.songId)
                        const displayAssignments = getSpecialRequestDisplayAssignments(request)
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
                                : displayAssignments.singers.length
                                  ? formatSingerAssignmentNames(displayAssignments.singers)
                                  : 'No singers'}
                            </span>{' '}
                            · {formatSpecialRequestKeyLabel(request)}
                          </div>
                          {request.note && <div className="print-row-note">{request.note}</div>}
                        </div>
                      )})}
                  </div>
                </div>
              )}

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
          className="fixed inset-x-0 bottom-0 z-[130] bg-slate-950/95"
          style={{
            top:
              appState.currentSongId &&
              appState.currentSongId !== dismissedUpNextId &&
              adminUpNextBannerBottom > 0
                ? `${adminUpNextBannerBottom}px`
                : '0',
          }}
          onClick={() => {
            setDocModalSongId(null)
            setDocModalContent(null)
            setDocModalPageIndex(0)
          }}
        >
          <div
            className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">
                  {docModalContent
                    ? docModalContent.type === 'Lyrics'
                      ? 'Song Lyrics'
                      : 'Song Chart'
                    : 'Song documents'}
                </h3>
                <div className="flex shrink-0 items-center gap-2">
                  {docModalContent && (
                    <button
                      className="icon-header-btn rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200"
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
                <CloseButton
                  onClick={() => {
                    setDocModalSongId(null)
                    setDocModalContent(null)
                    setDocModalPageIndex(0)
                  }}
                />
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              {!docModalContent && (
                <div className="mt-4 space-y-2">
                  {docModalSelectionItems.map((doc) => (
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
                  {docModalSelectionItems.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
                      No charts or lyrics found for selected instruments.
                    </div>
                  )}
                </div>
              )}
              {docModalContent && (
                <div
                  className={`relative mt-2 flex h-full min-h-0 flex-col rounded-2xl border p-4 ${sharedLyricsContainerClasses}`}
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
                  {renderLyricsTools()}
                  {docModalContent.content ? (
                    <div
                      className={`relative min-h-0 flex-1 overflow-hidden rounded-xl border ${lyricsBodySurfaceClasses}`}
                    >
                      {lyricsEditMode && isTextLyricsDoc ? (
                        <textarea
                          className={`h-full w-full resize-none overflow-auto bg-transparent p-3 text-sm leading-relaxed outline-none ${sharedLyricsPreClasses} ${sharedLyricsAlignmentClass}`}
                          style={{ fontSize: `${lyricsFontSizeRem}rem` }}
                          value={lyricsEditDraft}
                          onChange={(event) => setLyricsEditDraft(event.target.value)}
                        />
                      ) : (
                        <div
                          ref={lyricsTextContainerRef}
                          className={`h-full overflow-auto whitespace-pre-wrap p-3 text-sm leading-relaxed ${sharedLyricsPreClasses} ${sharedLyricsAlignmentClass}`}
                          style={{ fontSize: `${lyricsFontSizeRem}rem` }}
                          onMouseUp={handleLyricsSelectionCapture}
                          onTouchEnd={handleLyricsSelectionCapture}
                        >
                          {renderHighlightedLyrics(resolvedLyricsText, activeLyricsDocState.highlights)}
                        </div>
                      )}
                      {renderLyricsStrokeOverlay()}
                    </div>
                  ) : activeDocModalPage ? (
                    <div className="relative min-h-0 flex-1 w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
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
                      {renderLyricsStrokeOverlay()}
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
                <CloseButton onClick={() => setAudioModalUrl(null)} />
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
              <div className="flex items-start gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Musician</p>
                  <h3 className="text-lg font-semibold">Edit musician</h3>
                </div>
                <CloseButton onClick={cancelEditMusician} />
              </div>
              <div className="mt-3 flex items-center gap-2">
                {hasEditingMusicianChanges && (
                  <button
                    className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                    onClick={saveEditMusician}
                  >
                    Save
                  </button>
                )}
                <button
                  className="min-w-[92px] rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-200"
                  onClick={() => deleteMusician(editingMusicianId)}
                >
                  Delete
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
                <CloseButton onClick={() => setShowTeamModal(false)} />
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

      {authUserId && sharedSignupReturnView && (
        <div
          className="fixed inset-0 z-[112] flex items-center justify-center bg-slate-950/85 px-4 py-6"
          onClick={() => {
            if (sharedImportSaving) return
            clearSharedSignupReturnView()
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-[0.24em] text-teal-300/80">Shared gig</p>
            <h3 className="mt-2 text-2xl font-semibold">Save this setlist?</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Add {sharedSignupReturnView.gigName || 'this gig'} to your account so it appears in My Gigs.
              This copies the setlist, audio links, sections, musicians, singers, and keys into your own workspace.
            </p>
            <div className="mt-4 rounded-2xl border border-teal-300/25 bg-teal-400/10 p-3 text-xs leading-relaxed text-teal-100">
              Beta accounts are free right now. You can save gigs during the beta without upgrading.
            </div>
            {sharedImportStatus && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-200">
                {sharedImportStatus}
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-teal-400/90 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void saveSharedGigToAccount()}
                disabled={sharedImportSaving}
              >
                {sharedImportSaving ? 'Saving...' : 'Save to My Gigs'}
              </button>
              <button
                type="button"
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  if (sharedImportSaving) return
                  clearSharedSignupReturnView()
                }}
                disabled={sharedImportSaving}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteGigConfirm && (
        <ConfirmModal
          title="Delete this gig?"
          message="This will remove the gig, assignments, and special requests."
          onCancel={cancelDeleteGig}
          onConfirm={confirmDeleteGig}
          confirmLabel="Delete gig"
          variant="danger"
        />
      )}

      {showTierDetailsModal && selectedTierDetails && (
        <div
          className="fixed inset-0 z-[109] flex items-center justify-center bg-slate-950/85 px-4 py-6"
          onClick={() => setShowTierDetailsModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-teal-300/80">Plan details</p>
                <h3 className="mt-2 text-2xl font-semibold">{selectedTierDetails.name}</h3>
                <p className="mt-1 text-sm text-slate-300">{selectedTierDetails.summary}</p>
              </div>
              <button
                type="button"
                className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-200"
                onClick={() => setShowTierDetailsModal(null)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">What&apos;s included</p>
              <div className="mt-2 grid gap-1 text-sm text-slate-200 md:grid-cols-2">
                {selectedTierDetails.includes.map((item) => (
                  <p key={`tier-include-${item}`}>• {item}</p>
                ))}
              </div>
            </div>

            {isSelectedUpgrade && (
              <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3">
                <p className="text-xs uppercase tracking-wide text-emerald-200">What you gain</p>
                <div className="mt-2 space-y-1 text-sm text-emerald-100">
                  {tierGainItems.length > 0
                    ? tierGainItems.map((item) => <p key={`gain-${item}`}>+ {item}</p>)
                    : <p>This upgrade includes additional plan capacity and benefits.</p>}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isSelectedCurrentTier ? (
                <button
                  type="button"
                  className="rounded-xl border border-teal-300/40 bg-teal-400/10 px-4 py-2 text-sm font-semibold text-teal-100"
                  disabled
                >
                  Current beta access
                </button>
              ) : isSelectedUpgrade && selectedTier && selectedTier !== 'free' ? (
                <button
                  type="button"
                  className="rounded-xl border border-teal-300/40 bg-teal-400/10 px-4 py-2 text-sm font-semibold text-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled
                >
                  Coming after beta
                </button>
              ) : isSelectedDowngrade ? (
                <button
                  type="button"
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100"
                  disabled
                >
                  Beta access is already free
                </button>
              ) : null}
              <span className="text-xs text-slate-400">
                Purchases and plan limits are paused while Setlist Connect is in beta.
              </span>
            </div>
          </div>
        </div>
      )}

      {showTierLimitModal && (
        <TierLimitModal onClose={() => setShowTierLimitModal(null)} />
      )}

      {showGigLockedSongWarning && (
        <ConfirmModal
          title="Song already selected"
          message="This song is already in the gig queue. Do you want to re-send it anyway?"
          onCancel={() => { setShowGigLockedSongWarning(false); setPendingResendGigSongId(null) }}
          onConfirm={() => {
            if (pendingResendGigSongId) markGigSongAsSelected(pendingResendGigSongId, { forceResend: true })
            setShowGigLockedSongWarning(false)
            setPendingResendGigSongId(null)
          }}
          confirmLabel="Re-send anyway"
          zClass="z-[108]"
        />
      )}

      {showSingerWarning && (
        <InfoModal
          title="Assign musicians first"
          message="Add musicians to this gig first. Singer assignment will use active assigned musicians (vocalists preferred)."
          onClose={() => setShowSingerWarning(false)}
        />
      )}

      {showMissingSingerWarning && (
        <InfoModal
          title="Assign singers first"
          message="Add singer assignments for every song in this set before marking it complete."
          onClose={() => setShowMissingSingerWarning(false)}
        />
      )}

      {showDocInstrumentWarning && (
        <InfoModal
          title="Choose instrument(s)"
          message="Charts require at least one instrument selection before saving."
          onClose={() => setShowDocInstrumentWarning(false)}
          zClass="z-[90]"
        />
      )}

      {showDocUrlAccessWarning && (
        <InfoModal
          title="Shared URL check"
          message="Please make sure the shared chart URL original source is viewable for everyone, otherwise it will not load properly. Uploading a PDF is the most secure way for all musicians to see your chart."
          onClose={() => setShowDocUrlAccessWarning(false)}
          zClass="z-[90]"
        />
      )}

      {importReview && currentSetlist && (
        <div
          className="fixed inset-0 z-[112] flex items-center justify-center bg-slate-950/80 px-4 py-6"
          onClick={() => setImportReview(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const source = appState.setlists.find((gig) => gig.id === importReview.sourceGigId)
              const deletedSongIds = getDeletedSectionSongIds(currentSetlist.id, importReview.section)
              const sourceSongIds = source ? getSourceSectionSongIds(importReview.section, source) : []
              const importRows = sourceSongIds
                .filter((songId) => !currentSetlist.songIds.includes(songId))
                .map((songId) => ({
                  song: appState.songs.find((song) => song.id === songId),
                  deleted: deletedSongIds.has(songId),
                }))
                .filter((row): row is { song: Song; deleted: boolean } => Boolean(row.song))
              const availableCount = importRows.filter((row) => !row.deleted).length
              const deletedCount = importRows.filter((row) => row.deleted).length
              return (
                <>
                  <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
                    <h3 className="text-lg font-semibold">Review import</h3>
                    <p className="mt-1 text-sm text-slate-300">
                      {source?.gigName ?? 'Previous gig'} → {importReview.section}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <CloseButton onClick={() => setImportReview(null)} />
                      <button
                        className="min-w-[120px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                        onClick={async () => {
                          const saved = await importSectionFromGig(
                            importReview.section,
                            importReview.sourceGigId,
                            importReview.selectedSongIds,
                          )
                          if (saved) setImportReview(null)
                        }}
                        disabled={sectionSaveStatus === 'Saving setlist...'}
                      >
                        {sectionSaveStatus === 'Saving setlist...' ? 'Saving...' : 'Save songs'}
                      </button>
                    </div>
                    {sectionSaveStatus && (
                      <p className="mt-3 text-xs font-semibold text-teal-200">{sectionSaveStatus}</p>
                    )}
                  </div>
                  <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
                    <div className="mb-3 rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-3 text-xs text-slate-300">
                      New songs are checked by default. Songs you previously deleted from this setlist type are shown
                      separately so they do not sneak back in.
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2 text-xs">
                      <button
                        className="rounded-full border border-white/10 px-3 py-1 text-slate-200"
                        onClick={() =>
                          setImportReview((current) =>
                            current
                              ? {
                                  ...current,
                                  selectedSongIds: importRows.map((row) => row.song.id),
                                }
                              : current,
                          )
                        }
                      >
                        Select all
                      </button>
                      <button
                        className="rounded-full border border-white/10 px-3 py-1 text-slate-200"
                        onClick={() =>
                          setImportReview((current) =>
                            current
                              ? {
                                  ...current,
                                  selectedSongIds: importRows
                                    .filter((row) => !row.deleted)
                                    .map((row) => row.song.id),
                                }
                              : current,
                          )
                        }
                      >
                        New only ({availableCount})
                      </button>
                      <button
                        className="rounded-full border border-white/10 px-3 py-1 text-slate-200"
                        onClick={() =>
                          setImportReview((current) =>
                            current ? { ...current, selectedSongIds: [] } : current,
                          )
                        }
                      >
                        Clear
                      </button>
                    </div>
                    <div className="space-y-2">
                      {importRows.map(({ song, deleted }) => {
                        const selected = importReview.selectedSongIds.includes(song.id)
                        return (
                          <label
                            key={`import-review-${song.id}`}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                              deleted
                                ? 'border-amber-300/35 bg-amber-400/10'
                                : 'border-white/10 bg-slate-950/40'
                            }`}
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{song.title}</span>
                                {deleted && (
                                  <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                                    Previously deleted
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-400">{song.artist}</div>
                            </div>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) =>
                                setImportReview((current) => {
                                  if (!current) return current
                                  return {
                                    ...current,
                                    selectedSongIds: event.target.checked
                                      ? Array.from(new Set([...current.selectedSongIds, song.id]))
                                      : current.selectedSongIds.filter((songId) => songId !== song.id),
                                  }
                                })
                              }
                            />
                          </label>
                        )
                      })}
                      {importRows.length === 0 && (
                        <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-300">
                          No songs from that setlist are available to import.
                        </div>
                      )}
                      {deletedCount > 0 && (
                        <div className="text-[10px] text-amber-200">
                          {deletedCount} previously deleted song{deletedCount === 1 ? '' : 's'} shown.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )
            })()}
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
                Songs already in this gig can still be selected to move/assign them to a different
                setlist section. Default setlist: {sectionAddSongsSource}. Use "Assign here" for a
                single saved song.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <CloseButton onClick={() => setShowSectionAddSongsModal(false)} />
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
                {sectionAddSongsAvailableSongs.map((song) => {
                  const alreadyInGig = currentSetlist.songIds.includes(song.id)
                  const isSelected = selectedSongIds.includes(song.id)
                  const currentAssignment =
                    getGigSongSectionOverride(currentSetlist.id, song.id) || 'Unassigned'
                  return (
                    <label
                      key={`section-add-song-${song.id}`}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                        isSelected
                          ? 'border-teal-300/50 bg-teal-400/10'
                          : alreadyInGig
                            ? 'border-teal-300/35 bg-teal-400/10 opacity-80'
                          : 'border-white/10 bg-slate-950/40'
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{song.title}</span>
                          {alreadyInGig && (
                            <span className="rounded-full border border-teal-300/40 bg-teal-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-200">
                              Already saved
                            </span>
                          )}
                          {alreadyInGig && (
                            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                              {currentAssignment}
                            </span>
                          )}
                        </div>
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
                        checked={isSelected}
                        onChange={(event) =>
                          setSelectedSongIds((current) =>
                            event.target.checked
                              ? [...current, song.id]
                              : current.filter((id) => id !== song.id),
                          )
                        }
                      />
                      {alreadyInGig && (
                        <button
                          type="button"
                          className="ml-2 rounded-full border border-teal-300/40 bg-teal-400/10 px-3 py-1 text-[10px] font-semibold text-teal-100"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            const assignmentSection = normalizeSetlistSectionLabel(
                              sectionAddSongsSource ||
                                normalizeTagList(sectionAddSongsTargets)[0] ||
                                '',
                            )
                            if (!assignmentSection) return
                            setSongsForGigSection(currentSetlist.id, [song.id], assignmentSection)
                          }}
                        >
                          Assign here
                        </button>
                      )}
                    </label>
                  )
                })}
                {sectionAddSongsAvailableSongs.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-300">
                    No songs match this search.
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <button
                  className="rounded-full border border-white/10 px-3 py-1"
                  onClick={() =>
                    setSelectedSongIds(
                      sectionAddSongsAvailableSongs.map((song) => song.id),
                    )
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
                <CloseButton onClick={closeManualSectionOrderModal} />
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
                <CloseButton
                  onClick={() => {
                    resetPendingSpecialRequest()
                    setShowSpecialRequestModal(false)
                  }}
                />
                <button
                  className="min-w-[120px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={saveSpecialRequest}
                >
                  {editingSpecialRequestId ? 'Save changes' : 'Save request'}
                </button>
              </div>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
              <div className="grid gap-3 md:grid-cols-3">
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
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wide text-slate-400">
                    Artist
                  </label>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    placeholder="Optional artist"
                    value={pendingSpecialArtist}
                    onChange={(event) => setPendingSpecialArtist(event.target.value)}
                  />
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
                    <button
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        isPendingSpecialDjOnly
                          ? 'border-rose-300 bg-rose-400/10 text-rose-200'
                          : 'border-white/10 text-slate-300'
                      }`}
                      onClick={() => {
                        const next = !isPendingSpecialDjOnly
                        setPendingSpecialDjOnly(next)
                        if (next) {
                          setPendingSpecialSingers([])
                          setPendingSpecialKey('')
                        }
                      }}
                      disabled={pendingSpecialForcesDjOnly}
                      title={
                        pendingSpecialForcesDjOnly
                          ? 'This request type is DJ-only'
                          : 'Mark this request as DJ-only'
                      }
                    >
                      DJ
                    </button>
                    {specialRequestSingerOptions.map((singer) => (
                      <button
                        type="button"
                        key={singer}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          pendingSpecialSingers.includes(singer)
                            ? 'border-teal-300 bg-teal-400/10 text-teal-200'
                            : 'border-white/10 text-slate-300'
                        }`}
                        onClick={() => {
                          if (isPendingSpecialDjOnly && !pendingSpecialForcesDjOnly) {
                            setPendingSpecialDjOnly(false)
                          }
                          setPendingSpecialSingers((current) =>
                            current.includes(singer)
                              ? current.filter((item) => item !== singer)
                              : [...current, singer],
                          )
                        }}
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
                    disabled={isPendingSpecialDjOnly}
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
                    DJ mode
                  </label>
                  <div className="text-xs text-slate-300">
                    Use the <span className="font-semibold">DJ</span> tag in Singers to toggle DJ-only mode.
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
            {pendingDeleteSetlistSection?.toLowerCase().startsWith('special request') ||
            pendingDeleteSetlistSection?.trim().toLowerCase() === 'dj only' ? (
              <p className="mt-2 text-sm text-slate-300">
                This hides <span className="font-semibold">{pendingDeleteSetlistSection}</span> for this gig.
                Existing special request entries stay saved.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-300">
                This removes <span className="font-semibold">{pendingDeleteSetlistSection}</span>{' '}
                and clears the songs inside that setlist type for this gig.
              </p>
            )}
            {pendingDeleteSetlistSection &&
              !pendingDeleteSetlistSection.toLowerCase().startsWith('special request') &&
              pendingDeleteSetlistSection.trim().toLowerCase() !== 'dj only' && (
                <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {pendingDeleteSetlistSectionImpact.exclusiveSongCount > 0 ? (
                    <span>
                      This will delete the section and remove{' '}
                      <span className="font-semibold">
                        {pendingDeleteSetlistSectionImpact.exclusiveSongCount}
                      </span>{' '}
                      exclusive song
                      {pendingDeleteSetlistSectionImpact.exclusiveSongCount === 1 ? '' : 's'} from the gig.
                    </span>
                  ) : (
                    <span>
                      This will delete the section only. Songs in this section also belong to other setlists and will stay in the gig.
                    </span>
                  )}
                </div>
              )}
            <div className="mt-4 flex items-center gap-2">
              <button
                className="min-w-[92px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                onClick={cancelDeleteSetlistSection}
              >
                Cancel
              </button>
              <button
                className="min-w-[120px] rounded-xl bg-red-500/90 px-4 py-2 text-sm font-semibold text-red-100"
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
            <h3 className="text-lg font-semibold">Add Section</h3>
            <p className="mt-2 text-sm text-slate-300">
              Choose a section type or create your own label. Admin can drag sections to reorder them.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['Special Requests', 'DJ Only', 'Dinner', 'Latin', 'Dance'].map((template) => (
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
              <CloseButton onClick={() => setShowAddSetlistModal(false)} />
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
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">Assign vocalist & key</h3>
                  <div className="mt-2 text-sm text-slate-300">
                    {singerModalSong.title}
                    {singerModalSong.artist ? ` · ${singerModalSong.artist}` : ''}
                  </div>
                </div>
                <CloseButton onClick={() => setSingerModalSongId(null)} />
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
                        Select vocalist
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
                                const nextKey = event.target.value
                                setPendingSingerAssignments((prev) => {
                                  const rows = prev[singerModalSong.id] ?? [{ singer: '', key: '' }]
                                  const nextRows = [...rows]
                                  nextRows[index] = {
                                    singer: pending.singer,
                                    key: nextKey,
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
                              Save & close
                            </button>
                            <button
                              className="rounded-xl border border-red-300/30 px-3 py-2 text-xs text-red-100"
                              onClick={() =>
                                removeSingerAssignment(singerModalSong.id, pending.singer)
                              }
                            >
                              Remove
                            </button>
                          </div>
                        )
                      })}
                      {(pendingSingerAssignments[singerModalSong.id] ?? []).length === 0 && (
                        <div className="text-xs text-slate-400">
                          Tap a vocalist above, enter the key, then Save.
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
        <ConfirmModal
          title="Remove this song?"
          message="This will remove the song from the gig setlist."
          onCancel={cancelRemoveSong}
          onConfirm={confirmRemoveSong}
          confirmLabel="Remove song"
          variant="danger"
          zClass="z-[110]"
        />
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
                <CloseButton onClick={() => setShowGigMusiciansModal(false)} />
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
                <CloseButton onClick={() => setShowSetlistModal(false)} />
                <button
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-indigo-300/60 bg-indigo-500/20 px-4 text-sm font-semibold text-indigo-100 shadow-[0_0_18px_rgba(99,102,241,0.28)]"
                  onClick={() => {
                    setPlaylistIndex(0)
                    setPlaylistAutoAdvance(true)
                    setPlaylistModalTab('setlist')
                    setShowPlaylistModal(true)
                  }}
                  title="Active Setlist"
                  aria-label="Active Setlist"
                >
                  <span>Active Setlist</span>
                  <img src={openPlaylistIcon} alt="" className="h-5 w-5 object-contain" />
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
                      const displayAssignments = getSpecialRequestDisplayAssignments(request)
                      return (
                        <div
                          key={request.id}
                          className="grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr]"
                        >
                          <div className="text-xs text-teal-300">
                            {request.djOnly || request.origin === 'dj_track'
                              ? request.type || 'DJ Only'
                              : 'Special Request'}
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
                            {(request.artist || song?.artist) && (
                              <div className="text-xs text-slate-400">{request.artist || song?.artist}</div>
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
                              displayAssignments.singers.some(
                                (singer) =>
                                  singer.trim().toLowerCase() === INSTRUMENTAL_LABEL.toLowerCase(),
                              )
                                ? 'text-fuchsia-200'
                                : 'text-slate-300'
                            }`}
                          >
                            {request.djOnly
                              ? 'DJ ONLY'
                              : displayAssignments.singers.length
                                ? displayAssignments.singers.join(', ')
                                : 'No singers'}
                          </div>
                          <div className="text-xs text-slate-200">
                            {formatSpecialRequestKeyLabel(request)}
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
                        .filter((song) => songMatchesGigSection(song, section, currentSetlist.id))
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
                                  {getGigSongSections(currentSetlist.id, song.id).length > 1 && (
                                    <span
                                      className="ml-2 inline-flex rounded-full border border-cyan-300/45 bg-cyan-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-100"
                                      title="In multiple playlists"
                                    >
                                      M
                                    </span>
                                  )}
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
            <div className="flex items-start gap-3">
              <div>
                <h3 className="text-lg font-semibold">Start Gig Mode</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Start gig mode in your current builder layout or open the Active Setlist view.
                </p>
              </div>
              <CloseButton
                className="text-slate-300"
                onClick={() => setShowGigModeLaunchModal(false)}
              />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100"
                onClick={() => {
                  setGigMode(true)
                  setShowGigSetlistSheet(false)
                  setShowGigModeLaunchModal(false)
                }}
              >
                Use Builder View
              </button>
              <button
                className="rounded-xl bg-teal-400/90 px-4 py-3 text-sm font-semibold text-slate-950"
                onClick={() => {
                  setGigMode(true)
                  setShowGigSetlistSheet(true)
                  setShowGigModeLaunchModal(false)
                }}
              >
                Use Active Setlist
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
                  <h3 className="text-lg font-semibold">Active Setlist</h3>
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
                      ? 'liquid-button border-lime-300/60 bg-black text-lime-100 shadow-[0_0_12px_rgba(190,242,100,0.24)]'
                      : 'border-emerald-300/35 bg-black'
                  }`}
                >
                  <div className="flex min-h-[34px] items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${
                        gigSheetQueuedSong ? 'text-emerald-200/90' : 'text-emerald-200/70'
                      }`}
                    >
                      Up Next
                    </span>
                    <div className="grid w-[250px] shrink-0 grid-cols-2 items-center gap-2 md:w-[280px]">
                        <button
                          className={`gig-sheet-clear-upnext relative z-10 flex h-8 w-full items-center justify-center whitespace-nowrap rounded-xl border border-emerald-300/35 bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-100 transition-opacity ${
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
                      gigSheetQueuedSong ? 'text-emerald-100' : 'text-slate-300'
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
                      Add Section
                    </button>
                  )}
                  <CloseButton
                    className="text-slate-300"
                    onClick={closeGigSetlistSheet}
                  />
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
                      const displayAssignments = getSpecialRequestDisplayAssignments(request)
                      return (
                        <div
                          key={`gig-sheet-special-${request.id}`}
                          role={request.songId ? 'button' : undefined}
                          tabIndex={request.songId ? 0 : -1}
                          draggable={isAdmin}
                          className={`print-row ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${isLocked ? 'opacity-45' : ''} ${
                            request.songId && appState.currentSongId === request.songId
                              ? 'ring-2 ring-emerald-300/80 shadow-[0_0_18px_rgba(74,222,128,0.35)]'
                              : ''
                          }`}
                          onDragStart={(event) => {
                            if (!isAdmin) return
                            clearSheetLongPress()
                            setDraggedSpecialRequestId(request.id)
                            setDragOverSpecialRequestId(null)
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', request.id)
                          }}
                          onDragOver={(event) => {
                            if (!isAdmin) return
                            event.preventDefault()
                            event.dataTransfer.dropEffect = 'move'
                            autoScrollDragContainer(event)
                            setDragOverSpecialRequestId(request.id)
                          }}
                          onDrop={(event) => {
                            if (!isAdmin) return
                            event.preventDefault()
                            const fromId = draggedSpecialRequestId ?? event.dataTransfer.getData('text/plain')
                            if (!fromId) return
                            reorderSpecialRequests(fromId, request.id)
                            setDraggedSpecialRequestId(null)
                            setDragOverSpecialRequestId(null)
                          }}
                          onDragEnd={() => {
                            setDraggedSpecialRequestId(null)
                            setDragOverSpecialRequestId(null)
                          }}
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
                                : displayAssignments.singers.length
                                  ? formatSingerAssignmentNames(displayAssignments.singers)
                                  : 'No singers'}
                            </span>
                            <span className="musical-key">{formatSpecialRequestKeyLabel(request)}</span>
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
                              className="rounded-lg border border-red-400/40 px-2 py-1 text-[10px] text-red-200"
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
                          const keySummary = getGigKeySummary(song.id, currentSetlist.id)
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
                                className={`print-row song-row gig-sheet-row transition-all duration-150 ${isLocked ? 'opacity-45' : ''} ${
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
                                    {getGigSongSections(currentSetlist.id, song.id).length > 1 && (
                                      <span
                                        className="ml-1 inline-flex rounded-full border border-cyan-300/50 bg-cyan-400/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-100"
                                        title="In multiple playlists"
                                      >
                                        M
                                      </span>
                                    )}
                                    <span className="gig-sheet-artist-inline">- {song.artist || 'Unknown'}</span>
                                  </div>
                                  <div
                                    className={`gig-sheet-singer-line ${
                                      isQueuedOrPlayed ? 'line-through decoration-2 opacity-70' : ''
                                    }`}
                                  >
                                    {singers.length ? formatSingerFirstNames(singers) : 'No singers'}
                                  </div>
                                  <div
                                    className={`gig-sheet-singer-line ${
                                      isQueuedOrPlayed ? 'line-through decoration-2 opacity-70' : ''
                                    }`}
                                  >
                                    Key: {keySummary || '—'}
                                  </div>
                                </div>
                                {isAdmin && !isQueuedOrPlayed && (
                                  <button
                                    className="gig-sheet-remove-inline"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      requestRemoveSong(song.id, section)
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
          className={`playlist-modal-shell fixed inset-0 z-[98] overflow-y-auto overflow-x-hidden bg-slate-950/90 pb-[calc(7.25rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:overflow-hidden ${
            isIOSStandaloneMode ? 'playlist-modal-ios-standalone' : ''
          }`}
        >
          <div
            className="flex min-h-dvh w-full flex-col overflow-visible bg-slate-900 md:h-full md:min-h-0 md:overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 shrink-0 border-b border-white/10 bg-slate-900/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pr-2">
                  <h3 className="text-lg font-semibold">Active Setlist</h3>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                  {playlistModalTab === 'playlist' ? (
                    <span className="hidden text-xs text-slate-400 sm:inline">
                      {visiblePlaylistEntries.length
                        ? `${playlistIndex + 1} / ${visiblePlaylistEntries.length}`
                        : 'No playable songs'}
                    </span>
                  ) : null}
                  <CloseButton
                    className="text-slate-300"
                    onClick={() => setShowPlaylistModal(false)}
                  />
                </div>
              </div>
              {playlistModalTab === 'playlist' ? (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-end sm:hidden">
                    <span className="text-xs text-slate-400">
                      {visiblePlaylistEntries.length
                        ? `${playlistIndex + 1} / ${visiblePlaylistEntries.length}`
                        : 'No playable songs'}
                    </span>
                  </div>
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
                  <div className="grid grid-cols-1 gap-2">
                    <div className="min-h-[44px] rounded-xl border border-teal-300/60 bg-teal-400/10 px-2 py-2 text-center text-xs text-teal-100">
                      Auto-next: On
                    </div>
                  </div>
                  {playlistShareStatus ? (
                    <span className="text-xs text-teal-200">{playlistShareStatus}</span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-visible md:overflow-hidden">
              {playlistModalTab === 'setlist' ? (
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-2 sm:px-5 sm:pt-3 md:h-full md:pb-4">
                  {isAdmin && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="min-h-[44px] rounded-xl border border-indigo-300/60 bg-indigo-500/20 px-4 text-sm font-semibold text-indigo-100"
                        onClick={() => void copyPlaylistShareLink({ fromFirstSong: true })}
                      >
                        Copy Guest Link
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-teal-300/50 bg-teal-400/10 px-4 text-sm font-semibold text-teal-100 shadow-[0_0_18px_rgba(20,184,166,0.18)]"
                        onClick={handlePrintSetlist}
                        title="Print or download setlist PDF"
                        aria-label="Print or download setlist PDF"
                      >
                        <img src={downloadPdfIcon} alt="" className="h-5 w-5 shrink-0 object-contain" />
                        Print / PDF
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 bg-slate-900/70 px-4 text-sm font-semibold text-slate-200"
                        onClick={() => void copySetlistForExcel()}
                      >
                        Copy for Excel
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 bg-slate-900/70 px-4 text-sm font-semibold text-slate-200"
                        onClick={handleDownloadOfflineGig}
                      >
                        Save Offline Copy
                      </button>
                      {playlistShareStatus ? (
                        <span className="text-xs text-teal-200">{playlistShareStatus}</span>
                      ) : null}
                      {offlineExportStatus ? (
                        <span className="text-xs text-teal-200">{offlineExportStatus}</span>
                      ) : null}
                      {setlistCopyStatus ? (
                        <span className="text-xs text-teal-200">{setlistCopyStatus}</span>
                      ) : null}
                    </div>
                  )}
                  <div className="w-full bg-white shared-setlist-shell sm:rounded-2xl sm:p-6">
                    <div className="print-container shared-setlist-container">
                      <div className="print-header">
                        <div className="print-band-name">
                          {activeBandName?.trim() || currentSetlist.gigName || 'Band'}
                        </div>
                        <div className="print-header-details">
                          <div className="print-title">{currentSetlist.gigName}</div>
                          <div className="print-subtitle">{formatGigDate(currentSetlist.date)}</div>
                          {currentSetlist.venueAddress ? (
                            <div className="print-subtitle">{currentSetlist.venueAddress}</div>
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
                            {printableGigMusicians.map((musician) => (
                              <div key={`modal-sheet-musician-${musician.id}`} className="print-card">
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
                            {printableGigMusicians.length === 0 && (
                              <div className="print-empty">No musicians assigned.</div>
                            )}
                          </div>
                        </div>
                        {groupedPlaylistSections.map((group) => (
                          <div
                            key={`modal-sheet-section-${group.section}`}
                            className={`print-section-box ${getPrintToneClass(group.section)} ${getPrintLayoutClass(group.section)}`}
                          >
                            <div className="print-section-title">{group.section}</div>
                            <div className="print-list">
                              {group.items.map(({ entry: item }) => {
                                const singerNames = Array.from(new Set(item.assignmentSingers ?? []))
                                const isDjOnly =
                                  item.tags.some((tag) => tag.trim().toLowerCase() === 'dj only') ||
                                  singerNames.some((name) => name.trim().toLowerCase() === 'dj')
                                const assignmentKeys = item.assignmentKeys ?? []
                                const keyLabel =
                                  assignmentKeys.length === 0
                                    ? 'No key'
                                    : assignmentKeys.length === 1
                                      ? assignmentKeys[0]
                                      : 'Multi'
                                const highlightId =
                                  visiblePlaylistEntries[playlistIndex]?.songId ?? null
                                const rowHighlight =
                                  (highlightId && highlightId === item.songId) ||
                                  (sharedNowPlayingSongId && sharedNowPlayingSongId === item.songId)
                                return (
                                  <div
                                    key={`modal-sheet-row-${item.key}`}
                                    className={`print-row song-row ${
                                      rowHighlight ? 'ring-2 ring-emerald-300/80' : ''
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
                                      {item.songId &&
                                        getDocumentSelectionItems(item.songId).some(
                                          (doc) => doc.type === 'Lyrics',
                                        ) && (
                                        <button
                                          type="button"
                                          className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300/70 bg-white text-[13px] text-slate-700"
                                          title="Open lyrics"
                                          aria-label="Open lyrics"
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            openLyricsForSong(item.songId)
                                          }}
                                        >
                                          📜
                                        </button>
                                      )}
                                    </div>
                                    <div className="print-row-subtitle print-song-meta">
                                      <span className="musical-key text-[0.72em]">{keyLabel}</span>
                                      <span
                                        className={`print-assignee-names text-[0.62em] ${
                                          isDjOnly
                                            ? 'rounded-full border border-rose-300/35 bg-rose-900/45 px-2 py-0.5 text-rose-100'
                                            : ''
                                        }`}
                                      >
                                        {isDjOnly
                                          ? 'DJ ONLY'
                                          : singerNames.length
                                            ? formatSingerAssignmentNames(singerNames)
                                            : 'No singers'}
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
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-visible px-4 pb-[calc(7.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-4 md:h-full md:flex-row md:gap-4 md:overflow-hidden md:pb-4">
              <div
                ref={playlistPlayerBlockRef}
                className={`relative z-10 flex min-h-0 w-full flex-col md:min-h-0 md:flex-1 ${
                  widePlaylistUi && playlistDrawerOverlay
                    ? 'pointer-events-none opacity-0 md:pointer-events-auto md:opacity-100'
                    : 'opacity-100'
                }`}
              >
              {currentPlaylistEntry ? (
                <div className="min-h-0 max-h-[min(50vh,440px)] w-full shrink-0 overflow-y-auto overflow-x-hidden md:max-h-none md:shrink">
                <div className="rounded-2xl bg-gradient-to-b from-slate-900/70 to-slate-950/60 p-4 shadow-[0_12px_36px_rgba(2,6,23,0.45)] ring-1 ring-white/10 transition-all duration-150">
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
                      <div className="relative aspect-video w-full max-h-[min(52vh,320px)] overflow-hidden rounded-xl ring-1 ring-white/10 md:max-h-[min(58vh,520px)]">
                        <div className="absolute inset-0 z-0 min-h-[160px]">
                          <PlaylistYouTubePlayer
                            ref={playlistModalYtHandleRef}
                            key={`${currentPlaylistEntry.key}-${playlistPlayNonce}-modal-yt`}
                            watchUrl={currentPlaylistEntry.audioUrl}
                            playNonce={playlistPlayNonce}
                            className="h-full w-full"
                            onEnded={handlePlaylistYoutubeEnded}
                            autoplay
                          />
                        </div>
                      </div>
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
                </div>
              ) : (
                <div className="shrink-0 rounded-2xl bg-gradient-to-b from-slate-900/70 to-slate-950/60 p-4 text-sm text-slate-300 shadow-[0_12px_36px_rgba(2,6,23,0.45)] ring-1 ring-white/10">
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
                className={`z-20 min-h-0 overflow-visible rounded-2xl border border-white/10 bg-slate-900 shadow-xl transition-all duration-150 md:h-full md:w-[300px] md:shrink-0 md:overflow-hidden ${
                  widePlaylistUi
                    ? 'absolute inset-x-0 bottom-0 shadow-2xl md:static md:inset-auto'
                    : 'flex min-h-[36vh] flex-1 flex-col'
                }`}
                style={
                  widePlaylistUi
                    ? { top: playlistDrawerOverlay ? 0 : playlistDrawerDockTop }
                    : undefined
                }
                onTouchStart={handlePlaylistDrawerTouchStart}
                onTouchMove={handlePlaylistDrawerTouchMove}
                onTouchEnd={handlePlaylistDrawerTouchEnd}
              >
                <div className={`flex items-center justify-center py-2 ${widePlaylistUi ? 'md:hidden' : 'hidden'}`}>
                  <div className="h-1 w-12 rounded-full bg-white/25" />
                </div>
                <div
                  className={`min-h-0 overflow-visible px-2 pb-[calc(7.75rem+env(safe-area-inset-bottom))] md:h-full md:max-h-full md:overflow-y-auto md:overscroll-contain md:pb-2 ${
                    widePlaylistUi ? 'max-h-full' : 'flex-1'
                  }`}
                  onScroll={handlePlaylistDrawerScroll}
                >
                  <div className="space-y-3 pb-2">
                    <div className="sticky top-0 z-10 bg-slate-900/95 pb-2 pt-1 backdrop-blur md:pt-2">
                      <select
                        className="min-h-[38px] w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus:border-teal-300"
                        value={playlistSingerFilter}
                        onChange={(event) => setPlaylistSingerFilter(event.target.value)}
                        aria-label="Filter songs by singer"
                      >
                        <option value="__all__">All singers</option>
                        {playlistSingerOptions.map((singer) => (
                          <option key={`playlist-singer-${singer}`} value={singer}>
                            {singer}
                          </option>
                        ))}
                      </select>
                    </div>
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
              )}
            </div>
            <nav
              className={`playlist-modal-bottom-nav fixed inset-x-0 bottom-0 z-[120] border-t border-white/10 bg-slate-950 px-3 pb-[env(safe-area-inset-bottom)] backdrop-blur ${
                isIOSStandaloneMode ? 'playlist-modal-bottom-nav-ios' : ''
              }`}
              aria-label="Active Setlist views"
            >
              <div className="mx-auto flex w-full max-w-3xl items-stretch justify-between gap-2 py-3">
                <button
                  type="button"
                  className={`flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-sm font-semibold shadow-lg transition ${
                    playlistModalTab === 'setlist'
                      ? 'border-teal-300/70 bg-teal-500 text-slate-950'
                      : 'border-white/10 bg-slate-900 text-slate-200'
                  }`}
                  onClick={() => setPlaylistModalTab('setlist')}
                >
                  <img src={downloadPdfIcon} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  Setlist
                </button>
                <button
                  type="button"
                  className={`flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-sm font-semibold shadow-lg transition ${
                    playlistModalTab === 'playlist'
                      ? 'border-teal-300/70 bg-teal-500 text-slate-950'
                      : 'border-white/10 bg-slate-900 text-slate-200'
                  }`}
                  onClick={() => setPlaylistModalTab('playlist')}
                >
                  <img src={openPlaylistIcon} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  Audio
                </button>
              </div>
            </nav>
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
                      className="min-w-[120px] rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
                      onClick={handlePrintSetlistPDF}
                    >
                      Print
                    </button>
                    <button
                      className="liquid-button min-w-[160px] rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(20,184,166,0.3)] transition-colors hover:bg-teal-400 disabled:cursor-wait disabled:opacity-70"
                      onClick={handleDownloadPDF}
                      disabled={pdfDownloadLoading}
                    >
                      {pdfDownloadLoading ? 'Preparing...' : 'Download PDF'}
                    </button>
                    <CloseButton
                      className="text-slate-300 hover:bg-white/5 transition-colors"
                      onClick={() => setShowPrintPreview(false)}
                    />
                  </div>
                </div>
                {pdfDownloadStatus ? (
                  <div className="mt-2 text-right text-xs text-teal-200">{pdfDownloadStatus}</div>
                ) : null}
              </div>
              <div className="max-h-[calc(90vh-96px)] overflow-auto bg-slate-950/50 p-6">
                <div className="mx-auto w-full max-w-[900px] rounded-[2px] bg-white p-8 shadow-2xl ring-1 ring-white/10">
                  <div id="printable-setlist-preview" className="print-container pdf-export-mode">
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

                      {chunkList(
                        getOrderedSpecialRequests(currentSetlist.id),
                        PRINT_SPECIAL_REQUESTS_PER_SECTION,
                      ).flatMap((requestChunk, chunkIndex) =>
                        requestChunk.length === 0
                          ? []
                          : [
                              <div
                                key={`special-print-chunk-${chunkIndex}`}
                                className={`print-section-box ${getPrintToneClass('special requests')} ${getPrintLayoutClass('special requests')}`}
                              >
                                <div className="print-section-title">
                                  Special Requests{chunkIndex > 0 ? ' (continued)' : ''}
                                </div>
                                <div className="print-list">
                                  {requestChunk.map((request) => {
                                    const song = appState.songs.find((item) => item.id === request.songId)
                                    const displayAssignments = getSpecialRequestDisplayAssignments(request)
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
                                              : displayAssignments.singers.length
                                                ? formatSingerAssignmentNames(displayAssignments.singers)
                                                : 'No singers'}
                                          </span>{' '}
                                      · {formatSpecialRequestKeyLabel(request)}
                                    </div>
                                    {request.note && <div className="print-row-note">{request.note}</div>}
                                  </div>
                                    )
                                  })}
                                </div>
                              </div>,
                            ],
                      )}

                      {orderedPrintableSongSections.flatMap((section) => {
                        const songs = currentSetlist.songIds
                          .map((songId) => appState.songs.find((song) => song.id === songId))
                          .filter((song): song is Song => Boolean(song))
                          .filter((song) => songMatchesGigSection(song, section, currentSetlist.id))
                        const sectionChunks = chunkList(songs, getPrintableSongChunkSize(section))
                        return sectionChunks.map((songChunk, chunkIndex) => (
                          <div
                            key={`stacked-${section}-${chunkIndex}`}
                            className={`print-section-box ${getPrintToneClass(section)} ${getPrintLayoutClass(section)}`}
                          >
                            <div className="print-section-title">
                              {getPrintableSectionTitle(section, chunkIndex > 0)}
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
              <div className="flex items-start gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Add musician</h3>
                  <p className="mt-1 text-sm text-slate-300">
                    Mark core members or subs. Add contact info and instruments.
                  </p>
                </div>
                <CloseButton onClick={() => setShowAddMusicianModal(false)} />
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
              <div className="flex items-start gap-3">
                <h3 className="text-lg font-semibold">Add new song</h3>
                <CloseButton
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
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] justify-center rounded-xl bg-teal-400/90 px-4 py-2 text-center text-sm font-semibold text-slate-950"
                  onClick={() => addSongFromAdmin(false)}
                >
                  Add song
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
                    {normalizeTagList(['DJ Only', ...setlistTypeTags]).map((tag) => {
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
                  Add New Sub
                </button>
                <CloseButton
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
                />
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
              <div className="flex items-start gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Song</p>
                  <h3 className="text-lg font-semibold">Edit song</h3>
                  <p className="mt-1 truncate text-sm text-teal-200">
                    {editingSongTitle.trim() || 'Untitled song'}
                  </p>
                </div>
                <CloseButton onClick={cancelEditSong} />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={() => {
                    void handleSaveSongEditor()
                  }}
                >
                  Save
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
                {normalizeTagList(['DJ Only', ...setlistTypeTags]).map((tag) => {
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
                              openExternalUrlSafely(doc.url)
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
              <div className="flex items-center justify-between gap-3">
                <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">
                  {activeBuildPanel === 'musicians'
                    ? 'Assign Musicians'
                    : activeBuildPanel === 'addSongs'
                      ? 'Add Songs Not on Setlist'
                      : activeBuildPanel === 'special'
                        ? 'Special Requests'
                        : getSectionFromPanel(activeBuildPanel) ?? 'Setlist'}
                </h3>
                <CloseButton onClick={() => setActiveBuildPanel(null)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
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
                      {normalizeTagList(['DJ Only', ...setlistTypeTags]).map((tag) => (
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
                      <div className="flex items-center gap-2">
                        <button
                          className="min-w-[92px] rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
                          onClick={() => {
                            resetPendingSpecialRequest()
                            setShowSpecialRequestModal(true)
                          }}
                        >
                          Add Request
                        </button>
                        <button
                          className="min-w-[92px] rounded-xl border border-rose-300/35 bg-rose-900/30 px-4 py-2 text-sm font-semibold text-rose-100"
                          onClick={() => {
                            resetPendingSpecialRequest()
                            setPendingSpecialType('DJ Only')
                            setPendingSpecialDjOnly(true)
                            setShowSpecialRequestModal(true)
                          }}
                        >
                          Add DJ Track
                        </button>
                      </div>
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
                        const displayAssignments = getSpecialRequestDisplayAssignments(request)
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
                              draggable={isAdmin}
                              className={`grid items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm md:grid-cols-[.9fr_1.4fr_1fr_.6fr_.4fr] ${
                                isAdmin ? 'cursor-grab active:cursor-grabbing' : gigMode ? 'cursor-pointer' : ''
                              } ${
                                isLockedInGigMode ? 'opacity-45' : ''
                              }`}
                              onDragStart={(event) => {
                                if (!isAdmin) {
                                  event.preventDefault()
                                  return
                                }
                                setDraggedSpecialRequestId(request.id)
                                setDragOverSpecialRequestId(null)
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', request.id)
                              }}
                              onDragOver={(event) => {
                                if (!isAdmin) return
                                event.preventDefault()
                                event.dataTransfer.dropEffect = 'move'
                                autoScrollDragContainer(event)
                                setDragOverSpecialRequestId(request.id)
                              }}
                              onDrop={(event) => {
                                if (!isAdmin) return
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
                              {request.djOnly || request.origin === 'dj_track'
                                ? request.type || 'DJ Only'
                                : 'Special Request'}
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
                              {(request.artist || song?.artist) && (
                                <div className="text-[10px] text-slate-400">
                                  {request.artist || song?.artist}
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
                                displayAssignments.singers.some(
                                  (singer) =>
                                    singer.trim().toLowerCase() ===
                                    INSTRUMENTAL_LABEL.toLowerCase(),
                                )
                                  ? 'text-fuchsia-200'
                                  : 'text-slate-300'
                              }`}
                            >
                              {request.djOnly
                                ? 'DJ ONLY'
                                : displayAssignments.singers.length
                                  ? displayAssignments.singers.join(', ')
                                  : 'No singers'}
                            </div>
                            <div className="text-xs text-slate-200">
                              {formatSpecialRequestKeyLabel(request)}
                            </div>
                            <div className="flex items-center justify-start gap-2 text-xs text-slate-400">
                              {request.note ? 'ℹ️' : ''}
                              {!gigMode && (
                                <>
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
                                  <button
                                    type="button"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-400/40 text-red-200"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      deleteSpecialRequest(request.id)
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    aria-label="Delete special request"
                                    title="Delete special request"
                                  >
                                    ✕
                                  </button>
                                </>
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
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="text-sm font-semibold whitespace-nowrap">
                            {section}
                          </h3>
                          {!gigMode && (
                            <button
                              type="button"
                              className="rounded-lg border border-white/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200"
                              onClick={() => {
                                const nextName = window.prompt('Rename section', section)?.trim() ?? ''
                                if (!nextName || nextName.toLowerCase() === section.toLowerCase()) return
                                renameGigSetlistSectionLabel(section, nextName)
                              }}
                            >
                              Rename
                            </button>
                          )}
                        </div>
                        {!buildCompletion[completionKey] && !gigMode && (
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-teal-200/90">
                              ↻ Import from gig
                            </span>
                            <select
                              className="w-[240px] shrink-0 rounded-xl border border-teal-300/30 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-slate-100"
                              onChange={(event) => {
                                if (event.target.value) {
                                  openImportReviewFromGig(section, event.target.value)
                                  event.target.value = ''
                                }
                              }}
                            >
                              <option value="">Select previous gig to import</option>
                              {recentGigs.map((gig) => (
                                <option key={gig.id} value={gig.id}>
                                  {gig.gigName} · {gig.date}
                                </option>
                              ))}
                            </select>
                            {starterPasteOpen[section] && (
                              <CloseButton
                                onClick={() =>
                                  setStarterPasteOpen((prev) => ({
                                    ...prev,
                                    [section]: false,
                                  }))
                                }
                              />
                            )}
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Songs tagged for {section.toLowerCase()}.
                      </p>
                      {!buildCompletion[completionKey] && !gigMode && (
                        <p className="mt-1 text-[10px] text-slate-500">
                          Drag songs to reorder this section. Previous-gig imports use singers on this gig and
                          pull their saved key history when available.
                        </p>
                      )}
                      {!buildCompletion[completionKey] && !gigMode && (
                        <div className="mt-3 space-y-3">
                          <div className="flex items-center gap-2">
                            <button
                              className="min-w-[170px] whitespace-nowrap rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
                              onClick={() =>
                                setStarterPasteOpen((prev) => ({
                                  ...prev,
                                  [section]: !prev[section],
                                }))
                              }
                            >
                              Paste starter list
                            </button>
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
                                className={`rounded-2xl border px-3 py-2 text-xs transition-all duration-150 ${
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
                                    {getGigSongSections(currentSetlist.id, song.id).length > 1 && (
                                      <span
                                        className="ml-2 inline-flex rounded-full border border-cyan-300/45 bg-cyan-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-100"
                                        title="In multiple playlists"
                                      >
                                        M
                                      </span>
                                    )}
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
                                    const assignmentLabel = !assignments.length
                                      ? 'No vocalist/key'
                                      : keys.length === 1
                                        ? `${singers.join(', ')} · Key: ${keys[0]}`
                                        : `${singers.join(', ')} · Multiple keys`
                                    const actionLabel = assignments.length ? 'Edit' : 'Assign'
                                    return (
                                      <button
                                        type="button"
                                        className={`mt-3 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                                          assignments.length === 0
                                            ? 'border-red-300/40 bg-red-400/10 text-red-200'
                                            : hasInstrumental
                                              ? 'border-fuchsia-300/40 bg-fuchsia-400/10 text-fuchsia-100'
                                              : 'border-teal-300/40 bg-teal-400/10 text-teal-100'
                                        }`}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          openSingerModal(song.id)
                                        }}
                                      >
                                        <span>{actionLabel}</span>
                                        <span className="font-medium opacity-85">{assignmentLabel}</span>
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
                                          requestRemoveSong(song.id, section)
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
          className={`pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-teal-400/90 px-4 py-2 text-xs font-semibold text-slate-950 shadow-lg transition-opacity duration-200 ${
            showUndoToast ? 'opacity-100' : 'opacity-0'
          }`}
        >
          Change saved.
          <button className="pointer-events-auto ml-3 underline" onClick={undoLast}>
            Undo
          </button>
        </div>
      )}
      {generalToast && (
        <div className="pointer-events-none fixed bottom-28 left-1/2 z-[9999] -translate-x-1/2 rounded-full bg-teal-400/90 px-4 py-2 text-xs font-semibold text-slate-950 shadow-lg">
          {generalToast}
        </div>
      )}
      {sectionSaveStatus && (
        <div
          className={`pointer-events-none fixed bottom-32 left-1/2 z-[130] -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold shadow-lg ${
            sectionSaveStatus.toLowerCase().includes('failed')
              ? 'bg-red-400 text-slate-950'
              : 'bg-teal-400 text-slate-950'
          }`}
        >
          {sectionSaveStatus}
        </div>
      )}
      {qaToolsEnabled && (
        <div className="fixed bottom-4 right-4 z-[390] w-[min(92vw,19rem)] rounded-2xl border border-cyan-300/35 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">QA</p>
              <p className="text-xs font-semibold text-white">View switcher</p>
            </div>
            <span className="rounded-full border border-cyan-300/35 px-2 py-0.5 text-[10px] text-cyan-100">
              {qaPreset === 'off' ? 'Live session' : qaPreset}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-300">
            <span className="rounded-full border border-white/10 px-2 py-0.5">
              Role: {role ?? 'guest'}
            </span>
            <span className="rounded-full border border-white/10 px-2 py-0.5">
              Screen: {screen}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 ${
                sharedPlaylistView
                  ? 'border border-emerald-300/45 bg-emerald-500/15 text-emerald-100'
                  : 'border border-white/10 bg-white/5 text-slate-300'
              }`}
            >
              Shared: {sharedPlaylistView ? 'on' : 'off'}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 ${
                gigMode
                  ? 'border border-emerald-300/45 bg-emerald-500/15 text-emerald-100'
                  : 'border border-white/10 bg-white/5 text-slate-300'
              }`}
            >
              Gig mode: {gigMode ? 'on' : 'off'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="rounded-lg border border-white/15 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-cyan-300/45 hover:text-cyan-100"
              onClick={activateQaMasterView}
            >
              Master
            </button>
            <button
              className="rounded-lg border border-white/15 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-cyan-300/45 hover:text-cyan-100"
              onClick={activateQaMemberView}
            >
              Member
            </button>
            <button
              className="rounded-lg border border-white/15 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-cyan-300/45 hover:text-cyan-100"
              onClick={activateQaNewUserView}
            >
              New user
            </button>
            <button
              className="rounded-lg border border-white/15 px-2 py-2 text-[11px] font-semibold text-slate-200 hover:border-cyan-300/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={activateQaSharedGuestView}
              disabled={!currentSetlist || playlistEntries.length === 0}
              title={!currentSetlist || playlistEntries.length === 0 ? 'Open a setlist with songs first' : ''}
            >
              Shared guest
            </button>
          </div>
          <button
            className="mt-2 w-full rounded-lg border border-white/15 px-2 py-2 text-[11px] font-semibold text-slate-300 hover:border-red-300/50 hover:text-red-100"
            onClick={resetQaView}
          >
            Reset to live
          </button>
          <p className="mt-2 text-[10px] text-slate-400">Local QA only. No writes are triggered by these toggles.</p>
        </div>
      )}
      </div>
    </div>
    </AppProvider>
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
  icon: ReactNode
  label: string
}) {
  return (
    <button
      className={`flex min-h-[62px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-2 py-2 text-center ${
        active ? 'bg-teal-400/20 text-teal-200' : 'text-slate-300'
      }`}
      onClick={onClick}
    >
      <span className="text-[1.65rem] leading-none">{icon}</span>
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

function replaceHistorySearchParams(params: URLSearchParams) {
  const next = params.toString()
  const newUrl = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', newUrl)
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

function parseSharedPlaylistQuery(search: string) {
  const params = new URLSearchParams(search)
  if (params.get('playlist') !== '1') return null
  const setlistId = sanitizeSharedText(params.get('setlist'), MAX_SHARED_ID_LENGTH)
  if (!setlistId) return null
  const requestedIndexRaw = Number.parseInt(params.get('item') ?? '0', 10)
  const requestedIndex =
    Number.isFinite(requestedIndexRaw) && requestedIndexRaw >= 0 ? requestedIndexRaw : 0
  const sharedBandNameParam = sanitizeSharedText(
    safeDecodeURIComponent(params.get('band') ?? ''),
    MAX_SHARED_BAND_NAME_LENGTH,
  )
  const sharedMusiciansParam = parseSharedMusiciansPayload(params.get('musicians'))
  const payloadEncoded = params.get('data')
  const parsedPayload = payloadEncoded ? parseSharedPlaylistPayload(payloadEncoded) : null
  return {
    setlistId,
    requestedIndex,
    sharedBandNameParam,
    sharedMusiciansParam,
    parsedPayload,
  }
}

const MAX_SHARED_PAYLOAD_PARAM_LENGTH = 200_000
const MAX_SHARED_MUSICIANS_PARAM_LENGTH = 60_000
const MAX_SHARED_PLAYLIST_ENTRIES = 1500
const MAX_SHARED_MUSICIANS = 300
const MAX_SHARED_ID_LENGTH = 120
const MAX_SHARED_TITLE_LENGTH = 200
const MAX_SHARED_ARTIST_LENGTH = 160
const MAX_SHARED_URL_LENGTH = 4096
const MAX_SHARED_TAGS_PER_ENTRY = 24
const MAX_SHARED_ASSIGNMENTS_PER_ENTRY = 24
const MAX_SHARED_BAND_NAME_LENGTH = 160
const MAX_SHARED_GIG_NAME_LENGTH = 180
const MAX_SHARED_DATE_LENGTH = 40
const MAX_SHARED_VENUE_LENGTH = 240
const MAX_SHARED_MUSICIAN_NAME_LENGTH = 140
const MAX_SHARED_EMAIL_LENGTH = 254
const MAX_SHARED_PHONE_LENGTH = 48
const MAX_SHARED_INSTRUMENTS_PER_MUSICIAN = 16
const MAX_SHARED_INSTRUMENT_LENGTH = 64

function sanitizeSharedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.slice(0, maxLength)
}

function sanitizeSharedUrl(value: unknown, maxLength: number): string {
  const trimmed = sanitizeSharedText(value, maxLength)
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return trimmed
  } catch {
    return ''
  }
}

function sanitizeSharedStringArray(values: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const next: string[] = []
  values.forEach((value) => {
    if (next.length >= maxItems) return
    const sanitized = sanitizeSharedText(value, maxItemLength)
    if (!sanitized) return
    const key = sanitized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    next.push(sanitized)
  })
  return next
}

function sanitizePlaylistEntry(entry: unknown, index: number): PlaylistEntry | null {
  if (!entry || typeof entry !== 'object') return null
  const source = entry as Partial<PlaylistEntry>
  const key = sanitizeSharedText(source.key, MAX_SHARED_ID_LENGTH) || `entry:${index}`
  const title = sanitizeSharedText(source.title, MAX_SHARED_TITLE_LENGTH) || 'Untitled Song'
  const artist = sanitizeSharedText(source.artist, MAX_SHARED_ARTIST_LENGTH)
  const audioUrl = sanitizeSharedUrl(source.audioUrl, MAX_SHARED_URL_LENGTH)
  const songId = sanitizeSharedText(source.songId, MAX_SHARED_ID_LENGTH)
  const tags = sanitizeSharedStringArray(source.tags, MAX_SHARED_TAGS_PER_ENTRY, MAX_SHARED_TITLE_LENGTH)
  const assignmentSingers = sanitizeSharedStringArray(
    source.assignmentSingers,
    MAX_SHARED_ASSIGNMENTS_PER_ENTRY,
    MAX_SHARED_TITLE_LENGTH,
  )
  const assignmentKeys = sanitizeSharedStringArray(
    source.assignmentKeys,
    MAX_SHARED_ASSIGNMENTS_PER_ENTRY,
    MAX_SHARED_TITLE_LENGTH,
  )
  return {
    key,
    title,
    ...(artist ? { artist } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    tags: tags.length ? tags : ['Setlist'],
    ...(songId ? { songId } : {}),
    ...(assignmentSingers.length ? { assignmentSingers } : {}),
    ...(assignmentKeys.length ? { assignmentKeys } : {}),
  }
}

function sanitizeMusician(entry: unknown, index: number): Musician | null {
  if (!entry || typeof entry !== 'object') return null
  const source = entry as Partial<Musician>
  const id = sanitizeSharedText(source.id, MAX_SHARED_ID_LENGTH) || `musician:${index}`
  const name = sanitizeSharedText(source.name, MAX_SHARED_MUSICIAN_NAME_LENGTH)
  if (!name) return null
  const roster = source.roster === 'sub' ? 'sub' : 'core'
  const instruments = sanitizeSharedStringArray(
    source.instruments,
    MAX_SHARED_INSTRUMENTS_PER_MUSICIAN,
    MAX_SHARED_INSTRUMENT_LENGTH,
  )
  const singer =
    source.singer === 'male' || source.singer === 'female' || source.singer === 'other'
      ? source.singer
      : undefined
  const email = sanitizeSharedText(source.email, MAX_SHARED_EMAIL_LENGTH)
  const phone = sanitizeSharedText(source.phone, MAX_SHARED_PHONE_LENGTH)
  return {
    id,
    name,
    roster,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    instruments,
    ...(singer ? { singer } : {}),
  }
}

function sanitizeMusiciansList(entries: unknown[]): Musician[] {
  const cappedEntries = entries.length > MAX_SHARED_MUSICIANS ? entries.slice(0, MAX_SHARED_MUSICIANS) : entries
  const deduped = new Map<string, Musician>()
  cappedEntries.forEach((entry, index) => {
    const sanitized = sanitizeMusician(entry, index)
    if (!sanitized) return
    const key = sanitized.id.toLowerCase()
    if (deduped.has(key)) return
    deduped.set(key, sanitized)
  })
  return Array.from(deduped.values())
}

function sanitizeSharedPlaylistView(view: SharedPlaylistView | null): SharedPlaylistView | null {
  if (!view || typeof view !== 'object') return null
  const setlistId = sanitizeSharedText(view.setlistId, MAX_SHARED_ID_LENGTH)
  if (!setlistId) return null
  const entriesRaw = Array.isArray(view.entries) ? view.entries : []
  if (entriesRaw.length === 0 || entriesRaw.length > MAX_SHARED_PLAYLIST_ENTRIES) return null
  const entries = entriesRaw
    .map((entry, index) => sanitizePlaylistEntry(entry, index))
    .filter((entry): entry is PlaylistEntry => Boolean(entry))
  if (entries.length === 0) return null
  const allEntriesRaw =
    Array.isArray(view.allEntries) && view.allEntries.length > 0 ? view.allEntries : entriesRaw
  const allEntries = allEntriesRaw
    .map((entry, index) => sanitizePlaylistEntry(entry, index))
    .filter((entry): entry is PlaylistEntry => Boolean(entry))
  return {
    setlistId,
    bandName: sanitizeSharedText(view.bandName, MAX_SHARED_BAND_NAME_LENGTH) || undefined,
    gigName: sanitizeSharedText(view.gigName, MAX_SHARED_GIG_NAME_LENGTH) || 'Shared Gig',
    date: sanitizeSharedText(view.date, MAX_SHARED_DATE_LENGTH),
    venueAddress: sanitizeSharedText(view.venueAddress, MAX_SHARED_VENUE_LENGTH) || undefined,
    musicians: Array.isArray(view.musicians) ? sanitizeMusiciansList(view.musicians) : undefined,
    entries,
    allEntries: allEntries.length ? allEntries : entries,
  }
}

function parseSharedPlaylistPayload(raw: string) {
  if (!raw || raw.length > MAX_SHARED_PAYLOAD_PARAM_LENGTH) return null
  const candidates = [raw, safeDecodeURIComponent(raw)]
  for (const candidate of candidates) {
    if (!candidate || candidate.length > MAX_SHARED_PAYLOAD_PARAM_LENGTH) continue
    try {
      const parsed = JSON.parse(candidate) as SharedPlaylistView
      const sanitized = sanitizeSharedPlaylistView(parsed)
      if (sanitized) return sanitized
    } catch {
      // Continue to base64 decode attempts.
    }
    try {
      const decoded = decodeSharePayloadBase64Url(candidate)
      const parsed = JSON.parse(decoded) as SharedPlaylistView
      const sanitized = sanitizeSharedPlaylistView(parsed)
      if (sanitized) return sanitized
    } catch {
      // Continue to next candidate.
    }
  }
  return null
}

function parseSharedMusiciansPayload(raw: string | null) {
  if (!raw) return []
  if (raw.length > MAX_SHARED_MUSICIANS_PARAM_LENGTH) return []
  const candidates = [raw, safeDecodeURIComponent(raw)]
  for (const candidate of candidates) {
    if (!candidate || candidate.length > MAX_SHARED_MUSICIANS_PARAM_LENGTH) continue
    try {
      const parsed = JSON.parse(candidate) as Musician[]
      if (Array.isArray(parsed)) return sanitizeMusiciansList(parsed)
    } catch {
      // Continue to base64 decode attempts.
    }
    try {
      const decoded = decodeSharePayloadBase64Url(candidate)
      const parsed = JSON.parse(decoded) as Musician[]
      if (Array.isArray(parsed)) return sanitizeMusiciansList(parsed)
    } catch {
      // Continue to next candidate.
    }
  }
  return []
}

function openExternalUrlSafely(url: string) {
  const sanitized = sanitizeSharedUrl(url, MAX_SHARED_URL_LENGTH)
  if (!sanitized) return
  window.open(sanitized, '_blank', 'noopener,noreferrer')
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
