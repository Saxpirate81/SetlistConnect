# Setlist Connect — Audit Report
_Generated June 28, 2026_

---

## 🔴 CRITICAL SECURITY ISSUES

### 1. Plaintext passwords hardcoded in source code
**File:** `src/App.tsx` lines 403–404

```ts
const ADMIN_PASSWORD = 'Signature'
const USER_PASSWORD = 'Signature2026'
```

These strings ship inside your compiled JavaScript bundle. Anyone who opens Chrome DevTools → Sources and searches the bundle will find them instantly. This is the local/offline fallback login used when Supabase is not configured, but it's still a real risk — especially if you ever demo or share the app without Supabase enabled.

**Fix:** Remove the offline password fallback entirely, or replace it with an environment-variable-driven hash check that never puts the password in the bundle. Since Supabase auth is already wired in, the local fallback should be removed.

---

### 2. Stripe secret key stored in `.env.local`
**File:** `.env.local` line 2

```
STRIPE_SECRET_KEY="sk_test_51T5sVB..."
```

This is a test key, but it's still a secret credential. While `.env.local` is in `.gitignore` (so it won't be committed), anyone with access to your machine or a leaked copy of that file can use this key to create Stripe charges or read customer data. The Stripe webhook secret is also empty (`STRIPE_WEBHOOK_SECRET=""`), which means webhooks aren't being verified in your local environment.

**Fix:**
- Rotate this key via the Stripe dashboard if it has been shared anywhere.
- Fill in `STRIPE_WEBHOOK_SECRET` — without it, Stripe events can be spoofed.
- Use Supabase's secret management (Dashboard → Edge Functions → Secrets) for production; never put secret keys in any `.env` file that lives on disk.

---

### 3. CORS wildcard on Stripe checkout Edge Function
**File:** `supabase/functions/create-stripe-checkout-session/index.ts` line 24

```ts
'Access-Control-Allow-Origin': '*',
```

This allows any website to call your Stripe checkout function. If someone discovers the function URL, they can initiate checkout sessions from their own site on behalf of your users.

**Fix:** Replace `*` with your production domain: `'Access-Control-Allow-Origin': 'https://www.setlistconnect.com'`

---

### 4. No rate limiting on auth endpoints
The frontend has client-side cooldown logic for email rate limits (parsing Supabase error messages), but there's no server-side or edge-function-level rate limiting on the checkout or portal session endpoints. A bad actor can hammer these endpoints.

**Fix:** Add IP-based rate limiting in the Edge Functions, or enable Supabase's built-in rate limiting for Auth.

---

### 5. Missing Stripe webhook signature validation in local dev
**File:** `.env.local` — `STRIPE_WEBHOOK_SECRET` is empty.

