'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Maximize2, X } from 'lucide-react'
import { Button } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { StudentQuizForm } from '@/components/StudentQuizForm'
import { normalizeTestDocuments } from '@/lib/test-documents'
import type { QuizQuestion, TestDocument } from '@/types'

interface Props {
  classroomId: string
  testId: string
}

interface AllowedDocItem {
  id: string
  title: string
  source: 'link' | 'upload' | 'text'
  url?: string
  content?: string
}

function isFullscreenActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement)
}

function extractAllowedDocLinks(questions: QuizQuestion[]): AllowedDocItem[] {
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  const plainUrlPattern = /\bhttps?:\/\/[^\s)]+/g
  const linksByUrl = new Map<string, AllowedDocItem>()

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

export function TeacherTestPreviewPage({ classroomId, testId }: Props) {
  const [title, setTitle] = useState('Test Preview')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [documents, setDocuments] = useState<TestDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeDoc, setActiveDoc] = useState<AllowedDocItem | null>(null)
  const fullscreenActiveRef = useRef(false)

  const allowedDocs = useMemo(() => {
    const teacherManagedDocs = normalizeTestDocuments(documents).map((doc) => ({
      id: doc.id,
      title: doc.title,
      source: doc.source,
      url: doc.url,
      content: doc.content,
    }))
    if (teacherManagedDocs.length > 0) return teacherManagedDocs
    return extractAllowedDocLinks(questions)
  }, [documents, questions])

  useEffect(() => {
    setActiveDoc((previous) => {
      if (!previous) return null
      return allowedDocs.some((doc) => doc.id === previous.id) ? previous : null
    })
  }, [allowedDocs])

  const requestExamFullscreen = useCallback(async () => {
    const fullscreenElement = document.documentElement
    if (typeof fullscreenElement.requestFullscreen !== 'function') {
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
      return
    }

    if (isFullscreenActive()) {
      fullscreenActiveRef.current = true
      setIsFullscreen(true)
      return
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
    }
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

  useEffect(() => {
    const fullscreenNow = isFullscreenActive()
    fullscreenActiveRef.current = fullscreenNow
    setIsFullscreen(fullscreenNow)
  }, [])

  useEffect(() => {
    if (loading || error) return
    maximizePreviewWindow()
    void requestExamFullscreen()
  }, [error, loading, maximizePreviewWindow, requestExamFullscreen])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    async function loadPreviewData() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/teacher/tests/${testId}`, { cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load preview')
        }

        if (isCancelled) return
        setTitle(data?.quiz?.title || 'Test Preview')
        setQuestions((data?.questions || []) as QuizQuestion[])
        setDocuments(normalizeTestDocuments(data?.quiz?.documents))
      } catch (err: any) {
        if (isCancelled) return
        setError(err?.message || 'Failed to load preview')
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    void loadPreviewData()

    return () => {
      isCancelled = true
    }
  }, [testId])

  function handleClosePreview() {
    window.close()
    window.setTimeout(() => {
      if (!window.closed) {
        window.location.assign(`/classrooms/${classroomId}?tab=tests`)
      }
    }, 150)
  }

  if (loading) {
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

  const showDocPanel = activeDoc !== null
  const showNotMaximizedWarning = !isFullscreen
  const iframeDocs = allowedDocs.filter((doc) => doc.source !== 'text' && Boolean(doc.url))

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-page">
      {showNotMaximizedWarning && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[60] border-[10px] border-warning bg-warning-bg/15"
        />
      )}
      {showNotMaximizedWarning && (
        <div
          aria-hidden="true"
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
              onClick={() => {
                void requestExamFullscreen()
              }}
            >
              <Maximize2 className="h-5 w-5" />
              <span>Maximize Window</span>
            </Button>
          </div>
        </div>
      )}

      <div className="flex-shrink-0 mx-auto w-full max-w-none px-3 pt-3 sm:px-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={handleClosePreview}>
            <X className="h-4 w-4" />
            Close Preview
          </Button>
          <span className="rounded-md border border-warning bg-warning-bg px-3 py-1 text-xs font-medium text-warning">
            Preview Mode
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 mx-auto w-full max-w-none px-3 pb-3 sm:px-4">
        <div
          className={`grid grid-cols-1 gap-2 h-full grid-rows-[1fr] ${
            showDocPanel ? 'lg:grid-cols-[50%_50%]' : 'lg:grid-cols-[30%_70%]'
          } lg:transition-[grid-template-columns] lg:duration-500 lg:ease-[cubic-bezier(0.22,1,0.36,1)]`}
        >
          <section
            className={`rounded-xl border border-border bg-surface h-full ${
              showDocPanel ? 'relative overflow-hidden p-0' : 'p-3 sm:p-4 overflow-y-auto scrollbar-hover'
            }`}
          >
            {showDocPanel ? (
              <div className="flex h-full flex-col bg-surface">
                <div className="grid h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-border bg-surface-2 px-3">
                  <button
                    type="button"
                    onClick={() => setActiveDoc(null)}
                    aria-label="Back to documents list"
                    className="inline-flex items-center gap-1 justify-self-start whitespace-nowrap rounded-md bg-info-bg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-info-bg-hover"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </button>
                  <span className="min-w-0 truncate text-center text-sm text-text-muted">
                    {activeDoc?.title || 'Documentation'}
                  </span>
                  <span
                    aria-hidden="true"
                    className="invisible inline-flex items-center gap-1 justify-self-end whitespace-nowrap rounded-md border border-primary/40 px-2 py-1 text-xs font-semibold"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </span>
                </div>

                {activeDoc?.source === 'text' ? (
                  <div className="scrollbar-hover min-h-0 flex-1 overflow-auto bg-surface-2 p-3">
                    <pre className="whitespace-pre-wrap break-words text-sm text-text-default">
                      {activeDoc.content || ''}
                    </pre>
                  </div>
                ) : iframeDocs.length > 0 ? (
                  <div className="group relative min-h-0 flex-1 overflow-hidden bg-white">
                    {iframeDocs.map((doc) => {
                      const isVisible = activeDoc?.id === doc.id
                      return (
                        <iframe
                          key={doc.id}
                          src={doc.url}
                          title={doc.title || 'Documentation'}
                          className={`absolute inset-y-0 left-0 h-full transition-[opacity,width] duration-150 motion-reduce:transition-none ${
                            isVisible
                              ? 'w-[calc(100%+12px)] opacity-100 group-hover:w-full group-focus-within:w-full'
                              : 'pointer-events-none w-full opacity-0'
                          }`}
                          sandbox="allow-same-origin allow-scripts allow-forms"
                          loading="eager"
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                    <p className="text-sm text-text-muted">This document is unavailable.</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                <h2 className="mb-3 text-lg font-semibold text-text-default">Documents</h2>
                {allowedDocs.length > 0 ? (
                  <div className="space-y-2">
                    {allowedDocs.map((doc) => (
                      <Button
                        key={doc.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => setActiveDoc(doc)}
                      >
                        {doc.title}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">No documents provided for this test.</p>
                )}
              </>
            )}
          </section>

          <section
            className={`rounded-xl border border-border bg-surface p-3 sm:p-4 h-full overflow-y-auto scrollbar-hover ${
              showNotMaximizedWarning ? 'border-warning bg-warning-bg/20' : ''
            }`}
          >
            <h2 className="text-xl font-bold text-text-default">{title}</h2>
            {questions.length > 0 ? (
              <StudentQuizForm
                quizId={testId}
                questions={questions}
                assessmentType="test"
                previewMode
                onSubmitted={() => {}}
              />
            ) : (
              <p className="mt-4 text-sm text-text-muted">No questions to preview.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
