export const CLASSROOM_SIDEBAR = {
  width: {
    default: 260,
    min: 96,
    max: 360,
  },
  collapsedWidth: 48,
} as const

export function clampClassroomSidebarWidth(width: number) {
  return Math.max(
    CLASSROOM_SIDEBAR.width.min,
    Math.min(CLASSROOM_SIDEBAR.width.max, width)
  )
}

export function parseClassroomSidebarWidthCookie(value: string | undefined) {
  if (!value) return CLASSROOM_SIDEBAR.width.default
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return CLASSROOM_SIDEBAR.width.default
  return clampClassroomSidebarWidth(Math.round(parsed))
}
