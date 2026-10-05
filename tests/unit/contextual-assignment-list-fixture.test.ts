import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { AssertionError } from 'node:assert'
import { ApiError } from '../../src/lib/api-error'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListEphemeralPlan, validateAssignmentListEphemeralIdentity, assignmentListCanonicalFingerprintSql, runAssignmentListEphemeralLifecycle, assignmentListLifecycleDiagnostic } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import type { AssignmentListLifecycleAdapters, AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { decodeAssignmentListProofManifest } from '../../scripts/check-contextual-assignment-list-reads'
import { assignmentListRevocationPlans, observeAssignmentListRevocation } from '../../scripts/contextual-assignment-list-proof-revocations'

describe('isolated assignment-list fixture source contracts', () => {
  it('diagnoses revocation failures using only closed metadata, never error text or identities', () => {
    const error = new AssertionError({ actual: new ApiError(503, 'private-token@example.com'), expected: 'private', operator: 'rejects' })
    expect(assignmentListLifecycleDiagnostic({ stage: 'revocations', error, transition: 'owner-transfer', boundary: 'first' })).toBe('transition=owner-transfer boundary=first operator=rejects status=503 checkpoint=none')
    expect(assignmentListLifecycleDiagnostic({ stage: 'revocations', error: new Error('private-token@example.com'), transition: 'private-token@example.com', boundary: 'secret' })).toBe('transition=none boundary=none operator=none status=none checkpoint=none')
    expect(assignmentListLifecycleDiagnostic({ stage: 'revocations', error: new AssertionError({ message: 'restoration-scope', actual: false, expected: true, operator: '==' }) })).toBe('transition=none boundary=none operator=== status=none checkpoint=restoration-scope')
  })
  it('allocates exact independent synthetic identities and large expected collections', () => {
    const f = newAssignmentListProofFixture(new Date('2026-10-03T12:00:00Z'))
    const manifest = decodeAssignmentListProofManifest(f.manifest)
    expect(manifest.cases).toHaveLength(9)
    expect(f.students).toHaveLength(1001)
    expect(f.assignments).toHaveLength(1004)
    expect(f.requirements).toHaveLength(1001)
    expect(f.docs).toHaveLength(1002)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(manifest.cases[0].stats?.[0]).toMatchObject({ totalStudents: 1001, submitted: 1001 })
    expect(manifest.cases.some(c => c.actorId === manifest.actors[0].id && c.classroomId === manifest.classrooms[1].id && c.permission === 'member')).toBe(true)
  })
  it('produces one committed fixture transaction with intact168 and provider gates held off', () => {
    const f = newAssignmentListProofFixture()
    const sql = assignmentListFixtureSetupSql(f, `pika_assignment_list_${f.manifest.syntheticTag.slice(-12)}`)
    expect(sql).toMatch(/^begin;/)
    expect(sql.trim()).toMatch(/commit;$/)
    expect(sql).toContain('guard_pal_membership_evidence')
    expect(sql).toContain('student_provider_cleanup_settings')
    expect(sql).toContain('pal_classroom_signal_settings')
    expect(sql).not.toMatch(/disable\s+trigger|drop\s+trigger|session_replication_role|delete\s+from\s+private\.pal_membership_generations/i)
    expect(sql).not.toMatch(/net\.http_|storage\.|vault\.|cron\.schedule|set_effective_feature_entitlement/)
    expect(() => assignmentListFixtureSetupSql(f, 'pika')).toThrow()
  })
  it('keeps lifecycle source non-executing and proposes only one fresh isolated project', () => {
    const project = 'pika_assignment_list_abcdef123456'
    const plan = assignmentListEphemeralPlan({ projectId: project, workdir: assignmentListProofWorkdir(project) })
    expect(plan.apiUrl).toBe('http://127.0.0.1:54331')
    expect(plan.dbPort).toBe(54332)
    expect(plan.replayOwner).toBe('root')
    expect(plan.teardownOwner).toBe('root')
    expect(plan.requiredModes).toEqual(['normal', 'after-fixture', 'before-capture'])
    expect(plan.config).not.toContain('54321')
    expect(plan.config).not.toContain('54322')
    expect(plan.config).toContain('shadow_port = 54340')
    expect(plan.config).toContain('[analytics]\nenabled = false')
    expect(plan.config).toContain('[edge_runtime]\nenabled = false')
    expect(plan.config).toContain('project_id = "' + project + '"')
    expect(plan.reviewRequirements.join(' ')).toMatch(/named volumes/)
  })
  it.each(['pika', 'pika_assignment_list_ABCDEF123456', 'pika_assignment_list_abcdef', 'pika_assignment_list_abcdef123456;rm -rf /'])('rejects broad or malformed project identities %s', projectId => {
    expect(() => validateAssignmentListEphemeralIdentity({ projectId, workdir: '/private/tmp/pika-assignment-list-abcdef123456' })).toThrow()
  })
  it.each(['/', '/Users/stew/Repos/pika', '/Users/stew/.codex/worktrees/contextual-assignment-list-reads/pika', 'relative'])('rejects shared/broad/relative workdir %s', workdir => {
    expect(() => validateAssignmentListEphemeralIdentity({ projectId: 'pika_assignment_list_abcdef123456', workdir })).toThrow()
  })
  it('fingerprints every public/private/storage row without writing canonical persisted data', () => {
    const sql = assignmentListCanonicalFingerprintSql()
    expect(sql).toContain("n.nspname in ('public','private','storage')")
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/i)
    expect(sql).toContain('to_jsonb(r)')
    expect(sql).toContain('order by md5(to_jsonb(r)::text)')
    expect(sql).not.toMatch(/insert\s+into\s+(public|private|storage)\.|update\s+(public|private|storage)\.|delete\s+from|alter\s+table/i)
  })
  it('plans current first/later/terminal owner, enrollment, archive and visibility revocations plus return withdrawals', () => {
    const f = newAssignmentListProofFixture(); const plans = assignmentListRevocationPlans(f)
    expect(plans).toHaveLength(14)
    for (const transition of ['owner-transfer', 'member-remove', 'archive', 'visibility']) {
      expect(plans.filter(p => p.transition === transition).map(p => p.boundary)).toEqual(['first', 'later', 'terminal'])
    }
    for (const p of plans) {
      expect(p.revokeSql).toContain(`pika_assignment_list_${f.manifest.syntheticTag.slice(-12)}_fixture`)
      expect(p.revokeSql + p.restoreSql).not.toMatch(/disable\s+trigger|drop\s+trigger|session_replication_role|delete\s+from\s+private\.pal_membership_generations/i)
      expect(p.permittedFixtureEffects).not.toHaveLength(0)
    }
    const removals = plans.filter(p => p.transition === 'member-remove')
    expect(removals[1].revokeSql).toContain(f.replacementEnrollments[0].id)
    expect(removals[2].revokeSql).toContain(f.replacementEnrollments[1].id)
    expect(removals[0].restoreSql).toContain("state='removed'")
    expect(removals[0].restoreSql).toContain("state='active'")
  })
  it.each(['first', 'later', 'terminal'] as const)('installed SDK offline observer fires %s owner revocation and restoration', async boundary => {
    const f = newAssignmentListProofFixture(new Date('2026-10-03T12:00:00Z'))
    const plan = assignmentListRevocationPlans(f).find(p => p.transition === 'owner-transfer' && p.boundary === boundary)!
    let revoked = false
    const calls: URL[] = []
    const originalFetch = vi.fn(async (request: RequestInfo | URL) => {
      const url = new URL(String(request)); calls.push(url)
      const select = url.searchParams.get('select') ?? ''
      const root = { id: f.classes[0].id, teacher_id: f.classes[0].owner, archived_at: null }
      const cursor = url.searchParams.get('assignments.id')?.slice(3) ?? ''
      const rows = f.assignments.filter(a => a.classroom === root.id && a.id > cursor).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1000)
      const assignments = rows.map(a => ({ id: a.id, classroom_id: a.classroom, created_by: a.owner, title: a.title, description: '', due_at: f.manifest.now,
        position: a.position, created_at: f.manifest.now, updated_at: f.manifest.now, is_draft: a.isDraft, released_at: a.releasedAt,
        instructions_markdown: 'Synthetic', rich_instructions: null, artifact_id: a.id, source_artifact_id: null, source_blueprint_version_id: null,
        blueprint_archived_at: null, points_possible: 30, gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1,
        gradebook_weight: 1, include_in_final: true, track_authenticity: true }))
      const body = revoked ? null : select === 'id,teacher_id,archived_at' ? root : { ...root, feature_visibility: {}, ...(select.includes('assignments:') ? { assignments } : {}) }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const transition = vi.fn(async (sql: string) => { revoked = sql === plan.revokeSql })
    const verifyRestoration = vi.fn(async () => { expect(revoked).toBe(false) })
    const secret = `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature`
    await expect(observeAssignmentListRevocation({ fixture: f, plan,
      target: { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:private@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: secret },
      originalFetch, transition, verifyRestoration })).resolves.toMatchObject({ boundary, expectedStatus: 403 })
    expect(transition).toHaveBeenNthCalledWith(1, plan.revokeSql)
    expect(transition).toHaveBeenNthCalledWith(2, plan.restoreSql)
    expect(verifyRestoration).toHaveBeenCalledTimes(1)
    expect(calls.length).toBe(boundary === 'first' ? 3 : boundary === 'later' ? 4 : 5)
  })
})

describe('injected executable assignment-list lifecycle (no real commands)', () => {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  function harness(migrationCount = 243) {
    const fixture = newAssignmentListProofFixture(new Date('2026-10-03T12:00:00Z'))
    const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
    const workdir = assignmentListProofWorkdir(projectId)
    const resources: AssignmentListResource[] = [
      { kind: 'container', id: 'db-fresh', name: `supabase_db_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['volume-fresh', 'network-fresh'], ports: [54332] },
      { kind: 'container', id: 'kong-fresh', name: `supabase_kong_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['network-fresh'], ports: [54331] },
      { kind: 'volume', id: 'volume-fresh', name: `supabase_db_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['db-fresh'], ports: [] },
      { kind: 'network', id: 'network-fresh', name: `supabase_network_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['db-fresh', 'kong-fresh', 'auth-fresh', 'rest-fresh', 'storage-fresh'], ports: [] },
      { kind: 'container', id: 'auth-fresh', name: `supabase_auth_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['network-fresh'], ports: [] },
      { kind: 'container', id: 'rest-fresh', name: `supabase_rest_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['network-fresh'], ports: [] },
      { kind: 'container', id: 'storage-fresh', name: `supabase_storage_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['storage-volume-fresh', 'network-fresh'], ports: [] },
      { kind: 'volume', id: 'storage-volume-fresh', name: `supabase_storage_${projectId}`, createdAt: 'created-fresh', labels: { 'com.supabase.cli.project': projectId }, attachedIds: ['storage-fresh'], ports: [] },
    ]
    resources.forEach(r => { r.labels['com.docker.compose.project'] = projectId })
    let started = false
    const migrations = Array.from({ length: migrationCount }, (_, n) => {
      const sql = `-- OFFLINE synthetic migration ${n + 1}\nselect ${n + 1};`
      return { name: `${String(n + 1).padStart(3, '0')}_offline.sql`, sql, sha256: hash(sql) }
    })
    const canonical = { rowDigests: 'all public/private/storage rows', guard168Metadata: 'functions/triggers/RLS/ACL', settings: 'all settings', cronJobs: 'all jobs', resources: 'canonical identities' }
    const adapters: AssignmentListLifecycleAdapters = {
      canonicalSnapshot: vi.fn(async () => canonical),
      inventory: vi.fn(async () => ({ resources: started ? resources : [], occupiedPorts: started ? [54331, 54332] : [], workdirExists: false })),
      prepare: vi.fn(async plan => ({ workdir: plan.workdir, realpath: plan.workdir, created: true, configSha256: hash(plan.config), migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] })),
      command: vi.fn(async request => {
        if (request.args[0] === 'start') { started = true; return undefined }
        return { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:private@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` }
      }),
      verifyEphemeral: vi.fn(async () => ({ projectId, containerId: 'db-fresh', applicationName: `${projectId}_fixture`, dbPort: 54332 as const, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true })),
      executeSql: vi.fn(async () => undefined),
      runCase: vi.fn(async ({ proofCase }) => ({ actorId: proofCase.actorId, classroomId: proofCase.classroomId, status: proofCase.expectedStatus })),
      runRevocation: vi.fn(async ({ plan, executeSql, verifyRestoration }) => { await executeSql(plan.revokeSql); await executeSql(plan.restoreSql); await verifyRestoration(plan); return { transition: plan.transition, boundary: plan.boundary, expectedStatus: plan.expectedStatus } }),
      verifyRestoration: vi.fn(async () => ({ nonTargetBefore: 'same', nonTargetAfter: 'same', semanticRestored: true, changedCells: [] })),
      teardown: vi.fn(async () => { started = false }),
      removeWorkdir: vi.fn(async () => undefined),
    }
    const input = { fixture, projectId, workdir, migrations, expectedResources: resources.map(({ kind, name }) => ({ kind, name })), reviewedManifestSha256: hash(JSON.stringify(fixture.manifest)), restorationPolicies: assignmentListRevocationPlans(fixture).map(p => ({ transition: p.transition, boundary: p.boundary, allowedCells: [] })), mode: 'normal' as 'normal' | 'after-fixture' | 'before-capture' }
    return { input, adapters, resources, canonical, setStarted: (value: boolean) => { started = value } }
  }
  it.each([243, 246, 247])('runs nine cases and all14 transitions with %i migrations, then exact cleanup and canonical equality', async count => {
    const { input, adapters, resources } = harness(count)
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).resolves.toMatchObject({ cases: 9, revocations: 14, mode: 'normal' })
    expect(adapters.runCase).toHaveBeenCalledTimes(9)
    expect(adapters.runRevocation).toHaveBeenCalledTimes(14)
    expect(adapters.teardown).toHaveBeenCalledWith(expect.objectContaining({ resources, projectId: input.projectId, stopArgs: ['stop', '--project-id', input.projectId, '--no-backup'] }))
    expect(adapters.canonicalSnapshot).toHaveBeenCalledTimes(2)
    expect(adapters.command).toHaveBeenCalledWith(expect.objectContaining({ args: ['start', '--workdir', input.workdir, '-x', 'analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector'] }))
    expect(adapters.prepare).toHaveBeenCalledWith(expect.anything(), input.migrations)
  })
  it.each(['short baseline', 'gap', 'changed hash', 'duplicate', 'out of order', 'invalid name'] as const)('rejects a %s before any adapter operation', async defect => {
    const { input, adapters } = harness(246)
    if (defect === 'short baseline') input.migrations.splice(242)
    if (defect === 'gap') input.migrations.splice(123, 1)
    if (defect === 'changed hash') input.migrations[245].sql += '\n-- changed after selection'
    if (defect === 'duplicate') input.migrations[123] = { ...input.migrations[122] }
    if (defect === 'out of order') [input.migrations[123], input.migrations[124]] = [input.migrations[124], input.migrations[123]]
    if (defect === 'invalid name') input.migrations[245].name = '246_../escape.sql'
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toThrow()
    for (const adapter of Object.values(adapters)) expect(adapter).not.toHaveBeenCalled()
  })
  it.each(['missing tail', 'changed copied hash', 'extra migration'] as const)('rejects prepared %s before startup or fixture writes', async defect => {
    const { input, adapters } = harness(246)
    const prepare = adapters.prepare
    adapters.prepare = vi.fn(async (plan, migrations) => {
      const prepared = await prepare(plan, migrations)
      if (defect === 'missing tail') prepared.migrations.pop()
      if (defect === 'changed copied hash') prepared.migrations[245].sha256 = '0'.repeat(64)
      if (defect === 'extra migration') prepared.migrations.push({ name: '247_extra.sql', sha256: '0'.repeat(64) })
      return prepared
    })
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'prepare' }, cleanupFailures: [] })
    expect(adapters.command).not.toHaveBeenCalled()
    expect(adapters.executeSql).not.toHaveBeenCalled()
    expect(adapters.runCase).not.toHaveBeenCalled()
  })
  it.each(['after-fixture', 'before-capture'] as const)('captures in finally and cleans forced %s committed fixtures', async mode => {
    const { input, adapters } = harness(); input.mode = mode
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: expect.objectContaining({ stage: mode }), cleanupFailures: [] })
    expect(adapters.executeSql).toHaveBeenCalledTimes(1)
    expect(adapters.runCase).not.toHaveBeenCalled()
    expect(adapters.teardown).toHaveBeenCalledTimes(1)
    expect(adapters.canonicalSnapshot).toHaveBeenCalledTimes(2)
  })
  it('captures partial resources after unknown start outcome without masking primary failure', async () => {
    const { input, adapters, setStarted } = harness()
    adapters.command = vi.fn(async () => { setStarted(true); throw new Error('private start diagnostic') })
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'start' }, cleanupFailures: [] })
    expect(adapters.teardown).toHaveBeenCalledTimes(1)
  })
  it('never authorizes CLI stop for a partially created project', async () => {
    const { input, adapters, resources, setStarted } = harness()
    const partial = resources.filter(r => ['db-fresh', 'volume-fresh', 'network-fresh'].includes(r.id)).map(r => ({ ...r, attachedIds: r.attachedIds.filter(id => ['db-fresh', 'volume-fresh', 'network-fresh'].includes(id)) }))
    let afterStart = false; let cleaned = false
    adapters.inventory = vi.fn(async () => ({ resources: afterStart && !cleaned ? partial : [], occupiedPorts: afterStart && !cleaned ? [54332] : [], workdirExists: false }))
    adapters.command = vi.fn(async () => { afterStart = true; setStarted(true); throw new Error('unknown start outcome') })
    adapters.teardown = vi.fn(async () => { cleaned = true })
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'start' }, cleanupFailures: [] })
    expect(adapters.teardown).toHaveBeenCalledWith(expect.objectContaining({ resources: partial, stopArgs: null }))
  })
  it('reports both primary failure and cleanup uncertainty', async () => {
    const { input, adapters } = harness(); input.mode = 'after-fixture'
    adapters.teardown = vi.fn(async () => { throw new Error('private cleanup diagnostic') })
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'after-fixture' }, cleanupFailures: expect.arrayContaining([expect.objectContaining({ stage: 'teardown' }), expect.objectContaining({ stage: 'absence' })]) })
    expect(adapters.canonicalSnapshot).toHaveBeenCalledTimes(2)
    expect(adapters.removeWorkdir).not.toHaveBeenCalled()
  })
  it.each(['project', 'port', 'workdir'] as const)('rejects preexisting %s before preparation/start/deletion', async collision => {
    const { input, adapters, resources } = harness()
    adapters.inventory = vi.fn(async () => ({ resources: collision === 'project' ? resources : [], occupiedPorts: collision === 'port' ? [54340] : [], workdirExists: collision === 'workdir' }))
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'preflight' } })
    expect(adapters.prepare).not.toHaveBeenCalled(); expect(adapters.command).not.toHaveBeenCalled(); expect(adapters.teardown).not.toHaveBeenCalled()
  })
  it('refuses cleanup when fresh resources have foreign attachments', async () => {
    const { input, adapters, resources } = harness(); resources[2].attachedIds.push('real-other-container')
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ cleanupFailures: expect.arrayContaining([expect.objectContaining({ stage: 'capture' })]) })
    expect(adapters.teardown).not.toHaveBeenCalled()
  })
  it.each(['com.supabase.cli.project', 'com.docker.compose.project'])('refuses unlabelled/foreign resources on %s', async label => {
    const { input, adapters, resources } = harness(); delete resources[2].labels[label]
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'capture' } })
    expect(adapters.teardown).not.toHaveBeenCalled()
  })
  it('refuses a resource recreated under the same volume name/ID', async () => {
    const { input, adapters, resources } = harness()
    adapters.runCase = vi.fn(async ({ proofCase }) => { resources[2].createdAt = 'recreated'; return { actorId: proofCase.actorId, classroomId: proofCase.classroomId, status: proofCase.expectedStatus } })
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ cleanupFailures: expect.arrayContaining([expect.objectContaining({ stage: 'capture' })]) })
    expect(adapters.teardown).not.toHaveBeenCalled()
  })
  it('rejects uncertain/wrong database identity before fixture writes', async () => {
    const { input, adapters } = harness()
    adapters.verifyEphemeral = vi.fn(async () => ({ projectId: input.projectId, containerId: 'canonical-db', applicationName: `${input.projectId}_fixture`, dbPort: 54332 as const, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true }))
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'fixture' }, cleanupFailures: [] })
    expect(adapters.executeSql).not.toHaveBeenCalled()
  })
  it.each(['guard168Enabled', 'persistedGatesOff', 'activeNetworkCronAbsent'] as const)('rejects %s=false before writes', async gate => {
    const { input, adapters } = harness(); const original = adapters.verifyEphemeral
    adapters.verifyEphemeral = vi.fn(async request => ({ ...await original(request), [gate]: false }))
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'fixture' } })
    expect(adapters.executeSql).not.toHaveBeenCalled()
  })
  it.each(['nonTargetAfter', 'semanticRestored', 'changedCells'] as const)('rejects unproven restoration %s', async field => {
    const { input, adapters } = harness()
    adapters.verifyRestoration = vi.fn(async () => ({ nonTargetBefore: 'same', nonTargetAfter: field === 'nonTargetAfter' ? 'different' : 'same', semanticRestored: field !== 'semanticRestored', changedCells: field === 'changedCells' ? [{ schema: 'public' as const, table: 'classrooms', id: input.fixture.classes[0].id, columns: ['unexpected_column'] }] : [] }))
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'revocations' }, cleanupFailures: [] })
  })
  it('fails if canonical metadata changes even when teardown succeeds', async () => {
    const { input, adapters, canonical } = harness()
    adapters.canonicalSnapshot = vi.fn().mockResolvedValueOnce(canonical).mockResolvedValueOnce({ ...canonical, guard168Metadata: 'changed' })
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ cleanupFailures: expect.arrayContaining([expect.objectContaining({ stage: 'canonical-after' })]) })
  })
  it('rejects unreviewed migration bytes before any adapter call', async () => {
    const { input, adapters } = harness(); input.migrations[0].sql += ' select 2;'
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toThrow()
    expect(adapters.canonicalSnapshot).not.toHaveBeenCalled()
  })
  it('retains preparation failure and unchanged canonical evidence after native owned-directory cleanup', async () => {
    const { input, adapters } = harness()
    const failure = new Error('Synthetic partial preparation failure')
    adapters.prepare = vi.fn(async () => { throw failure })
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toMatchObject({ primary: { stage: 'prepare', error: failure }, cleanupFailures: [] })
    expect(adapters.canonicalSnapshot).toHaveBeenCalledTimes(2)
    expect(adapters.command).not.toHaveBeenCalled(); expect(adapters.teardown).not.toHaveBeenCalled(); expect(adapters.removeWorkdir).not.toHaveBeenCalled()
  })
  it('rejects broad restoration allowances even for another captured fixture classroom', async () => {
    const { input, adapters } = harness()
    const policy = input.restorationPolicies[0] as { allowedCells: { schema: 'public'; table: string; id: string; columns: string[] }[] }
    policy.allowedCells = [{ schema: 'public', table: 'classrooms', id: input.fixture.classes[1].id, columns: ['teacher_id'] }]
    await expect(runAssignmentListEphemeralLifecycle(input, adapters)).rejects.toThrow()
    expect(adapters.canonicalSnapshot).not.toHaveBeenCalled()
  })
})
