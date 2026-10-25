import { ApiError } from '@/lib/api-error'
import { periodFromDates } from '@/lib/contracts/repolight/report/public'
import { makeRepositoryTarget } from '@/lib/contracts/repolight/engine/repo'
import { formatDayInZone } from '@/lib/contracts/repolight/engine/time'
import { publicRepositoryRequestSchema } from '@/lib/contracts/repolight/report/bundle-contract'
import { repoLightRepositoryChoiceSchema, type RepoLightRepositoryChoice, type RepoLightSource, type BeginRepoLightRequest } from '@/lib/validations/repolight'

export type RepoLightSourceSummary = {
  repositoryChoices: RepoLightRepositoryChoice[]; available: boolean; repositoryUrl: string | null; githubUsername: string | null;
  usernameProvenance: 'analysis_override' | 'teacher_override' | 'artifact' | 'legacy' | 'none';
  requirementId: string | null; period: { startAt: string; endAt: string; timezone: 'America/Toronto' } | null;
  periodDefaulted: boolean; notice: string | null;
}
function canonicalSubmittedRepositoryUrl(candidate: string): string {
  const plain = publicRepositoryRequestSchema.shape.repositoryUrl.max(2048).parse(candidate)
  if (/\.git\.git$/i.test(plain)) throw new ApiError(400, 'repolight_repository_ambiguous')
  const target = makeRepositoryTarget(plain)
  if (!target) throw new ApiError(400, 'repolight_repository_required')
  return publicRepositoryRequestSchema.shape.repositoryUrl.max(2048).parse(target.repoUrl)
}
function ambiguousArtifactCloneSuffix(artifact: RepoLightSource['artifacts'][number]): boolean {
  return [artifact.url, artifact.metadata_json.normalized_url].some(value => typeof value === 'string' && /\.git\.git$/i.test(value))
}
function validatedRepositoryArtifacts(source: RepoLightSource) {
  const counts = new Map<string, number>()
  for (const artifact of source.artifacts) counts.set(artifact.requirement_id, (counts.get(artifact.requirement_id) ?? 0) + 1)
  return source.artifacts.flatMap(artifact => {
    if (counts.get(artifact.requirement_id) !== 1 || ambiguousArtifactCloneSuffix(artifact)) return []
    for (const candidate of [artifact.metadata_json.normalized_url, artifact.url]) {
      if (typeof candidate !== 'string') continue
      try {
        const repositoryUrl = canonicalSubmittedRepositoryUrl(candidate)
        const parsed = repoLightRepositoryChoiceSchema.safeParse({ requirementId: artifact.requirement_id, repositoryUrl, label: repositoryUrl.replace('https://github.com/', '') })
        if (parsed.success) return [{ artifact, choice: parsed.data }]
      } catch { /* Invalid persisted candidates are not offered or sent. */ }
    }
    return []
  })
}
/** Current submitted requirements only; labels are public repository paths, never artifact prose. */
export function assignmentRepoLightRepositoryChoices(source: RepoLightSource): RepoLightRepositoryChoice[] {
  return validatedRepositoryArtifacts(source).map(entry => entry.choice)
}
export function resolveAssignmentRepoLightSource(raw: RepoLightSource, input: Partial<BeginRepoLightRequest>, now = new Date()) {
  const source = raw
  const options = input.analysisOptions
  const teacher = source.repo_target?.selection_mode === 'teacher_override' ? source.repo_target : null
  if (source.artifacts.some(artifact => ambiguousArtifactCloneSuffix(artifact)
    && (input.requirementId ? artifact.requirement_id === input.requirementId : !teacher?.selected_repo_url))) throw new ApiError(400, 'repolight_repository_ambiguous')
  const candidates = validatedRepositoryArtifacts(source)
  const repositoryChoices = candidates.map(entry => entry.choice)
  let selected: typeof candidates[number] | undefined
  if (input.requirementId) {
    selected = candidates.find(entry => entry.choice.requirementId === input.requirementId)
    if (!selected) throw new ApiError(400, 'repolight_requirement_unavailable')
  } else if (!teacher?.selected_repo_url && candidates.length > 1) throw new ApiError(400, 'repolight_requirement_required')
  else if (candidates.length === 1) selected = candidates[0]
  const artifact = selected?.artifact
  const submittedUrl = teacher?.selected_repo_url || selected?.choice.repositoryUrl || source.doc?.repo_url
  if (!submittedUrl) throw new ApiError(400, 'repolight_repository_required')
  const repositoryUrl = canonicalSubmittedRepositoryUrl(submittedUrl)
  let username: string | null = null
  let provenance: RepoLightSourceSummary['usernameProvenance'] = 'none'
  if (options && Object.hasOwn(options, 'githubUsername')) { username = options.githubUsername?.trim() || null; provenance = 'analysis_override' }
  else if (teacher?.override_github_username !== null && teacher?.override_github_username !== undefined) { username = teacher.override_github_username.trim() || null; provenance = 'teacher_override' }
  else if (artifact) { username = artifact.metadata_json.github_login_selection === 'none' ? null : typeof artifact.metadata_json.github_login === 'string' ? artifact.metadata_json.github_login.trim() || null : null; provenance = username ? 'artifact' : 'none' }
  else if (source.doc?.github_username) { username = source.doc.github_username.trim() || null; provenance = 'legacy' }
  const periodDefaulted = !options?.period && !(source.assignment.released_at && source.assignment.due_at)
  const today = formatDayInZone(now.toISOString(), 'America/Toronto')
  const first = new Date(`${today}T12:00:00Z`); first.setUTCDate(first.getUTCDate() - 59)
  const fallback = periodFromDates(first.toISOString().slice(0, 10), today, 'America/Toronto')
  const period = options?.period || (source.assignment.released_at && source.assignment.due_at
    ? { startAt: source.assignment.released_at, endAt: source.assignment.due_at, timezone: 'America/Toronto' as const } : fallback)
  const startDay = formatDayInZone(period.startAt, 'America/Toronto'), endDay = formatDayInZone(new Date(Date.parse(period.endAt) - 1).toISOString(), 'America/Toronto')
  const configuredDates = [...new Set(source.class_days.filter(day => day.is_class_day && day.date >= startDay && day.date <= endDay).map(day => day.date))].sort()
  if (options?.scheduledProjectDates?.some(day => !configuredDates.includes(day))) throw new ApiError(400, 'repolight_schedule_unavailable')
  const request = publicRepositoryRequestSchema.parse({ repositoryUrl, branch: options?.branch ?? 'main', ...(username ? { githubUsername: username } : {}), period,
    scheduledProjectDates: options?.scheduledProjectDates === null ? null : options?.scheduledProjectDates ? [...new Set(options.scheduledProjectDates)].sort() : source.class_days.length ? configuredDates : null,
    baselineReviewed: options?.baselineReviewed ?? false,
    exclusions: options?.exclusions ? { commitShas: [...new Set(options.exclusions.commitShas)].sort(), pathPrefixes: [...new Set(options.exclusions.pathPrefixes)].sort(), botLogins: [...new Set(options.exclusions.botLogins)].sort() } : { commitShas: [], pathPrefixes: [], botLogins: [] },
  })
  return { request, summary: { repositoryChoices, available: true, repositoryUrl: request.repositoryUrl, githubUsername: username, usernameProvenance: provenance,
    requirementId: artifact?.requirement_id ?? null, period: { ...request.period, timezone: 'America/Toronto' as const }, periodDefaulted,
    notice: periodDefaulted ? 'Using the last 60 Toronto calendar dates because assignment release and due dates are unavailable.' : null } satisfies RepoLightSourceSummary }
}
