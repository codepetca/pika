import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  adaptVerifiedCoursePackage,
  parseCourseBlueprintImportArchive,
  parseCourseBlueprintImportBundle,
  parseCourseBlueprintImportJson,
} from '@/lib/course-blueprint-package'
import {
  COURSE_BLUEPRINT_PACKAGE_CONTRACTS,
  COURSE_BLUEPRINT_PACKAGE_MAX_BYTES,
  COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES,
  COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS,
  type CoursePackageRawV2,
  type CoursePackageRawV3,
  type CoursePackageRawV4,
  type CoursePackageRawV5,
  type CoursePackageVersion,
} from '@/lib/contracts/course-blueprint-package'
import {
  verifyCourseBlueprintPackageArchive,
  verifyCourseBlueprintPackageBundle,
  verifyCourseBlueprintPackageJson,
  type CoursePackageVerificationResult,
} from '@/lib/course-blueprint-package-verification'
import {
  decodeFixtureTar,
  encodeFixtureTar,
  fixtureTarEntryText,
  fixtureTarTextEntry,
} from '../helpers/course-package-tar'

const testDir = dirname(fileURLToPath(import.meta.url))
const versions = COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS
const fixturePath = (version: CoursePackageVersion, extension: 'json' | 'tar') => (
  resolve(testDir, `../fixtures/course-blueprint-package-v${version}.${extension}`)
)

const fixtures = Object.fromEntries(versions.map((version) => [
  version,
  JSON.parse(readFileSync(fixturePath(version, 'json'), 'utf8')),
])) as Record<CoursePackageVersion, { manifest: Record<string, unknown>; files: Record<string, string> }>

const fixtureArchives = Object.fromEntries(versions.map((version) => [
  version,
  new Uint8Array(readFileSync(fixturePath(version, 'tar'))),
])) as Record<CoursePackageVersion, Uint8Array>

const fixtureJsonTexts = Object.fromEntries(versions.map((version) => [
  version,
  readFileSync(fixturePath(version, 'json'), 'utf8'),
])) as Record<CoursePackageVersion, string>

const fixtureDigests: Record<CoursePackageVersion, { json: string; tar: string }> = {
  '2': {
    json: '1d32ceb86478a8a0b10475125280fbf807060f8b7a171a722431ca590d3c6187',
    tar: 'b0f1b8022a159e20b9de6a86753c914036c2a599c476403cc9c8c7b245ed95b6',
  },
  '3': {
    json: '2ba84319a22e954804262e730b5012c22333215939b781428b3722314a9c2745',
    tar: '9de9f6caabdbc21216fd4b1419ba145e409b834252a0fa1f1cc40442150a806e',
  },
  '4': {
    json: 'adfde61fb5ce5423c48cf8f0efabaa878e0ab6dc2c992c77cb8f19e853e7117a',
    tar: '21682f0488f7ec8d9ce5df3c880cf91a65b897d0428944f9bbd8c690909dd4b2',
  },
  '5': {
    json: 'd2af8d10cdf90b8ff249daea7aa1c1c4aa3a195a852e383dc9c897ad7b0bfb24',
    tar: 'c63c2a21f799beb0067af11cb7f310d7bd43980d01431fd4c9e254fa80ef35cb',
  },
}

function issueCodes(result: CoursePackageVerificationResult) {
  return result.success ? [] : result.issues.map((issue) => issue.code)
}

function replaceTarManifest(
  archive: Uint8Array,
  mutate: (manifest: Record<string, unknown>) => void,
) {
  const entries = decodeFixtureTar(archive)
  return encodeFixtureTar(entries.map((entry) => {
    if (entry.name !== 'manifest.json') return entry
    const manifest = JSON.parse(fixtureTarEntryText(entry)) as Record<string, unknown>
    mutate(manifest)
    return fixtureTarTextEntry(entry.name, JSON.stringify(manifest, null, 2))
  }))
}

