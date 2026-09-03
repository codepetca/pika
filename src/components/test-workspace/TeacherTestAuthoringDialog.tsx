'use client'

import { useEffect, useRef, useState } from 'react'
import { Code, Eye } from 'lucide-react'
import { TestDetailPanel } from '@/components/TestDetailPanel'
import { getDisplayAssessmentTitle } from '@/lib/assessment-titles'
import { Button, DialogPanel, IconButton, Tooltip } from '@/ui'
import type {
  AssessmentEditorSummaryUpdate,
  TestAssessmentWithStats,
} from '@/types'

type AuthoringView = 'edit' | 'markdown'

interface TeacherTestAuthoringDialogProps {
  isOpen: boolean
  initialView?: AuthoringView
  test: TestAssessmentWithStats | null
  classroomId: string
  apiBasePath: string
  hasPendingMarkdownImport: boolean
  publicationError?: string
  onClose: () => void
  discardPristineOnClose?: boolean
  onDiscardPristine?: () => Promise<boolean>
  onDraftSummaryChange: (update: AssessmentEditorSummaryUpdate) => void
  onTestUpdate: (update?: AssessmentEditorSummaryUpdate) => void
  onPendingMarkdownImportChange: (pending: boolean) => void
  onRequestPreview: (preview: { testId: string; title: string }) => void
  onRequestPublish: () => Promise<boolean>
}

export function TeacherTestAuthoringDialog({
  isOpen,
  initialView = 'edit',
  test,
  classroomId,
  apiBasePath,
  hasPendingMarkdownImport,
  publicationError = '',
  onClose,
  discardPristineOnClose = false,
  onDiscardPristine,
  onDraftSummaryChange,
  onTestUpdate,
  onPendingMarkdownImportChange,
  onRequestPreview,
  onRequestPublish,
}: TeacherTestAuthoringDialogProps) {
  const [authoringView, setAuthoringView] = useState<AuthoringView>('edit')
  const [titlePortalTarget, setTitlePortalTarget] = useState<HTMLDivElement | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const [isPreparingPublish, setIsPreparingPublish] = useState(false)
  const draftFlushRef = useRef<(() => Promise<boolean>) | null>(null)
  const draftPristineCheckRef = useRef<(() => boolean) | null>(null)

  useEffect(() => {
    if (isOpen) {
      setAuthoringView(initialView)
    }
  }, [isOpen, test?.id, initialView])

  const handleClose = async () => {
    if (isClosing) return
    setIsClosing(true)
    const saved = await (draftFlushRef.current?.() ?? Promise.resolve(true))
    if (saved) {
      if (
        discardPristineOnClose
        && draftPristineCheckRef.current?.()
        && onDiscardPristine
      ) {
        const discarded = await onDiscardPristine()
        if (discarded) {
          setAuthoringView('edit')
          setIsClosing(false)
          return
        }
        setIsClosing(false)
        return
      }
      setAuthoringView('edit')
      onClose()
    }
    setIsClosing(false)
  }

  const handlePublish = async () => {
    if (isClosing || isPreparingPublish) return
    setIsPreparingPublish(true)
    const saved = await (draftFlushRef.current?.() ?? Promise.resolve(true))
    if (saved && await onRequestPublish()) {
      setAuthoringView('edit')
      onClose()
    }
    setIsPreparingPublish(false)
  }

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={() => {
        void handleClose()
      }}
      ariaLabelledBy="test-authoring-dialog-title"
      maxWidth="max-w-6xl"
      className="h-[85vh] overflow-hidden p-0"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <h2
            id="test-authoring-dialog-title"
            className="text-xs font-medium text-text-muted"
          >
            Edit test
          </h2>
          <div
            ref={setTitlePortalTarget}
            className="mt-0.5 min-w-0 text-base font-semibold text-text-default"
          >
            {!titlePortalTarget && test
              ? getDisplayAssessmentTitle(test.title, 'Untitled Test')
              : null}
          </div>
        </div>
        <Tooltip content="Markdown view">
          <Button
            type="button"
            variant={authoringView === 'markdown' ? 'subtle' : 'secondary'}
            size="sm"
            aria-pressed={authoringView === 'markdown'}
            className="gap-1.5"
            onClick={() => {
              setAuthoringView((current) => (current === 'markdown' ? 'edit' : 'markdown'))
            }}
          >
            <Code className="h-4 w-4" aria-hidden="true" />
            <span>Code</span>
          </Button>
        </Tooltip>
        <IconButton
          icon={Eye}
          label="Preview"
          variant="secondary"
          onClick={() => {
            if (!test) return
            onRequestPreview({ testId: test.id, title: test.title })
          }}
          disabled={hasPendingMarkdownImport || !test}
        />
        {test?.status === 'draft' ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handlePublish()
            }}
            disabled={
              hasPendingMarkdownImport ||
              (test.stats.questions_count || 0) < 1 ||
              isClosing ||
              isPreparingPublish
            }
          >
            {isPreparingPublish ? 'Preparing...' : 'Publish'}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void handleClose()
          }}
          disabled={isClosing || isPreparingPublish}
        >
          {isClosing ? 'Saving...' : 'Close'}
        </Button>
      </div>
      {publicationError ? (
        <div
          role="alert"
          className="mx-4 mt-3 shrink-0 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
        >
          {publicationError}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {test ? (
          <TestDetailPanel
            test={test}
            classroomId={classroomId}
            apiBasePath={apiBasePath}
            onDraftSummaryChange={onDraftSummaryChange}
            onTestUpdate={onTestUpdate}
            onPendingMarkdownImportChange={onPendingMarkdownImportChange}
            onDraftFlushReady={(flush) => {
              draftFlushRef.current = flush
            }}
            onDraftPristineCheckReady={(check) => {
              draftPristineCheckRef.current = check
            }}
            onRequestTestPreview={onRequestPreview}
            showInlineDeleteAction={false}
            testQuestionLayout={authoringView === 'markdown' ? 'markdown-only' : 'editor-only'}
            showPreviewButton={false}
            showResultsTab={false}
            titlePortalTarget={titlePortalTarget}
            generatedTitleLabel="Untitled Test"
          />
        ) : null}
      </div>
    </DialogPanel>
  )
}
