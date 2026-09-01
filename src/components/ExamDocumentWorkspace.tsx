'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TestTextDocumentViewer } from '@/components/TestTextDocumentViewer'
import { WorkspaceSplitPane } from '@/components/WorkspaceSplitPane'
import { Button, cn } from '@/ui'

export interface ExamDocumentItem {
  id: string
  title: string
  source: 'link' | 'upload' | 'text'
  url?: string
  content?: string
}

interface ExamDocumentWorkspaceProps {
  activeDocument: ExamDocumentItem | null
  documents: ExamDocumentItem[]
  questionsPane: ReactNode
  onCloseDocument: () => void
  onOpenDocument: (document: ExamDocumentItem) => void
  className?: string
  documentListFooter?: ReactNode
  documentsPaneTestId?: string
  documentOpenIconTestId?: string
  onDocumentInteraction?: () => void
  onTextDocumentKeyUp?: KeyboardEventHandler<HTMLDivElement>
  onTextDocumentMouseUp?: MouseEventHandler<HTMLDivElement>
  resetKey: string
  splitTestId?: string
  textViewerClassName?: string
}

const DOCUMENTS_LIST_WIDTH_PERCENT = 30
const DOCUMENTS_OPEN_DEFAULT_WIDTH_PERCENT = 50
const DOCUMENTS_OPEN_MAX_WIDTH_PERCENT = 50
const DOCUMENTS_OPEN_MIN_WIDTH_PERCENT = 30
const DOCUMENTS_RESIZE_STEP_PERCENT = 5

function clampDocumentsWidth(value: number): number {
  if (!Number.isFinite(value)) return DOCUMENTS_OPEN_DEFAULT_WIDTH_PERCENT
  return Math.min(
    DOCUMENTS_OPEN_MAX_WIDTH_PERCENT,
    Math.max(DOCUMENTS_OPEN_MIN_WIDTH_PERCENT, Math.round(value * 10) / 10),
  )
}

