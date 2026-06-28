export type CreateBandScreenProps = {
  newBandName: string
  setNewBandName: (v: string) => void
  supabaseError: string | null
  setSupabaseError: (v: string | null) => void
  authLoading: boolean
  onCreateBand: () => void
}

export function CreateBandScreen({
  newBandName,
  setNewBandName,
  supabaseError,
  setSupabaseError,
  authLoading,
  onCreateBand,
}: CreateBandScreenProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <p className="text-sm uppercase tracking-[0.3em] text-teal-300/80">Setlist Connect</p>
        <h1 className="mt-2 text-3xl font-semibold">Create your band</h1>
        <p className="mt-2 text-sm text-slate-300">
          Your account is ready. Create your first band workspace to continue.
        </p>
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <label className="text-xs uppercase tracking-wide text-slate-400">Band name</label>
          <input
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
            placeholder="Your Band Name"
            value={newBandName}
            onChange={(event) => {
              setNewBandName(event.target.value)
              if (supabaseError) setSupabaseError(null)
            }}
          />
          <button
            disabled={authLoading}
            className={`mt-4 w-full rounded-xl bg-teal-400/90 py-3 font-semibold text-slate-950 ${
              authLoading ? 'cursor-not-allowed opacity-70' : ''
            }`}
            onClick={onCreateBand}
          >
            {authLoading ? 'Creating workspace...' : 'Create band admin workspace'}
          </button>
          {supabaseError && <div className="mt-3 text-xs text-red-200">{supabaseError}</div>}
        </div>
      </div>
    </div>
  )
}
