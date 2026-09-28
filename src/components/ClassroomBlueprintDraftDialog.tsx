'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, ContentDialog, FormField, Select } from '@/ui'
import type { Assignment, TestAssessment } from '@/types'
import type { CourseBlueprintAuthoringGuidance } from '@/lib/course-blueprint-authoring-guidance'
import { fetchCachedJSON } from '@/lib/request-cache'

type DraftTarget = 'assignments' | 'tests'

type ClassroomGuidanceContext = {
  source_blueprint_version_id: string
  source_blueprint_version_number: number
  guidance: CourseBlueprintAuthoringGuidance
}

type GuidedSuggestion = {
  content: string
  guidance: {
    source_blueprint_version_number: number
    unit_exception_id: string | null
    unit_label: string | null
    rules_markdown: string
  }
  draft_id: string
  original_content_sha256: string
  draft_provenance_token: string
}

type Props = {
  isOpen: boolean
  classroomId: string
  target: DraftTarget
  onClose: () => void
  onCreated: (result: { assignment?: Assignment; test?: TestAssessment }) => void
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}))
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function errorFrom(body: Record<string, unknown>, fallback: string): string {
  const message = typeof body.error === 'string' && body.error ? body.error : fallback
  const detail = Array.isArray(body.errors) && typeof body.errors[0] === 'string' ? body.errors[0] : null
  return detail ? `${message}: ${detail}` : message
}

const textareaClasses = 'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus-visible:border-primary focus-visible:ring-foundation focus-visible:ring-focus'

