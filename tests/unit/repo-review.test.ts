import { describe, expect, it } from 'vitest'
import { categorizeRepoReviewChange, computeRepoReviewMetrics, parseGitHubRepoUrl } from '@/lib/repo-review'

describe('repo-review utilities', () => {
  it('parses GitHub repo URLs and owner/name shorthand', () => {
    expect(parseGitHubRepoUrl('https://github.com/openai/openai-node')).toEqual({
      owner: 'openai',
      name: 'openai-node',
    })
    expect(parseGitHubRepoUrl('openai/openai-node')).toEqual({
      owner: 'openai',
      name: 'openai-node',
    })
    expect(parseGitHubRepoUrl('not a repo')).toBeNull()
  })

  it('categorizes obvious test and bugfix changes', () => {
    expect(categorizeRepoReviewChange('add regression test for login', [
      { filename: 'tests/api/login.test.ts', status: 'modified', additions: 12, deletions: 0 },
    ])).toEqual({ category: 'test', ambiguous: false })

    expect(categorizeRepoReviewChange('fix classroom roster bug', [
      { filename: 'src/app/api/teacher/classrooms/route.ts', status: 'modified', additions: 12, deletions: 4 },
    ])).toEqual({ category: 'bugfix', ambiguous: false })
  })

  it('computes contribution and workflow metrics per student', () => {
    const analysis = computeRepoReviewMetrics({
      identities: [
        {
          studentId: 'student-1',
          email: 'student1@example.com',
          name: 'Alex Lee',
          githubLogin: 'alexlee',
          commitEmails: ['student1@example.com'],
        },
        {
          studentId: 'student-2',
          email: 'student2@example.com',
          name: 'Sam Cruz',
          githubLogin: 'samcruz',
          commitEmails: ['student2@example.com'],
        },
      ],
      commits: [
        {
          sha: 'a1',
          authoredAt: '2026-03-01T14:00:00.000Z',
          message: 'implement attendance filters',
          githubLogin: 'alexlee',
          authorEmail: 'student1@example.com',
          files: [{ filename: 'src/lib/attendance.ts', status: 'modified', additions: 50, deletions: 10 }],
          category: 'feature',
          weightedContribution: 1.5,
          areas: ['src/lib'],
        },
        {
          sha: 'a2',
          authoredAt: '2026-03-03T14:00:00.000Z',
          message: 'add attendance tests',
          githubLogin: 'alexlee',
          authorEmail: 'student1@example.com',
          files: [{ filename: 'tests/unit/attendance.test.ts', status: 'modified', additions: 20, deletions: 0 }],
          category: 'test',
          weightedContribution: 0.8,
          areas: ['tests/unit'],
        },
        {
          sha: 'b1',
          authoredAt: '2026-03-04T13:00:00.000Z',
          message: 'fix gradebook bug',
          githubLogin: 'samcruz',
          authorEmail: 'student2@example.com',
          files: [{ filename: 'src/app/api/teacher/gradebook/route.ts', status: 'modified', additions: 18, deletions: 5 }],
          category: 'bugfix',
          weightedContribution: 0.9,
          areas: ['src/app'],
        },
      ],
      reviewWindow: {
        startAt: '2026-03-01T00:00:00.000Z',
        endAt: '2026-03-07T23:59:59.000Z',
      },
      reviewEvidenceByLogin: new Map([
        ['alexlee', [{ type: 'pull_request', id: '12', title: 'PR 12', authored_at: '2026-03-03T16:00:00.000Z' }]],
      ]),
    })

    expect(analysis.students).toHaveLength(2)

    const alex = analysis.students.find((student) => student.studentId === 'student-1')
    const sam = analysis.students.find((student) => student.studentId === 'student-2')

    expect(alex?.commitCount).toBe(2)
    expect(alex?.activeDays).toBe(2)
    expect(alex?.relativeContributionShare).toBeGreaterThan(sam?.relativeContributionShare || 0)
    expect(alex?.reviewActivityCount).toBe(1)
    expect(alex?.evidence[0]?.type).toBe('commit')
    expect(sam?.commitCount).toBe(1)
  })
})
