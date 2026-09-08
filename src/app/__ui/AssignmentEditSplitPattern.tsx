'use client'

import { useState } from 'react'
import { AssignmentForm } from '@/components/AssignmentForm'
import { AssignmentSubmissionRequirementsEditor } from '@/components/AssignmentSubmissionRequirementsEditor'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import type { AssignmentSubmissionRequirementDraft } from '@/lib/assignment-submission-requirements'
import { Button, Card, ContentDialog, SaveStatus, SplitButton } from '@/ui'

const SAMPLE_INSTRUCTIONS = 'Read the field guide before our next class.\n\nBring one observation and one question to discuss.'
const SAMPLE_DUE_DATE = '2026-09-01'
const SAMPLE_REQUIREMENTS: AssignmentSubmissionRequirementDraft[] = [
  { id: '20000000-0000-4000-8000-000000000001', type: 'link', label: 'Research notes', position: 0 },
  { id: '20000000-0000-4000-8000-000000000002', type: 'image', label: 'Field photo', position: 1 },
]

export function AssignmentEditSplitPattern() {
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [title, setTitle] = useState('Field observations')
  const [instructions, setInstructions] = useState(SAMPLE_INSTRUCTIONS)
  const [dueAt, setDueAt] = useState(SAMPLE_DUE_DATE)
  const [requirements, setRequirements] = useState<AssignmentSubmissionRequirementDraft[]>(SAMPLE_REQUIREMENTS)
  const [changed, setChanged] = useState(false)

  function update<T>(setter: (value: T) => void, value: T) {
    setter(value)
    setChanged(true)
  }

  function openPrototype() {
    setTitle('Field observations')
    setInstructions(SAMPLE_INSTRUCTIONS)
    setDueAt(SAMPLE_DUE_DATE)
    setRequirements(SAMPLE_REQUIREMENTS.map((requirement) => ({ ...requirement })))
    setChanged(false)
    setPreviewOpen(false)
    setOpen(true)
  }

  return (
    <section id="assignment-edit-split">
      <Card tone="accent" padding="md">
        <h3 className="font-semibold">Assignment edit · split-pane prototype</h3>
        <p className="mt-2 text-sm text-text-muted">
          Preview keeps its own full-width row below the title, while Due and Post fill an equal-width row anchored to the bottom of the details pane. The editor and formatting bar stay together in the right pane, then stack below the details on mobile.
        </p>
        <Button className="mt-3" variant="surface" onClick={openPrototype}>Open assignment edit prototype</Button>
      </Card>

      <CreationModalShell
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Edit Assignment"
        titleId="pattern-assignment-edit-title"
        closeLabel="Close assignment edit prototype"
        maxWidth="!max-w-6xl"
        tall
        showTitle
        contentClassName="!overflow-hidden !p-0"
        headerCenter={<SaveStatus status={changed ? 'unsaved' : 'saved'} className={changed ? undefined : 'text-text-muted'} />}
      >
        <AssignmentForm
          fillHeight
          desktopSplit
          title={title}
          instructionsMarkdown={instructions}
          dueAt={dueAt}
          onTitleChange={(value) => update(setTitle, value)}
          onInstructionsMarkdownChange={(value) => update(setInstructions, value)}
          onDueAtChange={(value) => update(setDueAt, value)}
          onPreviewInstructions={() => setPreviewOpen(true)}
          extraFields={(
            <AssignmentSubmissionRequirementsEditor
              requirements={requirements}
              onChange={(value) => update(setRequirements, value)}
            />
          )}
          topRowActions={(
            <SplitButton
              label="Post"
              variant="success"
              size="md"
              className="w-full shadow-sm"
              toggleAriaLabel="Choose assignment action"
              menuPlacement="down"
              primaryButtonProps={{ className: 'flex-1 justify-center font-semibold' }}
              options={[
                { id: 'schedule', label: 'Schedule', onSelect: () => undefined },
                { id: 'draft', label: 'Revert to draft', onSelect: () => undefined },
              ]}
              onPrimaryClick={() => setChanged(false)}
            />
          )}
        />
      </CreationModalShell>

      <ContentDialog
        isOpen={open && previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Instructions"
        subtitle={title}
        maxWidth="!max-w-2xl"
        showFooterClose={false}
      >
        <LimitedMarkdown content={instructions} emptyPlaceholder={<p className="text-sm text-text-muted">No assignment details provided.</p>} />
      </ContentDialog>
    </section>
  )
}