The webhook handler correctly calls `stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET)`, but an empty secret means any POST to that endpoint will fail (it'll throw on construction), but it also means you can't test webhooks locally. More importantly, if this secret is also empty in production, webhooks won't work at all.

**Fix:** Run `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook` and paste the generated signing secret into both `.env.local` and Supabase's Secrets dashboard.

---

## 🟠 PERFORMANCE ISSUES

### 6. 20,000-line monolithic `App.tsx`
This is the single biggest performance and maintainability problem. The entire application — every screen, modal, piece of state, and function — lives in one file. React must reconcile the entire tree on every state change. There are:
- **121 `useState` calls** in a single component
- **187 `useEffect`/`useCallback`/`useMemo`** calls in the same component

Every time any state changes (e.g., a search box typed into), React re-evaluates all 121 state-derived values and potentially re-renders the entire UI tree.

**Fix:** Split into separate components/screens. At minimum:
- `screens/SetlistsScreen.tsx`
- `screens/BuilderScreen.tsx`
- `screens/SongsScreen.tsx`
- `screens/MusiciansScreen.tsx`
- `screens/AccountScreen.tsx`
- `components/modals/` — one file per modal
- `hooks/` — extract related state into custom hooks

---

### 7. No code splitting or lazy loading
The entire bundle loads on first page load. The `html2pdf.js` vendor chunk alone (~2MB) is loaded even if the user never prints.

**Fix:** Use `React.lazy` + `Suspense` for screens and heavy modals. Dynamically import `html2pdf.js` only when the user triggers a PDF export.

---

### 8. No component memoization
There are no `React.memo` wrappers on any child component. Since all state lives in one root component, every render propagates down to every child.

**Fix:** Wrap extracted components in `React.memo`, and use `useCallback`/`useMemo` at the boundaries to stabilize props.

---

### 9. `initialState` and `emptyState` are identical objects
**File:** `src/App.tsx` lines 546–573

Two separate objects with identical structure and values. No functional difference; one is pure redundancy.

**Fix:** Delete `emptyState` and use `initialState` in both places.

---

### 10. 47 `localStorage` reads/writes scattered inline
State initialization reads from `localStorage` in dozens of `useState` initializers. Some keys use string literals (`'setlist_build_complete'`, `'setlist_gig_sections'`), some use named constants. There's no single place that owns persistence logic.

**Fix:** Centralize all localStorage access in a `src/lib/storage.ts` module with typed getters/setters and a single source of truth for key names.

---

## 🟡 UX ISSUES

### 11. Dual authentication paths create confusion
The app has two completely different login systems:
- When Supabase is configured: full email/password auth with signup, magic links, and password recovery
- When Supabase is not configured: a plain password input with two hardcoded passwords

This means the login UI changes based on environment, which is disorienting. The offline mode serves no real user purpose in production.

**Fix:** Remove the offline password fallback. Make Supabase auth the only path. If you need a demo/guest mode, implement it explicitly with a "View demo" button that loads sample data.

---

### 12. No loading skeleton states
When Supabase data is loading, the app shows nothing or empty states. Users have no feedback that content is incoming.

**Fix:** Add skeleton placeholder components for the setlist list, song list, and musician roster while data loads.

---

### 13. Error messages are technical/undifferentiated
Supabase errors surface raw error messages like "Supabase lookup failed: ..." to the user. Auth errors are sometimes shown as raw API messages.

**Fix:** Map known error codes to friendly messages. Unknown errors should show a generic "Something went wrong" with a support contact.

---

### 14. Session timeout is silent
`SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000` (2 hours) — the session expires but there's no proactive warning. Users lose unsaved work with no warning.

**Fix:** Show a "Your session will expire in 5 minutes" toast and offer a "Stay logged in" button. On expiry, save any pending state to `localStorage` before logging out.

---

### 15. Mobile drag-and-drop is fragile
The setlist builder uses `onDragStart`/`onDragOver`/`onDrop` for reordering. These events have limited support and poor UX on touch devices. The code has separate touch-event patches (`sheetLongPressTimerRef`, `bannerTouchStartX`), indicating past struggles with this.

**Fix:** Replace the custom drag implementation with a proper touch-compatible library like `@dnd-kit/core`, which is purpose-built for this and works on mobile.

---

### 16. No offline indicator
The app is a PWA with a service worker, but there's no UI indication when the user is offline. Writes silently fail.

**Fix:** Add a top banner that appears when `navigator.onLine` is false: "You're offline — changes won't be saved."

---

### 17. PDF/print export is slow and blocks the UI
`html2pdf.js` runs synchronously on the main thread, freezing the UI for several seconds on larger setlists. There's no progress indicator during this time beyond `pdfDownloadLoading`.

**Fix:** Move PDF generation to a Web Worker, or show a progress bar with estimated time based on setlist length. At minimum, show a spinner with "Generating PDF…" text immediately on click.

---

### 18. Song search has no debounce
The song search filters on every keystroke. With a large song library this causes unnecessary re-renders on each character typed.

**Fix:** Debounce the search input by 150–200ms using a `useDebounce` hook.

---

## 🔵 CODE QUALITY / REDUNDANCY

### 19. All types defined inline in App.tsx
`Song`, `Setlist`, `Musician`, `Band`, `BandMembership`, `Document`, etc. are all defined at the top of App.tsx with no organization.

**Fix:** Move to `src/types/index.ts` or co-locate with their feature modules.

---

### 20. Magic strings for localStorage keys are mixed
Some keys use named constants (`ACTIVE_BAND_KEY`, `LAST_ACTIVE_KEY`), some use inline strings (`'setlist_build_complete'`, `'setlist_gig_sections'`). This makes it easy to typo a key and silently lose data.

**Fix:** Define all keys as constants in `src/lib/storage.ts`.

---

### 21. `QaViewPreset` and QA tooling baked into production bundle
QA/testing code (`qaPreset`, `qaToolsEnabled`, `QaViewPreset` type) is compiled into the production bundle. It's gated by hostname check, but the code still exists in the bundle.

**Fix:** Use Vite's `import.meta.env.DEV` to tree-shake QA code out of production builds.

---

### 22. No TypeScript strict null checks enforced
Several places cast with `as string` or use non-null assertions without guards. The tsconfig likely doesn't have `"strict": true`.

**Fix:** Enable `"strict": true` in `tsconfig.app.json` and fix the resulting errors.

---

### 23. Supabase calls have no centralized error handler
73 direct `supabase.from(...)` and `supabase.rpc(...)` calls are scattered through App.tsx. Each handles errors slightly differently. Some check `error`, some don't.

**Fix:** Create a `src/lib/db.ts` wrapper with typed query helpers and a single error handling path that logs errors and surfaces user-friendly messages.

---

## Summary Priority Table

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | Hardcoded passwords in bundle | 🔴 Critical | Low |
| 2 | Stripe secret key in env file | 🔴 Critical | Low |
| 3 | CORS wildcard on Edge Function | 🔴 Critical | Low |
| 5 | Empty webhook secret | 🔴 Critical | Low |
| 6 | 20k-line monolith App.tsx | 🟠 High | High |
| 7 | No code splitting | 🟠 High | Medium |
| 10 | localStorage scattered everywhere | 🟠 High | Medium |
| 8 | No component memoization | 🟠 High | Medium |
| 14 | Silent session timeout | 🟡 Medium | Low |
| 15 | Drag-and-drop broken on mobile | 🟡 Medium | Medium |
| 12 | No loading skeletons | 🟡 Medium | Medium |
| 18 | Search not debounced | 🟡 Medium | Low |
| 9 | `initialState`/`emptyState` duplication | 🔵 Low | Low |
| 21 | QA code in production bundle | 🔵 Low | Low |
| 20 | Magic string localStorage keys | 🔵 Low | Low |
