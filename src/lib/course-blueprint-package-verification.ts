import {
  COURSE_BLUEPRINT_PACKAGE_CONTRACTS,
  COURSE_BLUEPRINT_PACKAGE_MAX_BYTES,
  COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES,
  COURSE_BLUEPRINT_PACKAGE_MAX_FILE_COUNT,
  COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS,
  type CoursePackageRawBundle,
  type CoursePackageVersion,
} from '@/lib/contracts/course-blueprint-package'
import { parseStrictJson, StrictJsonError } from '@/lib/course-blueprint-package-json'

const TAR_BLOCK_BYTES = 512
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export type CoursePackageVerificationIssueCode =
  | 'invalid_envelope'
  | 'unsupported_version'
  | 'invalid_manifest'
  | 'missing_required_file'
  | 'forbidden_file'
  | 'invalid_file'
  | 'file_too_large'
  | 'package_too_large'
  | 'too_many_entries'
  | 'duplicate_entry'
  | 'invalid_archive'

export type CoursePackageVerificationIssue = {
  code: CoursePackageVerificationIssueCode
  message: string
  fileName?: string
}

type DeepReadonly<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends Record<string, unknown>
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

export type CoursePackageRawEvidence = Readonly<{
  source: 'json' | 'tar'
  byteLength: number
  entryNames: readonly string[]
  rawText?: string
  rawManifestText: string
  rawManifest: unknown
  rawFiles: Readonly<Record<string, unknown>>
}>

declare const verifiedCoursePackageBrand: unique symbol

export type VerifiedCoursePackage = Readonly<{
  [verifiedCoursePackageBrand]: true
  bundle: DeepReadonly<CoursePackageRawBundle>
  evidence: CoursePackageRawEvidence
}>

export type CoursePackageVerificationResult =
  | { success: true; value: VerifiedCoursePackage }
  | { success: false; issues: CoursePackageVerificationIssue[] }

function failure(
  code: CoursePackageVerificationIssueCode,
  message: string,
  fileName?: string,
): CoursePackageVerificationResult {
  return { success: false, issues: [{ code, message, ...(fileName ? { fileName } : {}) }] }
}

function cloneAndFreeze<T>(value: T): DeepReadonly<T> {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as DeepReadonly<T>
  }
  if (isRecord(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneAndFreeze(child)]),
    )) as DeepReadonly<T>
  }
  return value as DeepReadonly<T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isSupportedVersion(value: unknown): value is CoursePackageVersion {
  return typeof value === 'string'
    && (COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS as readonly string[]).includes(value)
}

function verifyEvidence(evidence: CoursePackageRawEvidence): CoursePackageVerificationResult {
  if (!isRecord(evidence.rawManifest)) {
    return failure('invalid_manifest', 'Invalid course package manifest')
  }

  const version = evidence.rawManifest.version
  if (!isSupportedVersion(version)) {
    return failure('unsupported_version', 'Unsupported course package version')
  }

  const contract = COURSE_BLUEPRINT_PACKAGE_CONTRACTS[version]
  const issues: CoursePackageVerificationIssue[] = []
  const manifestResult = contract.manifestSchema.safeParse(evidence.rawManifest)
  if (!manifestResult.success) {
    issues.push({ code: 'invalid_manifest', message: 'Invalid course package manifest' })
  }

  const fileNames = Object.keys(evidence.rawFiles)
  const allowedFiles = new Set<string>(contract.allowedFiles)
  for (const fileName of contract.requiredFiles) {
    if (!hasOwn(evidence.rawFiles, fileName)) {
      issues.push({
        code: 'missing_required_file',
        message: `Course package is missing required file "${fileName}"`,
        fileName,
      })
    }
  }
  for (const fileName of fileNames) {
    if (!allowedFiles.has(fileName)) {
      issues.push({
        code: 'forbidden_file',
        message: `Course package contains forbidden file "${fileName}"`,
        fileName,
      })
    }
  }
  for (const [fileName, content] of Object.entries(evidence.rawFiles)) {
    if (typeof content !== 'string') {
      issues.push({
        code: 'invalid_file',
        message: `Course package file "${fileName}" must contain text`,
        fileName,
      })
      continue
    }
    if (textEncoder.encode(content).byteLength > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES) {
      issues.push({
        code: 'file_too_large',
        message: `Course package file "${fileName}" exceeds the 2 MiB limit`,
        fileName,
      })
    }
  }
  if (issues.length > 0) return { success: false, issues }

  const bundleResult = contract.bundleSchema.safeParse({
    manifest: evidence.rawManifest,
    files: evidence.rawFiles,
  })
  if (!bundleResult.success) {
    return failure('invalid_envelope', 'Invalid course package bundle')
  }

  return {
    success: true,
    value: cloneAndFreeze({
      bundle: bundleResult.data as CoursePackageRawBundle,
      evidence,
    }) as unknown as VerifiedCoursePackage,
  }
}

