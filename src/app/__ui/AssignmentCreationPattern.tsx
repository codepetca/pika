'use client'

import { useState } from 'react'
import { AssignmentForm } from '@/components/AssignmentForm'
import { AssignmentSubmissionRequirementsEditor } from '@/components/AssignmentSubmissionRequirementsEditor'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import type { AssignmentSubmissionRequirementDraft } from '@/lib/assignment-submission-requirements'
import { Button, Card, ContentDialog, DialogPanel, SaveStatus, SplitButton } from '@/ui'

const SAMPLE_INSTRUCTIONS = 'Read the field guide before our next class.\n\nBring one observation and one question to discuss.'
const SAMPLE_DUE_DATE = '2026-09-01'
const SAMPLE_ATTACHMENTS: AssignmentSubmissionRequirementDraft[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    type: 'link',
    label: 'Link',
    instructions: 'Legacy helper text stays stored but is no longer edited here.',
    required: false,
    position: 0,
    validation_policy_json: { mode: 'expected_domain', expected_domains: ['example.com'] },
  },
  { id: '10000000-0000-4000-8000-000000000002', type: 'repo_link', label: 'Repo link', position: 1 },
  { id: '10000000-0000-4000-8000-000000000003', type: 'image', label: 'Image', position: 2 },
]
const ACTIONS = ['Post', 'Schedule', 'Draft'] as const
type Action = typeof ACTIONS[number]

/** Production form owners with local-only state: never creates an assignment draft. */
export function AssignmentCreationPattern() {
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [title, setTitle] = useState('Field observations')
  const [instructions, setInstructions] = useState(SAMPLE_INSTRUCTIONS)
  const [dueAt, setDueAt] = useState(SAMPLE_DUE_DATE)
  const [requirements, setRequirements] = useState<AssignmentSubmissionRequirementDraft[]>(SAMPLE_ATTACHMENTS)
  const [changed, setChanged] = useState(false)
  const [action, setAction] = useState<Action>('Post')
  const [scheduleDate, setScheduleDate] = useState(SAMPLE_DUE_DATE)
  const [scheduleTime, setScheduleTime] = useState('07:00')
  const [error, setError] = useState('')
  const [result, setResult] = useState('Example only—nothing is saved or posted.')

  function openExample() {
    setTitle('Field observations')
    setInstructions(SAMPLE_INSTRUCTIONS)
    setDueAt(SAMPLE_DUE_DATE)
    setRequirements(SAMPLE_ATTACHMENTS.map((requirement) => ({ ...requirement })))
    setChanged(false)
    setAction('Post')
    setScheduleDate(SAMPLE_DUE_DATE)
    setScheduleTime('07:00')
    setError('')
    setPreviewOpen(false)
    setScheduleOpen(false)
    setOpen(true)
  }

  function finishExample(selected: Action) {
    setResult(`${selected} selected. Example only—nothing was saved or posted.`)
    setScheduleOpen(false)
    setOpen(false)
  }

  return (
    <section id="assignment-creation">
      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Assignment creation</h3>
        <p className="mt-2 text-sm text-text-muted">
          The production Assignment form in the same shell as Material, with its due date, attachments and centered save status.
        </p>
        <Button className="mt-3" variant="surface" onClick={openExample}>Open assignment example</Button>
        <p role="status" className="mt-2 text-xs text-text-muted">{result}</p>
      </Card>
      <CreationModalShell
        isOpen={open}
        onClose={() => setOpen(false)}
        title="New Assignment"
        titleId="pattern-assignment-title"
        closeLabel="Close assignment example"
        tall
        showTitle
        contentClassName="!pt-1"
        headerCenter={<SaveStatus status={changed ? 'unsaved' : 'saved'} className={changed ? undefined : 'text-text-muted'} />}
      >
        <AssignmentForm
          fillHeight
          title={title}
          instructionsMarkdown={instructions}
          dueAt={dueAt}
          onTitleChange={(value) => { setTitle(value); setChanged(true); setError('') }}
          onInstructionsMarkdownChange={(value) => { setInstructions(value); setChanged(true) }}
          onDueAtChange={(value) => { setDueAt(value); setChanged(true) }}
          onPreviewInstructions={() => setPreviewOpen(true)}
          error={error}
          extraFields={(
            <AssignmentSubmissionRequirementsEditor
              requirements={requirements}
              onChange={(value) => { setRequirements(value); setChanged(true) }}
            />
          )}
          topRowActions={(
            <SplitButton
              label={action}
              variant={action === 'Post' ? 'success' : 'primary'}
              size="md"
              className="shadow-sm"
              toggleAriaLabel="Choose assignment action"
              menuPlacement="down"
              primaryButtonProps={{ className: 'w-14 justify-center font-semibold sm:w-24' }}
              options={ACTIONS.map((label) => ({ id: label, label, onSelect: () => setAction(label) }))}
              onPrimaryClick={() => {
                if (action !== 'Draft' && !title.trim()) {
                  setError('Add a title before posting or scheduling this assignment.')
                  return
                }
                if (action === 'Schedule') setScheduleOpen(true)
                else finishExample(action)
              }}
            />
          )}
        />
      </CreationModalShell>
      <ContentDialog
        isOpen={open && previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Instructions"
        maxWidth="!max-w-2xl"
        showFooterClose={false}
      >
        <LimitedMarkdown content={instructions} emptyPlaceholder={<p className="text-sm text-text-muted">No assignment details provided.</p>} />
      </ContentDialog>
      <DialogPanel
        isOpen={open && scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        maxWidth="max-w-sm"
        className="p-4"
        ariaLabelledBy="pattern-assignment-schedule-title"
      >
        <h3 id="pattern-assignment-schedule-title" className="mb-2 text-sm font-semibold text-text-default">Schedule Release</h3>
        <p className="mb-3 text-xs text-text-muted">Example only—this will not schedule an assignment.</p>
        <ScheduleDateTimePicker
          date={scheduleDate}
          time={scheduleTime}
          isFutureValid
          onDateChange={setScheduleDate}
          onTimeChange={setScheduleTime}
          onConfirm={() => finishExample('Schedule')}
          confirmLabel="Schedule"
          dateLabel="Date"
          timeLabel="Time"
          showHeader={false}
          showTimezoneLabel={false}
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </DialogPanel>
    </section>
  )
}
