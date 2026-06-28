/**
 * AppContext — lean shared context for the most commonly read state.
 *
 * WHAT belongs here:
 *   - Data that many unrelated components need to READ (songs, musicians, etc.)
 *   - Auth identity (userId, role, activeBandId)
 *   - Band metadata
 *
 * WHAT does NOT belong here:
 *   - State that only one screen or modal touches (keep it local or prop-drilled)
 *   - Large event handlers (keep in App.tsx, pass as props where needed)
 *
 * Usage in any component:
 *   import { useAppContext } from '../context/AppContext'
 *   const { songs, isAdmin, activeBandId } = useAppContext()
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { Song, Setlist, Musician, GigMusician, Chart, Document, SpecialRequest, Band, BandMembership, AppState, Role } from '../types'

// ─── Context shape ────────────────────────────────────────────────────────────

export type AppContextValue = {
  // ── Auth & identity ──────────────────────────────────────────────────────
  authUserId: string | null
  authUserEmail: string | null
  activeBandId: string
  role: Role
  isAdmin: boolean

  // ── Band metadata ─────────────────────────────────────────────────────────
  activeBand: Band | null
  bandMemberships: BandMembership[]

  // ── Core data ─────────────────────────────────────────────────────────────
  songs: Song[]
  setlists: Setlist[]
  musicians: Musician[]
  gigMusicians: GigMusician[]
  charts: Chart[]
  documents: Document[]
  specialRequests: SpecialRequest[]
  tagsCatalog: string[]
  specialTypes: string[]
  singersCatalog: string[]

  // ── Derived / current selection ───────────────────────────────────────────
  currentSetlist: Setlist | null
  currentSongId: string | null

  // ── Full AppState (for legacy compatibility) ──────────────────────────────
  appState: AppState

  // ── Common actions (add more here as modals are migrated) ─────────────────
  /** Show a brief success toast — implemented in App.tsx */
  showToast: (message: string) => void
  /** Update a song in the songs list */
  updateSong: (songId: string, updates: Partial<Song>) => void
}

// ─── Context & hook ───────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used inside <AppProvider>')
  return ctx
}

// ─── Provider ─────────────────────────────────────────────────────────────────

type AppProviderProps = {
  value: AppContextValue
  children: ReactNode
}

export function AppProvider({ value, children }: AppProviderProps) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
