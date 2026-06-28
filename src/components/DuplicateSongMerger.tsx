/**
 * DuplicateSongMerger
 *
 * Admin tool for detecting and merging duplicate songs.
 * Embed this in the Account / Admin screen.
 *
 * Usage:
 *   <DuplicateSongMerger />
 *
 * Reads songs + bandId from AppContext. No extra props needed.
 */

import { useState } from 'react'
import { useAppContext } from '../context/AppContext'
import { findDuplicateGroups, mergeSongs } from '../lib/deduplicateSongs'
import type { DuplicateGroup } from '../lib/deduplicateSongs'

type MergeState = 'idle' | 'merging' | 'done' | 'error'

export function DuplicateSongMerger() {
  const { songs, setlists, activeBandId, isAdmin, showToast, updateSong } = useAppContext()
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [canonicalOverrides, setCanonicalOverrides] = useState<Record<string, string>>({})
  const [mergeStates, setMergeStates] = useState<Record<string, MergeState>>({})
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set())

  if (!isAdmin) return null

  const scan = () => {
    const found = findDuplicateGroups(songs)
    setGroups(found)
    setCanonicalOverrides({})
    setMergeStates({})
    setMergedGroups(new Set())
  }

  const getCanonical = (group: DuplicateGroup) =>
    canonicalOverrides[group.key] ?? group.suggestedCanonicalId

  const handleMerge = async (group: DuplicateGroup) => {
    const canonicalId = getCanonical(group)
    const duplicateIds = group.songs.map((s) => s.id).filter((id) => id !== canonicalId)

    setMergeStates((prev) => ({ ...prev, [group.key]: 'merging' }))

    const result = await mergeSongs(canonicalId, duplicateIds, activeBandId)

    if (!result.ok) {
      setMergeStates((prev) => ({ ...prev, [group.key]: 'error' }))
      showToast(`Merge failed: ${result.error ?? 'Unknown error'}`)
      return
    }

    setMergeStates((prev) => ({ ...prev, [group.key]: 'done' }))
    setMergedGroups((prev) => new Set([...prev, group.key]))
    showToast(`Merged "${group.displayTitle}" — ${result.setlistsUpdated} setlist${result.setlistsUpdated === 1 ? '' : 's'} updated`)

    // Refresh groups (remove merged)
    setGroups((prev) =>
      (prev ?? []).filter((g) => g.key !== group.key)
    )
  }

  const pendingGroups = (groups ?? []).filter((g) => !mergedGroups.has(g.key))

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Song Library</p>
          <h3 className="mt-0.5 text-base font-semibold">Duplicate Song Finder</h3>
        </div>
        <button
          type="button"
          className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:border-white/25"
          onClick={scan}
        >
          {groups === null ? 'Scan for duplicates' : 'Re-scan'}
        </button>
      </div>

      {groups === null && (
        <p className="mt-3 text-sm text-slate-400">
          Scans your song library for tracks with the same name and artist. Safe to run anytime — no changes made until you merge.
        </p>
      )}

      {groups !== null && pendingGroups.length === 0 && (
        <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          ✓ No duplicates found in {songs.length} songs.
        </div>
      )}

      {pendingGroups.length > 0 && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-400">
            Found <span className="font-semibold text-amber-300">{pendingGroups.length}</span> duplicate group{pendingGroups.length > 1 ? 's' : ''}.
            Pick which version to keep — all setlists update automatically.
          </p>

          {pendingGroups.map((group) => {
            const canonicalId = getCanonical(group)
            const state = mergeStates[group.key] ?? 'idle'

            return (
              <div
                key={group.key}
                className="rounded-2xl border border-amber-300/20 bg-slate-800/60 p-4"
              >
                <p className="text-sm font-semibold text-white">{group.displayTitle}</p>
                <p className="text-xs text-slate-400">{group.displayArtist}</p>

                {/* Affected setlists count */}
                {(() => {
                  const songIds = new Set(group.songs.map((s) => s.id))
                  const affected = setlists.filter((sl) =>
                    sl.songIds.some((id) => songIds.has(id))
                  ).length
                  return affected > 0 ? (
                    <p className="mt-1 text-xs text-amber-300/80">
                      Appears in {affected} setlist{affected > 1 ? 's' : ''}
                    </p>
                  ) : null
                })()}

                {/* Song options */}
                <div className="mt-3 space-y-1.5">
                  {group.songs.map((song) => (
                    <button
                      key={song.id}
                      type="button"
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                        canonicalId === song.id
                          ? 'border-teal-400/50 bg-teal-400/10 text-teal-100'
                          : 'border-white/5 bg-slate-800/40 text-slate-300 hover:border-white/15'
                      }`}
                      onClick={() =>
                        setCanonicalOverrides((prev) => ({ ...prev, [group.key]: song.id }))
                      }
                    >
                      <span className="mt-0.5 shrink-0 text-xs">
                        {canonicalId === song.id ? '✓ Keep' : '○'}
                      </span>
                      <span className="flex-1">
                        <span className="font-medium">{song.title}</span>
                        {song.youtubeUrl && (
                          <span className="ml-2 text-[10px] text-teal-400/70">▶ video</span>
                        )}
                        {song.youtubeVerified && (
                          <span className="ml-1 text-[10px] text-emerald-400/70">✓ verified</span>
                        )}
                        {song.lyrics && (
                          <span className="ml-1 text-[10px] text-slate-400">lyrics</span>
                        )}
                        {(song.keys?.length ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            {song.keys.length} key{song.keys.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={state === 'merging'}
                  className={`mt-3 w-full rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                    state === 'merging'
                      ? 'cursor-not-allowed bg-slate-700 text-slate-400'
                      : state === 'error'
                      ? 'bg-red-400/80 text-white'
                      : 'bg-amber-400/80 text-slate-950 hover:bg-amber-300/80'
                  }`}
                  onClick={() => void handleMerge(group)}
                >
                  {state === 'merging'
                    ? 'Merging…'
                    : state === 'error'
                    ? 'Failed — try again'
                    : `Merge into "${group.songs.find((s) => s.id === canonicalId)?.title ?? group.displayTitle}"`}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
