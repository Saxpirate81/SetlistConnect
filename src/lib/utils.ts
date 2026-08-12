import type { BandMembership, Screen } from '../types'
import { LOCALHOST_ORIGIN_REGEX, DEFAULT_PRODUCTION_APP_ORIGIN } from './constants'

// ─── Role helpers ─────────────────────────────────────────────────────────────

export const isAdminMembershipRole = (value?: string | null): boolean => {
  const normalized = (value ?? '').trim().toLowerCase()
  return (
    normalized.includes('admin') ||
    normalized.includes('owner') ||
    normalized.includes('leader')
  )
}

export const getPreferredMembership = (
  memberships: BandMembership[],
  bandId: string,
): BandMembership | null => {
  const activeMemberships = memberships.filter(
    (m) => m.bandId === bandId && m.status === 'active',
  )
  return (
    activeMemberships.find((m) => isAdminMembershipRole(m.role)) ??
    activeMemberships[0] ??
    null
  )
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

export const isMainNavScreen = (
  value: string,
): value is Extract<Screen, 'setlists' | 'song' | 'musicians' | 'account'> =>
  value === 'setlists' || value === 'song' || value === 'musicians' || value === 'account'

// ─── URL / origin helpers ─────────────────────────────────────────────────────

export const isLocalhostOrigin = (origin: string): boolean =>
  LOCALHOST_ORIGIN_REGEX.test(origin)

export const parseOriginFromUrl = (value: string): string => {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

export function replaceHistorySearchParams(params: URLSearchParams) {
  const next = params.toString()
  const newUrl = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', newUrl)
}

export const resolveAuthRedirectOrigin = (
  currentOrigin: string,
  configuredAppUrl: string,
  options: { isProd: boolean },
): string => {
  const configuredOrigin = parseOriginFromUrl(configuredAppUrl)
  const isConfiguredLocal = configuredOrigin ? isLocalhostOrigin(configuredOrigin) : false
  const isCurrentLocal = isLocalhostOrigin(currentOrigin)
  if (options.isProd) {
    if (configuredOrigin && !isConfiguredLocal) return configuredOrigin
    if (!isCurrentLocal) return currentOrigin
    return DEFAULT_PRODUCTION_APP_ORIGIN
  }
  if (configuredOrigin && !isConfiguredLocal) return configuredOrigin
  return currentOrigin
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export const parseEmailRateLimitSeconds = (message: string): number => {
  const lower = message.toLowerCase()
  const minuteMatch = lower.match(/(\d+)\s*minute/)
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1] ?? 0)
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60
  }
  const secondMatch = lower.match(/(\d+)\s*second/)
  if (secondMatch) {
    const seconds = Number(secondMatch[1] ?? 0)
    if (Number.isFinite(seconds) && seconds > 0) return seconds
  }
  return 120
}

export const isEmailRateLimitErrorMessage = (message: string): boolean => {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('over_email_send_rate_limit') ||
    (normalized.includes('security purposes') && normalized.includes('once every'))
  )
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns ISO date string shifted back 5 hours (so midnight–5am counts as the previous day). */
export const getOperationalDateISO = (date = new Date()): string => {
  const shifted = new Date(date.getTime() - 5 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

export const normalizeGigDateISO = (raw: string | null | undefined): string => {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  const directIso = value.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(directIso)) return directIso
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

// ─── Array helpers ────────────────────────────────────────────────────────────

export const chunkList = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks.length ? chunks : [[]]
}
