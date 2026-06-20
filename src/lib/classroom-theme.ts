export const CLASSROOM_THEME_COLORS = [
  'blue',
  'teal',
  'green',
  'amber',
  'rose',
  'violet',
  'cyan',
  'slate',
] as const

export type ClassroomThemeColor = typeof CLASSROOM_THEME_COLORS[number]

export const DEFAULT_CLASSROOM_THEME_COLOR: ClassroomThemeColor = 'blue'

type ClassroomThemeDefinition = {
  label: string
  value: ClassroomThemeColor
  color: string
  softColor: string
  textColor: string
  darkColor: string
  darkSoftColor: string
  darkTextColor: string
}

export const CLASSROOM_THEME_PALETTE: ClassroomThemeDefinition[] = [
  { value: 'blue', label: 'Sky', color: '#0ea5e9', softColor: 'rgba(14, 165, 233, 0.14)', textColor: '#0369a1', darkColor: '#38bdf8', darkSoftColor: 'rgba(56, 189, 248, 0.18)', darkTextColor: '#7dd3fc' },
  { value: 'teal', label: 'Mint', color: '#14b8a6', softColor: 'rgba(20, 184, 166, 0.14)', textColor: '#0f766e', darkColor: '#2dd4bf', darkSoftColor: 'rgba(45, 212, 191, 0.18)', darkTextColor: '#99f6e4' },
  { value: 'green', label: 'Lime', color: '#65a30d', softColor: 'rgba(101, 163, 13, 0.14)', textColor: '#4d7c0f', darkColor: '#a3e635', darkSoftColor: 'rgba(163, 230, 53, 0.18)', darkTextColor: '#d9f99d' },
  { value: 'amber', label: 'Sunshine', color: '#f59e0b', softColor: 'rgba(245, 158, 11, 0.16)', textColor: '#b45309', darkColor: '#facc15', darkSoftColor: 'rgba(250, 204, 21, 0.18)', darkTextColor: '#fef08a' },
  { value: 'rose', label: 'Coral', color: '#f43f5e', softColor: 'rgba(244, 63, 94, 0.14)', textColor: '#be123c', darkColor: '#fb7185', darkSoftColor: 'rgba(251, 113, 133, 0.18)', darkTextColor: '#fecdd3' },
  { value: 'violet', label: 'Grape', color: '#8b5cf6', softColor: 'rgba(139, 92, 246, 0.14)', textColor: '#6d28d9', darkColor: '#c084fc', darkSoftColor: 'rgba(192, 132, 252, 0.18)', darkTextColor: '#e9d5ff' },
  { value: 'cyan', label: 'Aqua', color: '#06b6d4', softColor: 'rgba(6, 182, 212, 0.14)', textColor: '#0e7490', darkColor: '#22d3ee', darkSoftColor: 'rgba(34, 211, 238, 0.18)', darkTextColor: '#a5f3fc' },
  { value: 'slate', label: 'Peach', color: '#f97316', softColor: 'rgba(249, 115, 22, 0.15)', textColor: '#c2410c', darkColor: '#fb923c', darkSoftColor: 'rgba(251, 146, 60, 0.18)', darkTextColor: '#fed7aa' },
]

const CLASSROOM_THEME_SET = new Set<string>(CLASSROOM_THEME_COLORS)

export function isClassroomThemeColor(value: unknown): value is ClassroomThemeColor {
  return typeof value === 'string' && CLASSROOM_THEME_SET.has(value)
}

export function normalizeClassroomThemeColor(value: unknown): ClassroomThemeColor {
  return isClassroomThemeColor(value) ? value : DEFAULT_CLASSROOM_THEME_COLOR
}

export function getClassroomThemeDefinition(value: unknown): ClassroomThemeDefinition {
  const normalized = normalizeClassroomThemeColor(value)
  return CLASSROOM_THEME_PALETTE.find((item) => item.value === normalized) ?? CLASSROOM_THEME_PALETTE[0]
}

export function getClassroomThemeStyle(value: unknown): Record<string, string> {
  const theme = getClassroomThemeDefinition(value)
  return {
    '--classroom-accent-light': theme.color,
    '--classroom-accent-soft-light': theme.softColor,
    '--classroom-accent-text-light': theme.textColor,
    '--classroom-accent-dark': theme.darkColor,
    '--classroom-accent-soft-dark': theme.darkSoftColor,
    '--classroom-accent-text-dark': theme.darkTextColor,
  }
}

export function getDefaultClassroomThemeColor(seed: string): ClassroomThemeColor {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return CLASSROOM_THEME_COLORS[hash % CLASSROOM_THEME_COLORS.length]
}

export function getLeastUsedClassroomThemeColor(existingColors: unknown[], seed = ''): ClassroomThemeColor {
  const counts = new Map<ClassroomThemeColor, number>(
    CLASSROOM_THEME_COLORS.map((color) => [color, 0])
  )

  for (const color of existingColors) {
    if (isClassroomThemeColor(color)) {
      counts.set(color, (counts.get(color) ?? 0) + 1)
    }
  }

  const lowestCount = Math.min(...CLASSROOM_THEME_COLORS.map((color) => counts.get(color) ?? 0))
  const candidates = CLASSROOM_THEME_COLORS.filter((color) => (counts.get(color) ?? 0) === lowestCount)

  if (!seed) {
    return candidates[0] ?? DEFAULT_CLASSROOM_THEME_COLOR
  }

  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return candidates[hash % candidates.length] ?? DEFAULT_CLASSROOM_THEME_COLOR
}
