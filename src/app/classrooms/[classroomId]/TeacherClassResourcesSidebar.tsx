'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { ContentField, RichTextEditor } from '@/components/editor'
import type { Classroom, TiptapContent } from '@/types'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { isEmpty } from '@/lib/tiptap-content'
import {
  fetchTeacherClassResources,
  invalidateClassResourcesForClassroom,
} from '@/lib/class-resources-client'
import { invalidateCachedJSON } from '@/lib/request-cache'
import { Button } from '@/ui'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 2000

type PendingResourceDraft = {
  classroomId: string
  content: TiptapContent
  generation: number
  saveRevision: number
}

interface Props {
  classroom: Classroom
  onSaved?: (content: TiptapContent) => void
}

export function TeacherClassResourcesSidebar({ classroom, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<TiptapContent>(EMPTY_DOC)
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const showLoadingSpinner = useDelayedBusy(loading)

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingContentRef = useRef<PendingResourceDraft | null>(null)
  const lastSavedContentRef = useRef<string>('')
  const nextSaveRevisionRef = useRef(0)
  const currentClassroomIdRef = useRef(classroom.id)
  const loadedClassroomIdRef = useRef<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const loadGenerationRef = useRef(0)
  const isArchived = !!classroom.archived_at
  currentClassroomIdRef.current = classroom.id

  useEffect(() => {
    async function loadResources() {
      const requestId = loadRequestIdRef.current + 1
      const generation = loadGenerationRef.current + 1
      loadRequestIdRef.current = requestId
      loadGenerationRef.current = generation
      loadedClassroomIdRef.current = null
      setLoadedClassroomId(null)
      pendingContentRef.current = null
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      setSaveStatus('saved')
      setLoadError(null)
      setLoading(true)
      try {
        await saveQueueRef.current
        if (loadRequestIdRef.current !== requestId || loadGenerationRef.current !== generation) return
        const snapshot = await fetchTeacherClassResources(classroom.id)
        if (loadRequestIdRef.current !== requestId || loadGenerationRef.current !== generation) return
        const loadedContent = snapshot.content ?? EMPTY_DOC
        setContent(loadedContent)
        lastSavedContentRef.current = JSON.stringify(loadedContent)
        nextSaveRevisionRef.current = snapshot.saveRevision
        setSaveStatus('saved')
        setLoadedClassroomId(classroom.id)
        loadedClassroomIdRef.current = classroom.id
      } catch (err) {
        if (loadRequestIdRef.current !== requestId) return
        setSaveStatus('saved')
        setLoadError('Resources could not be loaded. Your existing resources have not been changed.')
        console.error('Error loading resources:', err)
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    }

    loadResources()
  }, [classroom.id, loadAttempt])

  const saveContent = useCallback((draft: PendingResourceDraft) => {
    const { classroomId: saveClassroomId, content: newContent, generation, saveRevision } = draft
    if (
      loadedClassroomIdRef.current !== saveClassroomId
      || loadGenerationRef.current !== generation
    ) return Promise.resolve()
    const newContentStr = JSON.stringify(newContent)
    const publicGuideSlug = classroom.actual_site_slug

    const saveTask = saveQueueRef.current.then(async () => {
      if (
        loadGenerationRef.current !== generation
        || loadedClassroomIdRef.current !== saveClassroomId
      ) {
        return
      }
      const latestPending = pendingContentRef.current
      if (
        latestPending?.classroomId === saveClassroomId
        && latestPending.generation === generation
        && latestPending.saveRevision > saveRevision
      ) {
        return
      }

      if (newContentStr === lastSavedContentRef.current) {
        if (latestPending?.classroomId === saveClassroomId) {
          pendingContentRef.current = null
        }
        if (currentClassroomIdRef.current === saveClassroomId) {
          setSaveStatus('saved')
        }
        return
      }

      if (currentClassroomIdRef.current === saveClassroomId) {
        setSaveStatus('saving')
      }

      try {
        const res = await fetch(`/api/teacher/classrooms/${saveClassroomId}/resources`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newContent, saveRevision }),
        })

        if (!res.ok) {
          throw new Error('Failed to save')
        }

        invalidateClassResourcesForClassroom(saveClassroomId)
        invalidateCachedJSON(`classroom-course-guide:${saveClassroomId}`)
        if (publicGuideSlug) {
          invalidateCachedJSON(`public-course-guide:${publicGuideSlug}`)
        }
        if (
          currentClassroomIdRef.current !== saveClassroomId
          || loadGenerationRef.current !== generation
        ) {
          return
        }

        lastSavedContentRef.current = newContentStr
        onSaved?.(newContent)
        const pending = pendingContentRef.current
        const pendingMatchesSavedDraft =
          pending?.classroomId === saveClassroomId
          && pending.generation === generation
          && pending.saveRevision === saveRevision
        if (!pending || pendingMatchesSavedDraft) {
          pendingContentRef.current = null
          setSaveStatus('saved')
        }
      } catch (err) {
        console.error('Error saving resources:', err)
        if (
          currentClassroomIdRef.current === saveClassroomId
          && loadGenerationRef.current === generation
        ) {
          setSaveStatus('unsaved')
        }
      }
    })

    saveQueueRef.current = saveTask
    return saveTask
  }, [classroom.actual_site_slug, onSaved])

  const handleContentChange = useCallback((newContent: TiptapContent) => {
    if (loadedClassroomIdRef.current !== classroom.id) return
    const saveRevision = nextSaveRevisionRef.current + 1
    nextSaveRevisionRef.current = saveRevision
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = {
      classroomId: classroom.id,
      content: newContent,
      generation: loadGenerationRef.current,
      saveRevision,
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      const pending = pendingContentRef.current
      if (pending?.classroomId === classroom.id && pending.saveRevision === saveRevision) {
        saveContent(pending)
      }
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [classroom.id, saveContent])

  const handleBlur = useCallback(() => {
    if (loadedClassroomIdRef.current !== classroom.id) return
    const pending = pendingContentRef.current
    if (saveStatus === 'unsaved' && pending?.classroomId === classroom.id) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      saveContent(pending)
    }
  }, [classroom.id, saveStatus, saveContent])

  useEffect(() => {
    const handleBeforeUnload = () => {
      const pending = pendingContentRef.current
      if (pending && loadedClassroomIdRef.current === pending.classroomId) {
        const contentStr = JSON.stringify(pending.content)
        if (contentStr !== lastSavedContentRef.current) {
          navigator.sendBeacon(
            `/api/teacher/classrooms/${pending.classroomId}/resources`,
            new Blob([
              JSON.stringify({ content: pending.content, saveRevision: pending.saveRevision }),
            ], { type: 'application/json' }),
          )
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [classroom.id])

  const currentContent = loadedClassroomId === classroom.id ? content : EMPTY_DOC
  const hasContent = !isEmpty(currentContent)
  if (showLoadingSpinner) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spinner />
      </div>
    )
  }

  if (loadError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
        <span>{loadError}</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            invalidateClassResourcesForClassroom(classroom.id)
            setLoadAttempt((attempt) => attempt + 1)
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {isArchived && (
        <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          This classroom is archived. Resources are read-only.
        </div>
      )}

      {!hasContent && !isArchived && (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <p className="text-sm leading-6 text-text-muted">
            Consider contact details, external or ministry links, grading policies, and class expectations.
          </p>
        </div>
      )}

      <ContentField
        label="Rules, links, and reference material"
        hint="This appears in the Resources section of the Course Guide and saves automatically."
        saveStatus={!isArchived ? saveStatus : undefined}
      >
        <RichTextEditor
          content={currentContent}
          onChange={handleContentChange}
          onBlur={handleBlur}
          placeholder="Add resources for your students..."
          editable={!isArchived && loadedClassroomId === classroom.id}
          toolbarPreset={isArchived ? 'none' : 'document'}
          aria-label="Course guide rules, links, and reference material"
          className="min-h-24 sm:min-h-28"
        />
      </ContentField>
    </div>
  )
}
