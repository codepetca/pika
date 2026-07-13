import { gzipSync, gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_RELATIONAL_RESOURCES, GRADEX_RESOURCE_TABLES } from '@/lib/contracts/classroom-data'
import {
  buildClassroomArchiveBundle,
  canonicalJsonStringify,
  contentChecksum,
  encodeTar,
  parseTar,
  sha256Bytes,
} from '@/lib/server/classroom-archive-format'
import {
  buildGradexExtractFromClassroomArchive,
  verifyGradexExtractBundle,
} from '@/lib/server/classroom-gradex-extract'

const TEACHER_ID = '10000000-0000-4000-8000-000000000001'
const STUDENT_ID = '20000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '30000000-0000-4000-8000-000000000001'
const ASSIGNMENT_ID = '40000000-0000-4000-8000-000000000001'
const ASSIGNMENT_DOC_ID = '50000000-0000-4000-8000-000000000001'
const TEST_ID = '60000000-0000-4000-8000-000000000001'
const QUESTION_ID = '70000000-0000-4000-8000-000000000001'
const RESPONSE_ID = '80000000-0000-4000-8000-000000000001'
const EXTRACT_ID = '90000000-0000-4000-8000-000000000001'
const GENERATED_AT = '2026-07-13T12:00:00.000Z'
const DELETE_AFTER = '2026-10-11T12:00:00.000Z'
const HMAC_SECRET = 'test-only-gradex-hmac-secret-with-more-than-32-bytes'

function sourceArchive() {
  const resources = Object.fromEntries(
    CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [resource.table, [] as unknown[]]),
  )
  resources.assignments = [{
    id: ASSIGNMENT_ID,
    classroom_id: CLASSROOM_ID,
    title: 'Private reflection',
    description: 'Contact alex.student@example.test or https://private.example.test',
    instructions_markdown: 'Explain your reasoning.',
    rich_instructions: null,
    due_at: '2026-07-10T12:00:00.000Z',
    position: 0,
    is_draft: false,
    released_at: '2026-07-01T12:00:00.000Z',
    track_authenticity: true,
    points_possible: 30,
    include_in_final: true,
    gradebook_weight: 1,
    created_by: TEACHER_ID,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-07-01T12:00:00.000Z',
  }]
  resources.assignment_docs = [{
    id: ASSIGNMENT_DOC_ID,
    assignment_id: ASSIGNMENT_ID,
    student_id: STUDENT_ID,
    content: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { url: 'https://student.example.test/private' },
        content: [{
          type: 'text',
          text: `Alex Student wrote this. ${STUDENT_ID} @alex_student`,
        }],
      }],
    },
    is_submitted: true,
    submitted_at: '2026-07-09T12:00:00.000Z',
    viewed_at: null,
    score_completion: 8,
    score_thinking: 7,
    score_workflow: 9,
    feedback: 'Good work, Alex Student.',
    teacher_feedback_draft: null,
    teacher_feedback_draft_updated_at: null,
    feedback_returned_at: '2026-07-11T12:00:00.000Z',
    ai_feedback_suggestion: 'Ask Alex Student for one more example.',
    ai_feedback_suggested_at: '2026-07-10T12:00:00.000Z',
    ai_feedback_model: 'gpt-test',
    teacher_cleared_at: null,
    graded_at: '2026-07-10T12:00:00.000Z',
    graded_by: TEACHER_ID,
    returned_at: '2026-07-11T12:00:00.000Z',
    authenticity_score: 0.9,
    created_at: '2026-07-02T12:00:00.000Z',
    updated_at: '2026-07-11T12:00:00.000Z',
  }]
  resources.tests = [{
    id: TEST_ID,
    classroom_id: CLASSROOM_ID,
    title: 'Reasoning check',
    assessment_type: 'test',
    status: 'closed',
    opens_at: '2026-07-01T12:00:00.000Z',
    show_results: true,
    documents: [{
      id: 'document-1',
      title: 'Reference',
      source: 'link',
      url: 'https://private.example.test/reference',
      snapshot_path: 'teacher/private.html',
      content: 'Reference for alex.student@example.test',
    }],
    position: 0,
    points_possible: 10,
    include_in_final: true,
    gradebook_weight: 1,
    created_by: TEACHER_ID,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-07-01T12:00:00.000Z',
  }]
  resources.test_questions = [{
    id: QUESTION_ID,
    test_id: TEST_ID,
    question_type: 'open_response',
    question_text: 'Explain the result.',
    options: [],
    correct_option: null,
    answer_key: 'A complete explanation.',
    sample_solution: 'One possible explanation.',
    points: 10,
    response_max_chars: 5000,
    response_monospace: false,
    position: 0,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-02T12:00:00.000Z',
  }]
  resources.test_responses = [{
    id: RESPONSE_ID,
    test_id: TEST_ID,
    question_id: QUESTION_ID,
    student_id: STUDENT_ID,
    selected_option: null,
    response_text: 'My email is alex.student@example.test and my name is Alex Student.',
    score: 8,
    feedback: 'Clear explanation.',
    graded_at: '2026-07-10T12:00:00.000Z',
    graded_by: TEACHER_ID,
    ai_grading_basis: 'teacher_key',
    ai_reference_answers: ['A complete explanation.'],
    ai_model: 'gpt-test',
    submitted_at: '2026-07-09T12:00:00.000Z',
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-10T12:00:00.000Z',
  }]

  return buildClassroomArchiveBundle({
    archiveId: 'a0000000-0000-4000-8000-000000000001',
    classroomId: CLASSROOM_ID,
    teacherId: TEACHER_ID,
    createdAt: GENERATED_AT,
    source: {
      schemaMigration: '082_verified_classroom_archive_exports',
      appCommit: 'deadbee',
    },
    retention: { mode: 'teacher_managed', delete_after: null },
    resources,
    actors: [
      {
        id: TEACHER_ID,
        email: 'teacher@example.test',
        role: 'teacher',
        profile: null,
      },
      {
        id: STUDENT_ID,
        email: 'alex.student@example.test',
        role: 'student',
        profile: {
          id: 'b0000000-0000-4000-8000-000000000001',
          user_id: STUDENT_ID,
          student_number: '123456789',
          first_name: 'Alex',
          last_name: 'Student',
          created_at: '2026-01-01T12:00:00.000Z',
        },
      },
    ],
    storageObjects: [],
  }).archive
}

