'use client'

import { useState } from 'react'
import { StudentAssignmentSubmissionChecklist } from '@/components/StudentAssignmentSubmissionChecklist'
import { Button, Card, ConfirmDialog } from '@/ui'
import type { AssignmentSubmissionArtifact, AssignmentSubmissionRequirement } from '@/types'

const CREATED_AT = '2026-08-31T12:00:00.000Z'
const REQUIREMENTS: AssignmentSubmissionRequirement[] = [
  {
    id: '10000000-0000-4000-8000-000000000011', assignment_id: 'pattern-assignment',
    type: 'link', label: 'Reflection link', instructions: '', required: true, position: 0,
    validation_policy_json: {}, created_at: CREATED_AT, updated_at: CREATED_AT,
  },
  {
    id: '10000000-0000-4000-8000-000000000012', assignment_id: 'pattern-assignment',
    type: 'repo_link', label: 'Repo link', instructions: '', required: true, position: 1,
    validation_policy_json: {}, created_at: CREATED_AT, updated_at: CREATED_AT,
  },
  {
    id: '10000000-0000-4000-8000-000000000013', assignment_id: 'pattern-assignment',
    type: 'image', label: 'Image', instructions: '', required: true, position: 2,
    validation_policy_json: {}, created_at: CREATED_AT, updated_at: CREATED_AT,
  },
]
const ARTIFACTS: AssignmentSubmissionArtifact[] = [{
  id: '10000000-0000-4000-8000-000000000021', assignment_doc_id: 'pattern-doc',
  requirement_id: REQUIREMENTS[0].id, student_id: 'pattern-student', type: 'link',
  url: 'https://example.com/reflection', storage_path: null,
  metadata_json: { validation_level: 'format_only' }, validation_status: 'valid',
  validation_message: null, validated_at: CREATED_AT, created_at: CREATED_AT, updated_at: CREATED_AT,
}]

/** Production attachment and dialog owners with fixed local data and no API writes. */
export function StudentAssignmentAttachmentsPattern() {
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [result, setResult] = useState('Example only—nothing is submitted.')

  return (
    <section id="student-assignment-attachments">
      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Assignment attachments</h3>
        <p className="mt-2 text-sm text-text-muted">
          Configured attachments are expected. Missing items use one confirmation instead of blocking Submit.
        </p>
        <div className="mt-4">
          <StudentAssignmentSubmissionChecklist
            assignmentId="pattern-assignment"
            requirements={REQUIREMENTS}
            artifacts={ARTIFACTS}
            githubIdentity={null}
            disabled
            onArtifactsChange={() => undefined}
            onError={setResult}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={() => setConfirmationOpen(true)}>Submit</Button>
          <span role="status" className="text-xs text-text-muted">{result}</span>
        </div>
      </Card>
      <ConfirmDialog
        isOpen={confirmationOpen}
        title="Submit without attachments?"
        description="Repo link and Image are missing. Submit anyway?"
        confirmLabel="Submit anyway"
        cancelLabel="Go back"
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={() => {
          setConfirmationOpen(false)
          setResult('Submit anyway selected. Example only—nothing was submitted.')
        }}
      />
    </section>
  )
}
