// ─── Core domain types ────────────────────────────────────────────────────────

export type Role = 'admin' | 'user' | null
export type Screen = 'setlists' | 'builder' | 'song' | 'musicians' | 'account'
export type QaViewPreset = 'off' | 'master' | 'member' | 'newUser' | 'sharedGuest'
export type BandTier = 'free' | 'pro'

export type SongKey = {
  singer: string
  defaultKey: string
  gigOverrides: Record<string, string>
}

export type Song = {
  id: string
  title: string
  artist: string
  originalKey?: string
  bpm?: number
  youtubeUrl?: string
  /** Extracted YouTube video ID — e.g. "dQw4w9WgXcQ". Kept in sync with youtubeUrl. */
  youtubeVideoId?: string
  /** True once a band member has confirmed this is the correct YouTube video. */
  youtubeVerified?: boolean
  /** Original release year of the song (e.g. 1978). AI-populated. */
  originalYear?: number
  /** Broad genre/style (e.g. "Pop", "Jazz", "R&B"). AI-populated. */
  genre?: string
  tags: string[]
  keys: SongKey[]
  lyrics?: string
  specialPlayedCount: number
}

export type Setlist = {
  id: string
  gigName: string
  date: string
  songIds: string[]
  venueAddress?: string
}

export type SpecialRequest = {
  id: string
  gigId: string
  type: string
  songTitle: string
  artist?: string
  songId?: string
  singers: string[]
  key: string
  note?: string
  djOnly?: boolean
  externalAudioUrl?: string
  sourceType?: 'spotify_playlist' | 'spotify_track' | 'youtube' | 'apple_music' | 'external'
  origin?: 'special_request' | 'dj_track'
}

export type Chart = {
  id: string
  songId: string
  instrument: string
  title: string
  fileName?: string
}

export type Musician = {
  id: string
  name: string
  roster: 'core' | 'sub'
  email?: string
  phone?: string
  instruments: string[]
  singer?: 'male' | 'female' | 'other'
}

export type GigMusician = {
  gigId: string
  musicianId: string
  status: 'active' | 'out'
  note?: string
}

export type Band = {
  id: string
  name: string
  createdBy?: string
}

export type BandMembership = {
  id: string
  bandId: string
  userId: string
  role: 'admin' | 'member'
  status: 'active' | 'invited' | 'revoked'
  musicianId?: string
}

export type Document = {
  id: string
  songId: string
  type: 'Chart' | 'Lyrics' | 'Lead Sheet'
  instrument: string
  title: string
  url?: string
  content?: string
}

export type PlaylistEntry = {
  key: string
  title: string
  artist?: string
  audioUrl?: string
  tags: string[]
  songId?: string
  assignmentSingers?: string[]
  assignmentKeys?: string[]
}

export type SharedPlaylistView = {
  setlistId: string
  bandName?: string
  gigName: string
  date: string
  venueAddress?: string
  musicians?: Musician[]
  entries: PlaylistEntry[]
  allEntries?: PlaylistEntry[]
}

export type DocumentSelectionItem = {
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

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// ─── Lyrics types ─────────────────────────────────────────────────────────────

export type LyricsHighlightRange = {
  id: string
  start: number
  end: number
  color: string
}

export type LyricsStrokePoint = {
  x: number
  y: number
}

export type LyricsStroke = {
  id: string
  color: string
  width: number
  points: LyricsStrokePoint[]
}

export type LyricsDocState = {
  fontScale: number
  highlights: LyricsHighlightRange[]
  strokes: LyricsStroke[]
  editedText?: string
}

export type LyricsUserPrefs = {
  theme: 'dark' | 'light'
  font: 'sans' | 'serif' | 'mono'
  fontScale: number
  centered: boolean
}

export type LyricsUndoState = {
  kind: 'prefs'
  viewerId: string
  prev: LyricsUserPrefs
}

export type LyricsToolPanelKey = 'font' | 'edit' | 'draw'

export type LyricsToolPanelPosition = {
  x: number
  y: number
}

// ─── App state ────────────────────────────────────────────────────────────────

export type AppState = {
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

export type HistoryEntry = {
  label: string
  state: AppState
  timestamp: string
}
