import { makeRepositoryTarget, normalizeGitHubLogin } from '@/lib/contracts/repolight/engine/repo'
import type { PublicRepositoryBundle, PublicRepositoryRequest } from '@/lib/contracts/repolight/report/bundle-contract'

/** Uses the fingerprint-bound assignment source and the selected linked account only. */
export function assignmentSummary(bundle: PublicRepositoryBundle, request: PublicRepositoryRequest, assignment: { released_at: string | null; due_at: string | null }): {scopeKey:string; text:string; rulesVersion:'1.0.0'} | null {
  const login = request.githubUsername && normalizeGitHubLogin(request.githubUsername)
  const selection = bundle.selection
  if (!login || selection.status !== 'matched' || selection.requestedGithubLogin !== login) return null
  const selected = bundle.contributors.find(entry => entry.contributor.id === selection.contributorId && entry.contributor.kind === 'github_account' && entry.contributor.githubLogin === login)
  if (!selected) return null
  const scopeKey = `contributor:${selected.contributor.id}`
  const unavailable = (reason:string) => ({ scopeKey, rulesVersion:'1.0.0' as const, text:`Assignment commit metrics are unavailable because ${reason}. There is not enough information to calculate these metrics.` })
  const requestedRepo = makeRepositoryTarget(request.repositoryUrl, request.branch)
  const reportedRepo = makeRepositoryTarget(bundle.context.repository.url, bundle.context.repository.branch)
  const sameList = (a:string[], b:string[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort())
  if (!requestedRepo || !reportedRepo || requestedRepo.owner.toLowerCase() !== reportedRepo.owner.toLowerCase() || requestedRepo.name.toLowerCase() !== reportedRepo.name.toLowerCase()
    || (request.branch && request.branch !== bundle.context.repository.branch)
    || (request.baselineReviewed !== (bundle.context.baseline.status === 'applied'))
    || !sameList(request.exclusions.commitShas,bundle.context.exclusions.commitShas)
    || !sameList(request.exclusions.pathPrefixes,bundle.context.exclusions.pathPrefixes)
    || !sameList(request.exclusions.botLogins,bundle.context.exclusions.botLogins)) return unavailable('the report settings do not match the requested settings')
  const start = Date.parse(assignment.released_at ?? ''), end = Date.parse(assignment.due_at ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return unavailable('assignment dates are unavailable or invalid')
  const period = bundle.context.period
  if (period.timezone !== request.period.timezone || Date.parse(period.startAt) !== Date.parse(request.period.startAt) || Date.parse(period.endAt) !== Date.parse(request.period.endAt)) return unavailable('the report period does not match the requested period')
  if (Date.parse(period.startAt) > start || Date.parse(period.endAt) < end) return unavailable('the analysis period does not cover the assignment')
  const facts = selected.analysis.facts
  if (facts.metrics.commits.status === 'unavailable') return unavailable('commit history is unavailable')
  const undated = facts.activity.undatedCommitCount > 0
  const commits = facts.commits.filter(commit => commit.authoredAt && Date.parse(commit.authoredAt) >= start && Date.parse(commit.authoredAt) < end)
  const limitations = [facts.coverage.history !== 'complete' ? 'incomplete history' : null,
    bundle.context.baseline.status !== 'applied' ? 'an unreviewed starter baseline' : null,
    bundle.context.exclusions.pathPrefixes.length && facts.coverage.files !== 'complete' ? 'incomplete file evidence for exclusions' : null,
    undated ? 'undated commits' : null,
    Date.parse(bundle.context.snapshot.capturedAt) < end ? 'a snapshot before the deadline' : null].filter(Boolean)
  const count = undated ? `${commits.length} observed dated commits` : `${commits.length} included commit${commits.length === 1 ? '' : 's'}`
  let timing = 'the first recorded commit and final-window share are unavailable'
  let concentrated = false
  if (commits.length) {
    const first = Math.min(...commits.map(commit => Date.parse(commit.authoredAt!)))
    const hours = ((first - start) / 3600000).toFixed(2)
    const date = new Intl.DateTimeFormat('en-CA', {timeZone:period.timezone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(first))
    const window = Math.max(start, end - 86400000)
    const inWindow = commits.filter(commit => Date.parse(commit.authoredAt!) >= window).length
    concentrated = !limitations.length && end - start > 86400000 && commits.length >= 4 && inWindow / commits.length >= 0.5
    const share = undated ? 'the final-window share is unavailable because some commits are undated' : `${inWindow} of ${commits.length} (${Math.round(inWindow / commits.length * 100)}%) were in ${end - start < 86400000 ? 'the entire assignment, which is shorter than 24 hours' : 'the final 24 hours before the deadline'}`
    timing = `the first observed commit author timestamp was ${date}, approximately ${hours} hours after release, and ${share}`
  }
  const feedback = limitations.length ? `These observations are provisional because of ${limitations.join(', ')}` : concentrated ? 'For a future assignment, consider recording checkpoints earlier' : 'These figures describe recorded commit author timestamps'
  return {scopeKey, rulesVersion:'1.0.0', text:`For the selected GitHub account, the assignment contains ${count}; ${timing}. ${feedback}.`}
}
