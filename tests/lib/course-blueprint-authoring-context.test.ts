import { describe, expect, it } from 'vitest'
import { resolveCourseBlueprintAuthoringContext } from '@/lib/course-blueprint-authoring-context'

const guidance = {
  course_expectations_markdown: 'Use course conventions.',
  assignment_guidance_markdown: 'Give a submission checklist.',
  test_guidance_markdown: 'Put general instructions in a reference.',
  unit_exceptions: [{
    id: '11111111-1111-4111-8111-111111111111',
    unit_label: 'Unit 1',
    assignment_guidance_markdown: 'Use Python.',
    test_guidance_markdown: 'Use Karel.',
  }],
}

describe('Blueprint authoring context', () => {
  it('composes course, target, and selected unit rules without crossing targets', () => {
    const context = resolveCourseBlueprintAuthoringContext({
      guidance,
      target: 'tests',
      unitExceptionId: guidance.unit_exceptions[0].id,
    })
    expect(context.rules_markdown).toContain('Use course conventions.')
    expect(context.rules_markdown).toContain('Put general instructions in a reference.')
    expect(context.rules_markdown).toContain('Use Karel.')
    expect(context.rules_markdown).not.toContain('Use Python.')
    expect(context.rules_markdown).not.toContain('Give a submission checklist.')
    expect(context.unit_label).toBe('Unit 1')
  })

  it('rejects a stale unit selection', () => {
    expect(() => resolveCourseBlueprintAuthoringContext({
      guidance,
      target: 'assignments',
      unitExceptionId: '22222222-2222-4222-8222-222222222222',
    })).toThrow('no longer available')
  })

  it('matches database edge trimming and treats UUID case as insignificant', () => {
    const uppercaseUnitId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'
    const context = resolveCourseBlueprintAuthoringContext({
      guidance: {
        ...guidance,
        course_expectations_markdown: '\n\tUse course conventions.\r\n',
        test_guidance_markdown: '\tPut general instructions in a reference.\n',
        unit_exceptions: [{
          ...guidance.unit_exceptions[0],
          id: uppercaseUnitId,
          unit_label: '\nUnit 1\t',
          test_guidance_markdown: '\nUse Karel.\t',
        }],
      },
      target: 'tests',
      unitExceptionId: uppercaseUnitId.toLowerCase(),
    })

    expect(context.unit_exception_id).toBe(uppercaseUnitId)
    expect(context.rules_markdown).toBe(
      '## Course expectations\n\nUse course conventions.\n\n'
      + '## Test rules\n\nPut general instructions in a reference.\n\n'
      + '## Unit: Unit 1\n\nUse Karel.',
    )
  })

  it('preserves Unicode edge spaces in the signed rules contract', () => {
    const context = resolveCourseBlueprintAuthoringContext({
      guidance: {
        ...guidance,
        course_expectations_markdown: '\u00a0Course rule\u00a0',
        assignment_guidance_markdown: '',
      },
      target: 'assignments',
    })
    expect(context.rules_markdown).toBe('## Course expectations\n\n\u00a0Course rule\u00a0')
  })
})
