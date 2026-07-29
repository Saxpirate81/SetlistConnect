/**
 * QuickAddSong
 *
 * Floating "+ Quick Add" button for gig mode / builder.
 * Creates a SetlistSongs row and links it via SetlistGigSongs.
 * YouTube search runs in the background after the song is added.
 */

import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { searchYouTube } from '../lib/youtubeSearch'
import { getYouTubeVideoId } from '../lib/youtube'
import { useAppContext } from '../context/AppContext'

type QuickAddSongProps = {
  gigId: string
  /** Current song count on the gig — used for sort_order. */
  sortOrder?: number
  /** Called after the song is created and linked to the gig. */
  onSongAdded: (songId: string, title: string, artist: string) => void
  /** Optional: called when background YouTube match lands. */
  onSongAudioFound?: (songId: string, youtubeUrl: string, youtubeVideoId: string) => void
}

type Phase = 'closed' | 'form' | 'saving' | 'done'

const suppressRealtime = (on: boolean) => {
  ;(window as typeof window & { __SC_SUPPRESS_REALTIME__?: boolean }).__SC_SUPPRESS_REALTIME__ = on
}

export function QuickAddSong({
  gigId,
  sortOrder = 0,
  onSongAdded,
  onSongAudioFound,
}: QuickAddSongProps) {
  const { activeBandId, showToast, updateSong } = useAppContext()
  const [phase, setPhase] = useState<Phase>('closed')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const open = () => {
    setTitle('')
    setArtist('')
    setError(null)
    setPhase('form')
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const close = () => {
    setPhase('closed')
    setTitle('')
    setArtist('')
    setError(null)
  }

  const handleSubmit = async () => {
    const cleanTitle = title.trim()
    const cleanArtist = artist.trim()
    if (!cleanTitle) {
      setError('Song name is required')
      return
    }
    if (!cleanArtist) {
      setError('Artist is required')
      return
    }
    if (!supabase || !activeBandId) {
      setError('Not connected')
      return
    }

    setPhase('saving')
    const songId = crypto.randomUUID()
    const gigSongId = crypto.randomUUID()
    suppressRealtime(true)

    try {
      const { error: insertErr } = await supabase.from('SetlistSongs').insert({
        id: songId,
        band_id: activeBandId,
        title: cleanTitle,
        artist: cleanArtist || null,
        audio_url: null,
        youtube_verified: false,
      })

      if (insertErr) {
        setError(insertErr.message || 'Failed to create song')
        setPhase('form')
        return
      }

      const { error: gigErr } = await supabase.from('SetlistGigSongs').insert({
        id: gigSongId,
        band_id: activeBandId,
        gig_id: gigId,
        song_id: songId,
        sort_order: sortOrder,
      })

      if (gigErr) {
        // Best-effort cleanup so we don't leave an orphan song row.
        await supabase.from('SetlistSongs').delete().eq('id', songId)
        setError(gigErr.message || 'Failed to add song to gig')
        setPhase('form')
        return
      }

      setPhase('done')
      onSongAdded(songId, cleanTitle, cleanArtist)
      showToast(`"${cleanTitle}" added to gig`)
      close()

      void (async () => {
        const videos = await searchYouTube(cleanTitle, cleanArtist, 1)
        if (videos.length === 0) return
        const best = videos[0]
        const videoId = getYouTubeVideoId(best.url)
        if (!videoId) return
        const { error: ytErr } = await supabase
          .from('SetlistSongs')
          .update({
            audio_url: best.url,
            youtube_video_id: videoId,
          })
          .eq('id', songId)
        if (ytErr) return
        updateSong(songId, {
          youtubeUrl: best.url,
          youtubeVideoId: videoId,
        })
        onSongAudioFound?.(songId, best.url, videoId)
      })()
    } finally {
      window.setTimeout(() => suppressRealtime(false), 900)
    }
  }

  return (
    <>
      <button
        type="button"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-2 rounded-full bg-teal-400/90 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_8px_24px_rgba(20,184,166,0.45)] active:scale-95 transition-transform"
        onClick={open}
        aria-label="Quick add song to gig"
      >
        <span className="text-lg leading-none">+</span>
        <span>Quick Add</span>
      </button>

      {phase !== 'closed' && (
        <div
          className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/70"
          onClick={close}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl border border-white/10 bg-slate-900 p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-teal-300/80">Live Gig</p>
                <h3 className="text-lg font-semibold">Quick Add Song</h3>
              </div>
              <button
                type="button"
                className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-300"
                onClick={close}
              >
                Cancel
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Song Name <span className="text-red-400">*</span>
                </label>
                <input
                  ref={titleRef}
                  type="text"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-800/80 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-teal-400"
                  placeholder="e.g. September"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Artist <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-800/80 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-teal-400"
                  placeholder="e.g. Earth, Wind & Fire"
                  value={artist}
                  onChange={(e) => {
                    setArtist(e.target.value)
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              {error && <p className="text-xs text-red-300">{error}</p>}

              <p className="text-[11px] text-slate-500">
                Added instantly to this gig. YouTube video matched in the background.
              </p>
            </div>

            <button
              type="button"
              disabled={phase === 'saving'}
              className={`mt-4 w-full rounded-xl py-3.5 text-sm font-semibold transition-colors ${
                phase === 'saving'
                  ? 'cursor-not-allowed bg-slate-700 text-slate-400'
                  : 'bg-teal-400/90 text-slate-950 active:bg-teal-300'
              }`}
              onClick={() => void handleSubmit()}
            >
              {phase === 'saving' ? 'Adding to gig…' : 'Add to Gig Now'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
