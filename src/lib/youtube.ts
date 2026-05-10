export function getYouTubeVideoId(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host.includes('youtube.com') || host.includes('music.youtube.com')) {
      const v = parsed.searchParams.get('v')
      if (v) return v
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts[0] === 'shorts' && parts[1]) return parts[1]
      if (parts[0] === 'embed' && parts[1]) return parts[1]
      if (parts[0] === 'live' && parts[1]) return parts[1]
      return null
    }
    if (host.includes('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0]
      return id || null
    }
  } catch {
    return null
  }
  return null
}

export function isYouTubeUrl(url: string | null): boolean {
  return Boolean(getYouTubeVideoId(url))
}

export function getYouTubeEmbedUrl(url: string | null): string {
  const id = getYouTubeVideoId(url)
  if (!id) return url ?? ''
  return `https://www.youtube.com/embed/${id}?autoplay=1`
}
