import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Existing local Pika, two connections, no committed fixtures or schema writes.
// This tests contention at the real RPC/producer lock boundary. It does not
// substitute for a committed-row MVCC claim/removal race rehearsal.
const container = 'supabase_db_pika'
const label = execFileSync('docker', ['inspect', container, '--format',
  '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim()
if (label !== 'pika') throw new Error('Unexpected local database target')

function connection() {
  const process = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres',
    '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { stdio: 'pipe' })
  let serial = 0
  let pending
  let output = ''
  let errors = ''
  process.stdout.on('data', data => {
    output += data.toString()
    if (pending && output.includes(`${pending.marker}\n`)) {
      const current = pending
      pending = undefined
      current.resolve(output)
      output = ''
    }
  })
  process.stderr.on('data', data => { errors += data.toString() })
  process.on('error', error => pending?.reject(error))
  process.on('exit', code => pending?.reject(new Error(`Local SQL exited ${code}: ${errors}`)))
  return {
    run(sql) {
      if (pending) throw new Error('Connection already has a query')
      return new Promise((resolve, reject) => {
        const marker = `fixture171_done_${++serial}`
        pending = { marker, resolve, reject }
        process.stdin.write(`${sql}\n\\echo ${marker}\n`)
      })
    },
    close() { process.stdin.end() },
    kill() { process.kill() },
  }
}

const holder = connection()
const contender = connection()
const timeout = setTimeout(() => { holder.kill(); contender.kill() }, 30_000)
try {
  const path = fileURLToPath(new URL('./check-student-provider-cleanup-database.sql', import.meta.url))
  const fixture = readFileSync(path, 'utf8')
  if (!/rollback;\s*$/i.test(fixture)) throw new Error('Fixture must end with rollback')
  await holder.run(fixture.replace(/rollback;\s*$/i, ''))
  const teacher = "'c1710000-0000-4000-8000-000000000001'::uuid"
  const student = "'c1710000-0000-4000-8000-000000000002'::uuid"
  const classroom = "'c1710000-0000-4000-8000-000000000010'::uuid"
  const generation = "'c1710000-0000-4000-8000-000000000020'::uuid"
  const checks = [
    `perform public.reserve_student_provider_cleanup(gen_random_uuid(),${teacher},${classroom},${student},${generation});`,
    `insert into public.managed_storage_provisional_owners(owner_kind,target_classroom_id,operation_id,created_by_user_id,expires_at)
      values('restore_copy',${classroom},gen_random_uuid(),${teacher},clock_timestamp()+interval '1 day');`,
    `perform public.resolve_attendance_scan_generation(${classroom},${student});`,
    `perform public.enqueue_attendance_outbound_message_v1(${classroom},'{}'::jsonb);`,
    `perform public.remove_classroom_students_preserving_data(${teacher},${classroom},array['c1710000-0000-4000-8000-000000000030'::uuid]);`,
  ]
  for (const sql of checks) {
    await contender.run(`begin; set local statement_timeout='3s'; do $$ begin
      begin ${sql} raise exception 'Contending operation unexpectedly passed';
      exception when sqlstate '40001' then
        if sqlerrm<>'classroom_operation_busy' then raise; end if;
      end;
    end $$; rollback;`)
  }
  await holder.run('rollback;')
  // Verify lock release and absence of the synthetic fixture after rollback.
  await contender.run(`begin; do $$ begin
    perform private.try_lock_classroom_membership_change(${classroom},${student});
    if exists(select 1 from public.users where id=${teacher}) then
      raise exception 'Synthetic fixture survived rollback';
    end if;
  end $$; rollback;`)
  console.log('PASS: five real cross-connection lock conflicts; rollback and lock release verified.')
} finally {
  clearTimeout(timeout)
  holder.close()
  contender.close()
}
