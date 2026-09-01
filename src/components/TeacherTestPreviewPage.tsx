'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize, X } from 'lucide-react'
import { Button } from '@/ui'
import {
  ExamDocumentWorkspace,
  type ExamDocumentItem,
} from '@/components/ExamDocumentWorkspace'
import { Spinner } from '@/components/Spinner'
import { StudentTestForm } from '@/components/StudentTestForm'
import { TEACHER_TESTS_UPDATED_EVENT } from '@/lib/events'
import { fetchJSON } from '@/lib/request-cache'
import { isLinkDocumentSnapshotStale, normalizeTestDocuments } from '@/lib/test-documents'
import { readTestFromPayload } from '@/lib/test-api-contract'
import type { TestAssessmentQuestion, TestDocument } from '@/types'

interface Props {
  classroomId: string
  testId: string
  embedded?: boolean
  listenForUpdates?: boolean
  onClose?: () => void
}

function isFullscreenActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement)
}

function isWindowNearMaximized(): boolean {
  if (typeof window === 'undefined') return false

  const availWidth = window.screen?.availWidth || window.innerWidth || 0
  const availHeight = window.screen?.availHeight || window.innerHeight || 0
  if (availWidth <= 0 || availHeight <= 0) return false

  const widthRatio = window.innerWidth / availWidth
  const heightRatio = window.innerHeight / availHeight
  return widthRatio >= 0.96 && heightRatio >= 0.9
}

function extractAllowedDocLinks(questions: TestAssessmentQuestion[]): ExamDocumentItem[] {
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  const plainUrlPattern = /\bhttps?:\/\/[^\s)]+/g
  const linksByUrl = new Map<string, ExamDocumentItem>()

  for (const question of questions) {
    const text = question.question_text || ''

    for (const match of text.matchAll(markdownLinkPattern)) {
      const title = (match[1] || '').trim()
      const url = (match[2] || '').trim()
      if (!url || linksByUrl.has(url)) continue
      linksByUrl.set(url, { id: url, title: title || url, source: 'link', url })
    }

    for (const match of text.matchAll(plainUrlPattern)) {
      const url = (match[0] || '').trim()
      if (!url || linksByUrl.has(url)) continue
      linksByUrl.set(url, { id: url, title: url, source: 'link', url })
    }
  }

  return Array.from(linksByUrl.values())
}

