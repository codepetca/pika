import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ensureSeedTimestampAfter,
  splitAssignmentHistoryAtSubmission,
} from '../../scripts/lib/assignment-history-seed'

const seedSource = readFileSync(resolve(process.cwd(), 'scripts/seed.ts'), 'utf8')

const baseline = {
  assignment_doc_id: 'doc-1',
  trigger: 'baseline',
  created_at: '2026-07-16T12:00:00.000Z',
  snapshot: { type: 'doc', content: [] },
}

const submit = {
  assignment_doc_id: 'doc-1',
  trigger: 'submit',
  created_at: '2026-07-17T12:00:00.000Z',
  snapshot: { type: 'doc', content: [] },
}

describe('splitAssignmentHistoryAtSubmission', () => {
  it('separates the final submit transition from editable history', () => {
    expect(splitAssignmentHistoryAtSubmission([baseline, submit])).toEqual({
      historyEntries: [baseline],
      submission: {
        assignmentDocId: 'doc-1',
        submittedAt: '2026-07-17T12:00:00.000Z',
      },
    })
  })

  it('keeps an in-progress document history unchanged', () => {
    expect(splitAssignmentHistoryAtSubmission([baseline])).toEqual({
      historyEntries: [baseline],
      submission: null,
    })
  })

  it('rejects history after the submit transition', () => {
    expect(() => splitAssignmentHistoryAtSubmission([submit, baseline])).toThrow(
      'Seed assignment submit history must be the final entry',
    )
  })

  it('requires the submit transition to carry a snapshot', () => {
    expect(() => splitAssignmentHistoryAtSubmission([{ ...submit, snapshot: null }])).toThrow(
      'Seed assignment submit history requires a snapshot',
    )
  })

  it('seeds editable documents and history before finalizing submissions', () => {
    const documentsStart = seedSource.indexOf('const assignmentDocs = [')
    const documentsInsert = seedSource.indexOf(".from('assignment_docs')", documentsStart)
    const historyInsert = seedSource.indexOf(
      "await supabase.from('assignment_doc_history').insert(historyEntries)",
    )
    const submissionFinalization = seedSource.indexOf('for (const submission of submissions)')
    const documentSeed = seedSource.slice(documentsStart, documentsInsert)

    expect(documentsStart).toBeGreaterThan(-1)
    expect(documentsInsert).toBeGreaterThan(documentsStart)
    expect(documentSeed).not.toContain('is_submitted: true')
    expect(seedSource).toContain('splitAssignmentHistoryAtSubmission(entries)')
    expect(historyInsert).toBeGreaterThan(documentsInsert)
    expect(submissionFinalization).toBeGreaterThan(historyInsert)
  })
})

describe('ensureSeedTimestampAfter', () => {
  it('moves an earlier fixture event one minute after its prerequisite', () => {
    expect(
      ensureSeedTimestampAfter(
        '2026-07-16T17:00:00.000Z',
        '2026-07-16T20:20:00.000Z',
      ),
    ).toBe('2026-07-16T20:21:00.000Z')
  })

  it('preserves a fixture event that is already later', () => {
    expect(
      ensureSeedTimestampAfter(
        '2026-07-16T21:00:00.000Z',
        '2026-07-16T20:20:00.000Z',
      ),
    ).toBe('2026-07-16T21:00:00.000Z')
  })

  it('rejects invalid chronology inputs', () => {
    expect(() => ensureSeedTimestampAfter('invalid', submit.created_at)).toThrow(
      'Seed assignment chronology requires valid timestamps',
    )
  })
})
