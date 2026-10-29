import { normalizeGitHubLogin } from '@/lib/contracts/repolight/engine/repo'
import { normalizeGitHubLogin as normalizeStudentGitHubLogin } from '@/lib/github-repos'
import { fetchJSON, fetchJSONWithCache } from '@/lib/request-cache'
import { repoLightContextReplySchema, repoLightImportResultSchema, repoLightReportReplySchema, repoLightRunReplySchema } from '@/lib/validations/repolight'

export type RepoLightBatchStudent = { studentId: string; expectedDocUpdatedAt: string | null }
export type RepoLightBatchResult = { studentId: string; status: 'imported' | 'skipped' | 'failed' | 'cancelled'; reason: string }
export type RepoLightBatchProgress = { studentId: string; index: number; total: number; phase: 'checking' | 'analyzing' | 'importing' | 'finished'; result?: RepoLightBatchResult }

type Request = (url: string, init: RequestInit) => Promise<unknown>
type Options = {
  assignmentId: string
  students: RepoLightBatchStudent[]
  signal: AbortSignal
  onProgress?: (progress: RepoLightBatchProgress) => void
  request?: Request
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  newId?: () => string
  now?: () => number
}

const defaultRequest: Request = (url, init) => init.method === 'POST'
  ? fetchJSON(url, { init, errorMessage: 'Repository operation failed.' })
  : fetchJSONWithCache(`repolight-batch:${url}`, () => fetchJSON(url, { init, errorMessage: 'Repository operation failed.' }), 0)

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Advances and imports one report at a time while the owning page remains open.
 * The server validates access, freshness and the captured document revision on every write.
 * An interrupted or failed POST is not retried: the teacher must reconcile it individually.
 */
export async function executeRepoLightBatch(options: Options): Promise<RepoLightBatchResult[]> {
  const { assignmentId, students, signal, onProgress } = options
  const request = options.request ?? defaultRequest
  const wait = options.sleep ?? sleep
  const newId = options.newId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now
  const results: RepoLightBatchResult[] = []
  if (students.length > 100) throw new Error('Select at most 100 students at a time.')
  const seen = new Set<string>()

  for (let index = 0; index < students.length; index++) {
    const { studentId, expectedDocUpdatedAt } = students[index]
    const progress = (phase: RepoLightBatchProgress['phase'], result?: RepoLightBatchResult) => onProgress?.({ studentId, index, total: students.length, phase, result })
    const finish = (status: RepoLightBatchResult['status'], reason: string) => {
      const result = { studentId, status, reason }; results.push(result); progress('finished', result)
    }
    if (signal.aborted) { finish('cancelled', 'Stopped before this student was processed.'); continue }
    if (seen.has(studentId)) { finish('skipped', 'Duplicate student selection.'); continue }
    seen.add(studentId)
    if (!expectedDocUpdatedAt || !Number.isFinite(Date.parse(expectedDocUpdatedAt))) { finish('skipped', 'The student work revision is unavailable.'); continue }
    const studentSignal = AbortSignal.any([signal, AbortSignal.timeout(180_000)])
    const base = `/api/teacher/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/repolight/runs`
    const get = (url: string) => request(url, { method: 'GET', cache: 'no-store', signal: studentSignal })
    const post = (url: string, body: unknown) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: studentSignal })
    let writeStarted = false
    try {
      progress('checking')
      const context = repoLightContextReplySchema.parse(await get(base))
      const login = normalizeGitHubLogin(context.source.githubUsername)
      if (context.state !== 'ready') { finish('skipped', 'RepoLight is unavailable for this teacher.'); continue }
      if (!context.source.available || !context.source.repositoryUrl) { finish('skipped', 'A single eligible repository is required.'); continue }
      if (!login || !normalizeStudentGitHubLogin(context.source.githubUsername)) { finish('skipped', 'A valid GitHub username is required.'); continue }
      if (context.run && ['queued', 'submitting', 'running'].includes(context.run.status)) { finish('skipped', 'An analysis is already in progress; open the student report to continue it.'); continue }
      progress('analyzing')
      writeStarted = true
      let run = repoLightRunReplySchema.parse(await post(base, { requestId: newId(), ...(context.source.requirementId ? { requirementId: context.source.requirementId } : {}) })).run
      writeStarted = false
      const runId = run.id
      const deadline = now() + 180_000
      let polls = 0
      let pollDelay = 2000
      while (['queued', 'submitting', 'running'].includes(run.status)) {
        if (studentSignal.aborted) throw new DOMException('Cancelled', 'AbortError')
        if (++polls > 90 || now() >= deadline) { finish('failed', 'Analysis is still running. Open the student report to continue it.'); break }
        await wait(pollDelay, studentSignal)
        pollDelay = Math.min(15_000, Math.round(pollDelay * 1.5))
        run = repoLightRunReplySchema.parse(await get(`${base}/${runId}`)).run
        if (run.id !== runId) throw new Error('Run changed')
        if (run.canAdvance && ['queued', 'submitting', 'running'].includes(run.status)) {
          writeStarted = true
          run = repoLightRunReplySchema.parse(await post(`${base}/${runId}/advance`, {})).run
          writeStarted = false
          if (run.id !== runId) throw new Error('Run changed')
        }
      }
      if (results.length > index) continue
      if (run.status !== 'completed' || !run.sourceCurrent || !run.reportAvailable || !run.canImport) { finish('failed', 'Analysis failed or became stale. Open the student report for details.'); continue }
      const reply = repoLightReportReplySchema.parse(await get(`${base}/${runId}/report`))
      const summary = reply.report.assignmentSummary
      const selected = reply.report.bundle.selection
      if (reply.run.id !== runId || !reply.run.sourceCurrent || !reply.run.canImport || !summary || selected.status !== 'matched' || selected.requestedGithubLogin !== login || summary.scopeKey !== `contributor:${selected.contributorId}`) { finish('skipped', 'A current matching student summary is unavailable.'); continue }
      // The v1 summary contract expresses unavailable assignment dates/settings as this
      // fixed rule text rather than a structured status. Do not draft that non-finding.
      if (summary.text.startsWith('Assignment commit metrics are unavailable because ')) { finish('skipped', 'Assignment metrics are unavailable.'); continue }
      progress('importing')
      writeStarted = true
      const imported = repoLightImportResultSchema.parse(await post(`${base}/${runId}/import`, { requestId: newId(), scopeKey: summary.scopeKey, expectedDocUpdatedAt, expectedReportDigest: reply.report.reportDigest, feedbackText: summary.text }))
      writeStarted = false
      if (imported.doc.assignment_id !== assignmentId || imported.doc.student_id !== studentId) throw new Error('Wrong import target')
      finish('imported', 'Added to the private comment draft.')
    } catch {
      if (signal.aborted) finish('cancelled', writeStarted ? 'Stopped during a request. Check this student before retrying.' : 'Stopped. Check this student before retrying.')
      else finish('failed', writeStarted ? 'Request outcome is uncertain. Check this student before retrying.' : 'Could not complete this student. Open their repository review for details.')
    }
  }
  return results
}
