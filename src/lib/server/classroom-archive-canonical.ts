import { createHash } from 'node:crypto'

export function compareCanonicalStrings(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function canonicalizeJsonWith(
  value: unknown,
  compare: (left: string, right: string) => number,
): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJsonWith(item, compare))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, item]) => [key, canonicalizeJsonWith(item, compare)]),
  )
}

export function canonicalizeJson(value: unknown): unknown {
  return canonicalizeJsonWith(value, compareCanonicalStrings)
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
