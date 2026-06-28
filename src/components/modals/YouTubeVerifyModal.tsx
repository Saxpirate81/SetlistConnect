/**
 * YouTubeVerifyModal
 *
 * Shows 3-4 YouTube video candidates for a song and lets the user
 * pick the right one (or skip). Called after a song is saved/created
 * when youtube_verified is false and we have search results.
 *
 * On confirm: saves the chosen youtubeUrl + youtubeVideoId to the song
 *             and marks youtubeVerified = true.
 * On skip:    leaves the song unverified (can be done later).
 */

import { useEffect, useState } from 'react'
import { searchYouTube } from '../../lib/youtubeSearch'
import type { YouTubeVideo } from '../../lib/youtubeSearch'

type YouTubeVerifyModalProps = {
  songId: string
  title: string
  artist: string
  /** Called when user picks a video. Receives full YouTube URL and video ID. */
  onConfirm: (songId: string, youtubeUrl: string, videoId: string) => void
  /** Called when user skips — song stays unverified */
  onSkip: () => void
}

export function YouTubeVerifyModal({
  songId,
  title,
  artist,
  onConfirm,
  onSkip,
}: YouTubeVerifyModalProps) {
  const [videos, setVideos] = useState<YouTubeVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    searchYouTube(title, artist, 4).then((results) => {
      if (!cancelled) {
        setVideos(results)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [title, artist])

  const handleConfirm = () => {
    const video = videos.find((v) => v.videoId === selected)
    if (!video) return
    onConfirm(songId, video.url, video.videoId)
  }

  return (
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/85 sm:items-center"
      onClick={onSkip}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl border border-white/10 bg-slate-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-teal-300/80">Match YouTube video</p>
            <h3 className="mt-1 text-lg font-semibold leading-tight">{title}</h3>
            <p className="text-sm text-slate-400">{artist}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-300"
            onClick={onSkip}
          >
            Skip
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Pick the best match — confirmed once, used forever for this song.
        </p>

        {/* Video candidates */}
        <div className="mt-4 space-y-2">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex animate-pulse gap-3 rounded-2xl border border-white/5 bg-slate-800/50 p-3">
                <div className="h-16 w-28 shrink-0 rounded-xl bg-slate-700/50" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 w-3/4 rounded bg-slate-700/50" />
                  <div className="h-2.5 w-1/2 rounded bg-slate-700/50" />
                </div>
              </div>
            ))
          ) : videos.length === 0 ? (
            <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              No videos found. You can add a YouTube URL manually in the song editor.
            </div>
          ) : (
            videos.map((video) => (
              <button
                key={video.videoId}
                type="button"
                className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors ${
                  selected === video.videoId
                    ? 'border-teal-400/60 bg-teal-400/10'
                    : 'border-white/5 bg-slate-800/40 hover:border-white/15'
                }`}
                onClick={() => setSelected(selected === video.videoId ? null : video.videoId)}
              >
                {/* Thumbnail */}
                <div className="relative shrink-0">
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    className="h-16 w-28 rounded-xl object-cover"
                    loading="lazy"
                  />
                  {/* Preview play button */}
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/50 opacity-0 transition-opacity hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewing(previewing === video.videoId ? null : video.videoId)
                    }}
                    aria-label="Preview"
                  >
                    <span className="text-xl">▶</span>
                  </button>
                </div>
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug text-white">
                    {video.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-400">{video.channelTitle}</p>
                </div>
                {/* Selected indicator */}
                {selected === video.videoId && (
                  <span className="mt-1 shrink-0 text-teal-400">✓</span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Inline preview iframe */}
        {previewing && (
          <div className="mt-3 overflow-hidden rounded-2xl">
            <iframe
              src={`https://www.youtube.com/embed/${previewing}?autoplay=1`}
              className="aspect-video w-full"
              allow="autoplay; encrypted-media"
              allowFullScreen
              title="YouTube preview"
            />
          </div>
        )}

        {/* Actions */}
        {!loading && videos.length > 0 && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-200"
              onClick={onSkip}
            >
              Skip for now
            </button>
            <button
              type="button"
              disabled={!selected}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${
                selected
                  ? 'bg-teal-400/90 text-slate-950'
                  : 'cursor-not-allowed bg-slate-700 text-slate-500'
              }`}
              onClick={handleConfirm}
            >
              Use this video
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