export function TeacherTestPreviewPage({
  classroomId,
  testId,
  embedded = false,
  listenForUpdates = false,
  onClose,
}: Props) {
  const [title, setTitle] = useState('Test Preview')
  const [questions, setQuestions] = useState<TestAssessmentQuestion[]>([])
  const [documents, setDocuments] = useState<TestDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [allowWindowMaximizedFallback, setAllowWindowMaximizedFallback] = useState(false)
  const [activeDoc, setActiveDoc] = useState<ExamDocumentItem | null>(null)
  const [loadedTestId, setLoadedTestId] = useState<string | null>(null)
  const fullscreenActiveRef = useRef(false)
  const autoSyncAttemptedRef = useRef<Set<string>>(new Set())
  const previewOwnerRef = useRef(testId)
  const previewRequestIdRef = useRef(0)

  const allowedDocs = useMemo(() => {
    const teacherManagedDocs = normalizeTestDocuments(documents).map((doc) => ({
      id: doc.id,
      title: doc.title,
      source: doc.source,
      url:
        doc.source === 'link'
          ? doc.snapshot_path
            ? `/api/teacher/tests/${testId}/documents/${doc.id}/snapshot`
            : undefined
          : doc.source === 'upload' && doc.storage_path
            ? `/api/teacher/tests/${testId}/documents/${doc.id}/file`
            : undefined,
      content: doc.content,
    }))
    if (teacherManagedDocs.length > 0) return teacherManagedDocs
    return extractAllowedDocLinks(questions)
  }, [documents, questions, testId])

  useEffect(() => {
    setActiveDoc((previous) => {
      if (!previous) return null
      return allowedDocs.find((doc) => doc.id === previous.id) ?? null
    })
  }, [allowedDocs])

  const requestExamFullscreen = useCallback(async (options?: { allowWindowFallback?: boolean }) => {
    const fullscreenElement = document.documentElement
    if (typeof fullscreenElement.requestFullscreen !== 'function') {
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
      if (!fullscreenNow && options?.allowWindowFallback) {
        setAllowWindowMaximizedFallback(isWindowNearMaximized())
      }
      return fullscreenNow
    }

    if (isFullscreenActive()) {
      fullscreenActiveRef.current = true
      setIsFullscreen(true)
      setAllowWindowMaximizedFallback(false)
      return true
    }

    try {
      await fullscreenElement.requestFullscreen()
    } catch {
      // Browsers can reject fullscreen when not initiated by a user gesture.
      // Preview mode should continue normally even when fullscreen is unavailable.
    } finally {
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
      if (fullscreenNow) {
        setAllowWindowMaximizedFallback(false)
      } else if (options?.allowWindowFallback) {
        setAllowWindowMaximizedFallback(isWindowNearMaximized())
      }
    }
    return isFullscreenActive()
  }, [])

  const maximizePreviewWindow = useCallback(() => {
    const maxWidth = Math.max(window.screen?.availWidth ?? 0, window.innerWidth ?? 0)
    const maxHeight = Math.max(window.screen?.availHeight ?? 0, window.innerHeight ?? 0)
    if (maxWidth <= 0 || maxHeight <= 0) return

    try {
      window.moveTo(0, 0)
      window.resizeTo(maxWidth, maxHeight)
    } catch {
      // Browsers may block scripted resize/move based on context/user settings.
    }
  }, [])

  const handleRequestMaximizeWindow = useCallback(() => {
    maximizePreviewWindow()
    setAllowWindowMaximizedFallback(isWindowNearMaximized())
    void requestExamFullscreen({ allowWindowFallback: true })
  }, [maximizePreviewWindow, requestExamFullscreen])

  useEffect(() => {
    const fullscreenNow = isFullscreenActive()
    fullscreenActiveRef.current = fullscreenNow
    setIsFullscreen(fullscreenNow)
    setAllowWindowMaximizedFallback(false)
  }, [])

  // Lock body scroll so the page-level container never scrolls in preview mode.
  // The root layout sets body.min-h-screen which allows body growth; this overrides it.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    if (loading || error) return
    if (!embedded) {
      maximizePreviewWindow()
      void requestExamFullscreen({ allowWindowFallback: true })
    }
  }, [embedded, error, loading, maximizePreviewWindow, requestExamFullscreen])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const wasFullscreen = fullscreenActiveRef.current
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
      if (fullscreenNow || wasFullscreen) {
        setAllowWindowMaximizedFallback(false)
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      if (!isFullscreenActive()) {
        setAllowWindowMaximizedFallback(isWindowNearMaximized())
      }
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const loadPreviewData = useCallback(async () => {
    const requestId = previewRequestIdRef.current + 1
    previewRequestIdRef.current = requestId
    const requestTestId = testId
    const isCurrentRequest = () => (
      previewOwnerRef.current === requestTestId
      && previewRequestIdRef.current === requestId
    )

    setLoading(true)
    setError('')
    try {
      const data = await fetchJSON<{
        questions?: TestAssessmentQuestion[]
        test?: { title?: string; documents?: unknown }
      }>(`/api/teacher/tests/${testId}`, {
        init: { cache: 'no-store' },
        errorMessage: 'Failed to load preview',
      })
      if (!isCurrentRequest()) return

      const responseTest = readTestFromPayload<{ title?: string; documents?: unknown }>(data)
      setTitle(responseTest?.title || 'Test Preview')
      setQuestions(data.questions || [])
      setDocuments(normalizeTestDocuments(responseTest?.documents))
      setLoadedTestId(requestTestId)
    } catch (err: any) {
      if (!isCurrentRequest()) return
      setError(err?.message || 'Failed to load preview')
      setLoadedTestId(requestTestId)
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
      }
    }
  }, [testId])

  useEffect(() => {
    previewOwnerRef.current = testId
    void loadPreviewData()
    return () => {
      previewRequestIdRef.current += 1
    }
  }, [loadPreviewData, testId])

  useEffect(() => {
    autoSyncAttemptedRef.current.clear()
    setActiveDoc(null)
  }, [testId])

  useEffect(() => {
    if (!listenForUpdates) return

    const handleTestsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail
      if (detail?.classroomId && detail.classroomId !== classroomId) return
      void loadPreviewData()
    }

    window.addEventListener(TEACHER_TESTS_UPDATED_EVENT, handleTestsUpdated)
    return () => {
      window.removeEventListener(TEACHER_TESTS_UPDATED_EVENT, handleTestsUpdated)
    }
  }, [classroomId, listenForUpdates, loadPreviewData])

  useEffect(() => {
    if (loadedTestId !== testId) return

    const staleDoc = normalizeTestDocuments(documents).find((doc) => {
      if (!isLinkDocumentSnapshotStale(doc)) return false
      const attemptKey = `${doc.id}:${doc.url || ''}:${doc.synced_at || ''}:${doc.snapshot_path || ''}`
      return !autoSyncAttemptedRef.current.has(attemptKey)
    })

    if (!staleDoc) return

    const attemptKey = `${staleDoc.id}:${staleDoc.url || ''}:${staleDoc.synced_at || ''}:${staleDoc.snapshot_path || ''}`
    autoSyncAttemptedRef.current.add(attemptKey)

    let isCancelled = false

    void (async () => {
      try {
        const response = await fetch(`/api/teacher/tests/${testId}/documents/${staleDoc.id}/sync`, {
          method: 'POST',
        })
        const data = await response.json()
        if (!response.ok || isCancelled) {
          if (!response.ok) {
            console.error(`Auto-sync failed for ${staleDoc.title}:`, data?.error || 'Unknown error')
          }
          return
        }

        const responseTest = readTestFromPayload<{ documents?: unknown }>(data)
        setDocuments(normalizeTestDocuments(responseTest?.documents))
      } catch (error) {
        if (!isCancelled) {
          console.error(`Auto-sync failed for ${staleDoc.title}:`, error)
        }
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [documents, loadedTestId, testId])

  function handleClosePreview() {
    if (onClose) {
      onClose()
      return
    }

    window.close()
    window.setTimeout(() => {
      if (!window.closed) {
        window.location.assign(`/classrooms/${classroomId}?tab=tests`)
      }
    }, 150)
  }

  const isLoadingCurrentPreview = loading || loadedTestId !== testId

  if (isLoadingCurrentPreview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-page px-4 py-6">
        <div className="mx-auto max-w-3xl rounded-xl border border-danger bg-danger-bg p-4 text-danger">
          <p>{error}</p>
          <Button type="button" variant="secondary" className="mt-3 gap-1.5" onClick={handleClosePreview}>
            <X className="h-4 w-4" />
            Close Preview
          </Button>
        </div>
      </div>
    )
  }

  const isPreviewMaximized = isFullscreen || allowWindowMaximizedFallback
  const showNotMaximizedWarning = !isPreviewMaximized
  const rootClassName = embedded
    ? 'fixed inset-0 z-[90] h-dvh overflow-hidden bg-page'
    : 'h-dvh overflow-hidden bg-page'

  return (
    <div
      role="region"
      aria-label="Teacher test preview"
      className={`${rootClassName} flex flex-col`}
    >
      {showNotMaximizedWarning && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[60] border-[10px] border-warning bg-warning-bg"
        />
      )}
      {showNotMaximizedWarning && (
        <div
          aria-hidden="true"
          data-testid="preview-content-obscurer"
          className="pointer-events-none fixed inset-0 z-[62] bg-warning-bg"
        />
      )}
      {showNotMaximizedWarning && (
        <div
          aria-hidden="true"
          data-testid="preview-interaction-blocker"
          className="pointer-events-none fixed inset-0 z-[64] cursor-not-allowed"
        />
      )}
      {showNotMaximizedWarning && (
        <div className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center px-4">
          <div className="pointer-events-auto rounded-xl border border-warning bg-surface p-4 shadow-xl">
            <p className="mb-3 text-center text-sm font-medium text-warning">
              Window must be maximized in exam mode.
            </p>
            <Button
              type="button"
              size="lg"
              className="w-full gap-2"
              onClick={handleRequestMaximizeWindow}
            >
              <Maximize className="h-5 w-5" />
              <span>Maximize Window</span>
            </Button>
          </div>
        </div>
      )}

      <div
        className={`flex-shrink-0 mx-auto w-full max-w-none px-3 pt-3 sm:px-4 ${
          showNotMaximizedWarning ? 'relative z-[66]' : ''
        }`}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant={showNotMaximizedWarning ? 'surface' : 'secondary'}
            size={showNotMaximizedWarning ? 'md' : 'sm'}
            className={showNotMaximizedWarning
              ? 'gap-2 border-warning/40 bg-surface shadow-lg hover:bg-surface-2'
              : 'gap-1.5'}
            onClick={handleClosePreview}
          >
            <X className="h-4 w-4" />
            Close Preview
          </Button>
          {!showNotMaximizedWarning ? (
            <span className="rounded-md border border-warning bg-warning-bg px-3 py-1 text-xs font-medium text-warning">
              Preview Mode
            </span>
          ) : null}
        </div>
      </div>

      {showNotMaximizedWarning ? (
        <div
          aria-hidden="true"
          className="pointer-events-none relative z-[66] flex flex-1 items-center justify-center px-3 pb-3 sm:px-4"
        />
      ) : (
        <div className="flex-1 min-h-0 mx-auto w-full max-w-none px-3 pb-3 sm:px-4">
          <ExamDocumentWorkspace
            resetKey={testId}
            activeDocument={activeDoc}
            documents={allowedDocs}
            onOpenDocument={setActiveDoc}
            onCloseDocument={() => setActiveDoc(null)}
            splitTestId="teacher-test-split-container"
            textViewerClassName="scrollbar-none"
            questionsPane={(
              <section
                aria-label="Test questions"
                className="h-full overflow-y-auto rounded-xl border border-border bg-surface p-3 scrollbar-none sm:p-4"
              >
                <h2 className="text-xl font-bold text-text-default">{title}</h2>
                {questions.length > 0 ? (
                  <StudentTestForm
                    testId={testId}
                    questions={questions}
                    previewMode
                    onSubmitted={() => {}}
                  />
                ) : (
                  <p className="mt-4 text-sm text-text-muted">No questions to preview.</p>
                )}
              </section>
            )}
          />
        </div>
      )}
    </div>
  )
}
