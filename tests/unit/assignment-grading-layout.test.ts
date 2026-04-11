import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_GRADING_LAYOUT,
  clampAssignmentGradingLayout,
  getAssignmentGradingLayoutCookieName,
  getAssignmentWorkspaceStudentCookieName,
  getDefaultAssignmentGradingLayout,
  getEffectiveInspectorWidthPercent,
  parseAssignmentGradingLayout,
  parseAssignmentWorkspaceStudentId,
  serializeAssignmentGradingLayout,
  setModeInspectorCollapsed,
} from '@/lib/assignment-grading-layout'

describe('assignment grading layout helpers', () => {
  it('returns the expected default layout', () => {
    expect(getDefaultAssignmentGradingLayout()).toEqual({
      overview: {
        inspectorCollapsed: false,
        inspectorWidth: 40,
      },
      details: {
        inspectorCollapsed: false,
        inspectorWidth: 40,
      },
    })
  })

  it('round-trips layout through cookie serialization', () => {
    const layout = {
      overview: {
        inspectorCollapsed: true,
        inspectorWidth: 44,
      },
      details: {
        inspectorCollapsed: false,
        inspectorWidth: 36,
      },
    }

    expect(parseAssignmentGradingLayout(serializeAssignmentGradingLayout(layout))).toEqual(layout)
  })

  it('falls back to defaults for invalid cookie state', () => {
    expect(parseAssignmentGradingLayout('not-json')).toEqual(getDefaultAssignmentGradingLayout())
    expect(parseAssignmentGradingLayout('{"overview":{"inspectorWidth":"bad"}}')).toEqual(
      getDefaultAssignmentGradingLayout(),
    )
  })

  it('clamps overview and details inspector widths to minimum readable sizes', () => {
    const clamped = clampAssignmentGradingLayout(
      {
        overview: {
          inspectorCollapsed: false,
          inspectorWidth: 95,
        },
        details: {
          inspectorCollapsed: false,
          inspectorWidth: 95,
        },
      },
      { totalWidth: 1000 },
    )

    expect(clamped.overview.inspectorWidth).toBe(58)
    expect(clamped.details.inspectorWidth).toBe(64)
  })

  it('returns zero effective width when a mode inspector is collapsed', () => {
    const layout = {
      overview: {
        inspectorCollapsed: true,
        inspectorWidth: 44,
      },
      details: {
        inspectorCollapsed: false,
        inspectorWidth: 36,
      },
    }

    expect(getEffectiveInspectorWidthPercent(layout, 'overview', { totalWidth: 1000 })).toBe(0)
    expect(getEffectiveInspectorWidthPercent(layout, 'details', { totalWidth: 1000 })).toBe(36)
  })

  it('supports explicit collapse transitions without discarding saved widths', () => {
    const layout = getDefaultAssignmentGradingLayout()

    expect(setModeInspectorCollapsed(layout, 'overview', true)).toEqual({
      ...layout,
      overview: {
        inspectorCollapsed: true,
        inspectorWidth: 40,
      },
    })
  })

  it('builds classroom-scoped cookie names for layout and selected student memory', () => {
    expect(getAssignmentGradingLayoutCookieName('classroom-1')).toBe(
      'pika_assignment_grading_layout:classroom-1',
    )
    expect(getAssignmentWorkspaceStudentCookieName('classroom-1', 'assignment-9')).toBe(
      'pika_assignment_workspace_student:classroom-1:assignment-9',
    )
  })

  it('parses remembered student ids defensively', () => {
    expect(parseAssignmentWorkspaceStudentId(' student-1 ')).toBe('student-1')
    expect(parseAssignmentWorkspaceStudentId('')).toBeNull()
    expect(parseAssignmentWorkspaceStudentId(null)).toBeNull()
  })

  it('keeps the declared minimum widths in sync with the default proportions', () => {
    const totalWidth = 1000
    const layout = getDefaultAssignmentGradingLayout()
    const overviewInspectorPx =
      (getEffectiveInspectorWidthPercent(layout, 'overview', { totalWidth }) / 100) * totalWidth
    const detailsInspectorPx =
      (getEffectiveInspectorWidthPercent(layout, 'details', { totalWidth }) / 100) * totalWidth

    expect(overviewInspectorPx).toBeGreaterThanOrEqual(ASSIGNMENT_GRADING_LAYOUT.inspectorMinPx)
    expect(detailsInspectorPx).toBeGreaterThanOrEqual(ASSIGNMENT_GRADING_LAYOUT.inspectorMinPx)
  })
})
