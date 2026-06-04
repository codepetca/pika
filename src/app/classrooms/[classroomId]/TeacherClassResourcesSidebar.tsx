'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/editor'
import type { Classroom, TiptapContent } from '@/types'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { isEmpty } from '@/lib/tiptap-content'
import {
  fetchTeacherClassResources,
  invalidateClassResourcesForClassroom,
} from '@/lib/class-resources-client'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 2000

type PendingResourceDraft = {
  classroomId: string
  content: TiptapContent
}

interface Props {
  classroom: Classroom
}

export function TeacherClassResourcesSidebar({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<TiptapContent>(EMPTY_DOC)
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const showLoadingSpinner = useDelayedBusy(loading)

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingContentRef = useRef<PendingResourceDraft | null>(null)
  const lastSavedContentRef = useRef<string>('')
  const currentClassroomIdRef = useRef(classroom.id)
  const loadRequestIdRef = useRef(0)
  const isArchived = !!classroom.archived_at
  currentClassroomIdRef.current = classroom.id

  useEffect(() => {
    async function loadResources() {
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
      pendingContentRef.current = null
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      setSaveStatus('saved')
      setLoading(true)
      try {
        const loadedContent = await fetchTeacherClassResources(classroom.id) ?? EMPTY_DOC
        if (loadRequestIdRef.current !== requestId) return
        setContent(loadedContent)
        lastSavedContentRef.current = JSON.stringify(loadedContent)
        setSaveStatus('saved')
        setLoadedClassroomId(classroom.id)
      } catch (err) {
        if (loadRequestIdRef.current !== requestId) return
        setContent(EMPTY_DOC)
        lastSavedContentRef.current = JSON.stringify(EMPTY_DOC)
        setSaveStatus('saved')
        setLoadedClassroomId(classroom.id)
        console.error('Error loading resources:', err)
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    }

    loadResources()
  }, [classroom.id])

  const saveContent = useCallback(async (newContent: TiptapContent) => {
    const saveClassroomId = classroom.id
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
      if (currentClassroomIdRef.current !== saveClassroomId) {
        return
      }

      lastSavedContentRef.current = newContentStr
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
  }, [classroom.id])

  const handleContentChange = useCallback((newContent: TiptapContent) => {
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
      if (pending) {
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

  return (
    <div className="px-3 py-3">
      <div className="space-y-4">
        {isArchived && (
          <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
            This classroom is archived. Resources are read-only.
          </div>
        )}

        {!hasContent && !isArchived && (
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <p className="mb-2 text-sm text-text-muted">
              Use this area to share static resources with your students:
            </p>
            <ul className="list-inside list-disc space-y-1 text-sm text-text-muted">
              <li>Contact information and office hours</li>
              <li>Links to external resources</li>
              <li>Rubrics and grading policies</li>
              <li>Class expectations and rules</li>
            </ul>
          </div>
        )}

        <div className="rounded-lg bg-surface p-4 shadow-sm">
          <RichTextEditor
            content={currentContent}
            onChange={handleContentChange}
            onBlur={handleBlur}
            placeholder="Add resources for your students..."
            editable={!isArchived}
            showToolbar={!isArchived}
            className="min-h-[400px]"
          />
        </div>
      </div>
    </div>
  )
}
