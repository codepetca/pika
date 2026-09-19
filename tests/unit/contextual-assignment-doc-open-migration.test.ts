import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/182_contextual_assignment_doc_open.sql',
  'utf8',
)

describe('contextual assignment document open migration', () => {
  it('is a service-only security-definer boundary with an empty search path', () => {
    const sql = migration()
    expect(sql).toContain('function public.open_assignment_doc_for_member_v1(')
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(
      /revoke all on function public\.open_assignment_doc_for_member_v1\([^;]+from public, anon, authenticated/s,
    )
    expect(sql).toMatch(
      /grant execute on function public\.open_assignment_doc_for_member_v1\([^;]+to service_role/s,
    )
  })

  it('rechecks visibility and exact membership after taking the removal fences', () => {
    const sql = migration()
    const body = sql.split('function public.open_assignment_doc_for_member_v1(')[1]
      .split('$function$;')[0]
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const membershipLock = body.indexOf('private.try_lock_classroom_membership_change')
    const parentLocks = body.indexOf('for update of classroom, assignment')
    const visibility = body.indexOf('or v_assignment_is_draft', parentLocks)
    const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')
    const documentWrite = body.indexOf('insert into public.assignment_docs')

    expect(classroomLock).toBeGreaterThan(-1)
    expect(classroomLock).toBeLessThan(membershipLock)
    expect(membershipLock).toBeLessThan(parentLocks)
    expect(parentLocks).toBeLessThan(visibility)
    expect(visibility).toBeLessThan(enrollment)
    expect(enrollment).toBeLessThan(documentWrite)
    expect(body).toContain('v_assignment_classroom_id is distinct from v_initial_classroom_id')
    expect(body).toContain('v_archived_at is not null')
    expect(body).toContain('v_assignment_released_at > clock_timestamp()')
  })

  it('creates or refreshes one exact document and emits Pal only on creation', () => {
    const body = migration().split('function public.open_assignment_doc_for_member_v1(')[1]
      .split('$function$;')[0]
    expect(body).toContain('for update;')
    expect(body).toContain("'{\"type\":\"doc\",\"content\":[]}'::jsonb")
    expect(body).toContain('private.enqueue_pal_event(')
    expect(body.indexOf('insert into public.assignment_docs')).toBeLessThan(
      body.indexOf('private.enqueue_pal_event('),
    )
    expect(body).toContain('greatest(v_doc.returned_at, v_doc.feedback_returned_at)')
    expect(body).toContain("'viewed_at_changed', v_viewed_at_changed")
  })

  it('accepts only the closed learning-item-viewed legacy event shape', () => {
    const body = migration().split('function public.open_assignment_doc_for_member_v1(')[1]
      .split('$function$;')[0]
    expect(body).toContain("p_pal_event->>'event_type' <> 'learning_item.viewed'")
    expect(body).toContain("p_pal_event - array[")
    expect(body).toContain("(p_pal_event->'metadata') - array['item_token', 'kind', 'period_key', 'timing']")
    expect(body).toContain("p_pal_event->'metadata'->>'period_key' is distinct from v_expected_period_key")
    expect(body).toContain("p_pal_event->'metadata'->>'timing' is distinct from v_expected_timing")
  })

  it('keeps rollback-only behavior and multi-connection races in the database CI lane', () => {
    const behavior = readFileSync(
      'scripts/check-contextual-assignment-doc-open-database.sh',
      'utf8',
    )
    const concurrency = readFileSync(
      'scripts/check-contextual-assignment-doc-open-concurrency.mjs',
      'utf8',
    )
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(behavior).toContain('Migration 182 is required; this harness never applies it')
    expect(behavior).toContain('rollback;')
    expect(concurrency).toContain("'removal_wins'")
    expect(concurrency).toContain("'archive_wins'")
    expect(concurrency).toContain("'draft_wins'")
    expect(concurrency).toContain("console.log('Passed: open_wins')")
    expect(concurrency).toContain("console.log('Passed: duplicate_open')")
    expect(concurrency).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
    expect(workflow).toContain('bash scripts/check-contextual-assignment-doc-open-database.sh')
    expect(workflow).toContain('node scripts/check-contextual-assignment-doc-open-concurrency.mjs')
  })
})
