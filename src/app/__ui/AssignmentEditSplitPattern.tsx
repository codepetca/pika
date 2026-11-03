'use client'

import { useState } from 'react'
import { Settings, Trash2 } from 'lucide-react'
import { AssignmentForm } from '@/components/AssignmentForm'
import { AssignmentSubmissionRequirementsEditor } from '@/components/AssignmentSubmissionRequirementsEditor'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { TeacherWorkSurfaceMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { AssignmentSubmissionRequirementDraft } from '@/lib/assignment-submission-requirements'
import { Button, Card, ConfirmDialog, ContentDialog, SaveStatus, SplitButton } from '@/ui'

const SAMPLE_INSTRUCTIONS = 'Read the field guide before our next class.\n\nBring one observation and one question to discuss.'
const SAMPLE_DUE_DATE = '2026-09-01'
const SAMPLE_REQUIREMENTS: AssignmentSubmissionRequirementDraft[] = [
  { id: '20000000-0000-4000-8000-000000000001', type: 'link', label: 'Research notes', position: 0 },
  { id: '20000000-0000-4000-8000-000000000002', type: 'image', label: 'Field photo', position: 1 },
]

export function AssignmentEditSplitPattern() {
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
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
        panelClassName="!p-0"
        tall
        contentClassName="!overflow-hidden !p-0"
      >
        <AssignmentForm
          classroomName="Health for Life · Period 2 · Community, wellbeing and lifelong learning"
          fillHeight
          desktopSplit
          title={title}
          instructionsMarkdown={instructions}
          dueAt={dueAt}
          onTitleChange={(value) => update(setTitle, value)}
          onInstructionsMarkdownChange={(value) => update(setInstructions, value)}
          onDueAtChange={(value) => update(setDueAt, value)}
          onPreviewInstructions={() => setPreviewOpen(true)}
          settingsAction={<TeacherWorkSurfaceMenuButton
            label={<><Settings className="h-4 w-4" aria-hidden="true" /> Settings</>}
            variant="secondary" className="w-full" menuAriaLabel="Assignment settings" menuPlacement="up" menuAlign="end"
            items={[{ id: 'delete', label: 'Delete assignment', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, destructive: true, onSelect: () => setDeleteOpen(true) }]}
          />}
          saveStatusContent={(
            <div className="flex items-center gap-1">
              <SaveStatus presentation="indicator" status={changed ? 'unsaved' : 'saved'} className={changed ? undefined : 'text-text-muted'} />
            </div>
          )}
          extraFields={(
            <AssignmentSubmissionRequirementsEditor
              requirements={requirements}
              onChange={(value) => update(setRequirements, value)}
            />
          )}
          topRowActions={(
            <SplitButton
              exitMotion="opacity"
              interactionActive={open && !previewOpen}
              label="Post"
              variant="primary"
              size="md"
              className="w-full shadow-sm"
              toggleAriaLabel="Choose assignment action"
              menuPlacement="up"
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

      <ConfirmDialog isOpen={deleteOpen} title="Delete assignment?" description="This changes only the Pattern Lab example." confirmLabel="Delete example" onCancel={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); setOpen(false) }} />

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
