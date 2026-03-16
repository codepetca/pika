import { formatInTimeZone } from 'date-fns-tz'
import { classifyAmbiguousRepoReviewChanges } from '@/lib/repo-review-ai'
import type {
  AssignmentRepoReviewConfig,
  RepoReviewEvidenceItem,
  RepoReviewSemanticBreakdown,
  RepoReviewSemanticCategory,
  RepoReviewTimelinePoint,
  RepoReviewWarning,
  UserGitHubIdentity,
} from '@/types'

const GITHUB_API_BASE = 'https://api.github.com'
const SESSION_GAP_MS = 90 * 60 * 1000
const CONTRIBUTION_SCALE = 40
const MAX_COMMITS = 250
const MAX_PULLS = 100
const MAX_EVIDENCE_ITEMS = 10
const TORONTO_TIMEZONE = 'America/Toronto'

export const REPO_REVIEW_METRICS_VERSION = 'v1'
export const REPO_REVIEW_PROMPT_VERSION = 'v1'

export const REPO_REVIEW_SEMANTIC_WEIGHTS: Record<RepoReviewSemanticCategory, number> = {
  feature: 1.0,
  bugfix: 0.9,
  test: 0.8,
  refactor: 0.7,
  docs: 0.4,
  styling: 0.4,
  config: 0.2,
  generated: 0.0,
}

export interface RepoReviewStudentIdentityInput {
  studentId: string
  email: string
  name: string | null
  githubLogin: string | null
  commitEmails: string[]
}

export interface RepoReviewWindow {
  startAt: string
  endAt: string
}

export interface RepoReviewCommitFile {
  filename: string
  status: string
  additions: number
  deletions: number
}

export interface RepoReviewAnalyzedCommit {
  sha: string
  authoredAt: string
  message: string
  githubLogin: string | null
  authorEmail: string | null
  files: RepoReviewCommitFile[]
  category: RepoReviewSemanticCategory
  weightedContribution: number
  areas: string[]
}

export interface RepoReviewStudentMetrics {
  studentId: string
  githubLogin: string | null
  commitCount: number
  activeDays: number
  sessionCount: number
  burstRatio: number
  weightedContribution: number
  relativeContributionShare: number
  spreadScore: number
  iterationScore: number
  semanticBreakdown: RepoReviewSemanticBreakdown
  timeline: RepoReviewTimelinePoint[]
  evidence: RepoReviewEvidenceItem[]
  areas: string[]
  reviewActivityCount: number
}

export interface RepoReviewAnalysisResult {
  sourceRef: string
  warnings: RepoReviewWarning[]
  confidence: number
  students: RepoReviewStudentMetrics[]
}

type GitHubCommitSummary = {
  sha: string
  commit: {
    author: {
      email?: string | null
      date?: string | null
      name?: string | null
    }
    message?: string | null
  }
  author?: {
    login?: string | null
  } | null
  parents?: Array<{ sha: string }>
}

type GitHubCommitDetail = GitHubCommitSummary & {
  files?: Array<{
    filename?: string
    status?: string
    additions?: number
    deletions?: number
  }>
}

type GitHubPullSummary = {
  number: number
  html_url?: string | null
  title?: string | null
  body?: string | null
  created_at?: string | null
  updated_at?: string | null
  merged_at?: string | null
  user?: { login?: string | null } | null
}

type GitHubReview = {
  id: number
  html_url?: string | null
  submitted_at?: string | null
  body?: string | null
  user?: { login?: string | null } | null
  state?: string | null
}

function getGitHubToken(): string | null {
  const key = process.env.GITHUB_PAT?.trim() || process.env.GITHUB_FEEDBACK_TOKEN?.trim() || ''
  return key || null
}