export function ClassroomBlueprintDraftDialog({
  isOpen,
  classroomId,
  target,
  onClose,
  onCreated,
}: Props) {
  const [context, setContext] = useState<ClassroomGuidanceContext | null>(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [unitId, setUnitId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [suggestion, setSuggestion] = useState<GuidedSuggestion | null>(null)
  const [content, setContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    if (!isOpen) return
    let active = true
    setContext(null)
    setLoadingContext(true)
    setUnitId('')
    setPrompt('')
    setSuggestion(null)
    setContent('')
    setError('')
    void (async () => {
      try {
        const body = await fetchCachedJSON<{ context: ClassroomGuidanceContext | null }>(
          `classroom-authoring-guidance:${classroomId}`,
          `/api/teacher/classrooms/${classroomId}/authoring-guidance`,
          { errorMessage: 'Failed to load Blueprint guidance' },
        )
        if (active) {
          setContext(body.context as ClassroomGuidanceContext | null)
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Failed to load Blueprint guidance')
        }
      } finally {
        if (active) setLoadingContext(false)
      }
    })()
    return () => { active = false }
  }, [isOpen, classroomId, target])

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!context || generating || creating) return
    const generation = ++generationRef.current
    setGenerating(true)
    setError('')
    setSuggestion(null)
    setContent('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/authoring-drafts/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, prompt, unit_exception_id: unitId || null }),
      })
      const body = await responseBody(response)
      if (generation !== generationRef.current) return
      if (!response.ok) throw new Error(errorFrom(body, 'Failed to draft from Blueprint'))
      const next = body.suggestion as GuidedSuggestion | undefined
      if (!next || typeof next.content !== 'string'
        || typeof next.draft_id !== 'string'
        || typeof next.original_content_sha256 !== 'string'
        || typeof next.draft_provenance_token !== 'string'
        || !next.guidance
        || typeof next.guidance.rules_markdown !== 'string'
        || typeof next.guidance.source_blueprint_version_number !== 'number'
        || (next.guidance.unit_exception_id !== null && typeof next.guidance.unit_exception_id !== 'string')
        || (next.guidance.unit_label !== null && typeof next.guidance.unit_label !== 'string')) {
        throw new Error('The generated draft was incomplete')
      }
      setSuggestion(next)
      setContent(next.content)
    } catch (cause) {
      if (generation === generationRef.current) {
        setError(cause instanceof Error ? cause.message : 'Failed to draft from Blueprint')
      }
    } finally {
      if (generation === generationRef.current) setGenerating(false)
    }
  }

  async function handleCreate() {
    if (!suggestion || !content.trim() || creating) return
    setCreating(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/authoring-drafts/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          content,
          draft_id: suggestion.draft_id,
          draft_provenance_token: suggestion.draft_provenance_token,
          original_content_sha256: suggestion.original_content_sha256,
          unit_exception_id: suggestion.guidance.unit_exception_id,
        }),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(errorFrom(body, 'Failed to create draft'))
      if (target === 'assignments' && !body.assignment) throw new Error('The assignment was not returned')
      if (target === 'tests' && !body.test) throw new Error('The test was not returned')
      onCreated({
        assignment: body.assignment as Assignment | undefined,
        test: body.test as TestAssessment | undefined,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create draft')
    } finally {
      setCreating(false)
    }
  }

  const singular = target === 'assignments' ? 'assignment' : 'test'
  const handleClose = () => { if (!creating) onClose() }
  const unitOptions = [
    { value: '', label: 'Whole course' },
    ...(context?.guidance.unit_exceptions.map((unit) => ({ value: unit.id, label: unit.unit_label })) ?? []),
  ]

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={handleClose}
      title={`Draft ${singular} with Blueprint`}
      subtitle="Review and edit before creating a draft"
      maxWidth="!max-w-3xl"
      panelClassName="w-full"
      showFooterClose={false}
      footer={(
        <>
          <Button type="button" variant="secondary" size="sm" onClick={handleClose} disabled={creating}>Cancel</Button>
          {suggestion ? (
            <Button type="button" size="sm" onClick={handleCreate} loading={creating} disabled={!content.trim()}>
              Create {singular} draft
            </Button>
          ) : null}
        </>
      )}
    >
      <div className="space-y-4">
        {loadingContext ? <p role="status" className="text-sm text-text-muted">Loading classroom Blueprint...</p> : null}
        {!loadingContext && !context && !error ? (
          <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-text-muted">
            This classroom has no saved Blueprint Version. Save a Version and create a classroom from it to use guided drafting.
          </p>
        ) : null}
        {context ? (
          <>
            <p className="text-sm text-text-muted">Using this classroom’s Blueprint Version {context.source_blueprint_version_number}.</p>
            <form onSubmit={handleGenerate} className="space-y-4">
              <FormField label="Unit" hint="Choose a unit to apply its additional guidance.">
                <Select
                  value={unitId}
                  options={unitOptions}
                  disabled={generating || creating}
                  onChange={(event) => {
                    setUnitId(event.target.value)
                    setSuggestion(null)
                    setContent('')
                  }}
                />
              </FormField>
              <FormField label={`What should this ${singular} cover?`} hint="Include the topic, skills, and any requirements for this draft.">
                <textarea
                  className={`${textareaClasses} min-h-24 resize-y`}
                  value={prompt}
                  disabled={generating || creating}
                  onChange={(event) => {
                    setPrompt(event.target.value)
                    setSuggestion(null)
                    setContent('')
                  }}
                />
              </FormField>
              <Button type="submit" size="sm" loading={generating} disabled={creating}>
                {suggestion ? 'Generate again' : 'Generate draft'}
              </Button>
            </form>
          </>
        ) : null}
        {suggestion ? (
          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-sm text-text-muted">
              Drafted with Version {suggestion.guidance.source_blueprint_version_number}
              {suggestion.guidance.unit_label ? ` · ${suggestion.guidance.unit_label}` : ' · whole course'}.
            </p>
            <details className="rounded-md border border-border bg-surface-2 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-text-default">Guidance applied</summary>
              <div className="mt-3 whitespace-pre-wrap text-text-muted">
                {suggestion.guidance.rules_markdown.trim() || 'This Version has no written rules for this target.'}
              </div>
            </details>
            <FormField label="Edit draft Markdown" hint="Check the content and formatting before creating an unpublished draft.">
              <textarea
                className={`${textareaClasses} min-h-72 resize-y font-mono`}
                value={content}
                disabled={creating}
                onChange={(event) => setContent(event.target.value)}
              />
            </FormField>
          </div>
        ) : null}
        {error ? <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}
      </div>
    </ContentDialog>
  )
}
