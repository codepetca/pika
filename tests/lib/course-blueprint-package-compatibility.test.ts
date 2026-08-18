import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  decodeCourseBlueprintPackageArchive,
  encodeCourseBlueprintPackageArchive,
  parseCourseBlueprintImportArchive,
  parseCourseBlueprintImportBundle,
  type CourseBlueprintImportResult,
  type CourseBlueprintPackageBundle,
} from '@/lib/course-blueprint-package'
import {
  COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS,
} from '@/lib/contracts/course-blueprint-package'

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures')

function loadFixture(version: string): CourseBlueprintPackageBundle {
  return JSON.parse(readFileSync(
    resolve(fixtureDir, `course-blueprint-package-v${version}.json`),
    'utf8',
  ))
}

function readTarEntry(archive: Uint8Array, fileName: string): Uint8Array {
  const decoder = new TextDecoder()
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.slice(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = decoder.decode(header.slice(0, 100)).replace(/\0.*$/, '').trim()
    const sizeText = decoder.decode(header.slice(124, 136)).replace(/\0/g, '').trim()
    const size = Number.parseInt(sizeText, 8) || 0
    const entryLength = 512 + Math.ceil(size / 512) * 512
    if (name === fileName) return archive.slice(offset, offset + entryLength)
    offset += entryLength
  }
  throw new Error(`Missing TAR fixture entry: ${fileName}`)
}

function appendTarEntry(archive: Uint8Array, entry: Uint8Array): Uint8Array {
  const body = archive.slice(0, archive.length - 1024)
  const result = new Uint8Array(body.length + entry.length + 1024)
  result.set(body)
  result.set(entry, body.length)
  return result
}

const fixtures = Object.fromEntries(
  COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS.map((version) => [version, loadFixture(version)]),
) as Record<string, CourseBlueprintPackageBundle>

function collectArtifactIds(result: CourseBlueprintImportResult): string[] {
  return [
    ...result.assignments.flatMap((assignment) => [
      assignment.artifact_id,
      ...(assignment.submission_requirements || []).map((requirement) => requirement.id),
    ]),
    ...result.assessments.flatMap((assessment) => [
      assessment.artifact_id,
      ...assessment.content.questions.map((question) => question.id),
      ...assessment.documents.map((document) => document.id),
    ]),
    ...result.lesson_templates.map((lesson) => lesson.artifact_id),
    ...result.materials.map((material) => material.artifact_id),
    ...result.surveys.flatMap((survey) => [
      survey.artifact_id,
      ...survey.questions_json.map((question) => question.id),
    ]),
  ].filter((id): id is string => Boolean(id))
}

function portableContent(result: CourseBlueprintImportResult) {
  return {
    blueprint: result.blueprint,
    assignments: result.assignments.map(({ artifact_id: _artifactId, submission_requirements, ...assignment }) => ({
      ...assignment,
      submission_requirements: (submission_requirements || []).map(({ id: _id, ...requirement }) => requirement),
    })),
    assessments: result.assessments.map(({ artifact_id: _artifactId, content, documents, ...assessment }) => ({
      ...assessment,
      content: {
        ...content,
        questions: content.questions.map(({ id: _id, ...question }) => question),
      },
      documents: documents.map(({ id: _id, ...document }) => document),
    })),
    lessons: result.lesson_templates.map(({ artifact_id: _artifactId, ...lesson }) => lesson),
    materials: result.materials.map(({ artifact_id: _artifactId, ...material }) => material),
    surveys: result.surveys.map(({ artifact_id: _artifactId, questions_json, ...survey }) => ({
      ...survey,
      questions_json: questions_json.map(({ id: _id, ...question }) => question),
    })),
  }
}

