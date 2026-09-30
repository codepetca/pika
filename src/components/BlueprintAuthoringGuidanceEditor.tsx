'use client'

import { useState } from 'react'
import { Button, FormField, Input, Select } from '@/ui'
import { MarkdownContentEditor } from '@/components/editor'
import type { CourseBlueprintAuthoringGuidance } from '@/lib/course-blueprint-authoring-guidance'
import type { CourseBlueprintGuidanceRevision } from '@/lib/course-blueprint-guidance-history'

type MarkdownKey = 'course_expectations_markdown' | 'assignment_guidance_markdown' | 'test_guidance_markdown'
type Unit = CourseBlueprintAuthoringGuidance['unit_exceptions'][number]

type Props = {
  guidance: CourseBlueprintAuthoringGuidance
  savedGuidance: CourseBlueprintAuthoringGuidance
  onChange: (guidance: CourseBlueprintAuthoringGuidance) => void
  onSave: () => void
  onTryDraft: (target: 'assignments' | 'tests', unitExceptionId: string | null) => void
  revision: number
  readOnly: boolean
  busy: boolean
  dirty: boolean
  history: CourseBlueprintGuidanceRevision[]
  historyLoading: boolean
  historyError: string
}

function reviewText(guidance: CourseBlueprintAuthoringGuidance): string {
  return [
    '# Course expectations',
    guidance.course_expectations_markdown || '(none)',
    '# Assignment rules',
    guidance.assignment_guidance_markdown || '(none)',
    '# Test rules',
    guidance.test_guidance_markdown || '(none)',
    ...guidance.unit_exceptions.flatMap((unit) => [
      `# ${unit.unit_label}`,
      `Assignment rules: ${unit.assignment_guidance_markdown || '(none)'}`,
      `Test rules: ${unit.test_guidance_markdown || '(none)'}`,
    ]),
  ].join('\n\n')
}