export function ExamDocumentWorkspace({
  activeDocument,
  documents,
  questionsPane,
  onCloseDocument,
  onOpenDocument,
  className,
  documentListFooter,
  documentsPaneTestId,
  documentOpenIconTestId,
  onDocumentInteraction,
  onTextDocumentKeyUp,
  onTextDocumentMouseUp,
  resetKey,
  splitTestId,
  textViewerClassName,
}: ExamDocumentWorkspaceProps) {
  const splitRef = useRef<HTMLDivElement | null>(null)
  const backButtonRef = useRef<HTMLButtonElement | null>(null)
  const listHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const removePointerResizeListenersRef = useRef<(() => void) | null>(null)
  const documentButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const returnFocusDocumentIdRef = useRef<string | null>(null)
  const [openDocumentsWidth, setOpenDocumentsWidth] = useState(
    DOCUMENTS_OPEN_DEFAULT_WIDTH_PERCENT,
  )
  const [isPointerResizing, setIsPointerResizing] = useState(false)
  const documentIsOpen = activeDocument !== null
  const documentsWidth = documentIsOpen
    ? openDocumentsWidth
    : DOCUMENTS_LIST_WIDTH_PERCENT
  const questionsWidth = 100 - documentsWidth
  const iframeDocuments = useMemo(
    () => documents.filter((document) => document.source !== 'text' && Boolean(document.url)),
    [documents],
  )

  useEffect(() => {
    removePointerResizeListenersRef.current?.()
    setOpenDocumentsWidth(DOCUMENTS_OPEN_DEFAULT_WIDTH_PERCENT)
    setIsPointerResizing(false)
    returnFocusDocumentIdRef.current = null
  }, [resetKey])

  useEffect(() => () => {
    removePointerResizeListenersRef.current?.()
  }, [])

  useEffect(() => {
    if (activeDocument) {
      backButtonRef.current?.focus()
      return
    }

    const documentId = returnFocusDocumentIdRef.current
    if (!documentId) return
    returnFocusDocumentIdRef.current = null
    const trigger = documentButtonRefs.current.get(documentId)
    if (trigger) {
      trigger.focus()
    } else {
      listHeadingRef.current?.focus()
    }
  }, [activeDocument])

  const updateDocumentsWidthFromPointer = useCallback((clientX: number) => {
    const splitElement = splitRef.current
    if (!splitElement) return
    const { left, width } = splitElement.getBoundingClientRect()
    if (width <= 0) return
    setOpenDocumentsWidth(clampDocumentsWidth(((clientX - left) / width) * 100))
  }, [])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    onDocumentInteraction?.()
    removePointerResizeListenersRef.current?.()
    setIsPointerResizing(true)
    updateDocumentsWidthFromPointer(event.clientX)

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      onDocumentInteraction?.()
      updateDocumentsWidthFromPointer(moveEvent.clientX)
    }
    const handleResizeEnd = () => {
      setIsPointerResizing(false)
      removePointerResizeListeners()
    }
    const removePointerResizeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handleResizeEnd)
      window.removeEventListener('pointercancel', handleResizeEnd)
      window.removeEventListener('blur', handleResizeEnd)
      if (removePointerResizeListenersRef.current === removePointerResizeListeners) {
        removePointerResizeListenersRef.current = null
      }
    }

    removePointerResizeListenersRef.current = removePointerResizeListeners
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handleResizeEnd)
    window.addEventListener('pointercancel', handleResizeEnd)
    window.addEventListener('blur', handleResizeEnd)
  }, [onDocumentInteraction, updateDocumentsWidthFromPointer])

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') {
      nextWidth = openDocumentsWidth - DOCUMENTS_RESIZE_STEP_PERCENT
    } else if (event.key === 'ArrowRight') {
      nextWidth = openDocumentsWidth + DOCUMENTS_RESIZE_STEP_PERCENT
    } else if (event.key === 'Home') {
      nextWidth = DOCUMENTS_OPEN_MIN_WIDTH_PERCENT
    } else if (event.key === 'End') {
      nextWidth = DOCUMENTS_OPEN_MAX_WIDTH_PERCENT
    }

    if (nextWidth === null) return
    event.preventDefault()
    onDocumentInteraction?.()
    setOpenDocumentsWidth(clampDocumentsWidth(nextWidth))
  }, [onDocumentInteraction, openDocumentsWidth])

  const handleResizeReset = useCallback(() => {
    onDocumentInteraction?.()
    setOpenDocumentsWidth(DOCUMENTS_OPEN_DEFAULT_WIDTH_PERCENT)
  }, [onDocumentInteraction])

  const handleOpenDocument = useCallback((document: ExamDocumentItem) => {
    onDocumentInteraction?.()
    returnFocusDocumentIdRef.current = document.id
    onOpenDocument(document)
  }, [onDocumentInteraction, onOpenDocument])

  const handleCloseDocument = useCallback(() => {
    onDocumentInteraction?.()
    if (activeDocument) {
      returnFocusDocumentIdRef.current = activeDocument.id
    }
    onCloseDocument()
  }, [activeDocument, onCloseDocument, onDocumentInteraction])

  const splitStyle = {
    '--exam-documents-grow': documentsWidth,
    '--exam-questions-grow': questionsWidth,
  } as CSSProperties
  const paneTransitionClass = isPointerResizing
    ? ''
    : 'lg:transition-[flex-grow] lg:duration-standard lg:ease-standard motion-reduce:transition-none'

  return (
    <div ref={splitRef} className={cn('h-full min-h-0', className)} style={splitStyle}>
      <WorkspaceSplitPane
        data-testid={splitTestId}
        orientation="responsive"
        className={documentIsOpen ? 'gap-2 lg:gap-1' : 'gap-2'}
        leftPaneClassName={cn(
          'flex-1 lg:flex-none lg:basis-0 lg:grow-[var(--exam-documents-grow)]',
          paneTransitionClass,
        )}
        rightPaneClassName={cn(
          'flex-1 lg:flex-none lg:basis-0 lg:grow-[var(--exam-questions-grow)]',
          paneTransitionClass,
        )}
        divider={documentIsOpen ? {
          label: 'Resize documents and questions panes',
          onPointerDown: handleResizeStart,
          onKeyDown: handleResizeKeyDown,
          onDoubleClick: handleResizeReset,
          ariaValueMin: DOCUMENTS_OPEN_MIN_WIDTH_PERCENT,
          ariaValueMax: DOCUMENTS_OPEN_MAX_WIDTH_PERCENT,
          ariaValueNow: openDocumentsWidth,
        } : undefined}
        left={(
          <section
            aria-label="Test documents"
            data-testid={documentsPaneTestId}
            className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
            onPointerDown={onDocumentInteraction}
            onPointerMove={onDocumentInteraction}
            onWheel={onDocumentInteraction}
          >
            <div
              className={cn(
                'grid min-h-control shrink-0 items-center border-b border-border bg-surface-2 px-2 sm:px-3',
                documentIsOpen
                  ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
                  : 'grid-cols-[minmax(0,1fr)]',
              )}
            >
              {documentIsOpen ? (
                <Button
                  ref={backButtonRef}
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="justify-self-start gap-1 px-2 text-primary"
                  onClick={handleCloseDocument}
                  aria-label="Back to documents list"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
              ) : null}

              <h2
                ref={listHeadingRef}
                tabIndex={-1}
                className="relative flex min-h-5 min-w-0 items-center justify-center overflow-hidden text-center text-sm font-semibold text-text-default focus:outline-none"
              >
                <span className="sr-only">
                  {activeDocument?.title || 'Documents'}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-x-0 truncate transition-opacity duration-standard ease-standard motion-reduce:transition-none',
                    documentIsOpen ? 'opacity-0' : 'opacity-100',
                  )}
                >
                  Documents
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-x-0 truncate transition-opacity duration-standard ease-standard motion-reduce:transition-none',
                    documentIsOpen ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {activeDocument?.title || 'Documentation'}
                </span>
              </h2>

              {documentIsOpen ? (
                <span aria-hidden="true" className="invisible min-h-control min-w-control px-2 text-xs">
                  Back
                </span>
              ) : null}
            </div>

            <div className="relative min-h-0 flex-1">
              <div
                aria-hidden={documentIsOpen}
                className={cn(
                  'absolute inset-0 overflow-x-hidden overflow-y-auto p-3 scrollbar-hover sm:p-4 transition-opacity duration-standard ease-standard motion-reduce:transition-none',
                  documentIsOpen ? 'pointer-events-none opacity-0' : 'opacity-100',
                )}
              >
                {documents.length > 0 ? (
                  <div className="space-y-2">
                    {documents.map((document) => (
                      <Button
                        key={document.id}
                        ref={(node) => {
                          if (node) documentButtonRefs.current.set(document.id, node)
                          else documentButtonRefs.current.delete(document.id)
                        }}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full justify-between gap-2 text-left"
                        onClick={() => handleOpenDocument(document)}
                        tabIndex={documentIsOpen ? -1 : 0}
                      >
                        <span className="min-w-0 truncate">{document.title}</span>
                        <ChevronRight
                          aria-hidden="true"
                          data-testid={documentOpenIconTestId}
                          className="h-4 w-4 flex-shrink-0 text-text-muted"
                        />
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">No documents provided for this test.</p>
                )}
                {documentListFooter ? <div className="mt-4">{documentListFooter}</div> : null}
              </div>

              <div
                aria-hidden={!documentIsOpen}
                className={cn(
                  'absolute inset-0 overflow-hidden transition-opacity duration-standard ease-standard motion-reduce:transition-none',
                  documentIsOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                {activeDocument?.source === 'text' ? (
                  <div className="absolute inset-0 flex min-h-0">
                    <TestTextDocumentViewer
                      className={textViewerClassName}
                      content={activeDocument.content || ''}
                      onKeyUp={onTextDocumentKeyUp}
                      onMouseUp={onTextDocumentMouseUp}
                    />
                  </div>
                ) : null}

                <div
                  aria-hidden={activeDocument?.source === 'text'}
                  className={cn(
                    'absolute inset-0 overflow-hidden bg-white',
                    activeDocument?.source === 'text' && 'pointer-events-none opacity-0',
                  )}
                >
                  {iframeDocuments.map((document) => {
                    const isVisible = activeDocument?.id === document.id
                    return (
                      <iframe
                        key={document.id}
                        src={document.url}
                        title={document.title || 'Documentation'}
                        onFocus={onDocumentInteraction}
                        onPointerEnter={onDocumentInteraction}
                        className={cn(
                          'absolute inset-y-0 left-0 h-full w-[calc(100%+10px)] transition-opacity duration-fast motion-reduce:transition-none',
                          isVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
                        )}
                        sandbox="allow-same-origin allow-scripts allow-forms"
                        loading="eager"
                        tabIndex={isVisible ? 0 : -1}
                      />
                    )
                  })}

                  {documentIsOpen
                    && activeDocument?.source !== 'text'
                    && !activeDocument?.url ? (
                      <div className="flex h-full items-center justify-center p-4">
                        <p className="text-sm text-text-muted">This document is unavailable.</p>
                      </div>
                    ) : null}
                </div>
              </div>
            </div>
          </section>
        )}
        right={questionsPane}
      />
    </div>
  )
}
