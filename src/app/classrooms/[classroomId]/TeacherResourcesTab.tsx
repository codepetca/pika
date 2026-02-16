'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/editor'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { TeacherAnnouncementsSection } from './TeacherAnnouncementsSection'
import type { Classroom, TiptapContent } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 2000

type ResourcesSection = 'announcements' | 'class-resources'

interface Props {
  classroom: Classroom
  sectionParam?: string | null
  onSectionChange?: (section: ResourcesSection) => void
}

export function TeacherResourcesTab({
  classroom,
  sectionParam,
  onSectionChange = () => {},
}: Props) {
  const section: ResourcesSection = sectionParam === 'class-resources' ? 'class-resources' : 'announcements'

  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<TiptapContent>(EMPTY_DOC)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null)
  const showLoadingSpinner = useDelayedBusy(loading)

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingContentRef = useRef<TiptapContent | null>(null)
  const lastSavedContentRef = useRef<string>('')
  const isArchived = !!classroom.archived_at

  // Load resources on mount
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

  // Save content to server
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
      setLastSavedTime(new Date())
    } catch (err) {
      console.error('Error saving resources:', err)
      setSaveStatus('unsaved')
    }
  }, [classroom.id])

  // Handle content change with debounced autosave
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

  // Flush pending save on blur
  const handleBlur = useCallback(() => {
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      saveContent(pendingContentRef.current)
    }
  }, [saveStatus, saveContent])

  // Handle beforeunload - save pending changes with sendBeacon
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingContentRef.current) {
        const contentStr = JSON.stringify(pendingContentRef.current)
        if (contentStr !== lastSavedContentRef.current) {
          navigator.sendBeacon(
            `/api/teacher/classrooms/${classroom.id}/resources`,
            new Blob([JSON.stringify({ content: pendingContentRef.current })], { type: 'application/json' })
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

  const hasContent = content.content && content.content.length > 0
  const formattedTime = lastSavedTime
    ? lastSavedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <PageLayout>
      {/* Sub-tab navigation */}
      <div className="flex border-b border-border mb-4">
        <button
          type="button"
          onClick={() => onSectionChange('announcements')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'announcements'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          Announcements
        </button>
        <button
          type="button"
          onClick={() => onSectionChange('class-resources')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'class-resources'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          Class Resources
        </button>
      </div>

      {section === 'announcements' ? (
        <PageContent>
          <TeacherAnnouncementsSection classroom={classroom} />
        </PageContent>
      ) : (
        <PageContent>
          {showLoadingSpinner ? (
            <div className="flex items-center justify-center h-64">
              <Spinner />
            </div>
          ) : (
            <div className="bg-surface rounded-lg shadow-sm">
              <div className="flex items-center justify-between px-6 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-text-default">Class Resources</h2>
                <span
                  className={
                    'text-sm ' +
                    (saveStatus === 'saved'
                      ? 'text-text-muted'
                      : saveStatus === 'saving'
                        ? 'text-text-muted'
                        : 'text-warning')
                  }
                >
                  {saveStatus === 'saving' && 'Saving...'}
                  {saveStatus === 'saved' && formattedTime && `Last saved ${formattedTime}`}
                  {saveStatus === 'saved' && !formattedTime && ''}
                  {saveStatus === 'unsaved' && 'Unsaved changes'}
                </span>
              </div>

              <div className="p-6">
                {isArchived && (
                  <div className="mb-4 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
                    This classroom is archived. Resources are read-only.
                  </div>
                )}

                {!hasContent && !isArchived && (
                  <div className="mb-4 rounded-lg border border-border bg-surface-2 p-4">
                    <p className="text-sm text-text-muted mb-2">
                      Use this page to share static resources with your students:
                    </p>
                    <ul className="text-sm text-text-muted list-disc list-inside space-y-1">
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
          )}
        </PageContent>
      )}
    </PageLayout>
  )
}
