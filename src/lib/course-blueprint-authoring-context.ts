import {
  normalizeCourseBlueprintAuthoringGuidance,
  type CourseBlueprintAuthoringGuidance,
} from '@/lib/course-blueprint-authoring-guidance'

export type CourseBlueprintAuthoringTarget = 'assignments' | 'tests'

export type CourseBlueprintAuthoringContext = {
  target: CourseBlueprintAuthoringTarget
  unit_exception_id: string | null
  unit_label: string | null
  rules_markdown: string
}

export type CourseBlueprintDraftGuidanceProvenance = CourseBlueprintAuthoringContext & {
  blueprint_revision: number
}

/** The exact teacher-authored rules supplied to a draft, in precedence order. */
export function resolveCourseBlueprintAuthoringContext(args: {
  guidance: CourseBlueprintAuthoringGuidance
  target: CourseBlueprintAuthoringTarget
  unitExceptionId?: string | null
}): CourseBlueprintAuthoringContext {
  const guidance = normalizeCourseBlueprintAuthoringGuidance(args.guidance)
  const unit = args.unitExceptionId
    ? guidance.unit_exceptions.find((entry) => entry.id === args.unitExceptionId)
    : null
  if (args.unitExceptionId && !unit) {
    throw new Error('The selected unit guidance is no longer available')
  }
  const targetKey = args.target === 'tests'
    ? 'test_guidance_markdown'
    : 'assignment_guidance_markdown'
  const sections = [
    ['Course expectations', guidance.course_expectations_markdown],
    [args.target === 'tests' ? 'Test rules' : 'Assignment rules', guidance[targetKey]],
    ...(unit ? [[`Unit: ${unit.unit_label}`, unit[targetKey]]] : []),
  ].filter(([, body]) => body.trim())
  return {
    target: args.target,
    unit_exception_id: unit?.id ?? null,
    unit_label: unit?.unit_label ?? null,
    rules_markdown: sections.length
      ? sections.map(([heading, body]) => `## ${heading}\n\n${body.trim()}`).join('\n\n')
      : '',
  }
}
