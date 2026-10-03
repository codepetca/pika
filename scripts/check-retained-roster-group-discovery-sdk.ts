/** Read-only installed-SDK/null-argument/ACL proof; no fixture or paging claim.
 * Execute only after fixed-source review and local239 application.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '../src/types/database'
import { parseLockProofArgs, RETAINED_GROUP_PROOF_FINGERPRINT_SQL, validateLocalTarget } from './check-retained-roster-group-locks-database'

type Execute = (file: string, args: string[], input?: string) => string
const execute: Execute = (file, args, input) => execFileSync(file, args, {
  input, encoding: 'utf8', timeout: 65_000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
})
const identity = z.object({ teacher_id: z.string().uuid(), classroom_id: z.string().uuid() }).strict()
const page = z.object({
  schema_version: z.literal(1), teacher_id: z.string().uuid(), classroom_id: z.string().uuid(),
  student_id: z.null(), after_student_id: z.null(), include_unreserved: z.literal(false),
  targets: z.array(z.never()).length(0), target_count: z.literal(0), next_student_id: z.null(),
  snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
const statusSchema = z.object({ API_URL: z.literal('http://127.0.0.1:54321'),
  DB_URL: z.string(), SERVICE_ROLE_KEY: z.string().min(1), ANON_KEY: z.string().min(1) })

export async function runRetainedCleanupDiscoverySdkProof(options: {
  execute?: Execute; fetch?: typeof fetch; forceFailure?: boolean; receipt?: (message: string) => void
} = {}): Promise<{ emptyOwnerRead: boolean }> {
  const command = options.execute ?? execute
  const project = command('docker', ['inspect', 'supabase_db_pika', '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'])
  const ports = command('docker', ['port', 'supabase_db_pika', '5432/tcp'])
  const rawStatus = command('supabase', ['status', '-o', 'json'])
  validateLocalTarget({ project, ports, status: rawStatus })
  const status = statusSchema.parse(JSON.parse(rawStatus))
  const application = `pika_rg_sdk_${randomUUID().replaceAll('-', '')}`
  const sql = (input: string) => command('docker', ['exec', '-i', '-e', `PGAPPNAME=${application}`, 'supabase_db_pika',
    'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
  `set statement_timeout='60s'; set lock_timeout='3s'; ${input}`)
  sql(`do $proof$ begin
    if not exists(select 1 from supabase_migrations.schema_migrations where version='239')
      or coalesce((select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton),false)
      or coalesce((select enabled from private.removed_student_academic_settings where singleton),false) then
      raise exception 'Reviewed239 and disabled cleanup settings required'; end if;
  end; $proof$;`)
  const baseline = sql(RETAINED_GROUP_PROOF_FINGERPRINT_SQL).trim()
  if (!baseline || baseline.split(/\r?\n/).some(line => !z.record(z.string(), z.unknown()).safeParse(JSON.parse(line)).success))
    throw new Error('Private baseline invalid')
  try {
    // Existing state only: no enrollment, retirement ledger or invitation fixture.
    const candidates = identity.array().max(1).parse(JSON.parse(sql(`select coalesce(jsonb_agg(
      jsonb_build_object('teacher_id',c.teacher_id,'classroom_id',c.id)),'[]'::jsonb) from (
        select id,teacher_id from public.classrooms where archived_at is null and not exists(
          select 1 from public.classroom_roster r where r.classroom_id=classrooms.id and r.removed_at is not null)
        order by id limit 1) c;`).trim()))
    const scope = candidates[0] ?? { teacher_id: randomUUID(), classroom_id: randomUUID() }
    const localFetch: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== status.API_URL || url.pathname !== '/rest/v1/rpc/discover_retained_student_cleanup_groups'
        || url.search || url.hash || url.username || url.password || init?.method !== 'POST') throw new Error('Local SDK request rejected')
      const args = z.object({ p_teacher_id: z.string().uuid(), p_classroom_id: z.literal(scope.classroom_id),
        p_student_id: z.null(), p_after_student_id: z.null(), p_include_unreserved: z.literal(false), p_snapshot_sha256: z.null() }).strict()
        .parse(JSON.parse(String(init.body)))
      if (![scope.teacher_id, wrongOwner].includes(args.p_teacher_id)) throw new Error('Local SDK actor rejected')
      const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
      return (options.fetch ?? fetch)(input, { ...init, redirect: 'error', signal })
    }
    const wrongOwner = randomUUID()
    const make = (key: string) => createClient<Database>(status.API_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: localFetch },
    })
    const service = make(status.SERVICE_ROLE_KEY)
    const args: Database['public']['Functions']['discover_retained_student_cleanup_groups']['Args'] = {
      p_teacher_id: scope.teacher_id, p_classroom_id: scope.classroom_id, p_student_id: null,
      p_after_student_id: null, p_include_unreserved: false, p_snapshot_sha256: null,
    }
    const admitted = await service.rpc('discover_retained_student_cleanup_groups', args)
    const decoded = page.safeParse(admitted.data)
    if (candidates.length ? admitted.error || !decoded.success || decoded.data.teacher_id !== scope.teacher_id
      || decoded.data.classroom_id !== scope.classroom_id
      : admitted.data !== null || admitted.error?.code !== '42501') throw new Error('Installed SDK owner result differs')
    if (options.forceFailure) throw new Error('FORCED_RETAINED_SDK_PROOF_FAILURE')
    const deniedOwner = await service.rpc('discover_retained_student_cleanup_groups', { ...args, p_teacher_id: wrongOwner })
    const deniedAnonymous = await make(status.ANON_KEY).rpc('discover_retained_student_cleanup_groups', args)
    if (deniedOwner.data !== null || deniedOwner.error?.code !== '42501'
      || deniedAnonymous.data !== null || deniedAnonymous.error?.code !== '42501') throw new Error('Installed SDK ACL denial differs')
    return { emptyOwnerRead: candidates.length === 1 }
  } finally {
    if (sql(RETAINED_GROUP_PROOF_FINGERPRINT_SQL).trim() !== baseline) throw new Error('Canonical local baseline changed')
    options.receipt?.('PASS retained cleanup SDK unchanged local baseline.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => runRetainedCleanupDiscoverySdkProof({
    ...parseLockProofArgs(process.argv.slice(2)), receipt: message => process.stdout.write(`${message}\n`),
  })).then(result => process.stdout.write(result.emptyOwnerRead
    ? 'PASS retained cleanup real SDK empty-owner RPC, null arguments and anonymous ACL; no fixture/paging claim.\n'
    : 'PASS retained cleanup real SDK empty-database owner denial, null arguments and anonymous ACL; no fixture/paging claim.\n'))
    .catch(error => {
      process.stderr.write(error instanceof Error && error.message === 'FORCED_RETAINED_SDK_PROOF_FAILURE'
        ? 'FAIL forced retained cleanup SDK proof.\n' : 'FAIL retained cleanup SDK proof; captured target/SQL/API data withheld.\n')
      process.exitCode = 1
    })
}
