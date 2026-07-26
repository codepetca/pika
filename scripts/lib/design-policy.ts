import { createHash } from 'node:crypto'

export const DESIGN_VALUE_KINDS = [
  'raw-color-class',
  'raw-css-color',
  'arbitrary-spacing',
  'raw-z-index',
] as const

export type DesignValueKind = typeof DESIGN_VALUE_KINDS[number]

export const DESIGN_VALUE_REASONS = [
  'content-owned-color',
  'dynamic-identity-color',
  'theme-bootstrap',
  'legacy-visual-value',
  'layout-geometry',
  'special-layer',
  'third-party-editor',
] as const

export type DesignValueReason = typeof DESIGN_VALUE_REASONS[number]

export interface DesignValueException {
  kind: DesignValueKind
  count: number
  fingerprint: string
  reason: DesignValueReason
}

export interface DesignValueExceptionEntry {
  file: string
  reviewBy: string
  values: DesignValueException[]
}

export interface DesignValueExceptionRegistry {
  version: 1
  entries: DesignValueExceptionEntry[]
}

export interface DesignPolicyViolation {
  file: string
  message: string
}

export interface DesignValueInventory {
  count: number
  fingerprint: string
}

const rawColorClassPattern =
  /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]+)?(?![\w-])/g

const rawCssColorPattern =
  /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(/g

const arbitrarySpacingPattern =
  /(?<![\w-])-?(?:m[trblxy]?|p[trblxy]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|w|h|min-w|min-h|max-w|max-h)-\[[^\]\n]*(?:px|rem|em|dvh|svh|lvh|vh|dvw|svw|lvw|vw)[^\]\n]*\]/g

const rawZIndexPattern = /(?<![\w-])z-(?:\d+|\[[^\]\n]+\])(?![\w-])/g

const patterns: Record<DesignValueKind, RegExp> = {
  'raw-color-class': rawColorClassPattern,
  'raw-css-color': rawCssColorPattern,
  'arbitrary-spacing': arbitrarySpacingPattern,
  'raw-z-index': rawZIndexPattern,
}

function inventoryMatches(source: string, pattern: RegExp): DesignValueInventory {
  const matches = [...source.matchAll(pattern)].map((match) => match[0]).sort()
  return {
    count: matches.length,
    fingerprint: createHash('sha256').update(matches.join('\0')).digest('hex').slice(0, 16),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function inventoryDesignValues(files: Record<string, string>) {
  const inventory = new Map<string, Map<DesignValueKind, DesignValueInventory>>()

  for (const [file, source] of Object.entries(files)) {
    const values = new Map<DesignValueKind, DesignValueInventory>()
    for (const kind of DESIGN_VALUE_KINDS) {
      const evidence = inventoryMatches(source, patterns[kind])
      if (evidence.count > 0) values.set(kind, evidence)
    }
    if (values.size > 0) inventory.set(file, values)
  }

  return inventory
}

export function parseDesignValueExceptionRegistry(
  input: unknown,
): DesignValueExceptionRegistry {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.entries)) {
    throw new Error('Design-value exception registry must use version 1 with an entries array.')
  }

  const knownKinds = new Set<string>(DESIGN_VALUE_KINDS)
  const knownReasons = new Set<string>(DESIGN_VALUE_REASONS)
  const seenFiles = new Set<string>()
  const entries: DesignValueExceptionEntry[] = input.entries.map((candidate, entryIndex) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.file !== 'string' ||
      candidate.file.length === 0 ||
      typeof candidate.reviewBy !== 'string' ||
      candidate.reviewBy.length === 0 ||
      !Array.isArray(candidate.values)
    ) {
      throw new Error(`Invalid design-value exception entry at index ${entryIndex}.`)
    }
    if (seenFiles.has(candidate.file)) {
      throw new Error(`Duplicate design-value exception entry for ${candidate.file}.`)
    }
    seenFiles.add(candidate.file)

    const seenKinds = new Set<string>()
    const values: DesignValueException[] = candidate.values.map((value, valueIndex) => {
      if (
        !isRecord(value) ||
        typeof value.kind !== 'string' ||
        !knownKinds.has(value.kind) ||
        typeof value.count !== 'number' ||
        !Number.isInteger(value.count) ||
        value.count <= 0 ||
        typeof value.fingerprint !== 'string' ||
        !/^[0-9a-f]{16}$/.test(value.fingerprint) ||
        typeof value.reason !== 'string' ||
        !knownReasons.has(value.reason)
      ) {
        throw new Error(
          `Invalid design-value exception at ${candidate.file} index ${valueIndex}.`,
        )
      }
      if (seenKinds.has(value.kind)) {
        throw new Error(`Duplicate ${value.kind} exception for ${candidate.file}.`)
      }
      seenKinds.add(value.kind)
      return value as DesignValueException
    })

    if (values.length === 0) {
      throw new Error(`Design-value exception entry for ${candidate.file} is empty.`)
    }

    return {
      file: candidate.file,
      reviewBy: candidate.reviewBy,
      values,
    }
  })

  return { version: 1, entries }
}

export function auditDesignPolicy(
  files: Record<string, string>,
  registry: DesignValueExceptionRegistry,
): DesignPolicyViolation[] {
  const inventory = inventoryDesignValues(files)
  const registered = new Map(
    registry.entries.map((entry) => [
      entry.file,
      new Map(entry.values.map((value) => [value.kind, value])),
    ]),
  )
  const violations: DesignPolicyViolation[] = []

  for (const [file, values] of inventory) {
    const fileRegistry = registered.get(file)
    for (const [kind, evidence] of values) {
      const exception = fileRegistry?.get(kind)
      if (!exception) {
        violations.push({
          file,
          message: `${kind} values require an entry in scripts/design-value-exceptions.json.`,
        })
        continue
      }
      if (exception.count !== evidence.count) {
        violations.push({
          file,
          message: `${kind} count is ${evidence.count}; registry expects ${exception.count}.`,
        })
        continue
      }
      if (exception.fingerprint !== evidence.fingerprint) {
        violations.push({
          file,
          message: `${kind} values changed without updating their governed exception.`,
        })
      }
    }
  }

  for (const entry of registry.entries) {
    const values = inventory.get(entry.file)
    for (const value of entry.values) {
      if (!values?.has(value.kind)) {
        violations.push({
          file: entry.file,
          message: `${value.kind} registry entry is stale; no matching value remains.`,
        })
      }
    }
  }

  return violations.sort((left, right) =>
    left.file.localeCompare(right.file) || left.message.localeCompare(right.message))
}
