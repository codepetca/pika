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
  const pendingContentRef = useRef<PendingResourceDraft | null>(null)
  const lastSavedContentRef = useRef<string>('')
  const currentClassroomIdRef = useRef(classroom.id)
  const loadedClassroomIdRef = useRef<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const isArchived = !!classroom.archived_at
  currentClassroomIdRef.current = classroom.id

  useEffect(() => {
    async function loadResources() {
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
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
        const loadedContent = await fetchTeacherClassResources(classroom.id) ?? EMPTY_DOC
        if (loadRequestIdRef.current !== requestId) return
        setContent(loadedContent)
        lastSavedContentRef.current = JSON.stringify(loadedContent)
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

  const saveContent = useCallback(async (newContent: TiptapContent) => {
    const saveClassroomId = classroom.id
    if (loadedClassroomIdRef.current !== saveClassroomId) return
    const newContentStr = JSON.stringify(newContent)
    if (newContentStr === lastSavedContentRef.current) {
      const pending = pendingContentRef.current
      if (pending?.classroomId === saveClassroomId && JSON.stringify(pending.content) === newContentStr) {
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
        body: JSON.stringify({ content: newContent }),
      })

      if (!res.ok) {
        throw new Error('Failed to save')
      }

      invalidateClassResourcesForClassroom(saveClassroomId)
      invalidateCachedJSON(`classroom-course-guide:${saveClassroomId}`)
      if (classroom.actual_site_slug) {
        invalidateCachedJSON(`public-course-guide:${classroom.actual_site_slug}`)
      }
      if (currentClassroomIdRef.current !== saveClassroomId) {
        return
      }

      lastSavedContentRef.current = newContentStr
      onSaved?.(newContent)
      const pending = pendingContentRef.current
      const pendingMatchesSavedDraft =
        pending?.classroomId === saveClassroomId && JSON.stringify(pending.content) === newContentStr
      if (!pending || pendingMatchesSavedDraft) {
        pendingContentRef.current = null
        setSaveStatus('saved')
      }
    } catch (err) {
      console.error('Error saving resources:', err)
      if (currentClassroomIdRef.current === saveClassroomId) {
        setSaveStatus('unsaved')
      }
    }
  }, [classroom.id, classroom.actual_site_slug, onSaved])

  const handleContentChange = useCallback((newContent: TiptapContent) => {
    if (loadedClassroomIdRef.current !== classroom.id) return
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = {
      classroomId: classroom.id,
      content: newContent,
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveContent(newContent)
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
      saveContent(pending.content)
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
            new Blob([JSON.stringify({ content: pending.content })], { type: 'application/json' }),
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