function GuidanceField({
  label, value, onChange, sourceMode, readOnly, placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  sourceMode: boolean
  readOnly: boolean
  placeholder: string
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-text-default">{label}</div>
      {sourceMode ? (
        <textarea
          aria-label={`${label} Markdown`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={readOnly}
          rows={7}
          spellCheck={false}
          placeholder={placeholder}
          className="min-h-36 w-full resize-y rounded-control border border-border bg-surface px-3 py-3 font-mono text-sm text-text-default focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus disabled:cursor-not-allowed disabled:bg-surface-2"
        />
      ) : (
        <MarkdownContentEditor
          markdown={value}
          onMarkdownChange={onChange}
          placeholder={placeholder}
          editable={!readOnly}
          toolbarPreset="document"
          aria-label={label}
          className="min-h-36"
        />
      )}
    </div>
  )
}

export function BlueprintAuthoringGuidanceEditor({
  guidance, savedGuidance, onChange, onSave, onTryDraft, revision, readOnly, busy, dirty,
  history, historyLoading, historyError,
}: Props) {
  const [sourceMode, setSourceMode] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [trialUnitId, setTrialUnitId] = useState('')
  const update = (key: MarkdownKey, value: string) => onChange({ ...guidance, [key]: value })
  const updateUnit = (id: string, changes: Partial<Unit>) => onChange({
    ...guidance,
    unit_exceptions: guidance.unit_exceptions.map((unit) =>
      unit.id === id ? { ...unit, ...changes } : unit
    ),
  })

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-info-bg p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">Teacher only</div>
        <h2 className="mt-2 text-lg font-semibold text-text-default">Authoring Guidance</h2>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Set the expectations used when drafting new tests and assignments. Unit rules add to the course rules.
          This guidance is kept out of student questions and the public course site.
        </p>
        <div className="mt-3 text-xs text-text-muted">Blueprint Draft revision {revision}</div>
      </div>

      {readOnly ? (
        <div className="rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
          This Blueprint is repository-managed. Edit authoring-guidance.md in the course package, then review the proposal here.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">Write guidance teachers can reuse across assessments.</p>
        <Button type="button" variant="secondary" onClick={() => setSourceMode((value) => !value)}>
          {sourceMode ? 'Rich text' : 'Markdown source'}
        </Button>
      </div>

      <div className="space-y-5 rounded-card border border-border bg-surface-2 p-4">
        <GuidanceField
          label="Course expectations"
          value={guidance.course_expectations_markdown}
          onChange={(value) => update('course_expectations_markdown', value)}
          sourceMode={sourceMode}
          readOnly={readOnly || busy}
          placeholder="Learning priorities, taught prerequisites, shared terminology..."
        />
        <GuidanceField
          label="Assignment rules"
          value={guidance.assignment_guidance_markdown}
          onChange={(value) => update('assignment_guidance_markdown', value)}
          sourceMode={sourceMode}
          readOnly={readOnly || busy}
          placeholder="How assignments should be written, checked, and assessed..."
        />
        <GuidanceField
          label="Test rules"
          value={guidance.test_guidance_markdown}
          onChange={(value) => update('test_guidance_markdown', value)}
          sourceMode={sourceMode}
          readOnly={readOnly || busy}
          placeholder="Question style, references, code formatting, rubric expectations..."
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-text-default">Unit rules</h3>
            <p className="text-sm text-text-muted">Add details that apply only when drafting for a named unit.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={readOnly || busy || guidance.unit_exceptions.length >= 100}
            onClick={() => onChange({
              ...guidance,
              unit_exceptions: [...guidance.unit_exceptions, {
                id: crypto.randomUUID(),
                unit_label: `Unit ${guidance.unit_exceptions.length + 1}`,
                assignment_guidance_markdown: '',
                test_guidance_markdown: '',
              }],
            })}
          >
            Add unit
          </Button>
        </div>
        {guidance.unit_exceptions.length === 0 ? (
          <div className="rounded-card border border-border bg-surface-2 px-4 py-5 text-sm text-text-muted">
            No unit rules yet. Course rules apply to every unit.
          </div>
        ) : guidance.unit_exceptions.map((unit, index) => (
          <div key={unit.id} className="space-y-4 rounded-card border border-border bg-surface-2 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <FormField label={`Unit ${index + 1} name`}>
                <Input
                  value={unit.unit_label}
                  onChange={(event) => updateUnit(unit.id, { unit_label: event.target.value })}
                  disabled={readOnly || busy}
                  placeholder="Unit 1: Foundations"
                  maxLength={160}
                />
              </FormField>
              <Button
                type="button"
                variant="secondary"
                disabled={readOnly || busy}
                onClick={() => onChange({
                  ...guidance,
                  unit_exceptions: guidance.unit_exceptions.filter((candidate) => candidate.id !== unit.id),
                })}
              >
                Remove unit
              </Button>
            </div>
            <GuidanceField
              label={`${unit.unit_label || `Unit ${index + 1}`} assignment rules`}
              value={unit.assignment_guidance_markdown}
              onChange={(value) => updateUnit(unit.id, { assignment_guidance_markdown: value })}
              sourceMode={sourceMode}
              readOnly={readOnly || busy}
              placeholder="Assignment details for this unit..."
            />
            <GuidanceField
              label={`${unit.unit_label || `Unit ${index + 1}`} test rules`}
              value={unit.test_guidance_markdown}
              onChange={(value) => updateUnit(unit.id, { test_guidance_markdown: value })}
              sourceMode={sourceMode}
              readOnly={readOnly || busy}
              placeholder="Test details for this unit..."
            />
          </div>
        ))}
      </div>

      {dirty && !readOnly ? (
        <div className="space-y-3 rounded-card border border-border bg-surface-2 p-4">
          <div className="font-semibold text-text-default">Try these changes on a draft</div>
          <p className="text-sm text-text-muted">Generate a temporary preview with the edited rules. The Blueprint guidance stays unchanged until you apply it.</p>
          <FormField label="Unit guidance for trial">
            <Select
              value={trialUnitId}
              onChange={(event) => setTrialUnitId(event.target.value)}
              className="max-w-sm"
              options={[
                { value: '', label: 'Course rules only' },
                ...guidance.unit_exceptions.map((unit) => ({
                  value: unit.id,
                  label: unit.unit_label,
                })),
              ]}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => onTryDraft('tests', trialUnitId || null)} disabled={busy}>Try a test draft</Button>
            <Button type="button" variant="secondary" onClick={() => onTryDraft('assignments', trialUnitId || null)} disabled={busy}>Try an assignment draft</Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm text-text-muted">
          {dirty ? 'Guidance has unsaved changes.' : 'Guidance is saved.'}
        </div>
        <Button type="button" onClick={() => setReviewing(true)} disabled={readOnly || busy || !dirty}>
          Review changes
        </Button>
      </div>

      {reviewing && dirty ? (
        <div className="space-y-4 rounded-card border border-border bg-surface-2 p-4">
          <h3 className="text-base font-semibold text-text-default">Review guidance changes</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium text-text-default">Saved · revision {revision}</div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-control border border-border bg-surface p-3 text-sm text-text-muted">{reviewText(savedGuidance)}</pre>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-text-default">Proposed</div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-control border border-border bg-surface p-3 text-sm text-text-muted">{reviewText(guidance)}</pre>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setReviewing(false)}>Keep editing</Button>
            <Button type="button" variant="secondary" onClick={() => {
              onChange(savedGuidance)
              setReviewing(false)
            }}>Reject changes</Button>
            <Button type="button" onClick={() => {
              onSave()
              setReviewing(false)
            }} disabled={busy}>{busy ? 'Saving...' : 'Apply guidance'}</Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-border pt-5">
        <h3 className="text-base font-semibold text-text-default">Guidance history</h3>
        {historyLoading ? <div className="text-sm text-text-muted">Loading revisions...</div> : null}
        {historyError ? <div role="status" className="text-sm text-text-muted">{historyError}</div> : null}
        {!historyLoading && !historyError && history.length === 0 ? (
          <div className="text-sm text-text-muted">No guidance revisions yet.</div>
        ) : null}
        {history.map((item) => (
          <details key={item.id} className="rounded-card border border-border bg-surface-2 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-text-default">
              Revision {item.content_revision} · {new Date(item.created_at).toLocaleString()} · {item.source_kind}
            </summary>
            <div className="mt-3 space-y-3 text-sm text-text-muted">
              {([
                ['Course expectations', item.guidance.course_expectations_markdown],
                ['Assignment rules', item.guidance.assignment_guidance_markdown],
                ['Test rules', item.guidance.test_guidance_markdown],
              ] as const).map(([label, content]) => (
                <div key={label}>
                  <div className="font-medium text-text-default">{label}</div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{content || 'No rules'}</pre>
                </div>
              ))}
              {item.guidance.unit_exceptions.map((unit) => (
                <div key={unit.id}>
                  <div className="font-medium text-text-default">{unit.unit_label}</div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{unit.assignment_guidance_markdown || 'No assignment rules'}</pre>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{unit.test_guidance_markdown || 'No test rules'}</pre>
                </div>
              ))}
              {!readOnly ? (
                <Button type="button" variant="secondary" onClick={() => onChange(item.guidance)} disabled={busy}>
                  Use as a new proposal
                </Button>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