function withoutGeneratedIdentity(value: unknown) {
  return JSON.parse(JSON.stringify(value, (key, child) => (
    key === 'artifact_id' || key === 'id' ? undefined : child
  )))
}

describe('versioned Course Package contract', () => {
  it('exposes accurate version-specific raw wire types', () => {
    expectTypeOf<CoursePackageRawV2['files']>().toHaveProperty('quizzes.md')
    expectTypeOf<CoursePackageRawV2['files']>().not.toHaveProperty('surveys.md')
    expectTypeOf<CoursePackageRawV3['files']>().not.toHaveProperty('quizzes.md')
    expectTypeOf<CoursePackageRawV3['files']>().not.toHaveProperty('surveys.md')
    expectTypeOf<CoursePackageRawV4['files']>().not.toHaveProperty('quizzes.md')
    expectTypeOf<CoursePackageRawV4['files']>().not.toHaveProperty('surveys.md')
    expectTypeOf<CoursePackageRawV5['files']>().toHaveProperty('classwork-materials.md')
    expectTypeOf<CoursePackageRawV5['files']>().toHaveProperty('surveys.md')
    expectTypeOf<CoursePackageRawV5['files']>().not.toHaveProperty('quizzes.md')
  })

  it('freezes the required and allowed root files for every supported version', () => {
    const legacyFiles = [
      'course-overview.md',
      'course-outline.md',
      'resources.md',
      'assignments.md',
      'tests.md',
      'lesson-plans.md',
    ]
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['2'].requiredFiles).toEqual(legacyFiles)
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['2'].allowedFiles).toEqual([
      ...legacyFiles,
      'quizzes.md',
    ])
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['3'].requiredFiles).toEqual(legacyFiles)
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['3'].allowedFiles).toEqual(legacyFiles)
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['4'].requiredFiles).toEqual(legacyFiles)
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['4'].allowedFiles).toEqual(legacyFiles)
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['5'].requiredFiles).toEqual([
      ...legacyFiles,
      'classwork-materials.md',
      'surveys.md',
    ])
    expect(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['5'].allowedFiles)
      .toEqual(COURSE_BLUEPRINT_PACKAGE_CONTRACTS['5'].requiredFiles)
  })

  it.each(versions)('locks immutable JSON and binary TAR evidence for version %s', (version) => {
    expect(createHash('sha256').update(readFileSync(fixturePath(version, 'json'))).digest('hex'))
      .toBe(fixtureDigests[version].json)
    expect(createHash('sha256').update(readFileSync(fixturePath(version, 'tar'))).digest('hex'))
      .toBe(fixtureDigests[version].tar)
  })

  it.each(versions)('verifies version %s JSON and TAR through the same raw boundary', (version) => {
    const direct = verifyCourseBlueprintPackageJson(fixtureJsonTexts[version])
    const archive = verifyCourseBlueprintPackageArchive(fixtureArchives[version])

    expect(direct.success).toBe(true)
    expect(archive.success).toBe(true)
    if (!direct.success || !archive.success) return
    expect(direct.value.bundle).toEqual(archive.value.bundle)
    expect(direct.value.evidence).toEqual(expect.objectContaining({ source: 'json' }))
    expect(archive.value.evidence).toEqual(expect.objectContaining({ source: 'tar' }))
    expect(direct.value.evidence.entryNames).toEqual(archive.value.evidence.entryNames)
  })

  it.each(versions)('adapts version %s JSON and TAR to equivalent portable content', (version) => {
    const direct = parseCourseBlueprintImportJson(fixtureJsonTexts[version])
    const archive = parseCourseBlueprintImportArchive(fixtureArchives[version])

    expect(direct.errors).toEqual([])
    expect(archive.errors).toEqual([])
    expect(withoutGeneratedIdentity(archive)).toEqual(withoutGeneratedIdentity(direct))
  })

  it.each([
    ['2', 'Legacy Computer Science', 0, 0],
    ['3', 'Version 3 Computer Science', 0, 0],
    ['4', 'Version 4 Computer Science', 0, 0],
    ['5', 'Version 5 Computer Science', 1, 1],
  ] as const)(
    'adapts version %s fixture content into the current portable domain',
    (version, title, materialCount, surveyCount) => {
      const parsed = parseCourseBlueprintImportBundle(fixtures[version])

      expect(parsed.errors).toEqual([])
      expect(parsed.manifest?.version).toBe(version)
      expect(parsed.blueprint).toEqual(expect.objectContaining({
        title,
        planned_site_published: false,
      }))
      expect(parsed.blueprint.planned_site_config).not.toHaveProperty('quizzes')
      expect(parsed.assignments).toHaveLength(1)
      expect(parsed.assessments).toHaveLength(1)
      expect(parsed.assessments[0].assessment_type).toBe('test')
      expect(parsed.lesson_templates).toHaveLength(1)
      expect(parsed.materials).toHaveLength(materialCount)
      expect(parsed.surveys).toHaveLength(surveyCount)
    },
  )

  it('preserves exact version 5 identity, grading, and reusable child contracts', () => {
    const parsed = parseCourseBlueprintImportArchive(fixtureArchives['5'])

    expect(parsed.manifest).toEqual(expect.objectContaining({
      version: '5',
      blueprint_id: '10000000-0000-4000-8000-000000000005',
      source_draft_revision: 9,
      blueprint_version_id: '20000000-0000-4000-8000-000000000005',
      blueprint_version_number: 3,
    }))
    expect(parsed.blueprint).toEqual(expect.objectContaining({
      gradebook_use_weights: true,
      gradebook_assignments_weight: 60,
      gradebook_tests_weight: 40,
    }))
    expect(parsed.assignments[0]).toEqual(expect.objectContaining({
      artifact_id: '41000000-0000-4000-8000-000000000005',
      default_due_days: 8,
      gradebook_weight: 19,
      track_authenticity: true,
    }))
    expect(parsed.assignments[0].submission_requirements?.[0].id)
      .toBe('42000000-0000-4000-8000-000000000005')
    expect(parsed.assessments[0]).toEqual(expect.objectContaining({
      artifact_id: '51000000-0000-4000-8000-000000000005',
      gradebook_weight: 29,
    }))
    expect(parsed.assessments[0].content.questions[0].id)
      .toBe('52000000-0000-4000-8000-000000000005')
    expect(parsed.assessments[0].documents).toEqual([
      expect.objectContaining({ id: '53000000-0000-4000-8000-000000000005', source: 'link' }),
      expect.objectContaining({ id: '54000000-0000-4000-8000-000000000005', source: 'text' }),
    ])
    expect(parsed.lesson_templates[0].artifact_id)
      .toBe('61000000-0000-4000-8000-000000000005')
    expect(parsed.materials[0].artifact_id)
      .toBe('71000000-0000-4000-8000-000000000005')
    expect(parsed.surveys[0].artifact_id)
      .toBe('81000000-0000-4000-8000-000000000005')
    expect(parsed.surveys[0].questions_json[0].id)
      .toBe('82000000-0000-4000-8000-000000000005')
  })

  it('rejects non-zero TAR entry padding', () => {
    const archive = fixtureArchives['5'].slice()
    const firstEntrySize = Number.parseInt(
      new TextDecoder().decode(archive.slice(124, 136)).replace(/\0/g, '').trim(),
      8,
    )
    archive[512 + firstEntrySize] = 1

    expect(issueCodes(verifyCourseBlueprintPackageArchive(archive)))
      .toEqual(['invalid_archive'])
  })

  it('accepts version 2 with or without retired quizzes.md and discards it', () => {
    const withoutQuiz = structuredClone(fixtures['2'])
    delete withoutQuiz.files['quizzes.md']
    const withoutQuizArchive = encodeFixtureTar(
      decodeFixtureTar(fixtureArchives['2']).filter((entry) => entry.name !== 'quizzes.md'),
    )

    expect(verifyCourseBlueprintPackageBundle(fixtures['2']).success).toBe(true)
    expect(verifyCourseBlueprintPackageBundle(withoutQuiz).success).toBe(true)
    expect(verifyCourseBlueprintPackageArchive(withoutQuizArchive).success).toBe(true)
    expect(withoutGeneratedIdentity(parseCourseBlueprintImportBundle(fixtures['2'])))
      .toEqual(withoutGeneratedIdentity(parseCourseBlueprintImportBundle(withoutQuiz)))
    expect(withoutGeneratedIdentity(parseCourseBlueprintImportArchive(withoutQuizArchive)))
      .toEqual(withoutGeneratedIdentity(parseCourseBlueprintImportBundle(withoutQuiz)))
  })

  it.each(versions.flatMap((version) => (
    COURSE_BLUEPRINT_PACKAGE_CONTRACTS[version].requiredFiles.map((fileName) => [version, fileName] as const)
  )))('rejects version %s when required file %s is missing in JSON and TAR', (version, fileName) => {
    const direct = structuredClone(fixtures[version])
    delete direct.files[fileName]
    const archive = encodeFixtureTar(
      decodeFixtureTar(fixtureArchives[version]).filter((entry) => entry.name !== fileName),
    )

    const directVerification = verifyCourseBlueprintPackageBundle(direct)
    const archiveVerification = verifyCourseBlueprintPackageArchive(archive)
    expect(issueCodes(directVerification)).toContain('missing_required_file')
    expect(issueCodes(archiveVerification)).toEqual(issueCodes(directVerification))
    expect(parseCourseBlueprintImportArchive(archive).errors)
      .toEqual(parseCourseBlueprintImportBundle(direct).errors)
  })

  it.each([
    ...versions.map((version) => [version, 'notes.md'] as const),
    ['2', 'surveys.md'] as const,
    ['3', 'quizzes.md'] as const,
    ['4', 'quizzes.md'] as const,
    ['5', 'quizzes.md'] as const,
  ])('rejects forbidden version %s file %s in JSON and TAR', (version, fileName) => {
    const direct = structuredClone(fixtures[version])
    direct.files[fileName] = 'forbidden evidence'
    const archive = encodeFixtureTar([
      ...decodeFixtureTar(fixtureArchives[version]),
      fixtureTarTextEntry(fileName, 'forbidden evidence'),
    ])

    const directVerification = verifyCourseBlueprintPackageBundle(direct)
    const archiveVerification = verifyCourseBlueprintPackageArchive(archive)
    expect(issueCodes(directVerification)).toContain('forbidden_file')
    expect(issueCodes(archiveVerification)).toEqual(issueCodes(directVerification))
    expect(parseCourseBlueprintImportArchive(archive).errors)
      .toEqual(parseCourseBlueprintImportBundle(direct).errors)
  })

  it.each(versions)('rejects duplicate version %s TAR entries before adaptation', (version) => {
    const entries = decodeFixtureTar(fixtureArchives[version])
    const duplicate = entries.find((entry) => entry.name === 'course-overview.md')!
    const result = verifyCourseBlueprintPackageArchive(encodeFixtureTar([...entries, duplicate]))

    expect(issueCodes(result)).toEqual(['duplicate_entry'])
  })

  it('rejects a TAR entry whose header checksum no longer matches', () => {
    const archive = fixtureArchives['5'].slice()
    archive[0] = 'x'.charCodeAt(0)

    expect(issueCodes(verifyCourseBlueprintPackageArchive(archive)))
      .toEqual(['invalid_archive'])
  })

  it.each([
    ['one zero block', (archive: Uint8Array) => archive.slice(0, -512)],
    ['non-aligned zero tail', (archive: Uint8Array) => archive.slice(0, -1)],
  ] as const)('rejects a TAR with a %s', (_label, mutate) => {
    expect(issueCodes(verifyCourseBlueprintPackageArchive(mutate(fixtureArchives['5']))))
      .toEqual(['invalid_archive'])
  })

  it('rejects non-UTF-8 TAR content before adaptation', () => {
    const archive = encodeFixtureTar(decodeFixtureTar(fixtureArchives['5']).map((entry) => (
      entry.name === 'resources.md' ? { ...entry, content: new Uint8Array([0xff]) } : entry
    )))

    expect(issueCodes(verifyCourseBlueprintPackageArchive(archive)))
      .toEqual(['invalid_file'])
  })

  it('rejects non-UTF-8 direct JSON before adaptation', () => {
    const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d])

    expect(issueCodes(verifyCourseBlueprintPackageJson(invalidUtf8)))
      .toEqual(['invalid_envelope'])
  })

  it('rejects BOM-prefixed direct JSON without normalizing received evidence', () => {
    const content = new TextEncoder().encode(fixtureJsonTexts['5'])
    const prefixed = new Uint8Array(content.byteLength + 3)
    prefixed.set([0xef, 0xbb, 0xbf])
    prefixed.set(content, 3)

    expect(issueCodes(verifyCourseBlueprintPackageJson(prefixed)))
      .toEqual(['invalid_envelope'])
  })

  it('rejects a BOM-prefixed TAR manifest without normalizing received evidence', () => {
    const archive = encodeFixtureTar(decodeFixtureTar(fixtureArchives['5']).map((entry) => {
      if (entry.name !== 'manifest.json') return entry
      const content = new Uint8Array(entry.content.byteLength + 3)
      content.set([0xef, 0xbb, 0xbf])
      content.set(entry.content, 3)
      return { ...entry, content }
    }))

    expect(issueCodes(verifyCourseBlueprintPackageArchive(archive)))
      .toEqual(['invalid_manifest'])
  })

  it.each([
    ['root', (manifest: string, files: string) => (
      `{"manifest":${manifest},"manifest":${manifest},"files":${files}}`
    )],
    ['manifest', (manifest: string, files: string) => (
      `{"manifest":${manifest.replace('"version":"5"', '"version":"5","version":"5"')},"files":${files}}`
    )],
    ['files', (manifest: string, files: string) => (
      `{"manifest":${manifest},"files":${files.replace(
        '"course-overview.md":',
        '"course-overview.md":"duplicate","course-overview.md":',
      )}}`
    )],
  ] as const)('rejects duplicate %s keys in raw direct JSON', (_label, buildJson) => {
    const manifest = JSON.stringify(fixtures['5'].manifest)
    const files = JSON.stringify(fixtures['5'].files)

    expect(issueCodes(verifyCourseBlueprintPackageJson(buildJson(manifest, files))))
      .toEqual(['duplicate_entry'])
  })

  it('rejects duplicate manifest keys in a checksum-valid TAR', () => {
    const duplicateManifest = JSON.stringify(fixtures['5'].manifest)
      .replace('"version":"5"', '"version":"5","version":"5"')
    const archive = encodeFixtureTar(decodeFixtureTar(fixtureArchives['5']).map((entry) => (
      entry.name === 'manifest.json'
        ? fixtureTarTextEntry(entry.name, duplicateManifest)
        : entry
    )))

    expect(issueCodes(verifyCourseBlueprintPackageArchive(archive)))
      .toEqual(['duplicate_entry'])
  })

  it('preserves immutable raw evidence and verified content after caller mutation', () => {
    const input = structuredClone(fixtures['5'])
    const verification = verifyCourseBlueprintPackageBundle(input)
    expect(verification.success).toBe(true)
    if (!verification.success) return
    const before = adaptVerifiedCoursePackage(verification.value)

    input.manifest.title = 'mutated caller title'
    input.files['course-overview.md'] = 'mutated caller content'
    expect(Object.isFrozen(verification.value)).toBe(true)
    expect(Object.isFrozen(verification.value.bundle)).toBe(true)
    expect(Object.isFrozen(verification.value.bundle.manifest)).toBe(true)
    expect(Object.isFrozen(verification.value.bundle.files)).toBe(true)
    expect(Object.isFrozen(verification.value.evidence.entryNames)).toBe(true)
    expect(Object.isFrozen(verification.value.evidence.rawManifest)).toBe(true)
    expect(Object.isFrozen(verification.value.evidence.rawFiles)).toBe(true)
    expect(verification.value.evidence.rawManifest).toEqual(
      expect.objectContaining({ title: 'Version 5 Computer Science' }),
    )
    expect(verification.value.evidence.rawFiles['course-overview.md'])
      .not.toBe('mutated caller content')

    expect(() => {
      (verification.value.bundle.files as Record<string, string>)['course-overview.md'] =
        'post-verification mutation'
    }).toThrow()
    expect(adaptVerifiedCoursePackage(verification.value)).toEqual(before)
  })

  it.each(versions.flatMap((version) => ([
    [version, 'missing title', (manifest: Record<string, unknown>) => { delete manifest.title }],
    [version, 'invalid exported_at', (manifest: Record<string, unknown>) => {
      manifest.exported_at = 'not-a-date'
    }],
    [version, 'unknown manifest field', (manifest: Record<string, unknown>) => {
      manifest.runtime_storage_id = 'not-portable'
    }],
  ] as const)))('rejects version %s manifest mutation: %s', (version, _label, mutate) => {
    const direct = structuredClone(fixtures[version])
    mutate(direct.manifest)
    const archive = replaceTarManifest(fixtureArchives[version], mutate)

    const directVerification = verifyCourseBlueprintPackageBundle(direct)
    const archiveVerification = verifyCourseBlueprintPackageArchive(archive)
    expect(issueCodes(directVerification)).toContain('invalid_manifest')
    expect(issueCodes(archiveVerification)).toEqual(issueCodes(directVerification))
    expect(parseCourseBlueprintImportArchive(archive).errors)
      .toEqual(parseCourseBlueprintImportBundle(direct).errors)
  })

  it('rejects unknown version 3 planned-site keys in JSON and TAR', () => {
    const mutate = (manifest: Record<string, unknown>) => {
      const plannedSiteConfig = manifest.planned_site_config as Record<string, unknown>
      plannedSiteConfig.retired_navigation = false
    }
    const direct = structuredClone(fixtures['3'])
    mutate(direct.manifest)
    const archive = replaceTarManifest(fixtureArchives['3'], mutate)

    const directVerification = verifyCourseBlueprintPackageBundle(direct)
    const archiveVerification = verifyCourseBlueprintPackageArchive(archive)
    expect(issueCodes(directVerification)).toContain('invalid_manifest')
    expect(issueCodes(archiveVerification)).toEqual(issueCodes(directVerification))
    expect(parseCourseBlueprintImportArchive(archive).errors)
      .toEqual(parseCourseBlueprintImportBundle(direct).errors)
  })

  it.each(versions)('enforces the exact per-file byte boundary for version %s JSON and TAR', (version) => {
    const fileName = COURSE_BLUEPRINT_PACKAGE_CONTRACTS[version].requiredFiles[0]
    const exact = structuredClone(fixtures[version])
    exact.files[fileName] = 'a'.repeat(COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES)
    const oversized = structuredClone(exact)
    oversized.files[fileName] += 'a'
    const exactArchive = encodeFixtureTar(decodeFixtureTar(fixtureArchives[version]).map((entry) => (
      entry.name === fileName ? fixtureTarTextEntry(fileName, exact.files[fileName]) : entry
    )))
    const oversizedArchive = encodeFixtureTar(decodeFixtureTar(fixtureArchives[version]).map((entry) => (
      entry.name === fileName ? fixtureTarTextEntry(fileName, oversized.files[fileName]) : entry
    )))

    expect(verifyCourseBlueprintPackageBundle(exact).success).toBe(true)
    expect(verifyCourseBlueprintPackageArchive(exactArchive).success).toBe(true)
    expect(issueCodes(verifyCourseBlueprintPackageBundle(oversized))).toContain('file_too_large')
    expect(issueCodes(verifyCourseBlueprintPackageArchive(oversizedArchive)))
      .toContain('file_too_large')
  })

  it.each([
    ['ASCII', ''],
    ['multibyte', 'é'],
  ] as const)('enforces the exact manifest byte boundary for %s JSON and TAR', (_label, prefix) => {
    const exact = structuredClone(fixtures['5'])
    exact.manifest.title = prefix
    const baseBytes = new TextEncoder().encode(JSON.stringify(exact.manifest)).byteLength
    exact.manifest.title += 'a'.repeat(COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES - baseBytes)
    const oversized = structuredClone(exact)
    oversized.manifest.title += 'a'
    const exactJson = JSON.stringify(exact)
    const oversizedJson = JSON.stringify(oversized)
    const exactArchive = encodeFixtureTar([
      fixtureTarTextEntry('manifest.json', JSON.stringify(exact.manifest)),
      ...decodeFixtureTar(fixtureArchives['5']).filter((entry) => entry.name !== 'manifest.json'),
    ])
    const oversizedArchive = encodeFixtureTar([
      fixtureTarTextEntry('manifest.json', JSON.stringify(oversized.manifest)),
      ...decodeFixtureTar(fixtureArchives['5']).filter((entry) => entry.name !== 'manifest.json'),
    ])

    expect(new TextEncoder().encode(JSON.stringify(exact.manifest)).byteLength)
      .toBe(COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES)
    expect(verifyCourseBlueprintPackageJson(exactJson).success).toBe(true)
    expect(verifyCourseBlueprintPackageArchive(exactArchive).success).toBe(true)
    expect(issueCodes(verifyCourseBlueprintPackageJson(oversizedJson)))
      .toEqual(['file_too_large'])
    expect(issueCodes(verifyCourseBlueprintPackageArchive(oversizedArchive)))
      .toEqual(['file_too_large'])
  })

  it('enforces the exact TAR package byte boundary', () => {
    const fixture = fixtureArchives['5']
    const exact = new Uint8Array(COURSE_BLUEPRINT_PACKAGE_MAX_BYTES)
    exact.set(fixture)
    const oversized = new Uint8Array(COURSE_BLUEPRINT_PACKAGE_MAX_BYTES + 1)
    oversized.set(fixture)

    expect(verifyCourseBlueprintPackageArchive(exact).success).toBe(true)
    expect(issueCodes(verifyCourseBlueprintPackageArchive(oversized)))
      .toEqual(['package_too_large'])
  })

  it('enforces the exact direct JSON package byte boundary', () => {
    const exact = structuredClone(fixtures['5'])
    const sizedFiles = COURSE_BLUEPRINT_PACKAGE_CONTRACTS['5'].requiredFiles.slice(0, 4)
    sizedFiles.forEach((fileName) => { exact.files[fileName] = '' })
    const baseBytes = new TextEncoder().encode(JSON.stringify(exact)).byteLength
    let remainingBytes = COURSE_BLUEPRINT_PACKAGE_MAX_BYTES - baseBytes
    sizedFiles.forEach((fileName) => {
      const fileBytes = Math.min(remainingBytes, COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES)
      exact.files[fileName] = 'a'.repeat(fileBytes)
      remainingBytes -= fileBytes
    })
    const oversized = structuredClone(exact)
    oversized.files[sizedFiles[3]] += 'a'

    expect(remainingBytes).toBe(0)
    expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength)
      .toBe(COURSE_BLUEPRINT_PACKAGE_MAX_BYTES)
    expect(verifyCourseBlueprintPackageBundle(exact).success).toBe(true)
    expect(issueCodes(verifyCourseBlueprintPackageBundle(oversized)))
      .toEqual(['package_too_large'])
  })
})
