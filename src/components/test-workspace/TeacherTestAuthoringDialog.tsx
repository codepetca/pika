'use client'

import { useRef, useState } from 'react'
import { TestDetailPanel } from '@/components/TestDetailPanel'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
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
  onDiscardPristine?: (draftVersion: number, testUpdatedAt: string) => Promise<boolean>
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
  const [isClosing, setIsClosing] = useState(false)
  const [isPreparingPublish, setIsPreparingPublish] = useState(false)
  const draftFlushRef = useRef<(() => Promise<boolean>) | null>(null)
  const draftPristineCheckRef = useRef<(
    () => { isPristine: boolean; draftVersion: number; testUpdatedAt: string }
  ) | null>(null)

  const handleClose = async () => {
    if (isClosing) return
    setIsClosing(true)
    const saved = await (draftFlushRef.current?.() ?? Promise.resolve(true))
    if (saved) {
      const pristineState = draftPristineCheckRef.current?.()
      if (discardPristineOnClose && pristineState?.isPristine && onDiscardPristine) {
        const discarded = await onDiscardPristine(
          pristineState.draftVersion,
          pristineState.testUpdatedAt,
        )
        if (discarded) {
          setIsClosing(false)
          return
        }
        setIsClosing(false)
        return
      }
      onClose()
    }
    setIsClosing(false)
  }

  const handlePublish = async () => {
    if (isClosing || isPreparingPublish) return
    setIsPreparingPublish(true)
    const saved = await (draftFlushRef.current?.() ?? Promise.resolve(true))
    if (saved && await onRequestPublish()) {
      onClose()
    }
    setIsPreparingPublish(false)
  }

  return (
    <CreationModalShell
      isOpen={isOpen}
      onClose={() => {
        void handleClose()
      }}
      title="Edit test"
      titleId="test-authoring-dialog-title"
      closeLabel="Close test editor"
      showCloseButton={false}
      maxWidth="!max-w-6xl"
      panelClassName="!p-0"
      contentClassName="!overflow-hidden !p-0"
      tall
    >
      <div className="h-full min-h-0 overflow-hidden">
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
            testQuestionLayout="split"
            initialSplitView={initialView}
            onRequestClose={() => { void handleClose() }}
            onRequestPublish={() => { void handlePublish() }}
            publicationError={publicationError}
            isClosing={isClosing}
            isPreparingPublish={isPreparingPublish}
            showPreviewButton={false}
            showResultsTab={false}
            generatedTitleLabel="Untitled Test"
          />
        ) : null}
      </div>
    </CreationModalShell>
  )
}
