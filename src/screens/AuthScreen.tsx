import setlistConnectLogo from '../assets/setlist-connect-logo.png'
import { supabase } from '../lib/supabaseClient'
import type { SharedPlaylistView } from '../types'

export type AuthScreenProps = {
  // View state
  authEntryView: 'home' | 'auth'
  setAuthEntryView: (v: 'home' | 'auth') => void
  authIntroPhase: 'welcome' | 'fading' | 'login'
  showAuthLearnMore: boolean
  setShowAuthLearnMore: (v: boolean) => void
  isSharedLinkAuthContext: boolean
  sharedSignupReturnView: SharedPlaylistView | null

  // Auth mode
  authMode: 'login' | 'signup'
  setAuthMode: (v: 'login' | 'signup') => void

  // Form fields
  authEmail: string
  setAuthEmail: (v: string) => void
  authPassword: string
  setAuthPassword: (v: string) => void

  // Recovery
  passwordRecoveryMode: boolean
  setPasswordRecoveryMode: (v: boolean) => void
  recoveryPassword: string
  setRecoveryPassword: (v: string) => void
  recoveryPasswordConfirm: string
  setRecoveryPasswordConfirm: (v: string) => void

  // Status
  authLoading: boolean
  authError: string | null
  authStatus: string | null
  setAuthStatus: (v: string | null) => void
  authEmailCooldownSeconds: number

  // Handlers
  onLogin: () => void
  onResetPasswordSubmit: () => void
  onForgotPassword: () => void
  onRestoreSharedView: () => void
}