async function githubRequest<T>(path: string): Promise<T> {
  const token = getGitHubToken()
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub request failed (${res.status}): ${text}`)
  }

  return res.json() as Promise<T>
}

export function parseGitHubRepoUrl(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/i)
  if (httpsMatch) {
    return { owner: httpsMatch[1], name: httpsMatch[2] }
  }

  const shorthandMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], name: shorthandMatch[2] }
  }

  return null
}

export function normalizeCommitEmails(emails: string[] | null | undefined): string[] {
  return [...new Set((emails || []).map((email) => email.trim().toLowerCase()).filter(Boolean))]
}

function isMergeCommit(commit: GitHubCommitSummary): boolean {
  return (commit.parents?.length || 0) > 1 || /^merge\b/i.test(commit.commit.message || '')
}

function getTorontoDay(iso: string): string {
  return formatInTimeZone(new Date(iso), TORONTO_TIMEZONE, 'yyyy-MM-dd')
}

function enumerateTorontoDays(startAt: string, endAt: string): string[] {
  const days: string[] = []
  const cursor = new Date(startAt)
  const end = new Date(endAt)
  cursor.setHours(0, 0, 0, 0)
  while (cursor <= end) {
    days.push(formatInTimeZone(cursor, TORONTO_TIMEZONE, 'yyyy-MM-dd'))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return [...new Set(days)]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function createEmptySemanticBreakdown(): RepoReviewSemanticBreakdown {
  return {
    feature: 0,
    bugfix: 0,
    test: 0,
    refactor: 0,
    docs: 0,
    styling: 0,
    config: 0,
    generated: 0,
  }
}

function inferAreaFromPath(path: string): string {
  const normalized = path.replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (segments.length >= 2) return `${segments[0]}/${segments[1]}`
  return segments[0] || 'root'
}

function isGeneratedPath(path: string): boolean {
  return (
    path.includes('/dist/') ||
    path.includes('/build/') ||
    path.includes('/coverage/') ||
    path.endsWith('.map') ||
    path.endsWith('.min.js') ||
    path.endsWith('pnpm-lock.yaml') ||
    path.endsWith('package-lock.json') ||
    path.endsWith('yarn.lock')
  )
}

function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(path) || /\.test\.[a-z]+$/i.test(path) || /\.spec\.[a-z]+$/i.test(path)
}

function isDocsPath(path: string): boolean {
  return /(^|\/)(docs|guides)\//.test(path) || /\.(md|mdx|txt)$/i.test(path)
}

function isStylingPath(path: string): boolean {
  return /\.(css|scss|sass)$/i.test(path) || /tailwind|theme|tokens/i.test(path)
}

function isConfigPath(path: string): boolean {
  return (
    /\.(json|ya?ml|toml|ini)$/i.test(path) ||
    /(^|\/)(\.github|scripts)\//.test(path) ||
    /(^|\/)(next\.config|tsconfig|eslint|prettier|vitest|playwright|package\.json|pnpm-workspace)/i.test(path)
  )
}

function inferCategoryFromFiles(files: RepoReviewCommitFile[]): RepoReviewSemanticCategory | null {
  if (!files.length) return null
  if (files.every((file) => isGeneratedPath(file.filename))) return 'generated'
  if (files.every((file) => isDocsPath(file.filename))) return 'docs'
  if (files.every((file) => isTestPath(file.filename))) return 'test'
  if (files.every((file) => isStylingPath(file.filename))) return 'styling'
  if (files.every((file) => isConfigPath(file.filename))) return 'config'
  return null
}

function inferCategoryFromMessage(message: string): RepoReviewSemanticCategory | null {
  if (/\b(test|spec|coverage)\b/i.test(message)) return 'test'
  if (/\b(fix|bug|regression|issue|patch)\b/i.test(message)) return 'bugfix'
  if (/\b(refactor|cleanup|rename|restructure|extract)\b/i.test(message)) return 'refactor'
  if (/\b(doc|readme|comment)\b/i.test(message)) return 'docs'
  if (/\b(style|ui|css|layout|spacing)\b/i.test(message)) return 'styling'
  if (/\b(config|ci|workflow|lint|deps|dependency)\b/i.test(message)) return 'config'
  if (/\b(add|implement|create|build|feature)\b/i.test(message)) return 'feature'
  return null
}

export function categorizeRepoReviewChange(
  message: string,
  files: RepoReviewCommitFile[],
): { category: RepoReviewSemanticCategory; ambiguous: boolean } {
  const fromFiles = inferCategoryFromFiles(files)
  const fromMessage = inferCategoryFromMessage(message)

  if (fromFiles && fromMessage && fromFiles !== fromMessage && fromFiles !== 'config' && fromFiles !== 'generated') {
    return { category: fromMessage, ambiguous: true }
  }

  if (fromFiles) return { category: fromFiles, ambiguous: false }
  if (fromMessage) return { category: fromMessage, ambiguous: false }
  return { category: 'feature', ambiguous: true }
}

function isRepoReviewSemanticCategory(value: string | undefined): value is RepoReviewSemanticCategory {
  return value === 'feature'
    || value === 'bugfix'
    || value === 'test'
    || value === 'refactor'
    || value === 'docs'
    || value === 'styling'
    || value === 'config'
    || value === 'generated'
}

function buildAmbiguousClassificationSummary(message: string, files: RepoReviewCommitFile[]): string {
  const topLine = message.split('\n')[0]?.trim() || 'Untitled change'
  const topFiles = files
    .map((file) => file.filename)
    .filter(Boolean)
    .slice(0, 5)
    .join(', ')

  return topFiles ? `${topLine} | files: ${topFiles}` : topLine
}

function computeWeightedContribution(category: RepoReviewSemanticCategory, files: RepoReviewCommitFile[]): number {
  const churn = files.reduce((sum, file) => sum + file.additions + file.deletions, 0)
  const volume = clamp(churn / CONTRIBUTION_SCALE, 0.25, 3)
  return round(REPO_REVIEW_SEMANTIC_WEIGHTS[category] * volume)
}

function determineStudentId(
  commit: GitHubCommitSummary,
  identities: RepoReviewStudentIdentityInput[],
): { studentId: string | null; githubLogin: string | null } {
  const commitLogin = commit.author?.login?.toLowerCase() || null
  const commitEmail = commit.commit.author.email?.toLowerCase() || null

  for (const identity of identities) {
    if (identity.githubLogin && commitLogin && identity.githubLogin.toLowerCase() === commitLogin) {
      return { studentId: identity.studentId, githubLogin: identity.githubLogin }
    }
  }

  for (const identity of identities) {
    if (commitEmail && identity.commitEmails.includes(commitEmail)) {
      return { studentId: identity.studentId, githubLogin: identity.githubLogin }
    }
  }

  return { studentId: null, githubLogin: commitLogin }
}

async function listCommits(
  owner: string,
  repo: string,
  branch: string,
  window: RepoReviewWindow,
): Promise<{ commits: GitHubCommitSummary[]; truncated: boolean }> {
  const commits: GitHubCommitSummary[] = []
  let page = 1
  let truncated = false

  while (page <= 5) {
    const result = await githubRequest<GitHubCommitSummary[]>(
      `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(window.startAt)}&until=${encodeURIComponent(window.endAt)}&per_page=100&page=${page}`
    )

    if (!result.length) break
    commits.push(...result)

    if (commits.length >= MAX_COMMITS) {
      truncated = true
      return { commits: commits.slice(0, MAX_COMMITS), truncated }
    }

    if (result.length < 100) break
    page += 1
  }

  return { commits, truncated }
}

async function listPulls(
  owner: string,
  repo: string,
  window: RepoReviewWindow,
): Promise<GitHubPullSummary[]> {
  const pulls = await githubRequest<GitHubPullSummary[]>(
    `/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${MAX_PULLS}`
  )

  return pulls.filter((pull) => {
    const relevantAt = pull.merged_at || pull.updated_at || pull.created_at
    if (!relevantAt) return false
    const ms = new Date(relevantAt).getTime()
    return ms >= new Date(window.startAt).getTime() && ms <= new Date(window.endAt).getTime()
  })
}

async function listReviews(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GitHubReview[]> {
  return githubRequest<GitHubReview[]>(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews?per_page=100`)
}

