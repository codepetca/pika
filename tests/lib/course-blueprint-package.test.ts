import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  analyzeCourseBlueprintCompleteness,
  buildCourseBlueprintExportBundle,
  decodeCourseBlueprintPackageArchive,
  encodeCourseBlueprintPackageArchive,
  parseCourseBlueprintImportArchive,
  parseCourseBlueprintImportBundle,
} from '@/lib/course-blueprint-package'
import {
  COURSE_BLUEPRINT_PACKAGE_MAX_BYTES,
  COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES,
} from '@/lib/contracts/course-blueprint-package'
import type { CourseBlueprintDetail } from '@/types'

const testDir = dirname(fileURLToPath(import.meta.url))
const V2_BUNDLE = JSON.parse(
  readFileSync(resolve(testDir, '../fixtures/course-blueprint-package-v2.json'), 'utf8'),
)

const DETAIL: CourseBlueprintDetail = {
  id: 'blueprint-1',
  teacher_id: 'teacher-1',
  title: 'Computer Science 11',
  subject: 'Computer Science',
  grade_level: 'Grade 11',
  course_code: 'ICS3U',
  term_template: 'Semester 1',
  overview_markdown: '# Overview\nCourse summary',
  outline_markdown: '# Outline\n- Unit 1',
  resources_markdown: '# Resources\n- IDE',
  planned_site_slug: 'computer-science-11',
  planned_site_published: true,
  planned_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
  },
  position: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  assignments: [
    {
      id: 'assignment-1',
      course_blueprint_id: 'blueprint-1',
      title: 'Kickoff reflection',
      instructions_markdown: 'Write a short reflection.',
      default_due_days: -2,
      default_due_time: '23:59',
      points_possible: 10.5,
      gradebook_weight: 15,
      include_in_final: true,
      is_draft: true,
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  assessments: [
    {
      id: 'assessment-2',
      course_blueprint_id: 'blueprint-1',
      assessment_type: 'test',
      title: 'Unit 1 test',
      content: {
        title: 'Unit 1 test',
        show_results: false,
        questions: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            question_type: 'open_response',
            question_text: 'Explain the main concept.',
            options: [],
            correct_option: null,
            answer_key: 'Main concept explanation',
            sample_solution: null,
            points: 5,
            response_max_chars: 5000,
            response_monospace: false,
          },
        ],
        source_format: 'markdown',
      },
      documents: [],
      points_possible: 50.5,
      gradebook_weight: 30,
      include_in_final: false,
      position: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  lesson_templates: [
    {
      id: 'lesson-1',
      course_blueprint_id: 'blueprint-1',
      title: 'Course launch',
      content_markdown: 'Review expectations.',
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  linked_classrooms: [],
}

describe('course blueprint package', () => {
  it('exports and re-imports the portable package bundle', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle(bundle)

    expect(parsed.errors).toEqual([])
    expect(parsed.blueprint.title).toBe('Computer Science 11')
    expect(parsed.blueprint.planned_site_slug).toBe('computer-science-11')
    expect(parsed.blueprint.planned_site_published).toBe(true)
    expect(parsed.blueprint.planned_site_config).not.toHaveProperty('quizzes')
    expect(parsed.assignments).toHaveLength(1)
    expect(parsed.assignments[0]).toEqual(expect.objectContaining({
      default_due_days: -2,
      points_possible: 10.5,
      gradebook_weight: 15,
    }))
    expect(parsed.assessments).toHaveLength(1)
    expect(parsed.assessments[0].assessment_type).toBe('test')
    expect(parsed.assessments[0]).toEqual(expect.objectContaining({
      points_possible: 50.5,
      gradebook_weight: 30,
      include_in_final: false,
    }))
    expect(parsed.lesson_templates).toHaveLength(1)
  })

  it('omits classroom snapshot ownership from exported blueprint documents', () => {
    const detail = structuredClone(DETAIL)
    detail.assessments[0].documents = [{
      id: 'doc-1',
      title: 'Reference',
      source: 'link',
      url: 'https://docs.example.com/reference',
      snapshot_path: 'link-docs/teacher/test/doc-1/snapshots/current',
      snapshot_content_type: 'text/html',
      synced_at: '2026-07-23T12:00:00.000Z',
    }]

    const parsed = parseCourseBlueprintImportBundle(
      buildCourseBlueprintExportBundle(detail),
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.assessments[0].documents).toEqual([
      expect.objectContaining({
        title: 'Reference',
        source: 'link',
        url: 'https://docs.example.com/reference',
      }),
    ])
    expect(parsed.assessments[0].documents[0]).not.toHaveProperty('snapshot_path')
  })

  it('exports and re-imports the tar package archive', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const archive = encodeCourseBlueprintPackageArchive(bundle)
    const decoded = decodeCourseBlueprintPackageArchive(archive)
    const parsed = parseCourseBlueprintImportArchive(archive)

    expect(decoded).not.toBeNull()
    expect(decoded?.manifest.title).toBe('Computer Science 11')
    expect(decoded?.manifest.version).toBe('4')
    expect(parsed.errors).toEqual([])
    expect(parsed.blueprint.title).toBe('Computer Science 11')
    expect(parsed.blueprint.planned_site_slug).toBe('computer-science-11')
    expect(parsed.assignments).toHaveLength(1)
    expect(parsed.assignments[0]).toEqual(expect.objectContaining({
      default_due_days: -2,
      points_possible: 10.5,
    }))
    expect(parsed.assessments).toHaveLength(1)
    expect(parsed.assessments[0].assessment_type).toBe('test')
    expect(parsed.assessments[0].points_possible).toBe(50.5)
    expect(parsed.lesson_templates).toHaveLength(1)
  })

  it('imports version 2 packages while discarding retired Quiz content', () => {
    const parsed = parseCourseBlueprintImportBundle(V2_BUNDLE)

    expect(parsed.errors).toEqual([])
    expect(parsed.blueprint.title).toBe('Legacy Computer Science')
    expect(parsed.blueprint.planned_site_config).not.toHaveProperty('quizzes')
    expect(parsed.assessments).toEqual([])
  })

  it('decodes a version 2 archive while discarding retired Quiz content', () => {
    const archive = encodeCourseBlueprintPackageArchive(V2_BUNDLE)
    const decoded = decodeCourseBlueprintPackageArchive(archive)
    const parsed = parseCourseBlueprintImportArchive(archive)

    expect(decoded?.manifest.version).toBe('2')
    expect(decoded?.files).not.toHaveProperty('quizzes.md')
    expect(parsed.errors).toEqual([])
    expect(parsed.blueprint.title).toBe('Legacy Computer Science')
    expect(parsed.assessments).toEqual([])
  })

  it.each(['1', '5'])('rejects unsupported package version %s', (version) => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      manifest: { ...bundle.manifest, version },
    })

    expect(parsed.errors).toEqual(['Invalid course package bundle'])
  })

  it.each(['quizzes.md', 'notes.md'])('rejects undeclared version 4 file %s', (fileName) => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      files: { ...bundle.files, [fileName]: 'Unexpected content' },
    })

    expect(parsed.errors).toEqual(['Invalid course package bundle'])
  })

  it('rejects an archive with an unsupported manifest version', () => {
    const archive = encodeCourseBlueprintPackageArchive(buildCourseBlueprintExportBundle(DETAIL))
    const versionMarker = new TextEncoder().encode('"version": "4"')
    const markerOffset = archive.findIndex((byte, index) =>
      versionMarker.every((markerByte, markerIndex) => archive[index + markerIndex] === markerByte)
    )
    expect(markerOffset).toBeGreaterThanOrEqual(0)
    archive[markerOffset + versionMarker.length - 2] = '5'.charCodeAt(0)

    expect(decodeCourseBlueprintPackageArchive(archive)).toBeNull()
    expect(parseCourseBlueprintImportArchive(archive).errors).toEqual(['Invalid course package archive'])
  })

  it('rejects oversized archives and oversized package files', () => {
    expect(decodeCourseBlueprintPackageArchive(
      new Uint8Array(COURSE_BLUEPRINT_PACKAGE_MAX_BYTES + 1)
    )).toBeNull()

    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const oversizedBundle = parseCourseBlueprintImportBundle({
      ...bundle,
      files: {
        ...bundle.files,
        'course-overview.md': 'é'.repeat(Math.floor(COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES / 2) + 1),
      },
    })
    expect(oversizedBundle.errors).toEqual(['Invalid course package bundle'])

    const archive = encodeCourseBlueprintPackageArchive(bundle)
    const fileName = new TextEncoder().encode('course-overview.md')
    const headerOffset = archive.findIndex((byte, index) =>
      fileName.every((fileByte, fileIndex) => archive[index + fileIndex] === fileByte)
    )
    expect(headerOffset).toBeGreaterThanOrEqual(0)
    const oversizedOctal = (COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES + 1).toString(8).padStart(11, '0')
    archive.set(new TextEncoder().encode(oversizedOctal), headerOffset + 124)
    archive[headerOffset + 135] = 0
    expect(decodeCourseBlueprintPackageArchive(archive)).toBeNull()
  })

  it('rejects unexpected tar entries before decoding their content', () => {
    const archive = encodeCourseBlueprintPackageArchive(buildCourseBlueprintExportBundle(DETAIL))
    const fileName = new TextEncoder().encode('tests.md')
    const fileOffset = archive.findIndex((byte, index) =>
      fileName.every((fileByte, fileIndex) => archive[index + fileIndex] === fileByte)
    )
    expect(fileOffset).toBeGreaterThanOrEqual(0)
    archive[fileOffset] = 'x'.charCodeAt(0)

    expect(decodeCourseBlueprintPackageArchive(archive)).toBeNull()
  })

  it('rejects malformed package manifests at the import boundary', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      manifest: { ...bundle.manifest, exported_at: 'not-a-date' },
    })

    expect(parsed.errors).toEqual(['Invalid course package bundle'])
  })

  it('analyzes missing blueprint areas', () => {
    const analysis = analyzeCourseBlueprintCompleteness({
      ...DETAIL,
      overview_markdown: '',
      assignments: [],
      lesson_templates: [],
    })

    expect(analysis.missing).toContain('course overview')
    expect(analysis.missing).toContain('assignments')
    expect(analysis.missing).toContain('lesson templates')
    expect(analysis.suggestions.length).toBeGreaterThan(0)
  })
})
