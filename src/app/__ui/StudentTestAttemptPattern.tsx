'use client'

import { useState } from 'react'
import { StudentTestForm } from '@/components/StudentTestForm'
import { PageDensityProvider } from '@/ui'
import type { TestAssessmentQuestion } from '@/types'

const questions: TestAssessmentQuestion[] = [{
  id: 'q1', test_id: 'pattern-test-attempt', question_type: 'open_response',
  question_text: 'Explain how you would check that a result is reasonable.', options: [],
  points: 4, position: 0, response_max_chars: 5000,
  created_at: '2026-10-04T12:00:00Z', updated_at: '2026-10-04T12:00:00Z',
}]

export function StudentTestAttemptPattern({ interactive = false }: { interactive?: boolean }) {
  const [submitted, setSubmitted] = useState(false)
  return <PageDensityProvider density="student">
    <section id="student-test-attempt" className="mx-auto max-w-3xl space-y-3">
      <h3 className="text-base font-semibold text-text-default">Student test answers</h3>
      <p className="text-sm text-text-muted">Production response form, save feedback and recovery controls. Preview uses synthetic answers; interactive verification requires intercepted fixture requests.</p>
      {submitted ? <p role="status" className="text-success">Response submitted</p> : <StudentTestForm
        testId="pattern-test-attempt" questions={questions} initialDraftRevision={41}
        enableDraftAutosave previewMode={!interactive} apiBasePath="/api/__fixtures/test-attempts"
        onSubmitted={() => setSubmitted(true)}
      />}
    </section>
  </PageDensityProvider>
}
