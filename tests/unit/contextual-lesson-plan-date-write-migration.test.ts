import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/226_contextual_lesson_plan_date_write.sql', 'utf8')

describe('contextual lesson-plan date write migration source', () => {
  it('keeps service-only definer authority narrow', () => {
    expect(sql).toMatch(/create function public\.save_lesson_plan_for_owner_v1\(/i)
    expect(sql).toMatch(/security definer\s+set search_path = ''/i)
    expect(sql).toMatch(/revoke all on function public\.save_lesson_plan_for_owner_v1\([\s\S]*?from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.save_lesson_plan_for_owner_v1\([\s\S]*?to service_role/i)
  })

  it('checks the live owner under the lifecycle and parent locks before touching heads or plans', () => {
    const operation = sql.indexOf('pika-classroom-operation:')
    const purge = sql.indexOf('perform public.guard_classroom_purge_lifecycle')
    const parent = sql.indexOf('from public.classrooms as classroom')
    const owner = sql.indexOf('v_teacher_id is distinct from p_actor_id')
    const head = sql.indexOf('from public.lesson_plan_mutation_heads as head')
    const plan = sql.indexOf('from public.lesson_plans as plan')
    const engine = sql.indexOf('public.apply_ordered_lesson_plan_mutation(')
    expect(operation).toBeGreaterThan(0)
    expect(operation).toBeLessThan(purge)
    expect(purge).toBeLessThan(parent)
    expect(parent).toBeLessThan(owner)
    expect(owner).toBeLessThan(head)
    expect(head).toBeLessThan(plan)
    expect(plan).toBeLessThan(engine)
    expect(sql.match(/for update nowait/gi)).toHaveLength(3)
  })

  it('preserves ordered engine, lineage, and trigger behavior', () => {
    expect(sql).toMatch(/v_ordered_result := public\.apply_ordered_lesson_plan_mutation\(/)
    expect(sql).toMatch(/on conflict \(classroom_id, date\) do update\s+set content_markdown = excluded\.content_markdown,\s+content = excluded\.content,\s+updated_at = excluded\.updated_at/i)
    expect(sql).not.toMatch(/disable trigger|set session_replication_role|update public\.lesson_plan_mutation_heads/i)
    for (const column of ['artifact_id', 'source_artifact_id', 'source_blueprint_version_id', 'blueprint_archived_at']) {
      expect(sql).toContain(`'${column}', v_plan.${column}`)
    }
    expect(sql).toMatch(/if v_applied and \([\s\S]*?p_delete and v_plan_json <> 'null'::jsonb[\s\S]*?not p_delete and v_plan_json = 'null'::jsonb[\s\S]*?raise exception using errcode = 'PT409'/i)
    expect(sql).toMatch(/when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03'\s+or sqlstate '55000' then\s+raise exception using errcode = 'PT409'/i)
  })
})
