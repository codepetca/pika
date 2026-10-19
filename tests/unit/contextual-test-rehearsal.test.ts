import { describe, expect, it } from 'vitest'
import { createContextualTestPlan, contextualTestNarrowScopes, isContextualTestNarrowScope, bootstrapContextualTestFixtureSql, contextualTestWitnessSql } from '../../e2e/helpers/contextual-test-rehearsal'

describe('closed narrow-scope recognition', () => {
  it('recognizes exactly four fixed scopes without admitting full or forged values', () => {
    expect(contextualTestNarrowScopes).toEqual(['vertical-v1', 'vertical-grade-return-v1', 'lifecycle-permissions-v1', 'survey-workflow-v1'])
    expect(Object.isFrozen(contextualTestNarrowScopes)).toBe(true)
    for (const scope of contextualTestNarrowScopes) expect(isContextualTestNarrowScope(scope)).toBe(true)
    for (const scope of [undefined, null, false, '', 'full', 'survey-workflow-v2', {}, ['survey-workflow-v1'], new String('survey-workflow-v1')]) {
      expect(isContextualTestNarrowScope(scope)).toBe(false)
      if (scope !== undefined) expect(() => createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f', scope as never)).toThrow()
    }
    expect(() => createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f', undefined)).not.toThrow()
  })
})

describe('contextual Test rehearsal fixture contract', () => {
  it('binds Survey269 separately with smaller resource ceilings and CLASSWORK only in that profile', () => {
    const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f', 'survey-workflow-v1')
    expect(plan.sourceSha).toBe('44daed9da68b28af1d36c0bcc4610e36842396e7')
    expect(plan.sourceTree).toBe('c80c76193766a8007fbf26da22a26cb9d1cee00b')
    expect(plan.migrationChainSha256).toBe('dbecac4c459bf8a514ef83bd69dec7246d0a2546f0e311ae02e90593b66a6fe8')
    expect(plan.surveyLimits).toEqual({ surveys: 4, questionsPerSurvey: 2, uploads: 0, screenshots: 16 })
    expect(bootstrapContextualTestFixtureSql(plan, '$2b$10$' + 'A'.repeat(53))).toContain('"classwork":true')
    for (const scope of [undefined, 'vertical-v1', 'vertical-grade-return-v1', 'lifecycle-permissions-v1'] as const) {
      const legacy = createContextualTestPlan(plan.projectId, scope)
      expect(legacy.surveyLimits).toBeUndefined()
      expect(bootstrapContextualTestFixtureSql(legacy, '$2b$10$' + 'A'.repeat(53))).toContain('"classwork":false')
    }
  })
  it('binds the frozen app, five historical roles, both classrooms and finite limits', () => {
    const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
    expect(plan.sourceSha).toBe('050699bb0f889a533a349b6af415b821ac56d0e3')
    expect(plan.sourceTree).toBe('f44d726966f322e4e3eb0ef637c6f2c711544d77')
    expect(plan.appOrigin).toBe('http://localhost:3117')
    expect(plan.apiOrigin).toBe('http://127.0.0.1:54331')
    expect(Object.values(plan.actors).map(actor => actor.role)).toEqual(['teacher', 'student', 'teacher', 'student', 'student'])
    expect(plan.pageAccessPairs).toHaveLength(10)
    expect(plan.admission.admittedUserIds).toHaveLength(5)
    expect(plan.retiredTestIds).toHaveLength(2)
    expect(plan.limits).toEqual({ tests: 8, questionsPerTest: 2, uploadObjects: 2, uploadBytes: 32768,
      appRequests: 1000, storageRequests: 40, responseBytes: 1048576, operationMs: 30000,
      totalMs: 2700000, launches: 1, automaticRetries: 0 })
  })
  it.each(['pika', 'pika_assignment_list_123', '../pika_assignment_list_1a2b3c4d5e6f', 'pika_assignment_list_AABBCCDDEEFF'])('rejects unsafe identity %s before effects', project => {
    expect(() => createContextualTestPlan(project)).toThrow()
  })
  it('uses fresh project-bound class codes and admits no implicit account cross-product', () => {
    const a = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
    const b = createContextualTestPlan('pika_assignment_list_2a2b3c4d5e6f')
    expect(a.classrooms.classA.classCode).not.toBe(b.classrooms.classA.classCode)
    expect(a.pageAccessPairs).toEqual(Object.values(a.actors).flatMap(actor => Object.values(a.classrooms).map(c => ({ userId: actor.id, classroomId: c.id }))))
  })
  it('creates only bounded synthetic identities with collision guards and no upsert or settings relaxation', () => {
    const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
    const sql = bootstrapContextualTestFixtureSql(plan, '$2b$10$' + 'A'.repeat(53))
    expect(sql).toContain('fixture_identity_collision')
    expect(sql).toContain('fixture_pal_enabled')
    expect(sql).toContain('INSERT INTO public.users')
    expect(sql).toContain('INSERT INTO public.classroom_enrollments')
    expect(sql).not.toMatch(/ON CONFLICT|UPDATE private\.|ALTER|DISABLE TRIGGER|set_config/i)
    expect(sql).not.toContain('RHA55F')
    expect(() => bootstrapContextualTestFixtureSql(plan, 'plaintext-password')).toThrow()
  })
  it('witnesses forbidden-work digests without projecting auth credentials', () => {
    const sql = contextualTestWitnessSql(createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f'))
    expect(sql).toContain('REPEATABLE READ READ ONLY')
    expect(sql).toContain('work_graph_sha256')
    expect(sql).toContain('pal_membership_generations')
    expect(sql).toContain('test_attempt_history')
    expect(sql).not.toMatch(/password_hash|token_hash|auth_sessions|vault\./)
  })
})
