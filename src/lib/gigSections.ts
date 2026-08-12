import {
  GIG_SECTION_DELETED_TAG_PREFIX,
  GIG_SECTION_TAG_PREFIX,
  SETLIST_PANEL_PREFIX,
} from './constants'

/** Canonical library style tags used to seed / match setlist sections across gigs. */
export const SETLIST_STYLE_TAGS = ['Dinner', 'Dance', 'Latin'] as const
export type SetlistStyleTag = (typeof SETLIST_STYLE_TAGS)[number]

export function normalizeSetlistSectionLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Infer Dinner / Dance / Latin from a section label, including renamed
 * variants like "Dinner Set 2" or "Latin cocktail". Custom labels with no
 * style keyword return null (caller should use stored style affinity).
 */
export function inferSectionStyleTag(section: string): SetlistStyleTag | null {
  const lower = normalizeSetlistSectionLabel(section).toLowerCase()
  if (!lower) return null
  for (const style of SETLIST_STYLE_TAGS) {
    const needle = style.toLowerCase()
    if (lower === needle) return style
    if (lower.startsWith(`${needle} set `)) return style
    if (lower.startsWith(`${needle} `) || lower.endsWith(` ${needle}`)) return style
    if (new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`).test(lower)) return style
  }
  return null
}

/**
 * Library tags used to find songs for a section. Prefers an explicit style
 * affinity (survives rename), then label inference, then the section name itself.
 */
export function getLibrarySeedTagsForSection(
  section: string,
  styleOverride?: string | null,
): string[] {
  const normalized = normalizeSetlistSectionLabel(section)
  if (!normalized) return []
  const override = normalizeSetlistSectionLabel(styleOverride ?? '')
  if (override) {
    const known = SETLIST_STYLE_TAGS.find((tag) => tag.toLowerCase() === override.toLowerCase())
    return [known ?? override]
  }
  const inferred = inferSectionStyleTag(normalized)
  if (inferred) return [inferred]
  return [normalized]
}

export function sectionsShareStyleFamily(
  sectionA: string,
  sectionB: string,
  styleA?: string | null,
  styleB?: string | null,
): boolean {
  const seedsA = getLibrarySeedTagsForSection(sectionA, styleA).map((tag) => tag.toLowerCase())
  const seedsB = getLibrarySeedTagsForSection(sectionB, styleB).map((tag) => tag.toLowerCase())
  if (!seedsA.length || !seedsB.length) return false
  if (normalizeSetlistSectionLabel(sectionA).toLowerCase() ===
    normalizeSetlistSectionLabel(sectionB).toLowerCase()) {
    return true
  }
  return seedsA.some((seed) => seedsB.includes(seed))
}

export function makeGigSectionTag(gigId: string, section: string): string {
  return `${GIG_SECTION_TAG_PREFIX}${gigId}::${encodeURIComponent(normalizeSetlistSectionLabel(section))}`
}

export function makeGigSectionDeletedTag(gigId: string, section: string): string {
  return `${GIG_SECTION_DELETED_TAG_PREFIX}${gigId}::${encodeURIComponent(normalizeSetlistSectionLabel(section))}`
}

export function parseGigSectionTag(value: string): { gigId: string; section: string } | null {
  if (!value.startsWith(GIG_SECTION_TAG_PREFIX)) return null
  const payload = value.slice(GIG_SECTION_TAG_PREFIX.length)
  const separatorIndex = payload.indexOf('::')
  if (separatorIndex <= 0) return null
  const gigId = payload.slice(0, separatorIndex)
  const encodedSection = payload.slice(separatorIndex + 2)
  const decodedSection = normalizeSetlistSectionLabel(decodeURIComponent(encodedSection || ''))
  if (!gigId || !decodedSection) return null
  return { gigId, section: decodedSection }
}

export function parseGigSectionDeletedTag(value: string): { gigId: string; section: string } | null {
  if (!value.startsWith(GIG_SECTION_DELETED_TAG_PREFIX)) return null
  const payload = value.slice(GIG_SECTION_DELETED_TAG_PREFIX.length)
  const separatorIndex = payload.indexOf('::')
  if (separatorIndex <= 0) return null
  const gigId = payload.slice(0, separatorIndex)
  const encodedSection = payload.slice(separatorIndex + 2)
  const decodedSection = normalizeSetlistSectionLabel(decodeURIComponent(encodedSection || ''))
  if (!gigId || !decodedSection) return null
  return { gigId, section: decodedSection }
}

export function getSectionDeleteKey(section: string): string {
  return normalizeSetlistSectionLabel(section).toLowerCase()
}

export function setlistPanelKey(section: string): string {
  return `${SETLIST_PANEL_PREFIX}${section}`
}

export function getSectionFromPanel(panel: string | null): string | null {
  return panel && panel.startsWith(SETLIST_PANEL_PREFIX)
    ? panel.slice(SETLIST_PANEL_PREFIX.length)
    : null
}
