'use client'

import { useEffect, useRef, useState } from 'react'
import { TestDetailPanel } from '@/components/TestDetailPanel'
import { ClassroomBlueprintDraftSource } from '@/components/ClassroomBlueprintDraftSource'
import { Button } from '@/ui'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import type {
  AssessmentEditorSummaryUpdate,
  TestAssessment,
  TestAssessmentWithStats,
} from '@/types'

type AuthoringView = 'edit' | 'markdown'

interface TeacherTestAuthoringDialogProps {
  isOpen: boolean
  initialView?: AuthoringView
  test: TestAssessmentWithStats | null
  classroomId: string
  classroomName?: string
  apiBasePath: string
  hasPendingMarkdownImport: boolean
  publicationError?: string
  onClose: () => void
  onRequestDelete?: () => void
  discardPristineOnClose?: boolean
  onDiscardPristine?: (draftVersion: number, testUpdatedAt: string) => Promise<boolean>
  onDraftSummaryChange: (update: AssessmentEditorSummaryUpdate) => void
  onTestUpdate: (update?: AssessmentEditorSummaryUpdate) => void
  onPendingMarkdownImportChange: (pending: boolean) => void
  onRequestPreview: (preview: { testId: string; title: string }) => void
  onRequestPublish: () => Promise<boolean>
  onTestDateSaved?: (test: TestAssessment) => void
  onRequestUnpublish?: () => void
  canUnpublish?: boolean
}

export function TeacherTestAuthoringDialog({
  isOpen,
  initialView = 'edit',
  test,
  classroomId,
  classroomName,
  apiBasePath,
  publicationError = '',
  onClose,
  onRequestDelete,
  discardPristineOnClose = false,
  onDiscardPristine,
  onDraftSummaryChange,
  onTestUpdate,
  onPendingMarkdownImportChange,
  onRequestPreview,
  onRequestPublish,
  onTestDateSaved,
  onRequestUnpublish,
  canUnpublish,
}: TeacherTestAuthoringDialogProps) {
  const [isClosing, setIsClosing] = useState(false)
  const [isPreparingPublish, setIsPreparingPublish] = useState(false)
  const scopeKey = JSON.stringify([isOpen, test?.id, classroomId, apiBasePath])
  const scopeRef = useRef({ key: scopeKey })
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey }
  useEffect(() => {
    setIsPreparingPublish(false)
    const owner = scopeRef.current
    return () => { if (scopeRef.current === owner) scopeRef.current = { key: scopeKey } }
  }, [scopeKey])
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
    if (isClosing || isPreparingPublish) return false
    setIsPreparingPublish(true)
    const saved = await (draftFlushRef.current?.() ?? Promise.resolve(true))
    const prepared = saved && await onRequestPublish()
    if (prepared) onClose()
    setIsPreparingPublish(false)
    return prepared
  }

  const handleUnpublish = async () => {
    if (isClosing || isPreparingPublish || !canUnpublish || !onRequestUnpublish) return
    const owner = scopeRef.current
    setIsPreparingPublish(true)
    const saved = await (draftFlushRef.current?.() ?? Promise.resolve(true))
    if (scopeRef.current !== owner) return
    if (saved) onRequestUnpublish()
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
      closeDisabled={isClosing || isPreparingPublish}
      maxWidth="!max-w-6xl"
      panelClassName="!p-0"
      contentClassName="!overflow-hidden !p-0"
      tall
      footer={test && onRequestDelete ? (
        <Button type="button" variant="danger" onClick={onRequestDelete} disabled={isClosing || isPreparingPublish}>
          Delete test
        </Button>
      ) : undefined}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <ClassroomBlueprintDraftSource
          classroomId={classroomId}
          target="tests"
          artifactId={test?.id}
          isOpen={isOpen}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
        {test ? (
          <TestDetailPanel
            test={test}
            classroomId={classroomId}
            classroomName={classroomName}
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
            showCloseButton={false}
            onRequestPublish={handlePublish}
            onTestDateSaved={onTestDateSaved}
            onRequestUnpublish={onRequestUnpublish ? () => { void handleUnpublish() } : undefined}
            canUnpublish={canUnpublish}
            publicationError={publicationError}
            isClosing={isClosing}
            isPreparingPublish={isPreparingPublish}
            showPreviewButton={false}
            showResultsTab={false}
            generatedTitleLabel="Untitled Test"
          />
        ) : null}
        </div>
      </div>
    </CreationModalShell>
  )
}
