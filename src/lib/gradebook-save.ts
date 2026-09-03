import type { GradebookAssessmentColumn } from '@/types'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

async function requestJSON(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save assessment')
  return data
}

export async function saveGradebookAssessment({ classroomId, assessment, title, categoryId, weight }: {
  classroomId: string
  assessment: GradebookAssessmentColumn
  title: string
  categoryId: string | null
  weight: number
}) {
  let titleSaved = false
  const id = encodeURIComponent(assessment.assessment_id)
  try {
    if (title !== assessment.title) {
      if (assessment.assessment_type === 'assignment') {
        await requestJSON(`/api/teacher/assignments/${id}`, { title })
      } else {
        // The canonical Test draft writer fences concurrent edits and preserves questions.
        const { draft } = await requestJSON(`/api/teacher/tests/${id}/draft`)
        if (!Number.isInteger(draft?.version)) throw new Error('Could not load the current Test version')
        await requestJSON(`/api/teacher/tests/${id}/draft`, {
          version: draft.version,
          patch: [{ op: 'replace', path: '/title', value: title }],
        })
      }
      titleSaved = true
    }
    await requestJSON('/api/teacher/gradebook', {
      classroom_id: classroomId,
      assessment_type: assessment.assessment_type,
      assessment_id: assessment.assessment_id,
      gradebook_category_id: categoryId,
      gradebook_weight: weight,
    })
  } catch (error) {
    if (titleSaved) {
      throw new Error(`Title saved, but category and weight could not be confirmed. Retry to finish saving. ${error instanceof Error ? error.message : ''}`)
    }
    throw error
  } finally {
    // Also invalidate after an uncertain response: a write may have committed.
    invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
    invalidateCachedJSONMatching(`teacher-assignments:${classroomId}`)
    invalidateCachedJSONMatching(`student-assignments:${classroomId}`)
    invalidateCachedJSONMatching(`teacher-test-results:${assessment.assessment_id}:`)
    invalidateCachedJSONMatching(`test:${assessment.assessment_id}`)
  }
}
