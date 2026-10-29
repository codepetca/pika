import { describe, expect, it } from 'vitest'
import { publicRepositoryBundleSchema, publicRepositoryRequestSchema } from '@/lib/contracts/repolight/report/bundle-contract'
import { assignmentSummary } from '@/lib/server/repolight-assignment-summary'
import wire from './fixture.json'

function fixture() {
  const bundle = publicRepositoryBundleSchema.parse(structuredClone(wire.bundle))
  bundle.selection = { status:'matched', requestedGithubLogin:'sample-student', contributorId:'github-sample-student', notice:null }
  const request = publicRepositoryRequestSchema.parse({ ...wire.envelope.request, githubUsername:'sample-student' })
  const assignment = { released_at:bundle.context.period.startAt, due_at:bundle.context.period.endAt }
  bundle.context.snapshot.capturedAt = '2026-10-17T05:00:00Z'
  return { bundle, request, assignment }
}

describe('assignment summary', () => {
  it('uses the matched account and assignment dates, not repository totals', () => {
    const f = fixture()
    const result = assignmentSummary(f.bundle, f.request, f.assignment)!
    expect(result.scopeKey).toBe('contributor:github-sample-student')
    expect(result.text).toContain('12 included commits')
    expect(result.text).toContain('9.37 hours after release')
    expect(result.text).toContain('3 of 12 (25%)')
    expect(result.text).toContain('These figures describe recorded commit author timestamps')
    expect(result.text).not.toMatch(/review the exclusions|descriptive commit messages/i)
  })
  it('gives checkpoint advice only for reliable concentrated evidence', () => {
    const f = fixture(); const facts = f.bundle.contributors[0].analysis.facts
    facts.commits = facts.commits.map((commit, index) => ({...commit, authoredAt:index < 6 ? '2026-10-16T12:00:00Z' : '2026-10-10T12:00:00Z'}))
    expect(assignmentSummary(f.bundle,f.request,f.assignment)!.text).toContain('consider recording checkpoints earlier')
    facts.coverage.history = 'partial'
    const provisional = assignmentSummary(f.bundle,f.request,f.assignment)!.text
    expect(provisional).toContain('provisional')
    expect(provisional).not.toContain('consider recording checkpoints earlier')
    expect(provisional).not.toMatch(/review the exclusions|descriptive commit messages/i)
    facts.coverage.history = 'complete'
    facts.commits = facts.commits.slice(0,3)
    expect(assignmentSummary(f.bundle,f.request,f.assignment)!.text).not.toContain('consider recording checkpoints earlier')
  })
  it('never attributes an unmatched, unrequested, or mismatched account', () => {
    const f = fixture()
    expect(assignmentSummary(f.bundle, {...f.request, githubUsername:'other'}, f.assignment)).toBeNull()
    f.bundle.selection = { status:'not_found', requestedGithubLogin:'missing', contributorId:null, notice:'No match.' }
    expect(assignmentSummary(f.bundle, f.request, f.assignment)).toBeNull()
  })
  it('does not infer dates from a generic period or permit a narrower override', () => {
    const f = fixture()
    expect(assignmentSummary(f.bundle, f.request, {released_at:null,due_at:null})!.text).toContain('assignment dates are unavailable')
    expect(assignmentSummary(f.bundle, f.request, {released_at:'2026-01-01T00:00:00Z',due_at:f.assignment.due_at})!.text).toContain('analysis period does not cover')
    expect(assignmentSummary(f.bundle, f.request, {released_at:f.assignment.due_at,due_at:f.assignment.released_at})!.text).toContain('assignment dates are unavailable')
  })
  it('marks incomplete evidence and early snapshots as provisional without inventing a share for undated commits', () => {
    const f = fixture(); const facts = f.bundle.contributors[0].analysis.facts
    facts.coverage.history = 'partial'; facts.activity.undatedCommitCount = 1; facts.commits[0].authoredAt = null
    f.bundle.context.snapshot.capturedAt = f.assignment.released_at
    f.bundle.context.baseline.status = 'not_supplied'
    f.request.baselineReviewed = false
    const text = assignmentSummary(f.bundle, f.request, f.assignment)!.text
    expect(text).toContain('provisional'); expect(text).toContain('undated'); expect(text).toContain('share is unavailable')
    expect(text).toContain('snapshot before the deadline'); expect(text).toContain('starter baseline')
    expect(text).not.toContain('consider recording checkpoints earlier')
  })
  it('clamps the final window and uses half-open instants through DST', () => {
    const f = fixture(); const facts = f.bundle.contributors[0].analysis.facts
    f.assignment = {released_at:'2026-11-01T05:30:00Z',due_at:'2026-11-01T07:30:00Z'}
    f.bundle.context.period = {startAt:f.assignment.released_at,endAt:f.assignment.due_at,timezone:'America/Toronto'}
    f.request.period = f.bundle.context.period
    f.bundle.context.snapshot.capturedAt = '2026-11-01T08:00:00Z'
    facts.commits = [ {...facts.commits[0],authoredAt:f.assignment.released_at}, {...facts.commits[1],authoredAt:f.assignment.due_at} ]
    const text = assignmentSummary(f.bundle, f.request, f.assignment)!.text
    expect(text).toContain('1 of 1 (100%)'); expect(text).toContain('shorter than 24 hours')
    expect(text).not.toContain('consider recording checkpoints earlier')
  })
  it('filters to the assignment and counts the final window start but not the deadline', () => {
    const f = fixture(); const facts = f.bundle.contributors[0].analysis.facts
    f.assignment = {released_at:'2026-10-10T04:00:00Z',due_at:'2026-10-15T04:00:00Z'}
    const at = (index:number, authoredAt:string) => ({...facts.commits[index],authoredAt})
    facts.commits = [at(0,'2026-10-09T04:00:00Z'),at(1,'2026-10-10T04:00:00Z'),at(2,'2026-10-14T04:00:00Z'),at(3,'2026-10-15T04:00:00Z')]
    const text = assignmentSummary(f.bundle, f.request, f.assignment)!.text
    expect(text).toContain('2 included commits'); expect(text).toContain('1 of 2 (50%)')
  })
  it('distinguishes empty and unavailable history and rejects mismatched report settings', () => {
    const f = fixture(); const facts = f.bundle.contributors[0].analysis.facts
    facts.commits = []
    const empty = assignmentSummary(f.bundle, f.request, f.assignment)!.text
    expect(empty).toContain('0 included commits')
    expect(empty).not.toContain('consider recording checkpoints earlier')
    facts.metrics.commits.status = 'unavailable'
    expect(assignmentSummary(f.bundle, f.request, f.assignment)!.text).toContain('commit history is unavailable')
    f.request.exclusions.commitShas = ['a'.repeat(40)]
    expect(assignmentSummary(f.bundle, f.request, f.assignment)!.text).toContain('report settings do not match')
  })
})
