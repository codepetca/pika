import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const harness = readFileSync('scripts/check-contextual-course-guide-read.ts', 'utf8')
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const stepName = 'Verify contextual Course Guide SDK reads and exact failed-fixture cleanup'
const step = workflow.split(`name: ${stepName}`)[1]?.split('\n      - name:')[0] ?? ''
const shell = step.split('run: |\n')[1]?.split('\n').map(line => line.replace(/^ {10}/, '')).join('\n') ?? ''
const command = 'pnpm exec tsx scripts/check-contextual-course-guide-read.ts'
const normalMarkers = [
  'PASS course guide actual SDK mixed-role authority, genuine resource FK, both collections beyond 1000, terminal pages and millisecond release precision',
  'PASS course guide real SDK wire tampering, cardinality, cursor, resource/config bounds and transport failures deny without retries or partial DTO',
  'PASS course guide actual-site JSONB null/scalar/default/semantic equality, legal member feature controls and constraint denial, hidden projections, resource compatibility and current member syllabus',
  'PASS course guide committed owner/archive/enrollment/config/visibility/syllabus revocations before header, first/later/terminal pages and final control deny all partial output',
]
const cleanupMarker = 'PASS exact synthetic course guide cleanup, zero residual rows and global whole-row baseline counts'
const forced = [
  { flag: '--verify-cleanup-after-fixture', marker: 'FAIL Forced course guide post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)' },
  { flag: '--verify-cleanup-after-commit-before-capture', marker: 'FAIL Forced course guide post-commit pre-capture cleanup proof (expected for --verify-cleanup-after-commit-before-capture)' },
]

/** Execute only the CI shell gate against an inline stub; never run the database harness. */
function simulateGate(variant: string) {
  const output = (lines: string[]) => `printf '%s\\n' ${lines.map(line => `'${line}'`).join(' ')}`
  const normal = variant === 'missing-normal-marker' ? normalMarkers.slice(1) : normalMarkers
  const fake = `course_guide_stub() {
    if [[ "$#" -eq 0 ]]; then
      ${output([...normal, cleanupMarker])}
      return 0
    fi
    case "$1" in
      ${forced.map(({ flag, marker }) => `${flag})
        ${output([variant === 'wrong-forced-marker' ? 'FAIL unrelated transport failure' : marker, ...(variant === 'missing-forced-cleanup' ? [] : [cleanupMarker])])}
        return ${variant === 'successful-forced-run' ? 0 : variant === 'wrong-forced-exit' ? 2 : 1}
        ;;`).join('\n')}
      *) return 2 ;;
    esac
  }`
  const stubbed = shell.replaceAll(command, 'course_guide_stub')
  expect(stubbed).not.toContain(command)
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', `${fake}\n${stubbed}`], { encoding: 'utf8' }).status
}

