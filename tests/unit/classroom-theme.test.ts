import { describe, expect, it } from 'vitest'
import {
  CLASSROOM_THEME_COLORS,
  DEFAULT_CLASSROOM_THEME_COLOR,
  getClassroomThemeDefinition,
  getClassroomThemeStyle,
  getDefaultClassroomThemeColor,
  getLeastUsedClassroomThemeColor,
  isClassroomThemeColor,
  normalizeClassroomThemeColor,
} from '@/lib/classroom-theme'

describe('classroom-theme', () => {
  it('accepts only supported classroom theme names', () => {
    expect(isClassroomThemeColor('teal')).toBe(true)
    expect(isClassroomThemeColor('magenta')).toBe(false)
    expect(isClassroomThemeColor(null)).toBe(false)
  })

  it('normalizes missing and invalid theme values to the default', () => {
    expect(normalizeClassroomThemeColor('rose')).toBe('rose')
    expect(normalizeClassroomThemeColor(undefined)).toBe(DEFAULT_CLASSROOM_THEME_COLOR)
    expect(normalizeClassroomThemeColor('invalid')).toBe(DEFAULT_CLASSROOM_THEME_COLOR)
  })

  it('returns palette metadata for every supported classroom theme', () => {
    for (const color of CLASSROOM_THEME_COLORS) {
      const definition = getClassroomThemeDefinition(color)
      expect(definition.value).toBe(color)
      expect(definition.label).toBeTruthy()
      expect(definition.color).toMatch(/^#[0-9a-f]{6}$/)
      expect(definition.softColor).toContain('rgba(')
      expect(definition.darkColor).toMatch(/^#[0-9a-f]{6}$/)
      expect(definition.darkSoftColor).toContain('rgba(')
    }
  })

  it('returns light and dark CSS variables for a classroom theme', () => {
    const style = getClassroomThemeStyle('blue')

    expect(style['--classroom-accent-light']).toBe('#0ea5e9')
    expect(style['--classroom-accent-dark']).toBe('#38bdf8')
    expect(style['--classroom-accent-soft-light']).toContain('rgba(')
    expect(style['--classroom-accent-soft-dark']).toContain('rgba(')
  })

  it('derives stable defaults from a classroom seed', () => {
    expect(getDefaultClassroomThemeColor('teacher-1:Math 101')).toBe(
      getDefaultClassroomThemeColor('teacher-1:Math 101')
    )
    expect(CLASSROOM_THEME_COLORS).toContain(getDefaultClassroomThemeColor('teacher-1:Science 101'))
  })

  it('chooses the first unused classroom theme color before repeating', () => {
    expect(getLeastUsedClassroomThemeColor(['blue', 'teal', 'green'])).toBe('amber')
  })

  it('uses the seed to vary the first classroom theme color', () => {
    expect(getLeastUsedClassroomThemeColor([], 'teacher-1:Math 101')).toBe('cyan')
    expect(getLeastUsedClassroomThemeColor([], 'teacher-1:Science 101')).toBe('green')
  })

  it('chooses among least-used classroom theme colors after the palette is exhausted', () => {
    expect(getLeastUsedClassroomThemeColor([
      'blue',
      'teal',
      'green',
      'amber',
      'rose',
      'violet',
      'cyan',
      'slate',
      'blue',
    ], 'teacher-1:Science 101')).not.toBe('blue')
  })
})
