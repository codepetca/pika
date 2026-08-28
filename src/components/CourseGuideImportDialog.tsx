'use client'

import { useEffect, useState } from 'react'
import { FileUp, Link as LinkIcon } from 'lucide-react'
import { ContentField, MarkdownContentEditor } from '@/components/editor'
import type { CourseGuideImportDraft } from '@/lib/course-guide-import'
import { Button, ContentDialog, FormField, Input, cn } from '@/ui'
import type { Classroom } from '@/types'

type SourceType = 'file' | 'url'
type Step = 'source' | 'review' | 'confirm'

type Props = {
  isOpen: boolean
  classroom: Classroom
  onApplied: (classroom: Classroom) => void
  onClose: () => void
}

type DraftResponse = {
  draft?: CourseGuideImportDraft
  error?: string
}

export function CourseGuideImportDialog({
  isOpen,
  classroom,
  onApplied,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>('source')
  const [sourceType, setSourceType] = useState<SourceType>('file')
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [draft, setDraft] = useState<CourseGuideImportDraft | null>(null)
  const [reviewedMarkdown, setReviewedMarkdown] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setStep('source')
    setSourceType('file')
    setFile(null)
    setSourceUrl('')
    setDraft(null)
    setReviewedMarkdown('')
    setExtracting(false)
    setApplying(false)
    setError('')
  }, [isOpen, classroom.id])

  const busy = extracting || applying

  function close() {
    if (!busy) onClose()
  }

  async function extractDraft() {
    if (extracting) return
    if (sourceType === 'file' && !file) {
      setError('Choose a curriculum PDF.')
      return
    }
    if (sourceType === 'url' && !sourceUrl.trim()) {
      setError('Add a public document URL.')
      return
    }

    const formData = new FormData()
    formData.set('sourceType', sourceType)
    formData.set('sourceUrl', sourceType === 'url' ? sourceUrl.trim() : '')
    if (sourceType === 'file' && file) formData.set('file', file)

    setExtracting(true)
    setError('')
    try {
      const response = await fetch(
        `/api/teacher/classrooms/${encodeURIComponent(classroom.id)}/curriculum-import/draft`,
        { method: 'POST', body: formData },
      )
      const data = await response.json().catch(() => ({})) as DraftResponse
      if (!response.ok || !data.draft) {
        throw new Error(data.error || 'Pika could not extract this curriculum source.')
      }
      setDraft(data.draft)
      setReviewedMarkdown(data.draft.draftMarkdown)
      setStep('review')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pika could not extract this curriculum source.')
    } finally {
      setExtracting(false)
    }
  }

  async function applyDraft() {
    if (!draft || applying) return
    setApplying(true)
    setError('')
    try {
      const response = await fetch(
        `/api/teacher/classrooms/${encodeURIComponent(classroom.id)}/curriculum-import/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draftMarkdown: reviewedMarkdown,
            expectedOverviewMarkdown: classroom.course_overview_markdown || '',
            sourceTitle: draft.sourceTitle,
            sourceUrl: draft.sourceUrl,
            sourceFilename: draft.sourceFilename,
          }),
        },
      )
      const data = await response.json().catch(() => ({})) as { classroom?: Classroom; error?: string }
      if (!response.ok || !data.classroom) {
        throw new Error(data.error || 'The reviewed curriculum draft could not be added.')
      }
      onApplied(data.classroom)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reviewed curriculum draft could not be added.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={close}
      title="Import curriculum"
      subtitle={step === 'source'
        ? 'Create a draft from one curriculum source.'
        : step === 'review'
          ? 'Review and edit before anything is added.'
          : 'Confirm the reviewed draft.'}
      maxWidth="!max-w-3xl"
      showFooterClose={false}
    >
      <div className="space-y-4">
        <ol aria-label="Import progress" className="flex items-center gap-2 text-xs text-text-muted">
          {(['source', 'review', 'confirm'] as const).map((item, index) => (
            <li
              key={item}
              aria-current={step === item ? 'step' : undefined}
              className={cn(
                'rounded-control border border-border px-2 py-1',
                step === item && 'border-primary bg-primary-subtle text-primary',
              )}
            >
              {index + 1}. {item === 'source' ? 'Source' : item === 'review' ? 'Review' : 'Confirm'}
            </li>
          ))}
        </ol>

        {step === 'source' ? (
          <>
            <div className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
              Pika creates a one-time draft. It will not keep this file or synchronize future curriculum changes.
            </div>
            <div role="group" aria-label="Curriculum source type" className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="secondary"
                aria-pressed={sourceType === 'file'}
                onClick={() => {
                  setSourceType('file')
                  setError('')
                }}
                className={cn('justify-start', sourceType === 'file' && 'border-primary text-primary')}
              >
                <FileUp className="h-4 w-4" aria-hidden="true" />
                Upload PDF
              </Button>
              <Button
                type="button"
                variant="secondary"
                aria-pressed={sourceType === 'url'}
                onClick={() => {
                  setSourceType('url')
                  setError('')
                }}
                className={cn('justify-start', sourceType === 'url' && 'border-primary text-primary')}
              >
                <LinkIcon className="h-4 w-4" aria-hidden="true" />
                Public URL
              </Button>
            </div>

            {sourceType === 'file' ? (
              <FormField
                label="Curriculum PDF"
                hint="PDF only, up to 20 MB. Scanned pages may take longer to extract."
              >
                <Input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={extracting}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null)
                    setError('')
                  }}
                />
              </FormField>
            ) : (
              <FormField
                label="Public document URL"
                hint="Use a direct HTTPS link to a public curriculum page or document."
              >
                <Input
                  type="url"
                  value={sourceUrl}
                  placeholder="https://www.example.ca/curriculum.pdf"
                  disabled={extracting}
                  onChange={(event) => {
                    setSourceUrl(event.target.value)
                    setError('')
                  }}
                />
              </FormField>
            )}
          </>
        ) : null}

        {step === 'review' && draft ? (
          <>
            <div className="rounded-control border border-primary bg-primary-subtle px-3 py-2 text-sm text-text-default">
              <span className="font-medium">Extracted from:</span>{' '}
              {draft.sourceUrl ? (
                <a
                  href={draft.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  {draft.sourceTitle}
                </a>
              ) : `${draft.sourceTitle} (uploaded PDF)`}
            </div>
            <ContentField
              label="Imported curriculum draft"
              hint="Check the overview, expectations, and useful links. Edit anything that needs correction; Pika keeps the source citation attached."
            >
              <MarkdownContentEditor
                markdown={reviewedMarkdown}
                onMarkdownChange={setReviewedMarkdown}
                editable
                toolbarPreset="none"
                aria-label="Imported curriculum draft"
                className="min-h-48 max-h-80 overflow-y-auto sm:max-h-96"
              />
            </ContentField>
            <p className="text-sm text-text-muted">
              Nothing has been added to the Course Guide yet.
            </p>
          </>
        ) : null}

        {step === 'confirm' && draft ? (
          <div className="space-y-3">
            <div className="rounded-control border border-warning bg-warning-bg px-3 py-3 text-sm text-warning">
              Confirm that you reviewed this draft. Pika will add it below the current curriculum overview; existing teacher content will remain unchanged.
            </div>
            <dl className="grid gap-3 rounded-control border border-border bg-surface-2 px-3 py-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-text-default">Source</dt>
                <dd className="mt-1 text-text-muted">{draft.sourceTitle}</dd>
              </div>
              <div>
                <dt className="font-medium text-text-default">Current guide</dt>
                <dd className="mt-1 text-text-muted">
                  {classroom.course_overview_markdown?.trim()
                    ? 'Existing content will be preserved.'
                    : 'The imported draft will become the overview.'}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={step === 'source' ? close : () => {
            setError('')
            setStep(step === 'confirm' ? 'review' : 'source')
          }} disabled={busy}>
            {step === 'source' ? 'Cancel' : 'Back'}
          </Button>
          {step === 'source' ? (
            <Button type="button" onClick={extractDraft} disabled={extracting}>
              {extracting ? 'Creating draft...' : 'Create draft'}
            </Button>
          ) : null}
          {step === 'review' ? (
            <Button
              type="button"
              onClick={() => {
                setError('')
                setStep('confirm')
              }}
              disabled={!reviewedMarkdown.trim()}
            >
              Continue to confirmation
            </Button>
          ) : null}
          {step === 'confirm' ? (
            <Button type="button" onClick={applyDraft} disabled={applying}>
              {applying ? 'Adding draft...' : 'Add reviewed draft'}
            </Button>
          ) : null}
        </div>
      </div>
    </ContentDialog>
  )
}