function buildExtract(extractId = EXTRACT_ID) {
  return buildGradexExtractFromClassroomArchive({
    archive: sourceArchive(),
    extractId,
    generatedAt: GENERATED_AT,
    deleteAfter: DELETE_AFTER,
    hmacSecret: HMAC_SECRET,
  })
}

function rewriteExtractResource(
  extract: Uint8Array,
  table: string,
  mutate: (row: Record<string, unknown>) => void,
): Uint8Array {
  const files = parseTar(gunzipSync(extract))
  const manifest = JSON.parse(files.get('manifest.json')?.toString('utf8') || '{}')
  const descriptor = manifest.resources.find((resource: { table: string }) => resource.table === table)
  const resourceBytes = files.get(descriptor.path) as Buffer
  const rows = resourceBytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line))
  mutate(rows[0])
  const nextBytes = Buffer.from(`${rows.map(canonicalJsonStringify).join('\n')}\n`, 'utf8')
  descriptor.byte_size = nextBytes.byteLength
  descriptor.sha256 = sha256Bytes(nextBytes)
  manifest.content_sha256 = contentChecksum(manifest.resources)
  files.set(descriptor.path, nextBytes)
  files.set('manifest.json', Buffer.from(`${canonicalJsonStringify(manifest)}\n`, 'utf8'))
  return gzipSync(encodeTar([...files.entries()].map(([path, bytes]) => ({ path, bytes }))))
}