describe('course blueprint package compatibility matrix', () => {
  it('has one immutable fixture for every supported package version', () => {
    expect(Object.keys(fixtures)).toEqual([...COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS])
    expect(Object.entries(fixtures).map(([version, fixture]) => fixture.manifest.version === version))
      .toEqual([true, true, true, true])
  })

  it.each([
    ['2', 'Legacy Computer Science', 0, 0],
    ['3', 'Version 3 Computer Science', 0, 0],
    ['4', 'Version 4 Computer Science', 0, 0],
    ['5', 'Version 5 Computer Science', 1, 1],
  ] as const)(
    'imports version %s as reusable current-domain content',
    (version, title, materialCount, surveyCount) => {
      const parsed = parseCourseBlueprintImportBundle(fixtures[version])
      const artifactIds = collectArtifactIds(parsed)

      expect(parsed.errors).toEqual([])
      expect(parsed.manifest?.version).toBe(version)
      expect(parsed.blueprint).toEqual(expect.objectContaining({
        title,
        planned_site_published: false,
      }))
      expect(parsed.blueprint.planned_site_config).not.toHaveProperty('quizzes')
      expect(parsed.blueprint.planned_site_config).not.toHaveProperty('retired_navigation')
      expect(parsed.assignments).toHaveLength(1)
      expect(parsed.assessments).toHaveLength(1)
      expect(parsed.assessments[0].assessment_type).toBe('test')
      expect(parsed.lesson_templates).toHaveLength(1)
      expect(parsed.materials).toHaveLength(materialCount)
      expect(parsed.surveys).toHaveLength(surveyCount)
      expect(artifactIds.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)))
        .toBe(true)
      expect(new Set(artifactIds).size).toBe(artifactIds.length)
    },
  )

  it.each(COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS)(
    'preserves version %s portable content through a TAR archive',
    (version) => {
      const bundleResult = parseCourseBlueprintImportBundle(fixtures[version])
      const archive = encodeCourseBlueprintPackageArchive(fixtures[version])
      const decoded = decodeCourseBlueprintPackageArchive(archive)
      const archiveResult = parseCourseBlueprintImportArchive(archive)

      expect(decoded?.manifest.version).toBe(version)
      if (version !== '5') {
        expect(decoded?.files).not.toHaveProperty('classwork-materials.md')
        expect(decoded?.files).not.toHaveProperty('surveys.md')
      }
      expect(archiveResult.errors).toEqual([])
      expect(portableContent(archiveResult)).toEqual(portableContent(bundleResult))
    },
  )

  it.each(['2', '3'] as const)(
    'rejects undeclared current files in version %s direct and TAR packages',
    (version) => {
      const fixture = structuredClone(fixtures[version])
      fixture.files['surveys.md'] = fixtures['5'].files['surveys.md']
      const legacyArchive = encodeCourseBlueprintPackageArchive(fixtures[version])
      const currentArchive = encodeCourseBlueprintPackageArchive(fixtures['5'])
      const invalidArchive = appendTarEntry(
        legacyArchive,
        readTarEntry(currentArchive, 'surveys.md'),
      )

      expect(parseCourseBlueprintImportBundle(fixture).errors)
        .toContain('Invalid course package bundle')
      expect(parseCourseBlueprintImportArchive(invalidArchive).errors)
        .toContain('Invalid course package archive')
    },
  )

  it.each([
    ['direct bundle', () => parseCourseBlueprintImportBundle(fixtures['5'])],
    ['TAR archive', () => parseCourseBlueprintImportArchive(
      encodeCourseBlueprintPackageArchive(fixtures['5']),
    )],
  ] as const)('keeps version 5 identity, grading, and reusable child contracts exact through %s', (_source, parse) => {
    const parsed = parse()

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
    expect(collectArtifactIds(parsed)).toEqual([
      '41000000-0000-4000-8000-000000000005',
      '42000000-0000-4000-8000-000000000005',
      '51000000-0000-4000-8000-000000000005',
      '52000000-0000-4000-8000-000000000005',
      '53000000-0000-4000-8000-000000000005',
      '54000000-0000-4000-8000-000000000005',
      '61000000-0000-4000-8000-000000000005',
      '71000000-0000-4000-8000-000000000005',
      '81000000-0000-4000-8000-000000000005',
      '82000000-0000-4000-8000-000000000005',
    ])
    expect(parsed.assessments[0].documents).toEqual([
      expect.objectContaining({ id: '53000000-0000-4000-8000-000000000005', source: 'link' }),
      expect.objectContaining({ id: '54000000-0000-4000-8000-000000000005', source: 'text' }),
    ])
    expect(parsed.surveys[0].questions_json[0].id)
      .toBe('82000000-0000-4000-8000-000000000005')
  })

  it('rejects Pika-managed storage identities in an otherwise valid current package', () => {
    const fixture = structuredClone(fixtures['5'])
    fixture.files['tests.md'] += '\nmanaged_object_id: 90000000-0000-4000-8000-000000000005'

    expect(parseCourseBlueprintImportBundle(fixture).errors)
      .toContain('Course packages cannot contain Pika-managed storage references')
  })

  it.each([
    [
      'resources.md',
      '\nhttps://test.supabase.co/storage/v1/object/public/test-documents/teacher/test/file.pdf',
    ],
    [
      'assignments.md',
      '\nSNAPSHOT_MANAGED_OBJECT_ID: 90000000-0000-4000-8000-000000000005',
    ],
    [
      'resources.md',
      '\nhttps://test.supabase.co/%73torage/v1/object/public/test-documents/teacher/test/file.pdf',
    ],
    [
      'resources.md',
      '\nhttps://test.supabase.co/storage/v1/object/public/%74est-documents/teacher/test/file.pdf',
    ],
    [
      'resources.md',
      '\nhttps://test.supabase.co/storage/v1/object/public/%ZZ/teacher/test/file.pdf',
    ],
    [
      'resources.md',
      '\n//test.supabase.co/storage/v1/object/public/test-documents/teacher/test/file.pdf',
    ],
    [
      'resources.md',
      '\nhttps://test.supabase.co/%2573torage/v1/object/public/test-documents/teacher/test/file.pdf',
    ],
  ] as const)('rejects managed storage references in %s for direct and TAR imports', (fileName, content) => {
    const fixture = structuredClone(fixtures['5'])
    fixture.files[fileName] += content
    const archive = encodeCourseBlueprintPackageArchive(fixture)

    expect(parseCourseBlueprintImportBundle(fixture).errors)
      .toContain('Course packages cannot contain Pika-managed storage references')
    expect(parseCourseBlueprintImportArchive(archive).errors)
      .toContain('Course packages cannot contain Pika-managed storage references')
  })

  it('accepts an external URL that uses the same storage path shape', () => {
    const fixture = structuredClone(fixtures['5'])
    fixture.files['resources.md'] += [
      '\nhttps://docs.example.com/storage/v1/object/public/test-documents/reference.pdf',
      '\n//docs.example.com/storage/v1/object/public/test-documents/protocol-relative.pdf',
      '\nThe literal managed_object_id is a database field name, not a reference.',
    ].join('')
    const archive = encodeCourseBlueprintPackageArchive(fixture)

    expect(parseCourseBlueprintImportBundle(fixture).errors).toEqual([])
    expect(parseCourseBlueprintImportArchive(archive).errors).toEqual([])
  })
})
