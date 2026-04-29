'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import { TeacherWorkInspector } from '@/components/assignment-workspace/TeacherWorkInspector'
import { useTeacherStudentWorkController } from '@/components/assignment-workspace/useTeacherStudentWorkController'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import {
  ASSIGNMENT_GRADING_LAYOUT,
  clampAssignmentWorkspacePaneLayout,
  type AssignmentWorkspaceMode,
  type AssignmentWorkspacePaneLayout,
} from '@/lib/assignment-grading-layout'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'

interface TeacherStudentWorkPanelProps {
  classroomId: string
  assignmentId: string
  studentId: string
  refreshKey?: number
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
  inspectorEditMode?: boolean
  onDetailsMetaChange?: (meta: { studentName: string; characterCount: number } | null) => void
  onGradeTemplateChange?: (template: TeacherAssignmentGradeTemplate | null) => void
}

export interface TeacherAssignmentGradeTemplate {
  studentId: string
  scoreCompletion: string
  scoreThinking: string
  scoreWorkflow: string
  feedbackDraft: string
  gradeMode: 'draft' | 'graded'
}

export function TeacherStudentWorkPanel({
  classroomId,
  assignmentId,
  studentId,
  refreshKey = 0,
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
  inspectorEditMode = false,
  onDetailsMetaChange,
  onGradeTemplateChange,
}: TeacherStudentWorkPanelProps) {
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
    showDraftAutosavedNotice,
    gradeError,
    feedbackReturning,
    repoAnalyzing,
    feedbackEntries,
    repoReviewResult,
    totalScore,
    totalPercent,
    expandedSections,
    visibleSections,
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
    collapseAllSections,
    toggleSectionVisibility,
    handleReturnFeedback,
    handleSetGradeMode,
    handleAnalyzeRepo,
  } = useTeacherStudentWorkController({
    classroomId,
    assignmentId,
    studentId,
    refreshKey,
    onLoadingStateChange,
  })
  const previousInspectorEditModeRef = useRef(inspectorEditMode)
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

  useEffect(() => {
    if (!previousInspectorEditModeRef.current && inspectorEditMode) {
      collapseAllSections()
    }
    previousInspectorEditModeRef.current = inspectorEditMode
  }, [collapseAllSections, inspectorEditMode])

  useEffect(() => {
    if (mode !== 'details' || showInitialSpinner || error || !data) {
      onDetailsMetaChange?.(null)
      return
    }

    const nextDisplayContent = previewContent || data.doc?.content
    const nextCharacterCount =
      nextDisplayContent && !isEmpty(nextDisplayContent)
        ? countCharacters(nextDisplayContent)
        : 0
    const nextStudentDisplayName = data.student.name?.trim() || data.student.email

    onDetailsMetaChange?.({
      studentName: nextStudentDisplayName,
      characterCount: nextCharacterCount,
    })
  }, [data, error, mode, onDetailsMetaChange, previewContent, showInitialSpinner])

  useEffect(() => {
    return () => onGradeTemplateChange?.(null)
  }, [onGradeTemplateChange])

  useEffect(() => {
    if (mode !== 'overview' || showInitialSpinner || error || !data) {
      onGradeTemplateChange?.(null)
      return
    }

    onGradeTemplateChange?.({
      studentId,
      scoreCompletion,
      scoreThinking,
      scoreWorkflow,
      feedbackDraft,
      gradeMode,
    })
  }, [
    data,
    error,
    feedbackDraft,
    gradeMode,
    mode,
    onGradeTemplateChange,
    scoreCompletion,
    scoreThinking,
    scoreWorkflow,
    showInitialSpinner,
    studentId,
  ])

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
      showDraftAutosavedNotice={showDraftAutosavedNotice}
      repoAnalyzing={repoAnalyzing}
      expandedSections={expandedSections}
      visibleSections={visibleSections}
      editMode={inspectorEditMode}
      onToggleSection={toggleSection}
      onToggleSectionVisibility={toggleSectionVisibility}
      handleReturnFeedback={handleReturnFeedback}
      handleSetGradeMode={handleSetGradeMode}
      handleAnalyzeRepo={handleAnalyzeRepo}
    />
  )

  if (mode === 'overview') {
    return inspector
  }

  return (
    <TeacherWorkspaceSplit
      className="flex-1"
      primaryClassName={`flex min-h-0 flex-col ${
        previewEntry ? 'outline outline-2 outline-primary outline-offset-[-2px]' : ''
      }`}
      inspectorClassName="flex min-h-0 flex-col"
      inspectorCollapsed={layout.inspectorCollapsed}
      inspectorWidth={layout.inspectorWidth}
      minInspectorPx={ASSIGNMENT_GRADING_LAYOUT.inspectorMinPx}
      minPrimaryPx={ASSIGNMENT_GRADING_LAYOUT.detailsPrimaryMinPx}
      onInspectorCollapsedChange={(collapsed) => {
        updateLayout((current) => ({
          ...current,
          inspectorCollapsed: collapsed,
        }))
      }}
      onInspectorWidthChange={(nextInspectorWidth) => {
        updateLayout((current) => ({
          ...current,
          inspectorCollapsed: false,
          inspectorWidth: nextInspectorWidth,
        }))
      }}
      dividerLabel="Resize content and grading panes"
      primary={
        <>
          {previewEntry && (
            <div
              data-testid="individual-content-header"
              className="border-b border-border bg-surface px-4 py-2 text-sm"
            >
              <div className="text-xs font-medium text-primary">
                Previewing save from{' '}
                {formatInTimeZone(
                  new Date(previewEntry.created_at),
                  'America/Toronto',
                  'MMM d, h:mm a',
                )}
              </div>
            </div>
          )}
          {displayContent && !isEmpty(displayContent) ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <RichTextViewer content={displayContent} fillHeight chrome="flush" />
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-text-muted">
              No work submitted yet
            </div>
          )}
        </>
      }
      inspector={inspector}
    />
  )
}