describe('CourseGuide local SDK proof and CI registration (source only)', () => {
  it('binds the installed SDK to the exact local project/API/database before synthetic writes', () => {
    expect(harness).toContain("const container = 'supabase_db_pika'")
    expect(harness).toContain('com.supabase.cli.project')
    expect(harness).toContain("z.literal('http://127.0.0.1:54321')")
    expect(harness).toContain("u.port==='54322'&&u.pathname==='/postgres'")
    expect(harness).toContain('createClient<Database>')
    expect(harness).not.toMatch(/supabase.*(?:db reset|db push|migration up)|session_replication_role/i)
  })
  it('grants only synthetic ownership-transfer fixtures capacity without bypassing the creation guard', () => {
    expect(harness).toContain('const grants=[ownerStudent,ownerTeacher,outsider].map')
    expect(harness).toContain("public.set_effective_feature_entitlement_v1(op,u,'classrooms.create','manual'")
    expect(harness).toContain("a.actor_ref='test:course-guide-read' and a.reason_code=${q(tag)}")
    expect(harness).not.toMatch(/disable trigger enforce_classroom_creation|set_config\([^\n]*entitlement/i)
  })
  it('locks real wire shape, old resource FK, Zod clone rebind, authority/config and publication predicates', () => {
    for (const token of [
      'body[0]=root', 'Actual maybeSingle SDK wire array', 'Exact projection; hidden data never selected',
      'classroom_materials_classroom_id_fkey', 'membership.student_id', 'membership.classroom_id',
      'actual_site_config', 'feature_visibility', 'released_at.lt.${releaseExclusive}',
      "assert(!or.includes('released_at.lte.'))", 'No query retries/fallback',
      'Revoked statement returns no root or unauthorized payload at the actual wire boundary',
    ]) expect(harness).toContain(token)
  })
  it('retains tampered wire checks for cardinality, resource size, relationship, publication and backward cursor', () => {
    for (const token of [
      'r.resources=[r.resources]', 'r.resources=changed', "changed.content='x'.repeat(2*1024*1024+1)",
      'b.push(structuredClone(r))', 'r.membership=[]', 'c.released_at=nextMillisecond',
      'a.reverse();r.assignments=a', "c.status='draft'", "delete r.feature_visibility",
      'await assert.rejects(read(test.actor??ownerStudent,classA,observed.client),statusIs(test.status??503))',
    ]) expect(harness).toContain(token)
  })
  it('retains full-row baseline and exact fixture residual checks through both forced cleanup boundaries', () => {
    expect(harness).toContain('to_jsonb(r)::text')
    expect(harness).toContain('guide_fixture_ids')
    expect(harness).toContain('pg_temp.guide_residual()<>0 or pg_temp.guide_fingerprint() is distinct from')
    expect(harness).toContain('assert.deepEqual(fingerprint(),baseline)')
    for (const { flag, marker } of forced) {
      expect(harness).toContain(`process.argv.includes('${flag}')`)
      expect(harness).toContain(marker)
    }
    const earlyFailure = harness.indexOf("if(process.argv.includes('--verify-cleanup-after-commit-before-capture'))")
    expect(earlyFailure).toBeGreaterThan(0)
    expect(earlyFailure).toBeLessThan(harness.indexOf('capturedGenerations=row('))
    expect(harness).toContain('process.exitCode=1')
    expect(harness).toContain(cleanupMarker)
  })
  it('respects the installed feature shape constraint instead of manufacturing invalid persisted fixtures', () => {
    const persisted = harness.split('for(const rawFeature of [')[1]?.split("process.stdout.write('CHECK course guide feature constraint denial")[0] ?? ''
    expect(persisted).toContain('{}, {syllabus:true}')
    expect(persisted).not.toContain('historical feature scalar')
    for (const token of [
      'exception when check_violation then',
      'get stacked diagnostics violated=constraint_name,failure_state=returned_sqlstate',
      "violated is distinct from 'classrooms_feature_visibility_shape_check'",
      "failure_state is distinct from '23514'",
      "errcode='ZX205'",
      'Expected feature constraint denial must preserve every whole row',
      'assert.deepEqual(fingerprint(),denialBaseline',
      'is distinct from original',
    ]) expect(harness).toContain(token)
    expect(harness).not.toMatch(/alter\s+table[\s\S]{0,80}(?:drop|disable)\s+constraint/i)
  })
  it('registers exactly one bash step with safe log cleanup and valid shell syntax', () => {
    expect(workflow.split(`name: ${stepName}`)).toHaveLength(2)
    expect(step).toContain('shell: bash')
    expect(shell).toContain('course_guide_log="$(mktemp)"')
    expect(shell).toContain('trap \'rm -f -- "$course_guide_log"\' EXIT')
    expect(shell).not.toContain('rg -F')
    expect(shell).not.toMatch(/set \+e|\|\| true/)
    expect(shell.length).toBeGreaterThan(0)
    expect(spawnSync('bash', ['-n'], { input: shell, encoding: 'utf8' }).status).toBe(0)
  })
  it('requires all four exact normal proof markers and cleanup before either forced run', () => {
    expect(shell).toContain(`${command} > "$course_guide_log" 2>&1`)
    const normal = shell.split(`${command} --verify-cleanup-after-fixture`)[0]
    for (const marker of [...normalMarkers, cleanupMarker]) {
      expect(harness).toContain(marker)
      expect(normal).toContain(`grep -Fx '${marker}' "$course_guide_log"`)
    }
  })
  it.each(forced)('requires exact exit 1, its own $flag marker and cleanup', ({ flag, marker }) => {
    const position = shell.indexOf(`${command} ${flag}`)
    expect(position).toBeGreaterThan(0)
    const block = shell.slice(position).split('\ncleanup_status=0')[0]
    expect(shell.slice(0, position).trimEnd()).toMatch(/cleanup_status=0$/)
    expect(block).toContain('|| cleanup_status=$?')
    expect(block).toContain('[[ "$cleanup_status" -eq 1 ]] || exit 1')
    expect(block).toContain(`grep -Fx '${marker}' "$course_guide_log"`)
    expect(block).toContain(`grep -Fx '${cleanupMarker}' "$course_guide_log"`)
    expect(block).not.toContain("grep -F 'Error: Forced post-fixture cleanup proof'")
  })
  it('accepts complete normal and exact forced shell evidence without running the database proof', () => {
    expect(simulateGate('complete')).toBe(0)
  })
  it.each(['missing-normal-marker', 'wrong-forced-marker', 'wrong-forced-exit', 'successful-forced-run', 'missing-forced-cleanup'])('rejects incomplete/unrelated shell evidence: %s', variant => {
    expect(simulateGate(variant)).not.toBe(0)
  })
})
