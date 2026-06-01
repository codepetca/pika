import { describe, expect, it } from 'vitest'
import {
  buildPikaAssignmentGradexRunPayload,
  GRADEX_PIKA_ADAPTER_VERSION,
  GRADEX_PIKA_ASSIGNMENT_PROFILE,
  GRADEX_PIKA_PROMPT_VERSION,
} from '@/lib/server/gradex-assignment-payload'
import type { Assignment, AssignmentSubmissionArtifact } from '@/types'

const assignment: Assignment = {
  id: 'assignment-db-123',
  classroom_id: 'classroom-db-123',
  title: 'Portfolio Reflection for Jane Student',
  description: 'Fallback description',
  instructions_markdown: 'Write a reflection about the portfolio. Contact teacher@example.com if stuck.',
  rich_instructions: null,
  due_at: '2026-05-15T19:00:00.000Z',
  position: 0,
  is_draft: false,
  released_at: '2026-05-01T12:00:00.000Z',
  track_authenticity: true,
  created_by: 'teacher-db-123',
  created_at: '2026-05-01T12:00:00.000Z',
  updated_at: '2026-05-02T12:00:00.000Z',
}

function artifact(overrides: Partial<AssignmentSubmissionArtifact>): AssignmentSubmissionArtifact {
  return {
    id: 'artifact-db-123',
    assignment_doc_id: 'assignment-doc-db-456',
    requirement_id: 'requirement-db-123',
    student_id: 'student-db-789',
    type: 'repo_link',
    url: 'https://github.com/jane-student/portfolio',
    storage_path: null,
    metadata_json: {
      repo_owner: 'jane-student',
      repo_name: 'portfolio',
      normalized_url: 'https://github.com/jane-student/portfolio',
      github_login: 'jane-student',
    },
    validation_status: 'valid',
    validation_message: null,
    validated_at: '2026-05-04T21:00:00.000Z',
    created_at: '2026-05-04T20:00:00.000Z',
    updated_at: '2026-05-04T21:00:00.000Z',
    ...overrides,
  }
}

