'use client'

import { useCallback, useMemo, useRef } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import { TeacherWorkInspector } from '@/components/assignment-workspace/TeacherWorkInspector'
import { useTeacherStudentWorkController } from '@/components/assignment-workspace/useTeacherStudentWorkController'
import { ACTIONBAR_ICON_BUTTON_CLASSNAME } from '@/components/PageLayout'
import {
  ASSIGNMENT_GRADING_LAYOUT,
  clampAssignmentWorkspacePaneLayout,
  type AssignmentWorkspaceMode,
  type AssignmentWorkspacePaneLayout,
} from '@/lib/assignment-grading-layout'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import { useWindowSize } from '@/hooks/use-window-size'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'

interface TeacherStudentWorkPanelProps {
  classroomId: string
  assignmentId: string
  studentId: string
  mode?: AssignmentWorkspaceMode
  inspectorCollapsed?: boolean
  inspectorWidth?: number
  totalWidth?: number
  onLayoutChange?: (
    next:
      | AssignmentWorkspacePaneLayout
      | ((current: AssignmentWorkspacePaneLayout) => AssignmentWorkspacePaneLayout),
  ) => void
  onLoadingStateChange?: (loading: boolean) => void
  onGoPrevStudent?: () => void
  onGoNextStudent?: () => void
  canGoPrevStudent?: boolean
  canGoNextStudent?: boolean
}

