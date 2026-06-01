const DIRECT_IDENTIFIER_PATTERNS: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]'],
  [/\bhttps?:\/\/[^\s<>"')]+/gi, '[url redacted]'],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '[id redacted]',
  ],
  [
    /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g,
    '[phone redacted]',
  ],
  [
    /\b(?:student\s*(?:number|id|#)|student#)\s*[:#-]?\s*\d{6,12}\b/gi,
    '[student number redacted]',
  ],
  [/\b\d{8,12}\b/g, '[student number redacted]'],
  [
    /\b\d{1,6}\s+(?:[A-Z0-9'.-]+\s+){1,6}(?:street|st|avenue|ave|road|rd|drive|dr|court|ct|lane|ln|boulevard|blvd|way|place|pl|crescent|cres)\b/gi,
    '[address redacted]',
  ],
]

export type AiSanitizationStudent = {
  firstName: string
  lastName: string
}

export interface AiSanitizedRef {
  providerRef: string
  localId: string
}

export interface AiSanitizationContext {
  students: AiSanitizationStudent[]
  initialsMap: Record<string, string>
}

export interface AiSanitizationAudit {
  redactedDirectIdentifiers: boolean
  nameReplacementCount: number
}

export function redactDirectIdentifiers(text: string): string {
  return DIRECT_IDENTIFIER_PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text
  )
}

/**
 * Build a map of unique initials for each student.
 * Handles collisions by appending an index: "J.S.1", "J.S.2".
 */
export function buildInitialsMap(
  students: AiSanitizationStudent[]
): Record<string, string> {
  const result: Record<string, string> = {}
  const counts: Record<string, number> = {}

  for (const student of students) {
    const fi = (student.firstName[0] || '?').toUpperCase()
    const li = (student.lastName[0] || '?').toUpperCase()
    const base = `${fi}.${li}.`
    const fullName = `${student.firstName} ${student.lastName}`

    counts[base] = (counts[base] || 0) + 1
    const key = counts[base] > 1 ? `${base}${counts[base]}` : base

    result[key] = fullName
  }

  for (const base of Object.keys(counts)) {
    if (counts[base] > 1 && result[base]) {
      const fullName = result[base]
      delete result[base]
      result[`${base}1`] = fullName
    }
  }

  return result
}

export function buildAiSanitizationContext(
  students: AiSanitizationStudent[]
): AiSanitizationContext {
  return {
    students,
    initialsMap: buildInitialsMap(students),
  }
}

export function sanitizeTextWithStudentNames(
  text: string,
  students: AiSanitizationStudent[],
  initialsMap: Record<string, string>
): string {
  const result = replaceStudentNames(text, students, initialsMap)
  return redactDirectIdentifiers(result.text)
}

export function sanitizeAiText(
  text: string,
  options?: Partial<AiSanitizationContext>
): string {
  const students = options?.students ?? []
  const initialsMap = options?.initialsMap ?? {}

  if (students.length === 0) {
    return redactDirectIdentifiers(text)
  }

  return sanitizeTextWithStudentNames(text, students, initialsMap)
}

export function sanitizeAiOutputText(text: string): string {
  return redactDirectIdentifiers(text)
}

export function createProviderRefMap<T extends { localId: string }>(
  values: T[],
  prefix: string
): Array<T & AiSanitizedRef> {
  return values.map((value, index) => ({
    ...value,
    providerRef: `${prefix}_${index + 1}`,
  }))
}

export function mapProviderRefToLocalId(refs: AiSanitizedRef[]): Map<string, string> {
  return new Map(refs.map((ref) => [ref.providerRef, ref.localId]))
}

export function sanitizeAiEgressRecord<T extends Record<string, unknown>>(
  record: T,
  allowedKeys: Array<keyof T>
): Pick<T, keyof T> {
  const allowed = new Set<keyof T>(allowedKeys)
  const sanitized: Partial<T> = {}

  for (const key of Object.keys(record) as Array<keyof T>) {
    if (!allowed.has(key)) {
      throw new Error(`Unexpected AI egress field: ${String(key)}`)
    }
    sanitized[key] = record[key]
  }

  return sanitized as Pick<T, keyof T>
}

function replaceStudentNames(
  text: string,
  students: AiSanitizationStudent[],
  initialsMap: Record<string, string>
): { text: string; replacementCount: number } {
  const nameToInitials: Record<string, string> = {}
  for (const [initials, fullName] of Object.entries(initialsMap)) {
    nameToInitials[fullName] = initials
  }

  let result = text
  let replacementCount = 0

  const fullNames = students
    .map((s) => `${s.firstName} ${s.lastName}`)
    .filter((name) => name.trim().length > 1)
    .sort((a, b) => b.length - a.length)

  for (const fullName of fullNames) {
    const initials = nameToInitials[fullName]
    if (!initials) continue
    const escaped = escapeRegExp(fullName)
    result = result.replace(new RegExp(escaped, 'gi'), () => {
      replacementCount += 1
      return initials
    })
  }

  for (const student of students) {
    const fullName = `${student.firstName} ${student.lastName}`
    const initials = nameToInitials[fullName]
    if (!initials) continue

    for (const name of [student.firstName, student.lastName]) {
      if (!name || name.length < 2) continue
      const escaped = escapeRegExp(name)
      result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), () => {
        replacementCount += 1
        return initials
      })
    }
  }

  return { text: result, replacementCount }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