describe('buildPikaAssignmentGradexRunPayload', () => {
  it('builds the Pika adapter request, async Gradex run request, and local mapping', () => {
    const result = buildPikaAssignmentGradexRunPayload({
      assignment,
      assignmentDocs: [
        {
          id: 'assignment-doc-db-456',
          assignment_id: 'assignment-db-123',
          student_id: 'student-db-789',
          submitted_at: '2026-05-04T20:00:00.000Z',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'I completed the portfolio and wrote about my design decisions. My email is student@example.com.',
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'The repository is at https://github.com/jane-student/portfolio.',
                  },
                ],
              },
            ],
          },
          authenticity_score: 83,
          authenticity_flags: [
            {
              timestamp: '2026-05-03T12:00:00.000Z',
              wordDelta: 30,
              seconds: 5,
              wps: 6,
              reason: 'high_wps',
            },
            {
              timestamp: '2026-05-03T12:10:00.000Z',
              wordDelta: 12,
              seconds: 2,
              wps: 6,
              reason: 'paste',
            },
          ],
          student_name: 'Jane Student',
          student_email: 'student@example.com',
          roster_id: 'roster-db-123',
        },
      ],
      submissionArtifacts: [artifact({})],
      pseudonymSalt: 'stable-test-salt',
      requestTimeoutMs: 12_000,
    })

    expect(result.pikaAdapterRequest.adapter_version).toBe(GRADEX_PIKA_ADAPTER_VERSION)
    expect(result.pikaAdapterRequest.assignment).toEqual({
      pika_assignment_ref: expect.stringMatching(/^pika-assignment-(?=.*[a-z])(?=.*\d)[a-z0-9]{32}$/),
      title: 'Portfolio Reflection for [identity redacted]',
      instructions: 'Write a reflection about the portfolio. Contact [email redacted] if stuck.',
    })
    expect(result.pikaAdapterRequest.submissions).toHaveLength(1)
    expect(result.pikaAdapterRequest.submissions[0]).toEqual({
      pika_grade_record_ref: expect.stringMatching(/^pika-grade-(?=.*[a-z])(?=.*\d)[a-z0-9]{32}$/),
      pika_submission_ref: expect.stringMatching(/^pika-submission-(?=.*[a-z])(?=.*\d)[a-z0-9]{32}$/),
      pika_student_ref: expect.stringMatching(/^pika-student-(?=.*[a-z])(?=.*\d)[a-z0-9]{32}$/),
      content: expect.stringContaining('I completed the portfolio'),
      submitted_at: '2026-05-04T20:00:00.000Z',
      workflow_summary: {
        authenticity_score: 83,
        evidence_confidence: 0.75,
        paste_event_count: 1,
        high_wps_flag_count: 1,
        summary: 'Pika authenticity score: 83/100. Sanitized workflow flags: 1 paste event, 1 high writing-speed flag.',
      },
    })

    expect(result.pikaAdapterRequest.submissions[0].content).toContain('[email redacted]')
    expect(result.pikaAdapterRequest.submissions[0].content).toContain('[link redacted]')
    expect(result.pikaAdapterRequest.submissions[0].content).toContain('Attached Artifacts:')
    expect(result.pikaAdapterRequest.submissions[0].content).toContain('- Repository artifact submitted')

    expect(result.gradexRequest.assignment).toEqual({
      external_assignment_id: result.pikaAdapterRequest.assignment.pika_assignment_ref,
      title: result.pikaAdapterRequest.assignment.title,
      instructions: result.pikaAdapterRequest.assignment.instructions,
      type: 'essay',
      metadata: {
        adapter_version: GRADEX_PIKA_ADAPTER_VERSION,
        client: 'pika',
      },
    })
    expect(result.gradexRequest.rubric.criteria.map((criterion) => criterion.id)).toEqual([
      'completion',
      'thinking',
      'workflow',
    ])
    expect(result.gradexRequest.settings).toEqual({
      grading_profile: GRADEX_PIKA_ASSIGNMENT_PROFILE,
      model_profile: 'calibration',
      provider: 'auto',
      tier: 'auto',
      prompt_version: GRADEX_PIKA_PROMPT_VERSION,
      feedback_style: 'balanced',
      confidence_threshold: 0.65,
      request_timeout_ms: 12_000,
    })
    expect(result.gradexRequest.settings).not.toHaveProperty('model')
    expect(result.gradexRequest.submissions).toEqual([
      {
        external_submission_id: result.pikaAdapterRequest.submissions[0].pika_submission_ref,
        external_student_id: result.pikaAdapterRequest.submissions[0].pika_student_ref,
        content_type: 'text',
        content: result.pikaAdapterRequest.submissions[0].content,
        submitted_at: '2026-05-04T20:00:00.000Z',
      },
    ])
    expect(result.gradexRequest.workflow_evidence_by_submission_id).toEqual({
      [result.pikaAdapterRequest.submissions[0].pika_submission_ref]:
        result.pikaAdapterRequest.submissions[0].workflow_summary,
    })
    expect(result.mappings).toEqual([
      {
        assignment_doc_id: 'assignment-doc-db-456',
        student_id: 'student-db-789',
        pika_grade_record_ref: result.pikaAdapterRequest.submissions[0].pika_grade_record_ref,
        pika_submission_ref: result.pikaAdapterRequest.submissions[0].pika_submission_ref,
        pika_student_ref: result.pikaAdapterRequest.submissions[0].pika_student_ref,
        gradex_submission_id: result.pikaAdapterRequest.submissions[0].pika_submission_ref,
        gradex_student_id: result.pikaAdapterRequest.submissions[0].pika_student_ref,
      },
    ])
  })

  it('does not include raw Pika IDs, identity fields, history fields, repo identities, or raw URLs', () => {
    const result = buildPikaAssignmentGradexRunPayload({
      assignment,
      assignmentDocs: [
        {
          id: 'assignment-doc-db-456',
          assignment_id: 'assignment-db-123',
          student_id: 'student-db-789',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Submitted site: https://student.example.com/portfolio by Jane Student.',
                  },
                ],
              },
            ],
          },
          authenticity_score: null,
          authenticity_flags: null,
          student_name: 'Jane Student',
          email: 'student@example.com',
          roster_id: 'roster-db-123',
          assignment_doc_history: [{ id: 'history-db-123' }],
          keystrokes: 42,
          patch: [{ op: 'replace', path: '/content', value: [] }],
          snapshot: { type: 'doc', content: [] },
        },
      ],
      submissionArtifacts: [
        artifact({
          id: 'artifact-db-999',
          url: 'https://github.com/jane-student/portfolio',
        }),
      ],
      pseudonymSalt: 'stable-test-salt',
    })

    const serialized = JSON.stringify(result.gradexRequest)

    expect(serialized).not.toContain('assignment-db-123')
    expect(serialized).not.toContain('classroom-db-123')
    expect(serialized).not.toContain('teacher-db-123')
    expect(serialized).not.toContain('assignment-doc-db-456')
    expect(serialized).not.toContain('student-db-789')
    expect(serialized).not.toContain('Jane Student')
    expect(serialized).not.toContain('student@example.com')
    expect(serialized).not.toContain('roster-db-123')
    expect(serialized).not.toContain('assignment_doc_history')
    expect(serialized).not.toContain('history-db-123')
    expect(serialized).not.toContain('keystroke')
    expect(serialized).not.toContain('patch')
    expect(serialized).not.toContain('snapshot')
    expect(serialized).not.toContain('https://student.example.com/portfolio')
    expect(serialized).not.toContain('github.com')
    expect(serialized).not.toContain('jane-student')
    expect(serialized).not.toContain('artifact-db-999')
  })

  it('uses stable salted pseudonymous refs and changes them when the salt changes', () => {
    const baseOptions = {
      assignment,
      assignmentDocs: [
        {
          id: 'assignment-doc-db-456',
          assignment_id: 'assignment-db-123',
          student_id: 'student-db-789',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Final submission' }],
              },
            ],
          },
          authenticity_score: null,
        },
      ],
    }

    const first = buildPikaAssignmentGradexRunPayload({
      ...baseOptions,
      pseudonymSalt: 'stable-test-salt',
    })
    const second = buildPikaAssignmentGradexRunPayload({
      ...baseOptions,
      pseudonymSalt: 'stable-test-salt',
    })
    const changedSalt = buildPikaAssignmentGradexRunPayload({
      ...baseOptions,
      pseudonymSalt: 'different-test-salt',
    })

    expect(second.pikaAdapterRequest.assignment.pika_assignment_ref)
      .toBe(first.pikaAdapterRequest.assignment.pika_assignment_ref)
    expect(second.pikaAdapterRequest.submissions[0].pika_submission_ref)
      .toBe(first.pikaAdapterRequest.submissions[0].pika_submission_ref)
    expect(second.pikaAdapterRequest.submissions[0].pika_student_ref)
      .toBe(first.pikaAdapterRequest.submissions[0].pika_student_ref)
    expect(changedSalt.pikaAdapterRequest.submissions[0].pika_student_ref)
      .not.toBe(first.pikaAdapterRequest.submissions[0].pika_student_ref)
  })

  it('requires at least one assignment doc and a pseudonym salt', () => {
    expect(() =>
      buildPikaAssignmentGradexRunPayload({
        assignment,
        assignmentDocs: [],
        pseudonymSalt: 'stable-test-salt',
      }),
    ).toThrow('At least one assignment doc is required')

    expect(() =>
      buildPikaAssignmentGradexRunPayload({
        assignment,
        assignmentDocs: [
          {
            id: 'assignment-doc-db-456',
            student_id: 'student-db-789',
            content: { type: 'doc', content: [] },
          },
        ],
      }),
    ).toThrow('GRADEX_PIKA_PSEUDONYM_SALT is not configured')
  })
})
