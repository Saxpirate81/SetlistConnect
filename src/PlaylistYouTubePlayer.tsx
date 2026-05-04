import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

/** Extract watch URL video id for youtube.com, youtu.be, music.youtube.com, shorts, embed. */
export function getYouTubeVideoId(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('youtube.com')) {
      const v = parsed.searchParams.get('v')
      if (v) return v
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts[0] === 'shorts' && parts[1]) return parts[1]
      if (parts[0] === 'embed' && parts[1]) return parts[1]
      if (parts[0] === 'live' && parts[1]) return parts[1]
    }
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0]
      return id || null
    }
    if (parsed.hostname.includes('music.youtube.com')) {
      const v = parsed.searchParams.get('v')
      if (v) return v
    }
  } catch {
    return null
  }
  return null
}

type YtPlayerApi = {
  destroy: () => void
  loadVideoById: (videoId: string | { videoId: string }) => void
  playVideo: () => void
}

export type PlaylistYouTubePlayerHandle = {
  /** Call synchronously from a click/tap handler so the browser treats playback as user-started. */
  loadAndPlayUrl: (watchUrl: string) => void
}

let iframeApiPromise: Promise<void> | null = null

function ensureYoutubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const w = window as Window & {
    YT?: { Player: new (el: HTMLElement, cfg: Record<string, unknown>) => YtPlayerApi }
  }
  if (w.YT?.Player) return Promise.resolve()
  if (!iframeApiPromise) {
    iframeApiPromise = new Promise((resolve) => {
      const prior = (window as Window & { onYouTubeIframeAPIReady?: () => void })
        .onYouTubeIframeAPIReady
      ;(window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady =
        () => {
          prior?.()
          resolve()
        }
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.body.appendChild(tag)
    })
  }
  return iframeApiPromise
}

type Props = {
  watchUrl: string
  playNonce: number
  className?: string
  onEnded: () => void
  /** When false, player loads paused until loadAndPlayUrl() from a user gesture. */
  autoplay?: boolean
}

/**
 * YouTube IFrame API player with ENDED forwarding. Use ref.loadAndPlayUrl from the same
 * stack as a tap so playback is not blocked as autoplay.
 */
export const PlaylistYouTubePlayer = forwardRef<PlaylistYouTubePlayerHandle, Props>(
  function PlaylistYouTubePlayer(
    { watchUrl, playNonce, className, onEnded, autoplay = true },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const playerRef = useRef<YtPlayerApi | null>(null)
    const onEndedRef = useRef(onEnded)
    const pendingUserPlayUrlRef = useRef<string | null>(null)
    const prevPlayNonceRef = useRef<number | null>(null)
    onEndedRef.current = onEnded

    const tryPlayPending = () => {
      const pending = pendingUserPlayUrlRef.current
      if (!pending) return
      const id = getYouTubeVideoId(pending)
      const p = playerRef.current
      if (!id || !p) return
      pendingUserPlayUrlRef.current = null
      p.loadVideoById(id)
      p.playVideo()
    }

    useImperativeHandle(ref, () => ({
      loadAndPlayUrl: (url: string) => {
        const id = getYouTubeVideoId(url)
        const p = playerRef.current
        if (!id) return
        if (p) {
          p.loadVideoById(id)
          p.playVideo()
        } else {
          pendingUserPlayUrlRef.current = url
        }
      },
    }))

    useEffect(() => {
      const el = containerRef.current
      const videoId = getYouTubeVideoId(watchUrl)
      if (!el || !videoId) return

      const firstMount = prevPlayNonceRef.current === null
      const nonceBumped =
        prevPlayNonceRef.current !== null && prevPlayNonceRef.current !== playNonce
      prevPlayNonceRef.current = playNonce

      if (!firstMount && !nonceBumped && playerRef.current) {
        playerRef.current.loadVideoById(videoId)
        if (autoplay) {
          playerRef.current.playVideo()
        }
        return
      }

      let cancelled = false
      void ensureYoutubeIframeApi().then(() => {
        if (cancelled || !el) return
        const w = window as unknown as {
          YT: {
            Player: new (el: HTMLElement, cfg: Record<string, unknown>) => YtPlayerApi
            PlayerState: { ENDED: number }
          }
        }
        if (!w.YT?.Player) return

        try {
          playerRef.current?.destroy()
        } catch {
          /* ignore */
        }
        playerRef.current = null
        el.replaceChildren()

        const playerVars: Record<string, string | number> = {
          autoplay: autoplay ? 1 : 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
        }
        if (typeof window !== 'undefined') {
          playerVars.origin = window.location.origin
        }

        playerRef.current = new w.YT.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars,
          events: {
            onReady: () => {
              tryPlayPending()
            },
            onStateChange: (event: { data: number }) => {
              const endedState =
                typeof w.YT.PlayerState !== 'undefined' ? w.YT.PlayerState.ENDED : 0
              if (event.data === endedState) {
                onEndedRef.current()
              }
            },
          },
        })
      })

      return () => {
        cancelled = true
        try {
          playerRef.current?.destroy()
        } catch {
          /* ignore */
        }
        playerRef.current = null
      }
    }, [watchUrl, playNonce, autoplay])

    return (
      <div className={className}>
        <div ref={containerRef} className="h-full min-h-[160px] w-full" />
      </div>
    )
  },
)
