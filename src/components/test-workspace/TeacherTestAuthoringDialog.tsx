'use client'

import { useEffect, useState } from 'react'
import { Code, ExternalLink } from 'lucide-react'
import { TestDetailPanel } from '@/components/TestDetailPanel'
import { getDisplayAssessmentTitle } from '@/lib/assessment-titles'
import { Button, DialogPanel, Tooltip } from '@/ui'
import type {
  AssessmentEditorSummaryUpdate,
  TestAssessmentWithStats,
} from '@/types'

type AuthoringView = 'edit' | 'markdown'

interface TeacherTestAuthoringDialogProps {
  isOpen: boolean
  test: TestAssessmentWithStats | null
  classroomId: string
  apiBasePath: string
  hasPendingMarkdownImport: boolean
  onClose: () => void
  onDraftSummaryChange: (update: AssessmentEditorSummaryUpdate) => void
  onTestUpdate: (update?: AssessmentEditorSummaryUpdate) => void
  onPendingMarkdownImportChange: (pending: boolean) => void
  onRequestPreview: (preview: { testId: string; title: string }) => void
}

export function TeacherTestAuthoringDialog({
  isOpen,
  test,
  classroomId,
  apiBasePath,
  hasPendingMarkdownImport,
  onClose,
  onDraftSummaryChange,
  onTestUpdate,
  onPendingMarkdownImportChange,
  onRequestPreview,
}: TeacherTestAuthoringDialogProps) {
  const [authoringView, setAuthoringView] = useState<AuthoringView>('edit')
  const [titlePortalTarget, setTitlePortalTarget] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      setAuthoringView('edit')
    }
  }, [isOpen, test?.id])

  const handleClose = () => {
    setAuthoringView('edit')
    onClose()
  }

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={handleClose}
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            if (!test) return
            onRequestPreview({ testId: test.id, title: test.title })
          }}
          disabled={hasPendingMarkdownImport || !test}
          className="gap-1.5"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Preview
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleClose}
        >
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {test ? (
          <TestDetailPanel
            test={test}
            classroomId={classroomId}
            apiBasePath={apiBasePath}
            onDraftSummaryChange={onDraftSummaryChange}
            onTestUpdate={onTestUpdate}
            onPendingMarkdownImportChange={onPendingMarkdownImportChange}
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
