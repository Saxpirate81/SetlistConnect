/**
 * SongMetadataBackfill
 *
 * Admin-only tool that finds all songs missing year or genre, then
 * enriches them in batches using the enrich-song-metadata Edge Function.
 *
 * Embed in the Account / Admin screen alongside DuplicateSongMerger.
 *
 * Usage: <SongMetadataBackfill />
 * (reads songs + isAdmin from AppContext)
 */

import { useState } from 'react'
import { useAppContext } from '../context/AppContext'
import { enrichSongMetadata } from '../lib/enrichSongMetadata'
import { supabase } from '../lib/supabaseClient'

const BATCH_SIZE = 5

type Phase = 'idle' | 'running' | 'done' | 'error'

type Progress = {
  total: number
  done: number
  succeeded: number
  failed: number
  current?: string
}

export function SongMetadataBackfill() {
  const { songs, isAdmin, updateSong } = useAppContext()
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<Progress | null>(null)

  if (!isAdmin) return null

  const needsEnrichment = songs.filter(
    (s) => s.originalYear == null || !s.genre,
  )

  const handleRun = async () => {
    if (!supabase || needsEnrichment.length === 0) return
    setPhase('running')
    setProgress({ total: needsEnrichment.length, done: 0, succeeded: 0, failed: 0 })

    let succeeded = 0
    let failed = 0

    for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
      const batch = needsEnrichment.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async (song) => {
          setProgress((prev) => prev ? { ...prev, current: `${song.title} — ${song.artist}` } : prev)

          const result = await enrichSongMetadata(song.title, song.artist)

          if (result.source === 'unknown' || (!result.year && !result.genre)) {
            failed++
            setProgress((prev) => prev ? { ...prev, done: prev.done + 1, failed } : prev)
            return
          }

          // Only update fields that are missing — never overwrite user data
          const updates: { original_year?: number; genre?: string } = {}
          if (result.year && song.originalYear == null) updates.original_year = result.year
          if (result.genre && !song.genre) updates.genre = result.genre

          if (Object.keys(updates).length === 0) {
            setProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev)
            return
          }

          const { error } = await supabase!
            .from('songs')
            .update(updates)
            .eq('id', song.id)

          if (error) {
            console.warn('[backfill] DB update failed for', song.id, error.message)
            failed++
          } else {
            // Optimistically update local state
            updateSong(song.id, {
              originalYear: updates.original_year ?? song.originalYear,
              genre: updates.genre ?? song.genre,
            })
            succeeded++
          }

          setProgress((prev) =>
            prev ? { ...prev, done: prev.done + 1, succeeded, failed } : prev
          )
        }),
      )

      // Tiny pause between batches to avoid rate limits
      if (i + BATCH_SIZE < needsEnrichment.length) {
        await new Promise((r) => setTimeout(r, 300))
      }
    }

    setPhase('done')
    setProgress((prev) =>
      prev ? { ...prev, current: undefined, succeeded, failed } : prev
    )
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">AI Enrichment</p>
          <h3 className="mt-0.5 text-base font-semibold">Auto-populate Year &amp; Genre</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {needsEnrichment.length === 0
              ? `All ${songs.length} songs have year and genre ✓`
              : `${needsEnrichment.length} of ${songs.length} songs missing year or genre`}
          </p>
        </div>

        {phase === 'idle' && needsEnrichment.length > 0 && (
          <button
            type="button"
            className="shrink-0 rounded-xl bg-teal-400/80 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-300/80"
            onClick={() => void handleRun()}
          >
            Enrich all
          </button>
        )}
      </div>

      {phase === 'idle' && needsEnrichment.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          Uses MusicBrainz (free) then Claude AI as a fallback. Only fills missing fields —
          never overwrites data you've entered. Processes {BATCH_SIZE} songs at a time.
        </p>
      )}

      {phase === 'running' && progress && (
        <div className="mt-4 space-y-3">
          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full rounded-full bg-teal-400 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">
              {progress.done} / {progress.total} songs
            </span>
            <span className="text-slate-400">{pct}%</span>
          </div>
          {progress.current && (
            <p className="truncate text-xs text-slate-500 italic">
              Looking up: {progress.current}
            </p>
          )}
        </div>
      )}

      {phase === 'done' && progress && (
        <div className="mt-4 space-y-2">
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            ✓ Done — {progress.succeeded} song{progress.succeeded !== 1 ? 's' : ''} enriched
            {progress.failed > 0 && (
              <span className="text-emerald-300/70">
                {' '}· {progress.failed} not found (obscure or very new)
              </span>
            )}
          </div>
          {needsEnrichment.length > 0 && (
            <button
              type="button"
              className="text-xs text-teal-400 underline"
              onClick={() => { setPhase('idle'); setProgress(null) }}
            >
              Run again for remaining
            </button>
          )}
        </div>
      )}
    </div>
  )
}