export function AuthScreen({
  authEntryView,
  setAuthEntryView,
  authIntroPhase,
  showAuthLearnMore,
  setShowAuthLearnMore,
  isSharedLinkAuthContext,
  sharedSignupReturnView,
  authMode,
  setAuthMode,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  passwordRecoveryMode,
  setPasswordRecoveryMode,
  recoveryPassword,
  setRecoveryPassword,
  recoveryPasswordConfirm,
  setRecoveryPasswordConfirm,
  authLoading,
  authError,
  authStatus,
  setAuthStatus,
  authEmailCooldownSeconds,
  onLogin,
  onResetPasswordSubmit,
  onForgotPassword,
  onRestoreSharedView,
}: AuthScreenProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white opacity-100">
      <div className="pointer-events-none absolute -left-16 top-16 h-52 w-52 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-16 h-64 w-64 rounded-full bg-fuchsia-400/20 blur-3xl" />
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-8">
        {authEntryView === 'home' ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-7 shadow-[0_24px_90px_rgba(8,145,178,0.18)] backdrop-blur">
            <img
              src={setlistConnectLogo}
              alt="Setlist Connect"
              className="h-16 w-auto object-contain"
            />
            <p className="text-xs uppercase tracking-[0.32em] text-teal-300/85">Setlist Connect</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight">
              Your band&apos;s modern live setlist workspace
            </h1>
            <p className="mt-4 max-w-2xl text-sm text-slate-300">
              Organize songs, assign musicians, handle special requests, and run performances from one clean app built for busy gig days.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                className="rounded-xl bg-teal-400/90 px-5 py-2.5 text-sm font-semibold text-slate-950"
                onClick={() => {
                  setAuthMode('login')
                  setAuthEntryView('auth')
                }}
              >
                Get started
              </button>
              {!isSharedLinkAuthContext && (
                <button
                  type="button"
                  className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-100"
                  onClick={() => {
                    setAuthMode('signup')
                    setAuthEntryView('auth')
                  }}
                >
                  Create account
                </button>
              )}
              <button
                type="button"
                className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-semibold text-cyan-100"
                onClick={() => setShowAuthLearnMore(true)}
              >
                Learn more
              </button>
            </div>
            <div className="mt-8 grid gap-3 md:grid-cols-3">
              <div className="relative overflow-visible rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <span className="pointer-events-none absolute -right-3 -top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200/60 bg-emerald-400 text-base font-extrabold text-slate-950 shadow-[0_10px_25px_rgba(16,185,129,0.45)]">
                  ✓
                </span>
                <p className="text-xs uppercase tracking-wide text-teal-200">Build faster</p>
                <p className="mt-2 text-sm text-slate-300">Create and duplicate gigs with organized sections and drag-and-drop flow.</p>
              </div>
              <div className="relative overflow-visible rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <span className="pointer-events-none absolute -right-3 -top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-200/60 bg-cyan-400 text-base font-extrabold text-slate-950 shadow-[0_10px_25px_rgba(34,211,238,0.45)]">
                  ✓
                </span>
                <p className="text-xs uppercase tracking-wide text-teal-200">Stay in sync</p>
                <p className="mt-2 text-sm text-slate-300">Share musician-ready views and keep the whole team aligned in real time.</p>
              </div>
              <div className="relative overflow-visible rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <span className="pointer-events-none absolute -right-3 -top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-fuchsia-200/60 bg-fuchsia-400 text-base font-extrabold text-slate-950 shadow-[0_10px_25px_rgba(232,121,249,0.45)]">
                  ✓
                </span>
                <p className="text-xs uppercase tracking-wide text-teal-200">Run live gigs</p>
                <p className="mt-2 text-sm text-slate-300">Track songs, keys, and special requests without the usual show-day chaos.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-md">
            <div
              className={`transition-all duration-200 ${
                authIntroPhase === 'login'
                  ? 'pointer-events-auto translate-y-0 opacity-100'
                  : 'pointer-events-none translate-y-4 opacity-0'
              }`}
            >
              <p className="text-sm uppercase tracking-[0.3em] text-teal-300/80">
                Setlist Connect
              </p>
              <h1 className="mt-2 text-3xl font-semibold">
                {passwordRecoveryMode ? 'Reset your password' : 'Welcome back'}
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                {passwordRecoveryMode
                  ? 'Enter your new password, then log in.'
                  : 'Sign in with your account to access your band workspace.'}
              </p>
              <form
                className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
                autoComplete="on"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  if (passwordRecoveryMode) {
                    onResetPasswordSubmit()
                  } else {
                    onLogin()
                  }
                }}
              >
                {supabase && passwordRecoveryMode ? (
                  <>
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      New password
                    </label>
                    <input
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                      placeholder="Enter new password"
                      value={recoveryPassword}
                      onChange={(event) => setRecoveryPassword(event.target.value)}
                      type="password"
                      autoComplete="new-password"
                    />
                    <label className="mt-3 block text-xs uppercase tracking-wide text-slate-400">
                      Confirm password
                    </label>
                    <input
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                      placeholder="Confirm new password"
                      value={recoveryPasswordConfirm}
                      onChange={(event) => setRecoveryPasswordConfirm(event.target.value)}
                      type="password"
                      autoComplete="new-password"
                    />
                  </>
                ) : supabase ? (
                  <>
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Email
                    </label>
                    <input
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                      placeholder="you@band.com"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                    />
                    <label className="mt-3 block text-xs uppercase tracking-wide text-slate-400">
                      Password
                    </label>
                    <input
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none focus:border-teal-300"
                      placeholder="Enter password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      type="password"
                      autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    />
                  </>
                ) : (
                  <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                    Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your environment to enable sign-in.
                  </div>
                )}
                <button
                  type="submit"
                  disabled={authLoading}
                  className={`mt-4 w-full rounded-xl bg-teal-400/90 py-3 font-semibold text-slate-950 ${
                    authLoading ? 'cursor-not-allowed opacity-70' : ''
                  }`}
                >
                  {authLoading
                    ? 'Please wait...'
                    : passwordRecoveryMode
                    ? 'Update password'
                    : authMode === 'signup'
                    ? 'Create account'
                    : 'Login'}
                </button>
                {supabase && !passwordRecoveryMode && !isSharedLinkAuthContext && (
                  <button
                    type="button"
                    className="mt-3 w-full rounded-xl border border-white/10 py-2 text-sm text-slate-200"
                    onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                    disabled={authLoading || authEmailCooldownSeconds > 0}
                  >
                    {authMode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
                  </button>
                )}
                {supabase && !passwordRecoveryMode && authMode === 'login' && (
                  <button
                    type="button"
                    className="mt-3 w-full rounded-xl border border-amber-300/35 bg-amber-400/10 py-2 text-sm font-semibold text-amber-100"
                    onClick={onForgotPassword}
                    disabled={authLoading || authEmailCooldownSeconds > 0}
                  >
                    {authEmailCooldownSeconds > 0
                      ? `Forgot password (${Math.ceil(authEmailCooldownSeconds / 60)}m)`
                      : 'Forgot password'}
                  </button>
                )}
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl border border-white/10 py-2 text-sm text-slate-200"
                  onClick={() => {
                    if (passwordRecoveryMode) {
                      setPasswordRecoveryMode(false)
                      setRecoveryPassword('')
                      setRecoveryPasswordConfirm('')
                      setAuthStatus(null)
                      setAuthMode('login')
                    } else {
                      setAuthEntryView('home')
                    }
                  }}
                >
                  {passwordRecoveryMode ? 'Back to login' : 'Back to home'}
                </button>
                {!passwordRecoveryMode && (
                  <button
                    type="button"
                    className="mt-3 w-full rounded-xl border border-cyan-300/30 bg-cyan-400/10 py-2 text-sm font-semibold text-cyan-100"
                    onClick={() => setShowAuthLearnMore(true)}
                  >
                    Learn more
                  </button>
                )}
                {!passwordRecoveryMode && authMode === 'signup' && sharedSignupReturnView && (
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      className="w-full rounded-xl border border-white/10 py-2 text-sm font-semibold text-slate-200"
                      onClick={onRestoreSharedView}
                    >
                      Go back to previous view
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-emerald-300/40 bg-emerald-400/10 py-2 text-sm font-semibold text-emerald-100"
                      onClick={onRestoreSharedView}
                    >
                      Skip and go to gig view
                    </button>
                  </div>
                )}
                {authError && <div className="mt-3 text-xs text-red-200">{authError}</div>}
                {authStatus && <div className="mt-3 text-xs text-emerald-200">{authStatus}</div>}
                {authEmailCooldownSeconds > 0 && (
                  <div className="mt-2 text-xs text-amber-200">
                    Email actions are temporarily paused. Try again in about{' '}
                    {Math.ceil(authEmailCooldownSeconds / 60)} minute
                    {Math.ceil(authEmailCooldownSeconds / 60) === 1 ? '' : 's'}.
                  </div>
                )}
              </form>
            </div>
          </div>
        )}

        {authEntryView === 'auth' && (
          <div
            className={`absolute inset-0 flex items-center justify-center px-6 transition-all duration-200 ${
              authIntroPhase === 'welcome'
                ? 'opacity-100'
                : authIntroPhase === 'fading'
                ? 'opacity-0'
                : 'pointer-events-none opacity-0'
            }`}
          >
            <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-slate-900/70 p-7 text-center shadow-[0_20px_80px_rgba(6,182,212,0.2)] backdrop-blur-xl">
              <p className="text-[11px] uppercase tracking-[0.28em] text-teal-200/90">Setlist Connect</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight">Welcome to your next gig flow</h2>
              <p className="mt-3 text-sm text-slate-300">
                Build, organize, and run live setlists with your team in one clean workspace.
              </p>
            </div>
          </div>
        )}

        {showAuthLearnMore && (
          <div
            className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/85 px-5"
            onClick={() => setShowAuthLearnMore(false)}
          >
            <div
              className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_22px_80px_rgba(14,116,144,0.3)]"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="text-[10px] uppercase tracking-[0.28em] text-teal-300/80">Learn more</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">What Setlist Connect does</h3>
              <p className="mt-3 text-sm text-slate-300">
                Setlist Connect is your live-performance command center. Build gigs, manage songs and charts, assign musicians, and share real-time setlists so everyone stays in sync on stage.
              </p>
              <div className="mt-4 space-y-2 text-sm text-slate-200">
                <p>• Plan and reorder songs fast for each event</p>
                <p>• Track special requests, keys, and singer assignments</p>
                <p>• Share mobile-friendly gig views with your team</p>
              </div>
              <button
                type="button"
                className="mt-5 w-full rounded-xl bg-teal-400/90 py-2.5 text-sm font-semibold text-slate-950"
                onClick={() => setShowAuthLearnMore(false)}
              >
                Let&apos;s go
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
