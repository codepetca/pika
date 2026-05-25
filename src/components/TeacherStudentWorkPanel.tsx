'use client'

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import { TeacherWorkInspector } from '@/components/assignment-workspace/TeacherWorkInspector'
import { useTeacherStudentWorkController } from '@/components/assignment-workspace/useTeacherStudentWorkController'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import { summarizeArtifactUrl, type AssignmentArtifact } from '@/lib/assignment-artifacts'
import {
  ASSIGNMENT_GRADING_LAYOUT,
  clampAssignmentWorkspacePaneLayout,
  type AssignmentSplitPaneView,
  type AssignmentWorkspaceMode,
  type AssignmentWorkspacePaneLayout,
} from '@/lib/assignment-grading-layout'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import type { InspectorSectionId } from '@/components/assignment-workspace/types'

interface TeacherStudentWorkPanelProps {
  classroomId: string
  assignmentId: string
  studentId: string
  refreshKey?: number
  mode?: AssignmentWorkspaceMode | 'workspace'
  classPane?: ReactNode
  splitPaneView?: AssignmentSplitPaneView
  studentHeader?: ReactNode
  inspectorCollapsed?: boolean
  inspectorWidth?: number
  totalWidth?: number
  onLayoutChange?: (
    next:
      | AssignmentWorkspacePaneLayout
      | ((current: AssignmentWorkspacePaneLayout) => AssignmentWorkspacePaneLayout),
  ) => void
  onLoadingStateChange?: (loading: boolean) => void
  inspectorEditMode?: boolean
  onDetailsMetaChange?: (meta: { studentName: string; characterCount: number } | null) => void
  onGradeTemplateChange?: (template: TeacherAssignmentGradeTemplate | null) => void
  highlightedInspectorSections?: readonly InspectorSectionId[]
}

export interface TeacherAssignmentGradeTemplate {
  studentId: string
  scoreCompletion: string
  scoreThinking: string
  scoreWorkflow: string
  feedbackDraft: string
  gradeMode: 'draft' | 'graded'
}

