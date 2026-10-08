import { describe, expect, it } from 'vitest'
import {
  buildProcessReminders,
  scoreWorkflow,
  summarizeWorkProcess,
  type WorkProcessSummary,
} from '@/lib/assignment-workflow-process'

const DUE = '2026-03-10T23:59:00.000Z'

function summary(overrides: Partial<WorkProcessSummary> = {}): WorkProcessSummary {
  return {
    submitted: true,
    daysLate: 0,
    firstSaveDaysBeforeDue: 2,
    workSessions: 2,
    daysWithWork: 2,
    authenticityScore: 100,
    pastedWords: 0,
    ...overrides,
  }
}

function history(times: string[], opts: { words?: number[]; paste?: number[] } = {}) {
  return times.map((created_at, index) => ({
    created_at,
    word_count: opts.words?.[index] ?? index * 10,
    paste_word_count: opts.paste?.[index] ?? 0,
    trigger: 'autosave',
  }))
}

describe('summarizeWorkProcess', () => {
  it('reports lateness, sessions and days from save history', () => {
    const result = summarizeWorkProcess(
      history([
        '2026-03-08T10:00:00.000Z',
        '2026-03-08T10:20:00.000Z',
        '2026-03-09T14:00:00.000Z',
      ]),
      { dueAt: DUE, isSubmitted: true, submittedAt: '2026-03-11T23:59:00.000Z' },
    )

    expect(result.submitted).toBe(true)
    expect(result.daysLate).toBe(1)
    expect(result.workSessions).toBe(2)
    expect(result.daysWithWork).toBe(2)
    expect(result.firstSaveDaysBeforeDue).toBeCloseTo(2.6, 1)
  })

  it('has no lateness for work that was never submitted', () => {
    const result = summarizeWorkProcess(
      history(['2026-03-08T10:00:00.000Z', '2026-03-08T10:05:00.000Z']),
      { dueAt: DUE, isSubmitted: false, submittedAt: null },
    )

    expect(result.submitted).toBe(false)
    expect(result.daysLate).toBeNull()
    expect(result.workSessions).toBe(1)
  })

  it('counts pasted words and scores authenticity from the same history', () => {
    const result = summarizeWorkProcess(
      history(
        ['2026-03-08T10:00:00.000Z', '2026-03-08T10:00:05.000Z'],
        { words: [0, 300], paste: [0, 300] },
      ),
      { dueAt: DUE, isSubmitted: true, submittedAt: '2026-03-09T00:00:00.000Z' },
    )

    expect(result.pastedWords).toBe(300)
    expect(result.authenticityScore).toBe(0)
  })
})

describe('scoreWorkflow', () => {
  it('gives full marks for on-time, authentic work', () => {
    expect(scoreWorkflow({ presentation: 4, process: summary() }).total).toBe(10)
  })

  it('applies the lateness scale', () => {
    const late = (daysLate: number) =>
      scoreWorkflow({ presentation: 4, process: summary({ daysLate }) }).total

    expect(late(0)).toBe(10)
    expect(late(0.8)).toBe(9)
    expect(late(3)).toBe(9)
    expect(late(5)).toBe(8)
    expect(late(7)).toBe(8)
    expect(late(10)).toBe(7)
    expect(late(14)).toBe(7)
    expect(late(20)).toBe(5)
  })

  it('never treats unsubmitted work as late', () => {
    expect(scoreWorkflow({
      presentation: 4,
      process: summary({ submitted: false, daysLate: null }),
    }).total).toBe(10)
  })

  it('scores authenticity in three bands and never counts pasting twice', () => {
    const auth = (authenticityScore: number | null) =>
      scoreWorkflow({ presentation: 4, process: summary({ authenticityScore, pastedWords: 500 }) })

    expect(auth(100).authenticity).toBe(2)
    expect(auth(90).authenticity).toBe(2)
    expect(auth(89).authenticity).toBe(1)
    expect(auth(70).authenticity).toBe(1)
    expect(auth(69).authenticity).toBe(0)
    expect(auth(null).authenticity).toBe(2)
  })

  it('only asks for more than one sitting on multi-session assignments', () => {
    const single = summary({ workSessions: 1, daysWithWork: 1 })

    expect(scoreWorkflow({ presentation: 4, process: single }).sessions).toBe(2)
    expect(scoreWorkflow({
      presentation: 4,
      process: single,
      expectsMultipleSessions: true,
    }).sessions).toBe(0)
    expect(scoreWorkflow({
      presentation: 4,
      process: summary({ workSessions: 2, daysWithWork: 1 }),
      expectsMultipleSessions: true,
    }).sessions).toBe(1)
    expect(scoreWorkflow({
      presentation: 4,
      process: summary({ workSessions: 1, daysWithWork: 2 }),
      expectsMultipleSessions: true,
    }).sessions).toBe(2)
  })

  it('gives full process marks when history is missing', () => {
    expect(scoreWorkflow({ presentation: 4, process: null }).total).toBe(10)
  })

  it('clamps presentation to 4 and the total to 0', () => {
    expect(scoreWorkflow({ presentation: 9, process: summary() }).presentation).toBe(4)
    expect(scoreWorkflow({
      presentation: 0,
      process: summary({ daysLate: 30, authenticityScore: 0 }),
    }).total).toBe(0)
  })
})

describe('buildProcessReminders', () => {
  it('reminds a student who pasted their work to type it in Pika', () => {
    expect(buildProcessReminders(summary({ authenticityScore: 40 }))[0]).toContain('type all of your work')
  })

  it('reminds a student who never submitted', () => {
    expect(buildProcessReminders(summary({ submitted: false }))[0]).toContain('never submitted')
  })

  it('stays quiet for on-time authentic work', () => {
    expect(buildProcessReminders(summary())).toEqual([])
    expect(buildProcessReminders(null)).toEqual([])
  })
})
