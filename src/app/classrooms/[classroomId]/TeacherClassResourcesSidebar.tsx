'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/editor'
import type { Classroom, TiptapContent } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { isEmpty } from '@/lib/tiptap-content'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 2000

interface Props {
  classroom: Classroom
}

export function TeacherClassResourcesSidebar({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<TiptapContent>(EMPTY_DOC)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const showLoadingSpinner = useDelayedBusy(loading)

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingContentRef = useRef<TiptapContent | null>(null)
  const lastSavedContentRef = useRef<string>('')
  const isArchived = !!classroom.archived_at

  useEffect(() => {
    async function loadResources() {
      setLoading(true)
      try {
        const data = await fetchJSONWithCache(
          `teacher-resources:${classroom.id}`,
          async () => {
            const res = await fetch(`/api/teacher/classrooms/${classroom.id}/resources`)
            if (!res.ok) throw new Error('Failed to load resources')
            return res.json()
          },
          20_000,
        )
        const loadedContent = data.resources?.content || EMPTY_DOC
        setContent(loadedContent)
        lastSavedContentRef.current = JSON.stringify(loadedContent)
        setSaveStatus('saved')
      } catch (err) {
        console.error('Error loading resources:', err)
      } finally {
        setLoading(false)
      }
    }

    loadResources()
  }, [classroom.id])

  const saveContent = useCallback(async (newContent: TiptapContent) => {
    const newContentStr = JSON.stringify(newContent)
    if (newContentStr === lastSavedContentRef.current) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/resources`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      })

      if (!res.ok) {
        throw new Error('Failed to save')
      }

      invalidateCachedJSON(`teacher-resources:${classroom.id}`)
      invalidateCachedJSON(`student-resources:${classroom.id}`)
      lastSavedContentRef.current = newContentStr
      setSaveStatus('saved')
    } catch (err) {
      console.error('Error saving resources:', err)
      setSaveStatus('unsaved')
    }
  }, [classroom.id])

  const handleContentChange = useCallback((newContent: TiptapContent) => {
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveContent(newContent)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [saveContent])

  const handleBlur = useCallback(() => {
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      saveContent(pendingContentRef.current)
    }
  }, [saveStatus, saveContent])

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingContentRef.current) {
        const contentStr = JSON.stringify(pendingContentRef.current)
        if (contentStr !== lastSavedContentRef.current) {
          navigator.sendBeacon(
            `/api/teacher/classrooms/${classroom.id}/resources`,
            new Blob([JSON.stringify({ content: pendingContentRef.current })], { type: 'application/json' }),
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

  const hasContent = !isEmpty(content)
  if (showLoadingSpinner) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="px-3 py-3">
      <div className="rounded-lg bg-surface shadow-sm">
        <div className="space-y-4 p-4">
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

          <RichTextEditor
            content={content}
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