async function fetchCommitDetails(
  owner: string,
  repo: string,
  summaries: GitHubCommitSummary[],
): Promise<GitHubCommitDetail[]> {
  const queue = [...summaries]
  const details: GitHubCommitDetail[] = []
  const concurrency = Math.min(8, queue.length)

  async function worker() {
    while (queue.length > 0) {
      const commit = queue.shift()
      if (!commit) break
      const detail = await githubRequest<GitHubCommitDetail>(`/repos/${owner}/${repo}/commits/${commit.sha}`)
      details.push(detail)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return details
}

function buildEvidenceForCommits(commits: RepoReviewAnalyzedCommit[]): RepoReviewEvidenceItem[] {
  return commits
    .sort((a, b) => new Date(b.authoredAt).getTime() - new Date(a.authoredAt).getTime())
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((commit) => ({
      type: 'commit',
      id: commit.sha,
      title: commit.message.split('\n')[0] || commit.sha.slice(0, 7),
      authored_at: commit.authoredAt,
      summary: `${commit.category} • ${commit.files.length} file${commit.files.length === 1 ? '' : 's'}`,
      category: commit.category,
    }))
}

function appendEvidence(items: RepoReviewEvidenceItem[], next: RepoReviewEvidenceItem[]) {
  for (const item of next) {
    if (items.length >= MAX_EVIDENCE_ITEMS) return
    items.push(item)
  }
}

export function computeRepoReviewMetrics(opts: {
  identities: RepoReviewStudentIdentityInput[]
  commits: RepoReviewAnalyzedCommit[]
  reviewWindow: RepoReviewWindow
  reviewEvidenceByLogin?: Map<string, RepoReviewEvidenceItem[]>
}): RepoReviewAnalysisResult {
  const warnings: RepoReviewWarning[] = []
  const byStudent = new Map<string, RepoReviewAnalyzedCommit[]>()
  const unmatchedCommits: RepoReviewAnalyzedCommit[] = []

  for (const commit of opts.commits) {
    const identity = opts.identities.find((item) => {
      if (item.githubLogin && commit.githubLogin && item.githubLogin.toLowerCase() === commit.githubLogin.toLowerCase()) {
        return true
      }
      if (commit.authorEmail && item.commitEmails.includes(commit.authorEmail.toLowerCase())) {
        return true
      }
      return false
    })

    if (!identity) {
      unmatchedCommits.push(commit)
      continue
    }

    const commits = byStudent.get(identity.studentId) || []
    commits.push(commit)
    byStudent.set(identity.studentId, commits)
  }

  if (unmatchedCommits.length > 0) {
    warnings.push({
      code: 'unmatched-commits',
      message: `${unmatchedCommits.length} commit(s) could not be matched to a student mapping and were excluded.`,
    })
  }

  const totalWeightedContribution = Array.from(byStudent.values())
    .flat()
    .reduce((sum, commit) => sum + commit.weightedContribution, 0)

  const totalDays = enumerateTorontoDays(opts.reviewWindow.startAt, opts.reviewWindow.endAt).length || 1
  const burstCutoffMs = new Date(opts.reviewWindow.endAt).getTime() - (48 * 60 * 60 * 1000)

  const students = opts.identities.map((identity) => {
    const commits = (byStudent.get(identity.studentId) || []).sort(
      (left, right) => new Date(left.authoredAt).getTime() - new Date(right.authoredAt).getTime()
    )

    const activeDaysSet = new Set(commits.map((commit) => getTorontoDay(commit.authoredAt)))
    const timelineMap = new Map<string, RepoReviewTimelinePoint>()
    const breakdown = createEmptySemanticBreakdown()
    const areaCounts = new Map<string, number>()
    let weightedContribution = 0
    let lastCommitAt = 0
    let sessionCount = 0
    let burstWeightedContribution = 0

    for (const commit of commits) {
      weightedContribution += commit.weightedContribution
      breakdown[commit.category] += commit.weightedContribution

      if (new Date(commit.authoredAt).getTime() >= burstCutoffMs) {
        burstWeightedContribution += commit.weightedContribution
      }

      const commitAt = new Date(commit.authoredAt).getTime()
      if (!lastCommitAt || commitAt - lastCommitAt > SESSION_GAP_MS) {
        sessionCount += 1
      }
      lastCommitAt = commitAt

      const day = getTorontoDay(commit.authoredAt)
      const existingTimelinePoint = timelineMap.get(day) || {
        date: day,
        weighted_contribution: 0,
        commit_count: 0,
      }
      existingTimelinePoint.weighted_contribution = round(
        existingTimelinePoint.weighted_contribution + commit.weightedContribution
      )
      existingTimelinePoint.commit_count += 1
      timelineMap.set(day, existingTimelinePoint)

      for (const area of commit.areas) {
        areaCounts.set(area, (areaCounts.get(area) || 0) + 1)
      }
    }

    const featureLike = breakdown.feature + breakdown.bugfix
    const refinement = breakdown.test + breakdown.refactor
    const spreadScore = commits.length === 0 ? 0 : round(clamp(activeDaysSet.size / Math.max(totalDays, 1), 0, 1))
    const iterationScore = commits.length === 0
      ? 0
      : round(clamp((refinement / Math.max(weightedContribution, 0.0001)) * 0.7 + Math.min(sessionCount, 6) / 6 * 0.3, 0, 1))
    const burstRatio = commits.length === 0 ? 0 : round(clamp(burstWeightedContribution / Math.max(weightedContribution, 0.0001), 0, 1))
    const relativeContributionShare = totalWeightedContribution === 0
      ? 0
      : round(weightedContribution / totalWeightedContribution)

    const evidence = buildEvidenceForCommits(commits)
    if (identity.githubLogin && opts.reviewEvidenceByLogin?.has(identity.githubLogin.toLowerCase())) {
      appendEvidence(evidence, opts.reviewEvidenceByLogin.get(identity.githubLogin.toLowerCase()) || [])
    }

    const areas = [...areaCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([area]) => area)

    return {
      studentId: identity.studentId,
      githubLogin: identity.githubLogin,
      commitCount: commits.length,
      activeDays: activeDaysSet.size,
      sessionCount,
      burstRatio,
      weightedContribution: round(weightedContribution),
      relativeContributionShare,
      spreadScore,
      iterationScore,
      semanticBreakdown: breakdown,
      timeline: [...timelineMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
      evidence,
      areas,
      reviewActivityCount: (opts.reviewEvidenceByLogin?.get(identity.githubLogin?.toLowerCase() || '') || [])
        .filter((item) => item.type === 'review' || item.type === 'pull_request' || item.type === 'issue')
        .length,
    }
  })

  const matchedStudents = students.filter((student) => student.commitCount > 0 || student.reviewActivityCount > 0)
  const confidence = matchedStudents.length === 0
    ? 0.2
    : round(clamp(
        0.55
        + (matchedStudents.length / Math.max(opts.identities.length, 1)) * 0.25
        - (unmatchedCommits.length / Math.max(opts.commits.length || 1, 1)) * 0.3,
        0.2,
        1,
      ))

  return {
    sourceRef: '',
    warnings,
    confidence,
    students,
  }
}

async function buildReviewEvidenceByLogin(
  owner: string,
  repo: string,
  window: RepoReviewWindow,
  includePrReviews: boolean,
): Promise<Map<string, RepoReviewEvidenceItem[]>> {
  const byLogin = new Map<string, RepoReviewEvidenceItem[]>()
  if (!includePrReviews) return byLogin

  const pulls = await listPulls(owner, repo, window)
  for (const pull of pulls) {
    const authorLogin = pull.user?.login?.toLowerCase()
    const relevantAt = pull.merged_at || pull.updated_at || pull.created_at || undefined
    if (authorLogin) {
      const items = byLogin.get(authorLogin) || []
      items.push({
        type: 'pull_request',
        id: String(pull.number),
        title: pull.title || `Pull request #${pull.number}`,
        url: pull.html_url || undefined,
        authored_at: relevantAt,
        summary: 'Pull request activity',
      })
      byLogin.set(authorLogin, items)
    }

    const reviews = await listReviews(owner, repo, pull.number)
    for (const review of reviews) {
      const submittedAt = review.submitted_at
      if (!submittedAt) continue
      const submittedMs = new Date(submittedAt).getTime()
      if (submittedMs < new Date(window.startAt).getTime() || submittedMs > new Date(window.endAt).getTime()) {
        continue
      }

      const login = review.user?.login?.toLowerCase()
      if (!login) continue

      const items = byLogin.get(login) || []
      items.push({
        type: 'review',
        id: String(review.id),
        title: `${review.state || 'Review'} on PR #${pull.number}`,
        url: review.html_url || undefined,
        authored_at: submittedAt,
        summary: review.body?.trim() ? review.body.trim().slice(0, 180) : 'Review comment',
      })
      byLogin.set(login, items)
    }
  }

  return byLogin
}

export async function analyzeRepoReviewAssignment(opts: {
  config: AssignmentRepoReviewConfig
  identities: RepoReviewStudentIdentityInput[]
  reviewWindow: RepoReviewWindow
}): Promise<RepoReviewAnalysisResult> {
  const { config, identities, reviewWindow } = opts
  const warnings: RepoReviewWarning[] = []
  const { commits: commitSummaries, truncated } = await listCommits(
    config.repo_owner,
    config.repo_name,
    config.default_branch,
    reviewWindow,
  )

  if (truncated) {
    warnings.push({
      code: 'truncated-commits',
      message: `Commit analysis was limited to the first ${MAX_COMMITS} commits in the review window.`,
    })
  }

  const nonMergeSummaries = commitSummaries.filter((commit) => !isMergeCommit(commit))
  const commitDetails = await fetchCommitDetails(config.repo_owner, config.repo_name, nonMergeSummaries)

  const provisionalCommits = commitDetails.map((commit) => {
    const files = (commit.files || []).map((file) => ({
      filename: file.filename || '',
      status: file.status || 'modified',
      additions: Number(file.additions || 0),
      deletions: Number(file.deletions || 0),
    }))
    const { category, ambiguous } = categorizeRepoReviewChange(commit.commit.message || '', files)

    return {
      sha: commit.sha,
      authoredAt: commit.commit.author.date || new Date().toISOString(),
      message: commit.commit.message || '',
      githubLogin: commit.author?.login || null,
      authorEmail: commit.commit.author.email || null,
      files,
      category,
      ambiguous,
      areas: [...new Set(files.map((file) => inferAreaFromPath(file.filename)).filter(Boolean))],
    }
  })

  const ambiguousOverrides: Record<string, string> = await classifyAmbiguousRepoReviewChanges(
    provisionalCommits
      .filter((commit) => commit.ambiguous)
      .map((commit) => ({
        id: commit.sha,
        summary: buildAmbiguousClassificationSummary(commit.message, commit.files),
      }))
  ).catch((error): Record<string, string> => {
    warnings.push({
      code: 'ai-classification-failed',
      message: `Ambiguous change classification fell back to heuristics: ${error instanceof Error ? error.message : 'unknown error'}`,
    })
    return {}
  })

  const analyzedCommits = provisionalCommits.map((commit) => {
    const override = ambiguousOverrides[commit.sha]
    const category = isRepoReviewSemanticCategory(override) ? override : commit.category
    return {
      sha: commit.sha,
      authoredAt: commit.authoredAt,
      message: commit.message,
      githubLogin: commit.githubLogin,
      authorEmail: commit.authorEmail,
      files: commit.files,
      category,
      weightedContribution: computeWeightedContribution(category, commit.files),
      areas: commit.areas,
    } satisfies RepoReviewAnalyzedCommit
  })

  const reviewEvidenceByLogin = await buildReviewEvidenceByLogin(
    config.repo_owner,
    config.repo_name,
    reviewWindow,
    config.include_pr_reviews,
  ).catch((error) => {
    warnings.push({
      code: 'github-review-fetch-failed',
      message: `PR/review evidence could not be loaded: ${error instanceof Error ? error.message : 'unknown error'}`,
    })
    return new Map<string, RepoReviewEvidenceItem[]>()
  })

  const analysis = computeRepoReviewMetrics({
    identities: identities.map((identity) => ({
      ...identity,
      commitEmails: normalizeCommitEmails(identity.commitEmails),
    })),
    commits: analyzedCommits,
    reviewWindow,
    reviewEvidenceByLogin,
  })

  return {
    sourceRef: config.default_branch,
    warnings: [...analysis.warnings, ...warnings],
    confidence: analysis.confidence,
    students: analysis.students,
  }
}

export function buildRepoReviewWindow(opts: {
  dueAt: string
  releasedAt?: string | null
  reviewStartAt?: string | null
  reviewEndAt?: string | null
}): RepoReviewWindow {
  const startAt = opts.reviewStartAt || opts.releasedAt || new Date(new Date(opts.dueAt).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const endAt = opts.reviewEndAt || opts.dueAt
  return { startAt, endAt }
}

export function formatRepoReviewRepoName(config: Pick<AssignmentRepoReviewConfig, 'repo_owner' | 'repo_name'>): string {
  return `${config.repo_owner}/${config.repo_name}`
}

export function hydrateIdentityRow(
  userId: string,
  githubIdentity: UserGitHubIdentity | null | undefined,
): { githubLogin: string | null; commitEmails: string[] } {
  if (!githubIdentity || githubIdentity.user_id !== userId) {
    return { githubLogin: null, commitEmails: [] }
  }
  return {
    githubLogin: githubIdentity.github_login,
    commitEmails: normalizeCommitEmails(githubIdentity.commit_emails),
  }
}
