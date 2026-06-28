/**
 * Skeleton loading placeholder components.
 * Use these wherever data is loading from Supabase to avoid blank screens.
 *
 * Usage:
 *   import { SkeletonList, SkeletonCard } from './components/ui/Skeleton'
 *   {bandContextLoading && <SkeletonList rows={5} />}
 */

type SkeletonProps = {
  className?: string
}

/** A single animated shimmer bar */
export function SkeletonBar({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-700/50 ${className}`}
      aria-hidden="true"
    />
  )
}

/** A card-style skeleton — good for gig/setlist list items */
export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`rounded-2xl border border-white/5 bg-slate-800/50 p-4 ${className}`}
      aria-hidden="true"
    >
      <SkeletonBar className="h-4 w-2/3 mb-3" />
      <SkeletonBar className="h-3 w-1/3" />
    </div>
  )
}

/** A song row skeleton — good for song library list items */
export function SkeletonSongRow({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-white/5 bg-slate-800/40 px-4 py-3 ${className}`}
      aria-hidden="true"
    >
      <div className="flex-1 space-y-2">
        <SkeletonBar className="h-3.5 w-3/4" />
        <SkeletonBar className="h-2.5 w-1/2" />
      </div>
      <SkeletonBar className="h-6 w-10 shrink-0 rounded-lg" />
    </div>
  )
}

/** A stacked list of skeleton cards */
export function SkeletonList({
  rows = 5,
  variant = 'card',
}: {
  rows?: number
  variant?: 'card' | 'song'
}) {
  const Item = variant === 'song' ? SkeletonSongRow : SkeletonCard
  return (
    <div className="space-y-3 px-4 pt-4" aria-label="Loading…" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Item key={i} />
      ))}
    </div>
  )
}

/** Full-screen loading overlay — used while initial band context loads */
export function SkeletonAppShell() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Fake header */}
      <div className="fixed left-0 right-0 top-0 z-40 h-14 border-b border-white/5 bg-slate-950/90 backdrop-blur" aria-hidden="true">
        <div className="mx-auto flex h-full max-w-3xl items-center justify-between px-4">
          <SkeletonBar className="h-5 w-28" />
          <SkeletonBar className="h-7 w-7 rounded-full" />
        </div>
      </div>
      {/* Content area */}
      <div className="pt-16">
        <SkeletonList rows={6} variant="card" />
      </div>
      {/* Fake bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-white/5 bg-slate-950/90 px-4 backdrop-blur" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBar key={i} className="h-7 w-7 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
