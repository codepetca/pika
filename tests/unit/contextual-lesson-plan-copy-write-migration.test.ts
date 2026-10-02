import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/229_contextual_lesson_plan_copy_write.sql', 'utf8')

describe('contextual lesson-plan copy migration source', () => {
  it('grants only service-role execution of the narrow definer', () => {
    expect(sql).toMatch(/create function public\.copy_lesson_plan_for_owner_v1\(\s*p_actor_id uuid,\s*p_classroom_id uuid,\s*p_from_date date,\s*p_to_date date\s*\)/i)
    expect(sql).toMatch(/security definer\s+set search_path = ''/i)
    expect(sql).toMatch(/revoke all on function public\.copy_lesson_plan_for_owner_v1\([\s\S]*?from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.copy_lesson_plan_for_owner_v1\([\s\S]*?to service_role/i)
  })

  it('locks operation, purge guard, current parent, and sorted plans before the source read or write', () => {
    const positions = [
      'pika-classroom-operation:',
      'guard_classroom_purge_lifecycle',
      'from public.classrooms as classroom',
      'v_teacher_id is distinct from p_actor_id',
      'order by plan.date',
      'select * into v_source',
      'insert into public.lesson_plans',
    ].map((needle) => sql.indexOf(needle))
    expect(positions[0]).toBeGreaterThan(0)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(sql.match(/for update nowait/gi)).toHaveLength(2)
    expect(sql).toContain("errcode = 'PT404'")
    expect(sql).toContain("errcode = 'P0002'")
    expect(sql).toContain("errcode = '42501'")
  })

  it('validates legacy source content before write and copies only content fields', () => {
    expect(sql).toMatch(/v_source\.content \? 'content'/)
    expect(sql).toMatch(/with recursive content_nodes/)
    expect(sql).toMatch(/depth <= 100/)
    expect(sql).toMatch(/count\(\*\) <= 10000/)
    expect(sql).toMatch(/octet_length\(node->>'text'\) <= 1000000/)
    expect(sql).toMatch(/jsonb_array_length\([\s\S]*?node->'marks'[\s\S]*?\) <= 100/)
    expect(sql.indexOf('if not v_content_valid then')).toBeLessThan(sql.indexOf('insert into public.lesson_plans'))
    expect(sql).toMatch(/on conflict \(classroom_id, date\) do update\s+set content = excluded\.content,\s+content_markdown = excluded\.content_markdown,\s+updated_at = excluded\.updated_at/i)
    expect(sql).not.toMatch(/update public\.lesson_plan_mutation_heads|apply_ordered_lesson_plan_mutation|disable trigger|set session_replication_role/i)
    expect(sql).not.toMatch(/set [^;]*source_(?:artifact|blueprint)_/i)
  })

  it('uses SQL COALESCE syntax and rejects NULL per-node predicates', () => {
    expect(sql).not.toMatch(/pg_catalog\.coalesce\s*\(/i)
    expect(sql).toMatch(/coalesce\(pg_catalog\.bool_and\(bounded_nodes\.node_valid\), true\)/i)
    expect(sql).toMatch(/select coalesce\(depth <= 100[\s\S]*?\), false\) as node_valid\s+from content_nodes\s+limit 10001/i)
    expect(sql).toMatch(/jsonb_typeof\(node->'type'\) = 'string'/)
  })

  it('returns the explicit eleven-field target shape and maps lock contention', () => {
    for (const column of [
      'id', 'classroom_id', 'date', 'content', 'content_markdown', 'artifact_id',
      'source_artifact_id', 'source_blueprint_version_id', 'blueprint_archived_at',
      'created_at', 'updated_at',
    ]) expect(sql).toContain(`'${column}', v_target.${column}`)
    expect(sql).toMatch(/when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03'\s+or sqlstate '55000'[\s\S]*?errcode = 'PT409'/i)
  })
})
