import { describe, expect, it } from 'vitest'
import { resolveAssignmentRepoLightSource, assignmentRepoLightRepositoryChoices } from '@/lib/server/assignment-repolight-source'
import { sourceFixture } from './adapter-fixtures'
const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
describe('report-only submission source', () => {
  it('uses the artifact without inferring owner identity and sends no Pika identities/content', () => {
    const source = sourceFixture()
    const resolved = resolveAssignmentRepoLightSource(source, {})
    expect(resolved.request.githubUsername).toBeUndefined()
    expect(resolved.request.scheduledProjectDates).toEqual(['2026-10-02'])
    expect(JSON.stringify(resolved.request)).not.toContain(uuid(5))
    expect(resolved.summary.usernameProvenance).toBe('none')
  })
  it('honors explicitly cleared and supplied usernames and saved teacher overrides', () => {
    const source = sourceFixture(); source.artifacts[0].metadata_json = { github_login: 'saved-login', github_login_selection: 'none' }
    expect(resolveAssignmentRepoLightSource(source, {}).request.githubUsername).toBeUndefined()
    expect(resolveAssignmentRepoLightSource(source, { analysisOptions: { githubUsername: 'explicit' } }).request.githubUsername).toBe('explicit')
    source.repo_target = { selected_repo_url: 'https://github.com/teacher/override', selection_mode: 'teacher_override', override_github_username: 'teacher-choice' }
    expect(resolveAssignmentRepoLightSource(source, { analysisOptions: { githubUsername: null } }).request.githubUsername).toBeUndefined()
    expect(resolveAssignmentRepoLightSource(source, {}).request.repositoryUrl).toBe('https://github.com/teacher/override')
  })
  it('requires explicit selection for multiple artifact requirements and preserves legacy explicit login', () => {
    const source = sourceFixture(); source.artifacts.push({ ...source.artifacts[0], id: uuid(11), requirement_id: uuid(12) })
    expect(() => resolveAssignmentRepoLightSource(source, {})).toThrow('repolight_requirement_required')
    expect(resolveAssignmentRepoLightSource(source, { requirementId: uuid(12) }).summary.requirementId).toBe(uuid(12))
    source.artifacts = []; source.doc.repo_url = 'https://github.com/owner/legacy'; source.doc.github_username = 'legacy-login'
    expect(resolveAssignmentRepoLightSource(source, {}).request.githubUsername).toBe('legacy-login')
  })
  it('offers only validated server-derived requirements and uses the selected choice for POST', () => {
    const source = sourceFixture()
    source.artifacts.push({ ...source.artifacts[0], id: uuid(11), requirement_id: uuid(12), url: 'https://github.com/second/project', metadata_json: { label: 'Untrusted student label' } })
    source.artifacts.push({ ...source.artifacts[0], id: uuid(13), requirement_id: uuid(14), url: 'https://attacker.test/repo' })
    expect(assignmentRepoLightRepositoryChoices(source)).toEqual([
      { requirementId: uuid(8), repositoryUrl: 'https://github.com/fictional-owner/assignment', label: 'fictional-owner/assignment' },
      { requirementId: uuid(12), repositoryUrl: 'https://github.com/second/project', label: 'second/project' },
    ])
    const selected = resolveAssignmentRepoLightSource(source, { requirementId: uuid(12) })
    expect(selected.request.repositoryUrl).toBe('https://github.com/second/project')
    expect(selected.summary.repositoryChoices).toHaveLength(2)
    expect(() => resolveAssignmentRepoLightSource(source, { requirementId: uuid(14) })).toThrow('repolight_requirement_unavailable')
    source.artifacts = source.artifacts.filter(artifact => artifact.requirement_id !== uuid(12))
    expect(() => resolveAssignmentRepoLightSource(source, { requirementId: uuid(12) })).toThrow('repolight_requirement_unavailable')
  })
  it('canonicalizes clone suffixes for artifact choices, legacy URLs and teacher overrides before persistence', () => {
    const source = sourceFixture(); source.artifacts[0].url = 'https://github.com/fictional-owner/assignment.git'
    expect(assignmentRepoLightRepositoryChoices(source)[0]).toEqual({ requirementId: uuid(8), repositoryUrl: 'https://github.com/fictional-owner/assignment', label: 'fictional-owner/assignment' })
    expect(resolveAssignmentRepoLightSource(source, {}).request.repositoryUrl).toBe('https://github.com/fictional-owner/assignment')
    source.artifacts = []; source.doc.repo_url = 'https://github.com/owner/legacy.git'
    expect(resolveAssignmentRepoLightSource(source, {}).request.repositoryUrl).toBe('https://github.com/owner/legacy')
    source.repo_target = { selected_repo_url: 'https://github.com/teacher/override.git', selection_mode: 'teacher_override', override_github_username: null }
    expect(resolveAssignmentRepoLightSource(source, {}).request.repositoryUrl).toBe('https://github.com/teacher/override')
    source.repo_target.selected_repo_url = 'https://github.com/teacher/override.git?download=1'
    expect(() => resolveAssignmentRepoLightSource(source, {})).toThrow()
  })
  it('rejects repeated clone suffixes without silently selecting a normalized alias or legacy fallback', () => {
    const source = sourceFixture()
    source.artifacts[0].url = 'https://github.com/fictional-owner/assignment.git.git'
    source.artifacts[0].metadata_json = { normalized_url: 'https://github.com/fictional-owner/assignment' }
    source.doc.repo_url = 'https://github.com/other/legacy'
    expect(assignmentRepoLightRepositoryChoices(source)).toEqual([])
    expect(() => resolveAssignmentRepoLightSource(source, {})).toThrow('repolight_repository_ambiguous')
    expect(() => resolveAssignmentRepoLightSource(source, { requirementId: uuid(8) })).toThrow('repolight_repository_ambiguous')
    source.artifacts.push({ ...source.artifacts[0], id: uuid(11), requirement_id: uuid(12), url: 'https://github.com/safe/explicit.git', metadata_json: {} })
    expect(resolveAssignmentRepoLightSource(source, { requirementId: uuid(12) }).request.repositoryUrl).toBe('https://github.com/safe/explicit')
    source.artifacts = []; source.doc.repo_url = 'https://github.com/owner/legacy.git.git.git'
    expect(() => resolveAssignmentRepoLightSource(source, {})).toThrow('repolight_repository_ambiguous')
    source.repo_target = { selected_repo_url: 'https://github.com/teacher/override.git.git', selection_mode: 'teacher_override', override_github_username: null }
    expect(() => resolveAssignmentRepoLightSource(source, {})).toThrow('repolight_repository_ambiguous')
  })
  it('uses 60 Toronto calendar dates through DST and refuses invented schedules or >366 days', () => {
    const source = sourceFixture(); source.assignment.released_at = null as unknown as string
    const result = resolveAssignmentRepoLightSource(source, {}, new Date('2026-11-02T18:00:00Z'))
    expect(result.summary.periodDefaulted).toBe(true)
    expect(result.request.period).toEqual({ startAt: '2026-09-04T04:00:00.000Z', endAt: '2026-11-03T05:00:00.000Z', timezone: 'America/Toronto' })
    expect(() => resolveAssignmentRepoLightSource(source, { analysisOptions: { scheduledProjectDates: ['2026-10-04'] } })).toThrow()
    expect(() => resolveAssignmentRepoLightSource(source, { analysisOptions: { period: { startAt: '2025-01-01T00:00:00Z', endAt: '2026-10-01T00:00:00Z', timezone: 'America/Toronto' } } })).toThrow()
  })
})