function SubmittedArtifactsList({ artifacts }: { artifacts: AssignmentArtifact[] }) {
  if (artifacts.length === 0) return null

  return (
    <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Submitted artifacts
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {artifacts.map((artifact, index) => (
          <a
            key={`${artifact.url}:${index}`}
            href={artifact.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group overflow-hidden rounded-md border border-border bg-surface-2 hover:bg-surface-hover"
          >
            {artifact.type === 'image' ? (
              <div
                className="h-28 border-b border-border bg-surface bg-contain bg-center bg-no-repeat"
                style={{ backgroundImage: `url("${encodeURI(artifact.url)}")` }}
              />
            ) : null}
            <div className="min-w-0 px-3 py-2">
              <div className="text-xs font-medium text-text-default">
                {artifact.type === 'repo' ? 'Repo link' : artifact.type === 'image' ? 'Image' : 'Public link'}
              </div>
              <div className="truncate text-xs text-text-muted group-hover:text-text-default">
                {summarizeArtifactUrl(artifact.url)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

function AssignmentWorkspacePaneFrame({
  header,
  children,
}: {
  header?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header ? (
        <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
          {header}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

export function TeacherStudentWorkPanel({
  classroomId,
  assignmentId,
  studentId,
  refreshKey = 0,
  mode = 'details',
  classPane,
  splitPaneView = 'students-grading',
  studentHeader,
  inspectorCollapsed = false,
  inspectorWidth = ASSIGNMENT_GRADING_LAYOUT.defaultInspectorWidth,
  totalWidth = 0,
  onLayoutChange,
  onLoadingStateChange,
  inspectorEditMode = false,
  onDetailsMetaChange,
  onGradeTemplateChange,
  highlightedInspectorSections = [],
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
    feedbackEntries,
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
  } = useTeacherStudentWorkController({
    classroomId,
    assignmentId,
    studentId,
    refreshKey,
    onLoadingStateChange,
  })
  const previousInspectorEditModeRef = useRef(inspectorEditMode)
  const hasGradingPane = mode !== 'workspace' || splitPaneView !== 'students-content'
  const layoutMode: AssignmentWorkspaceMode =
    mode === 'workspace'
      ? splitPaneView === 'content-grading'
        ? 'details'
        : 'overview'
      : mode
  const layout = useMemo(
    () =>
      clampAssignmentWorkspacePaneLayout(
        {
          inspectorCollapsed,
          inspectorWidth,
        },
        layoutMode,
        { totalWidth },
      ),
    [inspectorCollapsed, inspectorWidth, layoutMode, totalWidth],
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
    const hasStudentContentPane = mode !== 'overview' && (
      mode !== 'workspace' || splitPaneView !== 'students-grading'
    )
    if (!hasStudentContentPane || showInitialSpinner || error || !data) {
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
  }, [data, error, mode, onDetailsMetaChange, previewContent, showInitialSpinner, splitPaneView])

  useEffect(() => {
    return () => onGradeTemplateChange?.(null)
  }, [onGradeTemplateChange])

  useEffect(() => {
    const shouldReportGradeTemplate = (mode === 'overview' || mode === 'workspace') && hasGradingPane
    if (!shouldReportGradeTemplate || showInitialSpinner || error || !data || data.student.id !== studentId) {
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
    hasGradingPane,
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
  const submittedArtifacts = submissionArtifactsToAssignmentArtifacts(data.submission_artifacts || [])
  const hasSubmittedArtifacts = submittedArtifacts.length > 0
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
      highlightedSections={highlightedInspectorSections}
      expandedSections={expandedSections}
      visibleSections={visibleSections}
      editMode={inspectorEditMode}
      onToggleSection={toggleSection}
      onToggleSectionVisibility={toggleSectionVisibility}
      handleReturnFeedback={handleReturnFeedback}
      handleSetGradeMode={handleSetGradeMode}
    />
  )

  const workPane = (
    <div className="flex h-full min-h-0 flex-col">
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
      <div className="min-h-0 flex-1 overflow-auto">
        {displayContent && !isEmpty(displayContent) ? (
          <RichTextViewer content={displayContent} fillHeight chrome="flush" />
        ) : !hasSubmittedArtifacts ? (
          <div className="flex h-32 items-center justify-center text-text-muted">
            No work submitted yet
          </div>
        ) : null}
        <SubmittedArtifactsList artifacts={submittedArtifacts} />
      </div>
    </div>
  )

  if (mode === 'overview') {
    return inspector
  }

  if (mode === 'workspace') {
    const primaryPane = splitPaneView === 'content-grading'
      ? workPane
      : classPane ?? workPane
    const inspectorPane = splitPaneView === 'students-content'
      ? workPane
      : inspector
    const primaryHeader = splitPaneView === 'content-grading' ? studentHeader : undefined
    const inspectorHeader = splitPaneView === 'students-content' ? studentHeader : undefined
    const primaryMinPx = splitPaneView === 'content-grading'
      ? ASSIGNMENT_GRADING_LAYOUT.detailsPrimaryMinPx
      : ASSIGNMENT_GRADING_LAYOUT.overviewPrimaryMinPx
    const dividerLabel =
      splitPaneView === 'students-grading'
        ? 'Resize students and grading panes'
        : splitPaneView === 'content-grading'
          ? 'Resize content and grading panes'
          : 'Resize students and content panes'

    return (
      <TeacherWorkspaceSplit
        className="flex-1"
        splitVariant="gapped"
        primaryClassName="min-h-0 rounded-lg bg-surface"
        inspectorClassName="min-h-0 rounded-lg bg-surface"
        inspectorCollapsed={layout.inspectorCollapsed}
        inspectorWidth={layout.inspectorWidth}
        minInspectorPx={ASSIGNMENT_GRADING_LAYOUT.inspectorMinPx}
        minPrimaryPx={primaryMinPx}
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
        dividerLabel={dividerLabel}
        primary={
          <AssignmentWorkspacePaneFrame header={primaryHeader}>
            {primaryPane}
          </AssignmentWorkspacePaneFrame>
        }
        inspector={
          <AssignmentWorkspacePaneFrame header={inspectorHeader}>
            {inspectorPane}
          </AssignmentWorkspacePaneFrame>
        }
      />
    )
  }

  return (
    <TeacherWorkspaceSplit
      className="flex-1"
      splitVariant="gapped"
      primaryClassName={`flex min-h-0 flex-col rounded-lg bg-surface ${
        previewEntry ? 'outline outline-2 outline-primary outline-offset-[-2px]' : ''
      }`}
      inspectorClassName="flex min-h-0 flex-col rounded-lg bg-surface"
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
      primary={workPane}
      inspector={inspector}
    />
  )
}
