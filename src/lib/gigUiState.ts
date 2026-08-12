export type GigUiState = {
  v: 1
  buildComplete?: Record<string, boolean>
  sections?: string[]
  hiddenSections?: string[]
  hiddenSpecial?: boolean
  /** Maps section display label → library style tag (Dinner / Dance / Latin). Survives rename. */
  sectionStyles?: Record<string, string>
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isBooleanRecord = (value: unknown): value is Record<string, boolean> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === 'boolean')
}

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === 'string')
}

export const parseGigUiState = (raw: unknown): GigUiState | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const next: GigUiState = { v: 1 }
  if (isBooleanRecord(obj.buildComplete)) next.buildComplete = obj.buildComplete
  if (isStringArray(obj.sections)) next.sections = obj.sections
  if (isStringArray(obj.hiddenSections)) next.hiddenSections = obj.hiddenSections
  if (typeof obj.hiddenSpecial === 'boolean') next.hiddenSpecial = obj.hiddenSpecial
  if (isStringRecord(obj.sectionStyles)) next.sectionStyles = obj.sectionStyles
  if (
    !next.buildComplete &&
    !next.sections &&
    !next.hiddenSections &&
    typeof next.hiddenSpecial !== 'boolean' &&
    !next.sectionStyles
  ) {
    return null
  }
  return next
}

export const buildGigUiStatePayload = (input: {
  buildComplete?: Record<string, boolean>
  sections?: string[]
  hiddenSections?: string[]
  hiddenSpecial?: boolean
  sectionStyles?: Record<string, string>
}): GigUiState => ({
  v: 1,
  buildComplete: input.buildComplete ?? {},
  sections: input.sections ?? [],
  hiddenSections: input.hiddenSections ?? [],
  hiddenSpecial: Boolean(input.hiddenSpecial),
  sectionStyles: input.sectionStyles ?? {},
})