describe('classroom Gradex extract', () => {
  it('creates a strict deidentified artifact while preserving grading relationships', () => {
    const built = buildExtract()
    const verified = verifyGradexExtractBundle(built.extract)
    expect(verified.ok).toBe(true)
    if (!verified.ok) throw new Error(verified.error)

    expect(verified.manifest.resources.map((resource) => resource.table).sort())
      .toEqual(GRADEX_RESOURCE_TABLES)
    expect(verified.manifest).toEqual(expect.objectContaining({
      direct_identifiers_removed: true,
      direct_identifier_findings: 0,
      storage_objects_included: false,
      timestamp_offsets_from: 'source-archive-created-at',
    }))

    const assignment = verified.resources.assignments[0]
    const doc = verified.resources.assignment_docs[0]
    const test = verified.resources.tests[0]
    const question = verified.resources.test_questions[0]
    const response = verified.resources.test_responses[0]
    expect(doc.assignment_ref).toBe(assignment.row_ref)
    expect(response.test_ref).toBe(test.row_ref)
    expect(response.question_ref).toBe(question.row_ref)
    expect(response.actor_ref).toBe(doc.actor_ref)
    expect(doc.graded_offset_ms).toBe(-3 * 24 * 60 * 60 * 1000)

    const serialized = JSON.stringify(verified.resources)
    for (const forbidden of [
      TEACHER_ID,
      STUDENT_ID,
      CLASSROOM_ID,
      ASSIGNMENT_ID,
      'alex.student@example.test',
      'Alex Student',
      'https://',
      'student_id',
      'teacher_id',
      'created_by',
      'graded_by',
      'snapshot_path',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(serialized).toContain('[redacted-identity]')
    expect(serialized).toContain('[email redacted]')
  })

  it('is deterministic for one extract and unlinkable across extract ids', () => {
    const first = buildExtract()
    const replay = buildExtract()
    const next = buildExtract('90000000-0000-4000-8000-000000000002')
    expect(Buffer.from(replay.extract)).toEqual(Buffer.from(first.extract))

    const firstVerified = verifyGradexExtractBundle(first.extract)
    const nextVerified = verifyGradexExtractBundle(next.extract)
    expect(firstVerified.ok).toBe(true)
    expect(nextVerified.ok).toBe(true)
    if (!firstVerified.ok || !nextVerified.ok) return
    expect(firstVerified.manifest.classroom_ref).not.toBe(nextVerified.manifest.classroom_ref)
    expect(firstVerified.resources.assignment_docs[0].actor_ref)
      .not.toBe(nextVerified.resources.assignment_docs[0].actor_ref)
  })

  it('fails closed for invalid source, retention, and HMAC inputs', () => {
    expect(() => buildGradexExtractFromClassroomArchive({
      archive: Buffer.from('not-an-archive'),
      extractId: EXTRACT_ID,
      generatedAt: GENERATED_AT,
      deleteAfter: DELETE_AFTER,
      hmacSecret: HMAC_SECRET,
    })).toThrow('Gradex source archive is invalid')
    expect(() => buildGradexExtractFromClassroomArchive({
      archive: sourceArchive(),
      extractId: EXTRACT_ID,
      generatedAt: GENERATED_AT,
      deleteAfter: '2026-07-12T12:00:00.000Z',
      hmacSecret: HMAC_SECRET,
    })).toThrow('deletion must be after generation')
    expect(() => buildGradexExtractFromClassroomArchive({
      archive: sourceArchive(),
      extractId: EXTRACT_ID,
      generatedAt: GENERATED_AT,
      deleteAfter: DELETE_AFTER,
      hmacSecret: 'too-short',
    })).toThrow('at least 32 bytes')
  })

  it('rejects checksum-consistent bundles with identifiers or broken pseudonymous relationships', () => {
    const built = buildExtract()
    const withEmail = rewriteExtractResource(
      built.extract,
      'test_responses',
      (row) => { row.response_text = 'student@example.test' },
    )
    expect(verifyGradexExtractBundle(withEmail)).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('privacy scan failed'),
    }))

    const withDanglingQuestion = rewriteExtractResource(
      built.extract,
      'test_responses',
      (row) => { row.question_ref = 'f'.repeat(64) },
    )
    expect(verifyGradexExtractBundle(withDanglingQuestion)).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('relationship is unresolved'),
    }))
  })
})