export function verifyCourseBlueprintPackageBundle(
  input: unknown,
): CoursePackageVerificationResult {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(input)
  } catch {
    return failure('invalid_envelope', 'Invalid course package bundle')
  }
  if (serialized === undefined) {
    return failure('invalid_envelope', 'Invalid course package bundle')
  }
  return verifyCourseBlueprintPackageJson(serialized)
}

export function verifyCourseBlueprintPackageJson(
  input: string | ArrayBuffer | Uint8Array,
): CoursePackageVerificationResult {
  const byteLength = typeof input === 'string'
    ? textEncoder.encode(input).byteLength
    : input.byteLength
  if (byteLength > COURSE_BLUEPRINT_PACKAGE_MAX_BYTES) {
    return failure('package_too_large', 'Course package exceeds the 8 MiB limit')
  }

  let rawText: string
  try {
    rawText = typeof input === 'string'
      ? input
      : textDecoder.decode(input instanceof Uint8Array ? input : new Uint8Array(input))
  } catch {
    return failure('invalid_envelope', 'Course package JSON is not valid UTF-8')
  }

  let parsedJson: ReturnType<typeof parseStrictJson>
  try {
    parsedJson = parseStrictJson(rawText)
  } catch (error) {
    if (error instanceof StrictJsonError && error.kind === 'duplicate_key') {
      return failure('duplicate_entry', error.message)
    }
    return failure('invalid_envelope', 'Invalid course package bundle')
  }
  const parsed = parsedJson.value
  if (!isRecord(parsed) || !isRecord(parsed.files)) {
    return failure('invalid_envelope', 'Invalid course package bundle')
  }
  if (Object.keys(parsed).some((key) => key !== 'manifest' && key !== 'files')) {
    return failure('invalid_envelope', 'Invalid course package bundle')
  }

  const rawManifestText = parsedJson.topLevelValueText.get('manifest') ?? ''
  if (textEncoder.encode(rawManifestText).byteLength > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES) {
    return failure(
      'file_too_large',
      'Course package file "manifest.json" exceeds the 2 MiB limit',
      'manifest.json',
    )
  }

  const rawFiles = parsed.files
  if (Object.keys(rawFiles).length + 1 > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_COUNT) {
    return failure('too_many_entries', 'Course package contains too many files')
  }
  return verifyEvidence({
    source: 'json',
    byteLength,
    entryNames: ['manifest.json', ...Object.keys(rawFiles)],
    rawText,
    rawManifestText,
    rawManifest: parsed.manifest,
    rawFiles,
  })
}

function readTarString(source: Uint8Array, offset: number, length: number): string | null {
  const field = source.slice(offset, offset + length)
  const end = field.indexOf(0)
  try {
    return textDecoder.decode(end === -1 ? field : field.slice(0, end))
  } catch {
    return null
  }
}

