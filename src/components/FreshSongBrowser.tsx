/**
 * FreshSongBrowser
 *
 * Shows songs from the library that have NOT appeared in the last N gigs.
 * Useful when building a new setlist and searching for songs to play.
 *
 * Usage:
 *   <FreshSongBrowser
 *     currentGigId={currentSetlist.id}
 *     onAddSong={(songId) => addSongToCurrentSetlist(songId)}
 *   />
 *
 * Reads songs + setlists from AppContext — no extra props needed.
 */

import { useMemo, useState } from 'react'
import { useAppContext } from '../context/AppContext'
import type { Song } from '../types'

type FreshSongBrowserProps = {
  /** The gig we're building — excluded from the "recent gigs" window */
  currentGigId: string
  /** Called when user taps "Add" on a song */
  onAddSong: (songId: string) => void
  /** Song IDs already in the current setlist — shown as already added */
  currentSetlistSongIds?: string[]
}

const WINDOW_OPTIONS = [5, 10, 15, 20] as const
type WindowSize = (typeof WINDOW_OPTIONS)[number]

export function FreshSongBrowser({
  currentGigId,
  onAddSong,
  currentSetlistSongIds = [],
}: FreshSongBrowserProps) {
  const { songs, setlists } = useAppContext()
  const [gigWindow, setGigWindow] = useState<WindowSize>(10)
  const [search, setSearch] = useState('')
  const [genreFilter, setGenreFilter] = useState<string>('All')
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  // ── Derive fresh songs ──────────────────────────────────────────────────────
  const freshSongs = useMemo<Song[]>(() => {
    // Sort setlists by date descending, exclude current gig
    const sorted = [...setlists]
      .filter((sl) => sl.id !== currentGigId)
      .sort((a, b) => {
        const da = a.date ?? ''
        const db = b.date ?? ''
        return db.localeCompare(da)
      })

    const recentGigs = sorted.slice(0, gigWindow)
    const recentSongIds = new Set(recentGigs.flatMap((sl) => sl.songIds))

    return songs.filter((song) => !recentSongIds.has(song.id))
  }, [songs, setlists, currentGigId, gigWindow])

  // ── Filter by search + genre ────────────────────────────────────────────────
  const genres = useMemo(() => {
    const set = new Set<string>()
    for (const song of freshSongs) {
      if (song.genre) set.add(song.genre)
    }
    return ['All', ...Array.from(set).sort()]
  }, [freshSongs])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return freshSongs.filter((song) => {
      if (genreFilter !== 'All' && song.genre !== genreFilter) return false
      if (!q) return true
      return (
        song.title.toLowerCase().includes(q) ||
        song.artist.toLowerCase().includes(q)
      )
    })
  }, [freshSongs, search, genreFilter])

  const alreadyInGig = new Set(currentSetlistSongIds)

  const handleAdd = (songId: string) => {
    onAddSong(songId)
    setAddedIds((prev) => new Set([...prev, songId]))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header + controls */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-teal-300/80">Song Discovery</p>
            <h3 className="mt-0.5 text-base font-semibold">Fresh Songs</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {freshSongs.length} song{freshSongs.length !== 1 ? 's' : ''} not played in the last{' '}
              <span className="text-white">{gigWindow}</span> gigs
            </p>
          </div>
          {/* Window size selector */}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-800/60 p-1">
            {WINDOW_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  gigWindow === n
                    ? 'bg-teal-400/80 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setGigWindow(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          className="mt-3 w-full rounded-xl border border-white/10 bg-slate-800/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-teal-400/60"
          placeholder="Search songs or artists…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Genre pills */}
        {genres.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {genres.map((g) => (
              <button
                key={g}
                type="button"
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  genreFilter === g
                    ? 'bg-teal-400/80 text-slate-950'
                    : 'border border-white/10 bg-slate-800/60 text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setGenreFilter(g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Song list */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 px-4 py-8 text-center">
          <p className="text-sm text-slate-400">
            {search || genreFilter !== 'All'
              ? 'No songs match your filter.'
              : `All songs have been played in the last ${gigWindow} gigs.`}
          </p>
          {freshSongs.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Try increasing the gig window above.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((song) => {
            const inGig = alreadyInGig.has(song.id) || addedIds.has(song.id)
            return (
              <div
                key={song.id}
                className="flex items-center gap-3 rounded-2xl border border-white/5 bg-slate-900/50 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{song.title}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="truncate text-xs text-slate-400">{song.artist}</p>
                    {song.genre && (
                      <span className="shrink-0 rounded-full border border-white/10 bg-slate-800/60 px-1.5 py-px text-[10px] text-slate-400">
                        {song.genre}
                      </span>
                    )}
                    {song.originalYear && (
                      <span className="shrink-0 text-[10px] text-slate-500">{song.originalYear}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={inGig}
                  className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                    inGig
                      ? 'bg-teal-400/20 text-teal-300/60 cursor-default'
                      : 'bg-teal-400/80 text-slate-950 hover:bg-teal-300/80 active:scale-95'
                  }`}
                  onClick={() => !inGig && handleAdd(song.id)}
                >
                  {inGig ? '✓ Added' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
