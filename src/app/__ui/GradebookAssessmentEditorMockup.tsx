'use client'

import type { ComponentProps } from 'react'
import { GradebookAssessmentEditor } from '@/components/gradebook/GradebookAssessmentEditor'

export function GradebookAssessmentEditorMockup(props: ComponentProps<typeof GradebookAssessmentEditor>) {
  return <GradebookAssessmentEditor {...props} validateTitle={(title) => {
    // Only prototype score fixtures use titles as keys. Live assessments use IDs
    // and intentionally allow the same titles as their canonical writers.
    if (title === props.assessment?.title.trim()) return undefined
    const collision = props.assessments.some((candidate) => (
      (candidate.assessment_id !== props.assessment?.assessment_id || candidate.assessment_type !== props.assessment?.assessment_type)
      && candidate.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase()
    ))
    return collision ? 'Assessment titles must be unique.' : undefined
  }} />
}
