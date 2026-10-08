import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListSnapshotSql, createAssignmentListNativeAdapters } from '../../scripts/contextual-assignment-list-proof-platform'

vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: vi.fn() }))
afterEach(() => vi.resetAllMocks())

describe('native ephemeral safety snapshot scope (offline command seam)', () => {
  function platform() {
    const fixture = newAssignmentListProofFixture(); const project = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
    const containers = ['pika', project].map((name, n) => ({ id: String(n + 1).padStart(64, '0'), name: `/supabase_db_${name}`,
      labels: { 'com.supabase.cli.project': name, 'com.docker.compose.project': name }, mounts: [], networks: {},
      bindings: { '5432/tcp': [{ HostPort: name === 'pika' ? '54322' : '54332' }] }, created: 'created' }))
    const sql: string[] = []
    const evidence = { gates: { guard: true, off: true, no_work: true, no_secrets: true },
      cron: [{ active: true, jobname: 'pika-test-ai-grading-watchdog', command: 'select private.watchdog_test_ai_grading_runs()' }] }
    vi.mocked(execFile).mockImplementation(((file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      expect(file).toBe('docker')
      return { stdin: { on() {}, end(input?: string) {
        let output = ''
        if (args[0] === 'ps') output = containers.map(row => row.id).join('\n')
        else if (args[0] === 'inspect') output = containers.map(row => JSON.stringify(row)).join('\n')
        else if (args[0] === 'exec') {
          expect(typeof input).toBe('string'); sql.push(input!)
          if (input!.includes("jsonb_build_object('guard'")) output = JSON.stringify(evidence.gates)
          else output = [
            ...(input!.includes("''table''") ? [JSON.stringify({ table: 'public.users', rows: { count: 0, digest: 'empty' } })] : []),
            JSON.stringify({ metadata: { guard: 'original metadata' } }), JSON.stringify({ cron: evidence.cron }),
          ].join('\n')
        } else expect(args[1]).toBe('ls')
        callback(null, output, '')
      } } }
    }) as unknown as typeof execFile)
    const request = { projectId: project, dbPort: 54332, applicationName: `${project}_fixture`, target: {} } as never
    return { fixture, project, request, sql, evidence }
  }
  it('keeps full snapshots by default and for canonical baselines while opting ephemeral guards into metadata', async () => {
    const f = platform(); const defaults = createAssignmentListNativeAdapters(f.fixture); const pilot = createAssignmentListNativeAdapters(f.fixture, { ephemeralSnapshot: 'metadata' })
    const before = await defaults.verifyEphemeral(f.request); expect(f.sql.at(-1)).toBe(assignmentListSnapshotSql('digests'))
    const after = await pilot.verifyEphemeral(f.request); expect(after).toEqual(before); expect(f.sql.at(-1)).toBe(assignmentListSnapshotSql('metadata'))
    await pilot.canonicalSnapshot({} as never); expect(f.sql.at(-1)).toBe(assignmentListSnapshotSql('digests'))
    expect(() => createAssignmentListNativeAdapters(f.fixture, { ephemeralSnapshot: 'rows' as never })).toThrow()
  })
  it('retains the same fail-closed gate and scheduler outcomes across both snapshot scopes', async () => {
    const f = platform(); const defaults = createAssignmentListNativeAdapters(f.fixture); const pilot = createAssignmentListNativeAdapters(f.fixture, { ephemeralSnapshot: 'metadata' })
    for (const gate of ['guard', 'off', 'no_work', 'no_secrets'] as const) {
      f.evidence.gates[gate] = false
      const before = await defaults.verifyEphemeral(f.request); expect(await pilot.verifyEphemeral(f.request)).toEqual(before)
      expect(before[gate === 'guard' ? 'guard168Enabled' : gate === 'off' ? 'persistedGatesOff' : 'activeNetworkCronAbsent']).toBe(false)
      f.evidence.gates[gate] = true
    }
    f.evidence.cron = [{ active: true, jobname: 'unapproved', command: 'select net.http_post()' }]
    expect(await pilot.verifyEphemeral(f.request)).toEqual(await defaults.verifyEphemeral(f.request))
    expect((await pilot.verifyEphemeral(f.request)).activeNetworkCronAbsent).toBe(false)
  })
})
