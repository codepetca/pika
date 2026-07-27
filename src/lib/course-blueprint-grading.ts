export type CourseBlueprintGrading = {
  use_weights: boolean
  assignments_weight: number
  tests_weight: number
}

export function courseBlueprintGradingToMarkdown(
  grading: CourseBlueprintGrading,
): string {
  return [
    '# Gradebook',
    `Use Weights: ${grading.use_weights ? 'true' : 'false'}`,
    `Assignments Weight: ${grading.assignments_weight}`,
    `Tests Weight: ${grading.tests_weight}`,
  ].join('\n')
}

export function markdownToCourseBlueprintGrading(markdown: string):
  | { grading: CourseBlueprintGrading; errors: [] }
  | { grading: null; errors: string[] } {
  const fields = new Map<string, string>()
  markdown.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
    const match = line.match(/^([A-Za-z ]+):\s*(.*?)\s*$/)
    if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim())
  })
  const rawUseWeights = fields.get('use weights')
  const assignmentsWeight = Number(fields.get('assignments weight'))
  const testsWeight = Number(fields.get('tests weight'))
  const errors: string[] = []
  if (!rawUseWeights || !['true', 'false'].includes(rawUseWeights.toLowerCase())) {
    errors.push('Use Weights must be true or false')
  }
  if (!Number.isInteger(assignmentsWeight) || assignmentsWeight < 0 || assignmentsWeight > 100) {
    errors.push('Assignments Weight must be a whole number from 0 to 100')
  }
  if (!Number.isInteger(testsWeight) || testsWeight < 0 || testsWeight > 100) {
    errors.push('Tests Weight must be a whole number from 0 to 100')
  }
  if (
    rawUseWeights?.toLowerCase() === 'true'
    && Number.isInteger(assignmentsWeight)
    && Number.isInteger(testsWeight)
    && assignmentsWeight + testsWeight !== 100
  ) {
    errors.push('Assignments Weight and Tests Weight must total 100')
  }
  if (errors.length > 0) return { grading: null, errors }
  return {
    grading: {
      use_weights: rawUseWeights!.toLowerCase() === 'true',
      assignments_weight: assignmentsWeight,
      tests_weight: testsWeight,
    },
    errors: [],
  }
}
