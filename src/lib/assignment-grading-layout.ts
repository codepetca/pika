export type AssignmentWorkspaceMode = 'overview' | 'details'

export interface AssignmentWorkspacePaneLayout {
  inspectorCollapsed: boolean
  inspectorWidth: number
}

export interface AssignmentGradingLayoutState {
  overview: AssignmentWorkspacePaneLayout
  details: AssignmentWorkspacePaneLayout
}

export interface AssignmentGradingLayoutMetrics {
  totalWidth: number
}

export const ASSIGNMENT_GRADING_LAYOUT = {
  defaultInspectorWidth: 40,
  inspectorMinPx: 320,
  overviewPrimaryMinPx: 420,
  detailsPrimaryMinPx: 360,
} as const

const DEFAULT_PANE_LAYOUT: AssignmentWorkspacePaneLayout = {
  inspectorCollapsed: false,
  inspectorWidth: ASSIGNMENT_GRADING_LAYOUT.defaultInspectorWidth,
}

const DEFAULT_LAYOUT: AssignmentGradingLayoutState = {
  overview: { ...DEFAULT_PANE_LAYOUT },
  details: { ...DEFAULT_PANE_LAYOUT },
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10
}

function clampNumber(value: number, min: number, max: number): number {
  if (max <= min) return min
  return Math.min(max, Math.max(min, value))
}

function isPercentNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getPrimaryMinPx(mode: AssignmentWorkspaceMode): number {
  return mode === 'overview'
    ? ASSIGNMENT_GRADING_LAYOUT.overviewPrimaryMinPx
    : ASSIGNMENT_GRADING_LAYOUT.detailsPrimaryMinPx
}

function parsePaneLayout(
  value: unknown,
  fallback: AssignmentWorkspacePaneLayout,
): AssignmentWorkspacePaneLayout {
  if (!value || typeof value !== 'object') return { ...fallback }

  const pane = value as Partial<AssignmentWorkspacePaneLayout>
  return {
    inspectorCollapsed: pane.inspectorCollapsed === true,
    inspectorWidth: isPercentNumber(pane.inspectorWidth)
      ? pane.inspectorWidth
      : fallback.inspectorWidth,
  }
}

export function getDefaultAssignmentGradingLayout(): AssignmentGradingLayoutState {
  return {
    overview: { ...DEFAULT_LAYOUT.overview },
    details: { ...DEFAULT_LAYOUT.details },
  }
}

export function getAssignmentGradingLayoutCookieName(classroomId: string): string {
  return `pika_assignment_grading_layout:${classroomId}`
}

export function getAssignmentWorkspaceStudentCookieName(
  classroomId: string,
  assignmentId: string,
): string {
  return `pika_assignment_workspace_student:${classroomId}:${assignmentId}`
}

export function serializeAssignmentGradingLayout(
  layout: AssignmentGradingLayoutState,
): string {
  return JSON.stringify(layout)
}

export function parseAssignmentGradingLayout(
  value: string | null | undefined,
): AssignmentGradingLayoutState {
  if (!value) return getDefaultAssignmentGradingLayout()

  try {
    const parsed = JSON.parse(value) as Partial<AssignmentGradingLayoutState>
    return {
      overview: parsePaneLayout(parsed.overview, DEFAULT_LAYOUT.overview),
      details: parsePaneLayout(parsed.details, DEFAULT_LAYOUT.details),
    }
  } catch {
    return getDefaultAssignmentGradingLayout()
  }
}

export function parseAssignmentWorkspaceStudentId(
  value: string | null | undefined,
): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function clampAssignmentWorkspacePaneLayout(
  layout: AssignmentWorkspacePaneLayout,
  mode: AssignmentWorkspaceMode,
  { totalWidth }: AssignmentGradingLayoutMetrics,
): AssignmentWorkspacePaneLayout {
  const base = {
    ...DEFAULT_PANE_LAYOUT,
    ...layout,
  }

  if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
    return {
      inspectorCollapsed: base.inspectorCollapsed,
      inspectorWidth: roundPercent(base.inspectorWidth),
    }
  }

  if (base.inspectorCollapsed) {
    return {
      inspectorCollapsed: true,
      inspectorWidth: roundPercent(base.inspectorWidth),
    }
  }

  const minInspectorPercent =
    (ASSIGNMENT_GRADING_LAYOUT.inspectorMinPx / totalWidth) * 100
  const maxInspectorPercent = Math.max(
    minInspectorPercent,
    ((totalWidth - getPrimaryMinPx(mode)) / totalWidth) * 100,
  )

  return {
    inspectorCollapsed: false,
    inspectorWidth: roundPercent(
      clampNumber(base.inspectorWidth, minInspectorPercent, maxInspectorPercent),
    ),
  }
}

export function clampAssignmentGradingLayout(
  layout: AssignmentGradingLayoutState,
  metrics: AssignmentGradingLayoutMetrics,
): AssignmentGradingLayoutState {
  const base = getDefaultAssignmentGradingLayout()
  const candidate = {
    overview: {
      ...base.overview,
      ...layout.overview,
    },
    details: {
      ...base.details,
      ...layout.details,
    },
  }

  return {
    overview: clampAssignmentWorkspacePaneLayout(candidate.overview, 'overview', metrics),
    details: clampAssignmentWorkspacePaneLayout(candidate.details, 'details', metrics),
  }
}

export function getEffectiveInspectorWidthPercent(
  layout: AssignmentGradingLayoutState,
  mode: AssignmentWorkspaceMode,
  metrics: AssignmentGradingLayoutMetrics,
): number {
  const pane = clampAssignmentGradingLayout(layout, metrics)[mode]
  return pane.inspectorCollapsed ? 0 : pane.inspectorWidth
}

export function setModeInspectorCollapsed(
  layout: AssignmentGradingLayoutState,
  mode: AssignmentWorkspaceMode,
  inspectorCollapsed: boolean,
): AssignmentGradingLayoutState {
  return {
    ...layout,
    [mode]: {
      ...layout[mode],
      inspectorCollapsed,
    },
  }
}
