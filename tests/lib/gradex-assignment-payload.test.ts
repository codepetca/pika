import { describe, expect, it } from 'vitest'
import {
  buildPikaAssignmentGradexPayload,
  GRADEX_PIKA_ASSIGNMENT_PROFILE,
} from '@/lib/server/gradex-assignment-payload'
import type { Assignment } from '@/types'

const assignment: Assignment = {
  id: 'assignment-db-123',
  classroom_id: 'classroom-db-123',
  title: 'Portfolio Reflection',
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

describe('buildPikaAssignmentGradexPayload', () => {
  it('maps assignment, rubric, submission, settings, and workflow evidence to the Gradex Pika profile', () => {
    const payload = buildPikaAssignmentGradexPayload({
      assignment,
      assignmentDoc: {
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
        patch: [{ op: 'replace', path: '/content', value: [] }],
        snapshot: { type: 'doc', content: [] },
      } as any,
      pseudonymSalt: 'stable-test-salt',
      requestTimeoutMs: 12_000,
    })

    expect(payload.assignment).toEqual({
      external_assignment_id: expect.stringMatching(/^pika-assignment-[a-f0-9]{32}$/),
      title: 'Portfolio Reflection',
      instructions: 'Write a reflection about the portfolio. Contact [email redacted] if stuck.',
      type: 'essay',
    })
    expect(payload.rubric.criteria.map((criterion) => criterion.id)).toEqual([
      'completion',
      'thinking',
      'workflow',
    ])
    expect(payload.rubric.criteria).toEqual([
      expect.objectContaining({ id: 'completion', scale: { min: 0, max: 10 } }),
      expect.objectContaining({ id: 'thinking', scale: { min: 0, max: 10 } }),
      expect.objectContaining({ id: 'workflow', scale: { min: 0, max: 10 } }),
    ])
    expect(payload.settings).toEqual({
      grading_profile: GRADEX_PIKA_ASSIGNMENT_PROFILE,
      model_profile: 'default',
      feedback_style: 'balanced',
      confidence_threshold: 0.65,
      request_timeout_ms: 12_000,
    })
    expect(payload.submission).toEqual({
      external_submission_id: expect.stringMatching(/^pika-submission-[a-f0-9]{32}$/),
      external_student_id: expect.stringMatching(/^pika-student-[a-f0-9]{32}$/),
      content_type: 'text',
      content: expect.stringContaining('I completed the portfolio'),
      submitted_at: '2026-05-04T20:00:00.000Z',
    })
    expect(payload.submission.content).toContain('[email redacted]')
    expect(payload.submission.content).toContain('[link redacted]')
    expect(payload.submission.content).toContain('Attached Artifacts:')
    expect(payload.submission.content).toContain('- Repository artifact submitted')
    expect(payload.workflow_evidence).toEqual({
      authenticity_score: 83,
      evidence_confidence: 0.75,
      paste_event_count: 1,
      high_wps_flag_count: 1,
      summary: 'Pika authenticity score: 83/100. Sanitized workflow flags: 1 paste event, 1 high writing-speed flag.',
      flags: [
        { reason: 'paste', count: 1, summary: '1 paste event detected in sanitized workflow evidence.' },
        { reason: 'high_wps', count: 1, summary: '1 high writing-speed flag detected in sanitized workflow evidence.' },
      ],
    })
  })

  it('does not include raw Pika IDs, identity fields, raw history, patches, snapshots, or exact artifact URLs', () => {
    const payload = buildPikaAssignmentGradexPayload({
      assignment,
      assignmentDoc: {
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
                  text: 'Submitted site: https://student.example.com/portfolio',
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
      } as any,
      pseudonymSalt: 'stable-test-salt',
    })

    const serialized = JSON.stringify(payload)

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
  })

  it('uses stable salted pseudonymous IDs and changes them when the salt changes', () => {
    const first = buildPikaAssignmentGradexPayload({
      assignment,
      assignmentDoc: {
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
      pseudonymSalt: 'stable-test-salt',
    })
    const second = buildPikaAssignmentGradexPayload({
      assignment,
      assignmentDoc: {
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
      pseudonymSalt: 'stable-test-salt',
    })
    const changedSalt = buildPikaAssignmentGradexPayload({
      assignment,
      assignmentDoc: {
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
      pseudonymSalt: 'different-test-salt',
    })

    expect(second.assignment.external_assignment_id).toBe(first.assignment.external_assignment_id)
    expect(second.submission.external_submission_id).toBe(first.submission.external_submission_id)
    expect(second.submission.external_student_id).toBe(first.submission.external_student_id)
    expect(changedSalt.submission.external_student_id).not.toBe(first.submission.external_student_id)
  })
})