function readTarOctal(source: Uint8Array, offset: number, length: number): number | null {
  const raw = readTarString(source, offset, length)
  if (raw === null) return null
  const value = raw.trim()
  if (!/^[0-7]+$/.test(value)) return null
  const parsed = Number.parseInt(value, 8)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isZeroBlock(block: Uint8Array) {
  return block.every((byte) => byte === 0)
}

function hasValidTarChecksum(header: Uint8Array) {
  const expected = readTarOctal(header, 148, 8)
  if (expected === null) return false
  const checksumHeader = header.slice()
  checksumHeader.fill(32, 148, 156)
  return checksumHeader.reduce((sum, byte) => sum + byte, 0) === expected
}

export function verifyCourseBlueprintPackageArchive(
  input: ArrayBuffer | Uint8Array,
): CoursePackageVerificationResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > COURSE_BLUEPRINT_PACKAGE_MAX_BYTES) {
    return failure('package_too_large', 'Course package exceeds the 8 MiB limit')
  }
  if (bytes.byteLength % TAR_BLOCK_BYTES !== 0) {
    return failure('invalid_archive', 'Invalid course package TAR structure')
  }

  const extracted = new Map<string, string>()
  const entryNames: string[] = []
  let offset = 0
  let sawTerminator = false

  while (offset + TAR_BLOCK_BYTES <= bytes.byteLength) {
    const header = bytes.slice(offset, offset + TAR_BLOCK_BYTES)
    if (isZeroBlock(header)) {
      const terminator = bytes.slice(offset)
      sawTerminator = terminator.byteLength >= TAR_BLOCK_BYTES * 2
      if (!sawTerminator || !terminator.every((byte) => byte === 0)) {
        return failure('invalid_archive', 'Invalid course package TAR structure')
      }
      break
    }
    if (!hasValidTarChecksum(header)) {
      return failure('invalid_archive', 'Invalid course package TAR header')
    }

    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const size = readTarOctal(header, 124, 12)
    const type = header[156]
    if (!name || prefix === null || size === null || (type !== 0 && type !== 48)) {
      return failure('invalid_archive', 'Invalid course package TAR entry')
    }
    const fullName = prefix ? `${prefix}/${name}` : name
    entryNames.push(fullName)
    if (entryNames.length > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_COUNT) {
      return failure('too_many_entries', 'Course package contains too many TAR entries')
    }
    if (extracted.has(fullName)) {
      return failure(
        'duplicate_entry',
        `Course package contains duplicate TAR entry "${fullName}"`,
        fullName,
      )
    }
    if (size > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES) {
      return failure(
        'file_too_large',
        `Course package file "${fullName}" exceeds the 2 MiB limit`,
        fullName,
      )
    }

    offset += TAR_BLOCK_BYTES
    if (offset + size > bytes.byteLength) {
      return failure('invalid_archive', 'Invalid course package TAR entry size')
    }
    const contentEnd = offset + size
    const paddedEnd = offset + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
    if (paddedEnd > bytes.byteLength) {
      return failure('invalid_archive', 'Invalid course package TAR entry size')
    }
    if (!bytes.slice(contentEnd, paddedEnd).every((byte) => byte === 0)) {
      return failure('invalid_archive', 'Invalid course package TAR entry padding')
    }
    try {
      extracted.set(fullName, textDecoder.decode(bytes.slice(offset, contentEnd)))
    } catch {
      return failure('invalid_file', `Course package file "${fullName}" is not valid UTF-8`, fullName)
    }
    offset = paddedEnd
  }

  if (!sawTerminator) {
    return failure('invalid_archive', 'Course package TAR is missing its terminator')
  }
  const manifestText = extracted.get('manifest.json')
  if (manifestText === undefined) {
    return failure('invalid_manifest', 'Invalid course package manifest')
  }

  let rawManifest: unknown
  try {
    rawManifest = parseStrictJson(manifestText).value
  } catch (error) {
    if (error instanceof StrictJsonError && error.kind === 'duplicate_key') {
      return failure('duplicate_entry', error.message, 'manifest.json')
    }
    return failure('invalid_manifest', 'Invalid course package manifest')
  }
  const rawFiles = Object.fromEntries(
    [...extracted.entries()].filter(([fileName]) => fileName !== 'manifest.json'),
  )
  return verifyEvidence({
    source: 'tar',
    byteLength: bytes.byteLength,
    entryNames,
    rawManifestText: manifestText,
    rawManifest,
    rawFiles,
  })
}
