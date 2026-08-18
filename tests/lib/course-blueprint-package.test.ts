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
  parseCourseBlueprintImportJson,
} from '@/lib/course-blueprint-package'
import {
  COURSE_BLUEPRINT_PACKAGE_MAX_BYTES,
  COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES,
} from '@/lib/contracts/course-blueprint-package'
import { portableCoursePackageTestDocumentSchema } from '@/lib/contracts/course-blueprint-portable-test-documents'
import type { CourseBlueprintDetail } from '@/types'

const testDir = dirname(fileURLToPath(import.meta.url))
const V2_BUNDLE = JSON.parse(
  readFileSync(resolve(testDir, '../fixtures/course-blueprint-package-v2.json'), 'utf8'),
)

function withTestDocument(
  bundle: ReturnType<typeof buildCourseBlueprintExportBundle>,
  lines: string[],
) {
  return {
    ...bundle,
    files: {
      ...bundle.files,
      'tests.md': bundle.files['tests.md'].replace(
        '## Documents\n_None_',
        ['## Documents', '### Document 1', ...lines].join('\n'),
      ),
    },
  }
}

const DETAIL: CourseBlueprintDetail = {
  id: '10000000-0000-4000-8000-000000000000',
  teacher_id: '20000000-0000-4000-8000-000000000000',
  content_revision: 7,
  title: 'Computer Science 11',
  subject: 'Computer Science',
  grade_level: 'Grade 11',
  course_code: 'ICS3U',
  term_template: 'Semester 1',
  overview_markdown: '# Overview\nCourse summary',
  outline_markdown: '# Outline\n- Unit 1',
  resources_markdown: '# Resources\n- IDE',
  gradebook_use_weights: true,
  gradebook_assignments_weight: 65,
  gradebook_tests_weight: 35,
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
      id: '30000000-0000-4000-8000-000000000000',
      artifact_id: '31000000-0000-4000-8000-000000000000',
      course_blueprint_id: '10000000-0000-4000-8000-000000000000',
      title: 'Kickoff reflection',
      instructions_markdown: 'Write a short reflection.',
      default_due_days: -2,
      default_due_time: '23:59',
      points_possible: 10.5,
      gradebook_weight: 15,
      include_in_final: true,
      is_draft: true,
      track_authenticity: true,
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  assessments: [
    {
      id: '40000000-0000-4000-8000-000000000000',
      artifact_id: '41000000-0000-4000-8000-000000000000',
      course_blueprint_id: '10000000-0000-4000-8000-000000000000',
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
      id: '50000000-0000-4000-8000-000000000000',
      artifact_id: '51000000-0000-4000-8000-000000000000',
      course_blueprint_id: '10000000-0000-4000-8000-000000000000',
      title: 'Course launch',
      content_markdown: 'Review expectations.',
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  materials: [
    {
      id: '60000000-0000-4000-8000-000000000000',
      artifact_id: '61000000-0000-4000-8000-000000000000',
      course_blueprint_id: '10000000-0000-4000-8000-000000000000',
      title: 'Reference sheet',
      content_markdown: 'Use this during the unit.',
      position: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  surveys: [
    {
      id: '70000000-0000-4000-8000-000000000000',
      artifact_id: '71000000-0000-4000-8000-000000000000',
      course_blueprint_id: '10000000-0000-4000-8000-000000000000',
      title: 'Unit reflection',
      show_results: false,
      dynamic_responses: true,
      questions_json: [{
        id: '72000000-0000-4000-8000-000000000000',
        question_type: 'short_text',
        question_text: 'What should we revisit?',
        options: [],
        response_max_chars: 800,
        position: 0,
      }],
      position: 2,
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
    expect(parsed.blueprint.planned_site_published).toBe(false)
    expect(parsed.blueprint.planned_site_config).not.toHaveProperty('quizzes')
    expect(parsed.blueprint).toEqual(expect.objectContaining({
      gradebook_use_weights: true,
      gradebook_assignments_weight: 65,
      gradebook_tests_weight: 35,
    }))
    expect(parsed.assignments).toHaveLength(1)
    expect(parsed.assignments[0]).toEqual(expect.objectContaining({
      artifact_id: '31000000-0000-4000-8000-000000000000',
      default_due_days: -2,
      points_possible: 10.5,
      gradebook_weight: 15,
      track_authenticity: true,
    }))
    expect(parsed.assessments).toHaveLength(1)
    expect(parsed.assessments[0].assessment_type).toBe('test')
    expect(parsed.assessments[0]).toEqual(expect.objectContaining({
      artifact_id: '41000000-0000-4000-8000-000000000000',
      points_possible: 50.5,
      gradebook_weight: 30,
      include_in_final: false,
    }))
    expect(parsed.lesson_templates).toHaveLength(1)
    expect(parsed.lesson_templates[0]?.artifact_id).toBe(
      '51000000-0000-4000-8000-000000000000'
    )
    expect(parsed.materials[0]).toEqual(expect.objectContaining({
      artifact_id: '61000000-0000-4000-8000-000000000000',
      position: 1,
    }))
    expect(parsed.surveys[0]).toEqual(expect.objectContaining({
      artifact_id: '71000000-0000-4000-8000-000000000000',
      position: 2,
      questions_json: [
        expect.objectContaining({
          id: '72000000-0000-4000-8000-000000000000',
        }),
      ],
    }))
  })

  it('omits classroom snapshot ownership from exported blueprint documents', () => {
    const detail = structuredClone(DETAIL)
    detail.assessments[0].documents = [{
      id: '60000000-0000-4000-8000-000000000000',
      title: 'Reference',
      source: 'link',
      url: 'https://docs.example.com/reference',
      snapshot_path: 'link-docs/teacher/test/doc-1/snapshots/current',
      snapshot_content_type: 'text/html',
      synced_at: '2026-07-23T12:00:00.000Z',
    }, {
      id: '61000000-0000-4000-8000-000000000000',
      title: 'Managed link',
      source: 'link',
      url: 'https://test.supabase.co/storage/v1/object/public/test-documents/reference.pdf',
      managed_object_id: '62000000-0000-4000-8000-000000000000',
    }, {
      id: '63000000-0000-4000-8000-000000000000',
      title: 'Managed upload',
      source: 'upload',
      url: 'https://test.supabase.co/storage/v1/object/public/test-documents/upload.pdf',
      managed_object_id: '64000000-0000-4000-8000-000000000000',
    }, {
      id: '65000000-0000-4000-8000-000000000000',
      title: 'Managed rendered image',
      source: 'link',
      url: 'https://test.supabase.co/storage/v1/render/image/public/submission-images/reference.png?width=500',
    }, {
      id: '66000000-0000-4000-8000-000000000000',
      title: 'Managed DNS-root alias',
      source: 'link',
      url: 'https://test.supabase.co./storage/v1/object/public/test-documents/reference.pdf',
    }]

    const bundle = buildCourseBlueprintExportBundle(detail)
    const parsed = parseCourseBlueprintImportBundle(bundle)

    expect(parsed.errors).toEqual([])
    expect(parsed.assessments[0].documents).toEqual([
      expect.objectContaining({
        title: 'Reference',
        source: 'link',
        url: 'https://docs.example.com/reference',
      }),
    ])
    expect(parsed.assessments[0].documents[0]).not.toHaveProperty('snapshot_path')
    expect(JSON.stringify(bundle)).not.toMatch(
      /managed_object_id|snapshot_path|snapshot_managed_object_id|snapshot_content_type|synced_at/,
    )
    expect(JSON.stringify(bundle)).not.toContain('/storage/v1/object/public/test-documents/')
  })

  it.each([
    {
      source: 'link',
      fields: ['URL: https://docs.example.com/reference'],
    },
    {
      source: 'text',
      fields: ['Content:', 'Portable reference text'],
    },
  ])('accepts portable $source Test documents', ({ source, fields }) => {
    const bundle = withTestDocument(buildCourseBlueprintExportBundle(DETAIL), [
      'ID: 60000000-0000-4000-8000-000000000000',
      `Source: ${source}`,
      'Title: Reference',
      ...fields,
    ])

    const parsed = parseCourseBlueprintImportBundle(bundle)

    expect(parsed.errors).toEqual([])
    expect(parsed.assessments[0].documents).toEqual([
      expect.objectContaining({ source, title: 'Reference' }),
    ])
  })

  it('rejects upload Test documents from the portable package model', () => {
    const bundle = withTestDocument(buildCourseBlueprintExportBundle(DETAIL), [
      'ID: 60000000-0000-4000-8000-000000000000',
      'Source: upload',
      'Title: Managed upload',
      'URL: https://files.example.com/reference.pdf',
    ])

    const parsed = parseCourseBlueprintImportBundle(bundle)

    expect(parsed.errors).toContainEqual(expect.stringContaining('Test 1: Document 1:'))
  })

  it.each([
    'managed_object_id',
    'snapshot_path',
    'snapshot_managed_object_id',
    'snapshot_content_type',
    'synced_at',
  ])('rejects runtime Test document field %s structurally', (field) => {
    expect(portableCoursePackageTestDocumentSchema.safeParse({
      id: '60000000-0000-4000-8000-000000000000',
      source: 'link',
      title: 'Reference',
      url: 'https://docs.example.com/reference',
      [field]: 'runtime-value',
    }).success).toBe(false)
    const bundle = withTestDocument(buildCourseBlueprintExportBundle(DETAIL), [
      'ID: 60000000-0000-4000-8000-000000000000',
      'Source: link',
      'Title: Reference',
      'URL: https://docs.example.com/reference',
      `${field}: runtime-value`,
    ])

    const parsed = parseCourseBlueprintImportBundle(bundle)

    expect(parsed.errors).toContainEqual(expect.stringContaining(`Invalid line "${field}: runtime-value"`))
    expect(parsed.errors).not.toContain('Course packages cannot contain Pika-managed storage references')
  })

  it.each([
    'https://test.supabase.co/storage/v1/object/public/test-documents/reference.pdf',
    'https://test.supabase.co/storage/v1/object/sign/assignment-artifacts/reference.pdf',
    'https://test.supabase.co/storage/v1/object/authenticated/submission-images/reference.png',
    'https://test.supabase.co/%73torage/v1/object/public/test-documents/reference.pdf',
    'https://test.supabase.co/%2Fstorage%2Fv1%2Fobject%2Fpublic%2Ftest-documents%2Freference.pdf',
    'https://test.supabase.co/%252Fstorage%252Fv1%252Fobject%252Fpublic%252Ftest-documents%252Freference.pdf',
    'https://test.supabase.co/storage/v1/render/image/public/submission-images/reference.png?width=500',
    'https://test.supabase.co/storage/v1/render/image/authenticated/test-documents/reference.png',
    'https://test.supabase.co./storage/v1/object/public/test-documents/reference.pdf',
    'https://test.supabase.co%2e/storage/v1/object/public/test-documents/reference.pdf',
  ])('rejects configured-origin managed URL %s', (url) => {
    const bundle = withTestDocument(buildCourseBlueprintExportBundle(DETAIL), [
      'ID: 60000000-0000-4000-8000-000000000000',
      'Source: link',
      'Title: Reference',
      `URL: ${url}`,
    ])

    const direct = parseCourseBlueprintImportBundle(bundle)
    const json = parseCourseBlueprintImportJson(JSON.stringify(bundle))
    const archive = parseCourseBlueprintImportArchive(encodeCourseBlueprintPackageArchive(bundle))

    expect(direct.errors).toContain('Course packages cannot contain Pika-managed storage references')
    expect(json.errors).toEqual(direct.errors)
    expect(archive.errors).toEqual(direct.errors)
  })

  it.each([
    'https://other.supabase.co/storage/v1/object/public/test-documents/reference.pdf',
    'https://test.supabase.co.evil.example/storage/v1/object/public/test-documents/reference.pdf',
    'https://test.supabase.co@evil.example/storage/v1/object/public/test-documents/reference.pdf',
    'https://docs.example.com/storage/v1/object/public/test-documents/reference.pdf',
    'http://test.supabase.co/storage/v1/object/public/test-documents/reference.pdf',
    'https://test.supabase.co:444/storage/v1/object/public/test-documents/reference.pdf',
  ])('allows external-origin URL lookalike %s', (url) => {
    const parsed = parseCourseBlueprintImportBundle(withTestDocument(
      buildCourseBlueprintExportBundle(DETAIL),
      [
        'ID: 60000000-0000-4000-8000-000000000000',
        'Source: link',
        'Title: Reference',
        `URL: ${url}`,
      ],
    ))

    expect(parsed.errors).toEqual([])
  })

  it.each([
    'https://test.supabase.co/storage%2Fv1%2Fobject%2Fpublic%2Ftest-documents%2Freference.pdf',
    '/%73torage%2Fv1%2Fobject%2Fpublic%2Ftest-documents%2Freference.pdf',
    '%2Fstorage%2Fv1%2Fobject%2Fpublic%2Ftest-documents%2Freference.pdf',
    '%252Fstorage%252Fv1%252Fobject%252Fpublic%252Ftest-documents%252Freference.pdf',
    '[Reference](%2Fstorage%2Fv1%2Fobject%2Fpublic%2Ftest-documents%2Freference.pdf)',
    'https://test.supabase.co/storage/v1/render/image/public/submission-images/reference.png?width=500',
    'https://test.supabase.co./storage/v1/object/public/test-documents/reference.pdf',
    'https://test.supabase.co%2e/storage/v1/object/public/test-documents/reference.pdf',
  ])('checks freeform Markdown managed URL %s as defense in depth', (managedUrl) => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    bundle.files['course-overview.md'] = [
      'External lookalike is allowed:',
      'https://other.supabase.co/storage/v1/object/public/test-documents/reference.pdf',
      'Configured storage is not:',
      managedUrl,
    ].join('\n')

    const direct = parseCourseBlueprintImportBundle(bundle)
    const json = parseCourseBlueprintImportJson(JSON.stringify(bundle))
    const archive = parseCourseBlueprintImportArchive(encodeCourseBlueprintPackageArchive(bundle))

    expect(direct.errors).toContain('Course packages cannot contain Pika-managed storage references')
    expect(json.errors).toEqual(direct.errors)
    expect(archive.errors).toEqual(direct.errors)
  })

  it('does not treat managed field names in freeform content as runtime state', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    bundle.files['course-overview.md'] = 'Explain what managed_object_id means in this API.'

    expect(parseCourseBlueprintImportBundle(bundle).errors).toEqual([])
  })

  it('exports and re-imports the tar package archive', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const archive = encodeCourseBlueprintPackageArchive(bundle)
    const decoded = decodeCourseBlueprintPackageArchive(archive)
    const parsed = parseCourseBlueprintImportArchive(archive)

    expect(decoded).not.toBeNull()
    expect(decoded?.manifest.title).toBe('Computer Science 11')
    expect(decoded?.manifest.version).toBe('5')
    expect(decoded?.manifest).toEqual(expect.objectContaining({
      blueprint_id: '10000000-0000-4000-8000-000000000000',
      source_draft_revision: 7,
    }))
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
    expect(parsed.assessments).toHaveLength(1)
    expect(parsed.assessments[0].title).toBe('Legacy Foundations Test')
    expect(parsed.assignments.every((assignment) =>
      /^[0-9a-f-]{36}$/.test(assignment.artifact_id ?? '')
    )).toBe(true)
  })

  it('decodes a version 2 archive while discarding retired Quiz content', () => {
    const archive = encodeCourseBlueprintPackageArchive(V2_BUNDLE)
    const decoded = decodeCourseBlueprintPackageArchive(archive)
    const parsed = parseCourseBlueprintImportArchive(archive)

    expect(decoded?.manifest.version).toBe('2')
    // Decoding preserves raw v2 evidence; adaptation is where retired Quiz
    // content is discarded.
    expect(decoded?.files).toHaveProperty('quizzes.md')
    expect(parsed.errors).toEqual([])
    expect(parsed.blueprint.title).toBe('Legacy Computer Science')
    expect(parsed.assessments).toHaveLength(1)
    expect(parsed.assessments[0].title).toBe('Legacy Foundations Test')
  })

  it.each(['1', '6'])('rejects unsupported package version %s', (version) => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      manifest: { ...bundle.manifest, version },
    })

    expect(parsed.errors).toEqual(['Unsupported course package version'])
  })

  it.each(['quizzes.md', 'notes.md'])('rejects undeclared version 5 file %s', (fileName) => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      files: { ...bundle.files, [fileName]: 'Unexpected content' },
    })

    expect(parsed.errors).toEqual([
      `Course package contains forbidden file "${fileName}"`,
    ])
  })

  it.each(['quizzes.md', 'notes.md'])('rejects undeclared version 4 file %s', (fileName) => {
    const current = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      manifest: {
        version: '4',
        exported_at: current.manifest.exported_at,
        title: current.manifest.title,
        subject: current.manifest.subject,
        grade_level: current.manifest.grade_level,
        course_code: current.manifest.course_code,
        term_template: current.manifest.term_template,
        planned_site_slug: current.manifest.planned_site_slug,
        planned_site_published: current.manifest.planned_site_published,
        planned_site_config: current.manifest.planned_site_config,
      },
      files: {
        'course-overview.md': current.files['course-overview.md'],
        'course-outline.md': current.files['course-outline.md'],
        'resources.md': current.files['resources.md'],
        'assignments.md': current.files['assignments.md'],
        'tests.md': current.files['tests.md'],
        'lesson-plans.md': current.files['lesson-plans.md'],
        [fileName]: 'Unexpected content',
      },
    })

    expect(parsed.errors).toEqual([
      `Course package contains forbidden file "${fileName}"`,
    ])
  })

  it('rejects a version 4 archive containing retired Quiz content', () => {
    const archive = encodeCourseBlueprintPackageArchive({
      ...structuredClone(V2_BUNDLE),
      manifest: {
        ...structuredClone(V2_BUNDLE.manifest),
        planned_site_config: undefined,
      },
    })
    const versionMarker = new TextEncoder().encode('"version": "2"')
    const markerOffset = archive.findIndex((byte, index) =>
      versionMarker.every((markerByte, markerIndex) => archive[index + markerIndex] === markerByte)
    )
    expect(markerOffset).toBeGreaterThanOrEqual(0)
    archive[markerOffset + versionMarker.length - 2] = '4'.charCodeAt(0)

    expect(decodeCourseBlueprintPackageArchive(archive)).toBeNull()
    expect(parseCourseBlueprintImportArchive(archive).errors).toEqual([
      'Course package contains forbidden file "quizzes.md"',
    ])
  })

  it('rejects an archive with an unsupported manifest version', () => {
    const archive = encodeCourseBlueprintPackageArchive(buildCourseBlueprintExportBundle(DETAIL))
    const versionMarker = new TextEncoder().encode('"version": "5"')
    const markerOffset = archive.findIndex((byte, index) =>
      versionMarker.every((markerByte, markerIndex) => archive[index + markerIndex] === markerByte)
    )
    expect(markerOffset).toBeGreaterThanOrEqual(0)
    archive[markerOffset + versionMarker.length - 2] = '6'.charCodeAt(0)

    expect(decodeCourseBlueprintPackageArchive(archive)).toBeNull()
    expect(parseCourseBlueprintImportArchive(archive).errors).toEqual([
      'Unsupported course package version',
    ])
  })

  it('rejects a version 5 package when a reusable artifact id is missing', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      files: {
        ...bundle.files,
        'assignments.md': bundle.files['assignments.md'].replace(
          /^Artifact ID:.*\n/m,
          ''
        ),
      },
    })

    expect(parsed.errors).toContain(
      'Assignment "Kickoff reflection" is missing Artifact ID'
    )
  })

  it('rejects a version 5 package when a test question id is missing', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      files: {
        ...bundle.files,
        'tests.md': bundle.files['tests.md'].replace(/^ID:.*\n/m, ''),
      },
    })

    expect(parsed.errors).toContain('Test 1: Question 1: ID is required')
  })

  it('rejects duplicate artifact ids across a version 5 package', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle({
      ...bundle,
      files: {
        ...bundle.files,
        'lesson-plans.md': bundle.files['lesson-plans.md'].replace(
          '51000000-0000-4000-8000-000000000000',
          '31000000-0000-4000-8000-000000000000'
        ),
      },
    })

    expect(parsed.errors).toContain(
      'Lesson 1 duplicates Artifact ID "31000000-0000-4000-8000-000000000000"'
    )
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
    expect(oversizedBundle.errors).toEqual([
      'Course package file "course-overview.md" exceeds the 2 MiB limit',
    ])

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

    expect(parsed.errors).toEqual(['Invalid course package manifest'])
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
