import type {
  AssessmentWorkspaceSummaryPatch,
  TestAssessmentWithStats,
} from '@/types'

export function applyTestSummaryPatchToTest(
  test: TestAssessmentWithStats,
  update: AssessmentWorkspaceSummaryPatch,
): TestAssessmentWithStats {
  return {
    ...test,
    title: typeof update.title === 'string' ? update.title : test.title,
    show_results: typeof update.show_results === 'boolean' ? update.show_results : test.show_results,
    status: update.status ?? test.status,
    stats: {
      ...test.stats,
      questions_count:
        typeof update.questions_count === 'number' ? update.questions_count : test.stats.questions_count,
    },
  }
}
