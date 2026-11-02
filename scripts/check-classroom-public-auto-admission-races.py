#!/usr/bin/env python3
"""Exercise migration 297 in a private disposable PostgreSQL cluster only."""
import os
from concurrent.futures import ThreadPoolExecutor
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
bindir = Path(subprocess.check_output(['pg_config', '--bindir'], text=True).strip())

def run(cmd, **kw):
    return subprocess.run(cmd, check=True, text=True, capture_output=True, timeout=30, **kw)

with tempfile.TemporaryDirectory(prefix='pika-auto-admission-test-') as td:
    root = Path(td)
    data = root / 'pg'
    run([str(bindir / 'initdb'), '-D', str(data), '-A', 'trust', '--no-locale'])
    run([str(bindir / 'pg_ctl'), '-D', str(data), '-l', str(root / 'server.log'),
         '-o', f"-k {root} -c listen_addresses='' -p 55442", 'start'])
    env = {**os.environ, 'PGHOST': str(root), 'PGPORT': '55442', 'PGDATABASE': 'postgres'}
    psql = [str(bindir / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
    def sql(q):
        return run(psql + ['-c', q], env=env).stdout.strip()
    def fixture_op(kind, n, rev):
        return ("select public.commit_classroom_experience_admission_batch_v2("
                f"'00000000-0000-4000-8000-{n:012}',{rev},'{kind}',array[]::uuid[],array[]::uuid[],"
                f"private.classroom_experience_admission_manifest_v2('{kind}',array[]::uuid[],array[]::uuid[]),'test')")
    def wait_sleep():
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if sql("select count(*) from pg_stat_activity where application_name='pika_auto_race' and wait_event='PgSleep'") == '1':
                return
            time.sleep(.05)
        raise AssertionError('fixture did not hold lock')
    def start_lock(q, seconds=1.5):
        worker_env = {**env, 'PGAPPNAME': 'pika_auto_race'}
        worker = subprocess.Popen(psql + ['-c', 'begin; ' + q + f'; select pg_sleep({seconds}); commit'],
                                  env=worker_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        wait_sleep()
        return worker
    def finished(worker):
        out, err = worker.communicate(timeout=10)
        if worker.returncode:
            raise AssertionError(f'fixture worker failed: {err}')
        return out
    try:
        sql('create role anon; create role authenticated; create role service_role; create schema private; create schema extensions; create extension pgcrypto with schema extensions; create table public.users(id uuid primary key,email_verified_at timestamptz)')
        run(psql + ['-f', str(ROOT / 'supabase/migrations/294_classroom_experience_admission_registry.sql')], env=env)
        constraint = 'classroom_experience_admission_batches_check2'
        original = sql("select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.classroom_experience_admission_batches'::regclass and conname='" + constraint + "'")
        sql('alter table private.classroom_experience_admission_batches drop constraint ' + constraint + ', add constraint ' + constraint + " check ((kind <> 'bootstrap') or admitted_count >= 1)")
        drift = subprocess.run(psql + ['-f', str(ROOT / 'supabase/migrations/297_classroom_public_auto_admission.sql')], env=env, text=True, capture_output=True, timeout=30)
        assert drift.returncode != 0 and 'classroom_admission_batch_constraints_drift' in drift.stderr
        assert sql("select count(*) from pg_class where oid=to_regclass('private.classroom_public_auto_admission_policy')") == '0'
        sql('alter table private.classroom_experience_admission_batches drop constraint ' + constraint + ', add constraint ' + constraint + ' ' + original)
        run(psql + ['-f', str(ROOT / 'supabase/migrations/297_classroom_public_auto_admission.sql')], env=env)
        run(psql + ['-f', str(ROOT / 'scripts/check-classroom-public-auto-admission.sql')], env=env)
        sql("insert into public.users select ('e2970000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, now() from generate_series(1,74) n")
        sql("select public.commit_classroom_experience_admission_batch_v2('00000000-0000-4000-8000-000000000001',0,'bootstrap', array(select ('e2970000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,70) n), array[]::uuid[],private.classroom_experience_admission_manifest_v2('bootstrap',array(select ('e2970000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,70) n),array[]::uuid[]),'test')")
        sql(fixture_op('growth_on',2,1))
        sql('select public.set_classroom_auto_admission_enabled_v1(true)')
        actor = 'e2970000-0000-4000-8000-000000000071'
        first = start_lock(f"select public.ensure_verified_classroom_admission_v1('{actor}', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))")
        duplicate = sql(f"select public.ensure_verified_classroom_admission_v1('{actor}', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'outcome'")
        finished(first)
        assert duplicate == 'already_admitted', duplicate
        assert sql("select count(*) from private.classroom_experience_admission_grants where user_id='" + actor + "'") == '1'
        # Stop commits while a competing new admission waits: no grant after stop.
        stopper = start_lock(fixture_op('growth_off',3,3))
        stopped = sql("select public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'outcome'")
        finished(stopper)
        assert stopped == 'growth_stopped'
        sql(fixture_op('growth_on',4,4))
        assert sql("select public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'outcome'") == 'growth_stopped'
        sql('select public.set_classroom_auto_admission_enabled_v1(true)')
        # Grant holds the lock first; a competing stale-revision stop waits and still stops.
        grant = start_lock("select public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000073', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))")
        sql(fixture_op('growth_off',5,5))
        finished(grant)
        assert sql("select count(*) from private.classroom_experience_admission_grants where user_id='e2970000-0000-4000-8000-000000000073'") == '1'
        assert sql('select not growth_enabled from private.classroom_experience_admission_policy') == 't'
        assert sql('select not enabled from private.classroom_public_auto_admission_policy') == 't'
        # Bounded local smoke, not a production throughput benchmark. Wall time
        # includes psql process startup and the single local PostgreSQL instance.
        sql(fixture_op('growth_on',6,7))
        sql('select public.set_classroom_auto_admission_enabled_v1(true)')
        sql("insert into public.users select ('e2970000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, now() from generate_series(101,125) n")
        manifest = sql('select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy')
        bounded_env = {**env, 'PGOPTIONS': '-c statement_timeout=5000 -c lock_timeout=5000'}
        def admit(n):
            actor_id = f'e2970000-0000-4000-8000-{n:012}'
            query = f"select public.ensure_verified_classroom_admission_v1('{actor_id}','{manifest}')->>'outcome'"
            start = time.monotonic()
            result = run(psql + ['-c', query], env=bounded_env).stdout.strip()
            return result, (time.monotonic()-start)*1000
        start = time.monotonic()
        with ThreadPoolExecutor(max_workers=24) as pool:
            samples = list(pool.map(admit, range(101,125)))
        elapsed = time.monotonic()-start
        assert all(result == 'admitted' for result, _ in samples), samples
        timings = sorted(ms for _, ms in samples)
        p95 = timings[math.ceil(.95*len(timings))-1]
        # A server-side timeout while waiting on the policy row leaves no grant;
        # once the lock is released a new, explicit call can converge once.
        blocker = start_lock('select singleton from private.classroom_experience_admission_policy where singleton for update', seconds=5.6)
        actor_id = 'e2970000-0000-4000-8000-000000000125'
        query = f"select public.ensure_verified_classroom_admission_v1('{actor_id}','{manifest}')->>'outcome'"
        failure = subprocess.run(psql + ['-c', query], env=bounded_env, text=True, capture_output=True, timeout=10)
        assert failure.returncode != 0 and ('statement timeout' in failure.stderr or 'lock timeout' in failure.stderr)
        finished(blocker)
        assert sql("select count(*) from private.classroom_experience_admission_grants where user_id='" + actor_id + "'") == '0'
        assert run(psql + ['-c', query], env=bounded_env).stdout.strip() == 'admitted'
        assert run(psql + ['-c', query], env=bounded_env).stdout.strip() == 'already_admitted'
        print(f'PASS: isolated replay, ACL, races, 24 concurrent actors; '
              f'wall {elapsed:.3f}s, p95 {p95:.1f}ms, timeouts 0; forced 5s lock timeout recovered')
    finally:
        run([str(bindir / 'pg_ctl'), '-D', str(data), '-m', 'fast', 'stop'])