export function TeacherStudentWorkPanel({
  classroomId,
  assignmentId,
  studentId,
  mode = 'details',
  inspectorCollapsed = false,
  inspectorWidth = ASSIGNMENT_GRADING_LAYOUT.defaultInspectorWidth,
  totalWidth = 0,
  onLayoutChange,
  onLoadingStateChange,
  onGoPrevStudent,
  onGoNextStudent,
  canGoPrevStudent = false,
  canGoNextStudent = false,
}: TeacherStudentWorkPanelProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const {
    data,
    error,
    showInitialSpinner,
    historyEntries,
    historyLoading,
    historyError,
    previewEntry,
    previewContent,
    isPreviewLocked,
    scoreCompletion,
    scoreThinking,
    scoreWorkflow,
    feedbackDraft,
    hasFreshAIDraft,
    gradeMode,
    gradeSaving,
    gradeError,
    feedbackReturning,
    repoAnalyzing,
    feedbackEntries,
    repoReviewResult,
    totalScore,
    totalPercent,
    expandedSections,
    setScoreCompletion,
    setScoreThinking,
    setScoreWorkflow,
    setFeedbackDraft,
    handlePreviewHover,
    handlePreviewLock,
    handleExitPreview,
    handleHistoryMouseLeave,
    handleAIDraftAcknowledge,
    toggleSection,
    handleReturnFeedback,
    handleSetGradeMode,
    handleAnalyzeRepo,
  } = useTeacherStudentWorkController({
    classroomId,
    assignmentId,
    studentId,
    onLoadingStateChange,
  })
  const { width: viewportWidth } = useWindowSize()
  const isDesktop = viewportWidth >= DESKTOP_BREAKPOINT
  const layout = useMemo(
    () =>
      clampAssignmentWorkspacePaneLayout(
        {
          inspectorCollapsed,
          inspectorWidth,
        },
        mode,
        { totalWidth },
      ),
    [inspectorCollapsed, inspectorWidth, mode, totalWidth],
  )

  const updateLayout = useCallback(
    (
      next:
        | AssignmentWorkspacePaneLayout
        | ((current: AssignmentWorkspacePaneLayout) => AssignmentWorkspacePaneLayout),
    ) => {
      onLayoutChange?.(next)
    },
    [onLayoutChange],
  )

  const handleInspectorResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!workspaceRef.current) return

      event.preventDefault()
      const { right, width } = workspaceRef.current.getBoundingClientRect()
      if (width <= 0) return

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextInspectorWidth = ((right - moveEvent.clientX) / width) * 100
        updateLayout((current) => ({
          ...current,
          inspectorCollapsed: false,
          inspectorWidth: nextInspectorWidth,
        }))
      }

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [updateLayout],
  )

  const handleInspectorResizeReset = useCallback(() => {
    updateLayout((current) => ({
      ...current,
      inspectorCollapsed: false,
      inspectorWidth: 50,
    }))
  }, [updateLayout])

  if (showInitialSpinner) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return <div className="p-4 text-sm text-danger">{error}</div>
  }

  if (!data) {
    return <div className="p-4 text-sm text-text-muted">No data</div>
  }

  const displayContent = previewContent || data.doc?.content
  const repoDisplayUrl =
    data.repo_target.submittedRepoUrl ||
    data.repo_target.effectiveRepoUrl ||
    data.repo_target.target?.selected_repo_url ||
    ''
  const repoDisplayGitHubUsername =
    data.repo_target.submittedGitHubUsername ||
    data.repo_target.effectiveGitHubUsername ||
    repoReviewResult?.github_login ||
    ''
  const studentDisplayName = data.student.name?.trim() || data.student.email
  const characterCount =
    displayContent && !isEmpty(displayContent) ? countCharacters(displayContent) : 0
  const inspectorPaneStyle = layout.inspectorCollapsed
    ? undefined
    : isDesktop
      ? ({
          width: `${layout.inspectorWidth}%`,
          flexBasis: `${layout.inspectorWidth}%`,
        } as const)
      : undefined

  const inspector = (
    <TeacherWorkInspector
      data={data}
      historyEntries={historyEntries}
      historyLoading={historyLoading}
      historyError={historyError}
      previewEntry={previewEntry}
      onEntryClick={handlePreviewLock}
      onEntryHover={handlePreviewHover}
      onHistoryMouseLeave={handleHistoryMouseLeave}
      isPreviewLocked={isPreviewLocked}
      onExitPreview={handleExitPreview}
      repoReviewResult={repoReviewResult}
      scoreCompletion={scoreCompletion}
      setScoreCompletion={setScoreCompletion}
      scoreThinking={scoreThinking}
      setScoreThinking={setScoreThinking}
      scoreWorkflow={scoreWorkflow}
      setScoreWorkflow={setScoreWorkflow}
      totalPercent={totalPercent}
      totalScore={totalScore}
      feedbackEntries={feedbackEntries}
      feedbackDraft={feedbackDraft}
      hasFreshAIDraft={hasFreshAIDraft}
      setFeedbackDraft={setFeedbackDraft}
      onAIDraftAcknowledge={handleAIDraftAcknowledge}
      gradeMode={gradeMode}
      gradeError={gradeError}
      feedbackReturning={feedbackReturning}
      gradeSaving={gradeSaving}
      repoAnalyzing={repoAnalyzing}
      expandedSections={expandedSections}
      onToggleSection={toggleSection}
      handleReturnFeedback={handleReturnFeedback}
      handleSetGradeMode={handleSetGradeMode}
      handleAnalyzeRepo={handleAnalyzeRepo}
    />
  )

  if (mode === 'overview') {
    return inspector
  }

  return (
    <div ref={workspaceRef} className="relative flex h-full min-h-0 flex-col lg:flex-row">
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          previewEntry ? 'outline outline-2 outline-primary outline-offset-[-2px]' : ''
        }`}
      >
        <div
          data-testid="individual-content-header"
          className="border-b border-border bg-surface px-4 py-2 text-sm"
        >
          <div className="flex flex-col gap-1 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <div
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
            >
              <div
                className="min-w-0 truncate font-medium text-text-default"
                title={studentDisplayName}
              >
                {studentDisplayName}
              </div>
              {(repoDisplayUrl || repoDisplayGitHubUsername) && (
                <>
                  <span className="text-text-muted" aria-hidden="true">
                    /
                  </span>
                  <div className="min-w-0 truncate text-text-muted">
                    <span className="text-text-muted">Repo </span>
                    {repoDisplayUrl ? (
                      <a
                        href={repoDisplayUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {repoDisplayUrl}
                      </a>
                    ) : (
                      '—'
                    )}
                  </div>
                  {repoDisplayGitHubUsername && (
                    <div className="truncate text-text-muted">
                      <span className="font-medium text-text-default">
                        @{repoDisplayGitHubUsername}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div
              className="inline-flex shrink-0 items-center justify-center text-xs text-text-muted sm:justify-self-center"
              aria-label={`${characterCount} characters`}
            >
              <span>{characterCount} chars</span>
            </div>
            {(onGoPrevStudent || onGoNextStudent) && (
              <div className="flex items-center gap-1 sm:justify-self-end">
                <button
                  type="button"
                  className={ACTIONBAR_ICON_BUTTON_CLASSNAME}
                  onClick={onGoPrevStudent}
                  disabled={!onGoPrevStudent || !canGoPrevStudent}
                  aria-label="Previous student"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={ACTIONBAR_ICON_BUTTON_CLASSNAME}
                  onClick={onGoNextStudent}
                  disabled={!onGoNextStudent || !canGoNextStudent}
                  aria-label="Next student"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          {previewEntry && (
            <div className="mt-1 text-xs font-medium text-primary">
              Previewing save from{' '}
              {formatInTimeZone(
                new Date(previewEntry.created_at),
                'America/Toronto',
                'MMM d, h:mm a',
              )}
            </div>
          )}
        </div>
        {displayContent && !isEmpty(displayContent) ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <RichTextViewer content={displayContent} fillHeight chrome="flush" />
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-text-muted">
            No work submitted yet
          </div>
        )}
      </div>

      {!layout.inspectorCollapsed && (
        <div className="relative hidden w-0 shrink-0 lg:block">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize content and grading panes"
            className="absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize bg-transparent"
            onPointerDown={handleInspectorResizeStart}
            onDoubleClick={handleInspectorResizeReset}
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
          </div>
        </div>
      )}

      {!layout.inspectorCollapsed && (
        <div
          className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-surface lg:border-t-0"
          style={inspectorPaneStyle}
        >
          {inspector}
        </div>
      )}
    </div>
  )
}
