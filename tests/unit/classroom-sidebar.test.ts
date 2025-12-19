import { describe, it, expect } from 'vitest'
import { CLASSROOM_SIDEBAR, clampClassroomSidebarWidth, parseClassroomSidebarWidthCookie } from '@/lib/classroom-sidebar'

describe('clampClassroomSidebarWidth', () => {
  it('should return the value when within range', () => {
    expect(clampClassroomSidebarWidth(200)).toBe(200)
    expect(clampClassroomSidebarWidth(240)).toBe(240)
    expect(clampClassroomSidebarWidth(300)).toBe(300)
  })

  it('should clamp to minimum when below range', () => {
    expect(clampClassroomSidebarWidth(50)).toBe(CLASSROOM_SIDEBAR.width.min)
    expect(clampClassroomSidebarWidth(0)).toBe(CLASSROOM_SIDEBAR.width.min)
    expect(clampClassroomSidebarWidth(-100)).toBe(CLASSROOM_SIDEBAR.width.min)
  })

  it('should clamp to maximum when above range', () => {
    expect(clampClassroomSidebarWidth(400)).toBe(CLASSROOM_SIDEBAR.width.max)
    expect(clampClassroomSidebarWidth(500)).toBe(CLASSROOM_SIDEBAR.width.max)
    expect(clampClassroomSidebarWidth(1000)).toBe(CLASSROOM_SIDEBAR.width.max)
  })

  it('should handle edge values', () => {
    expect(clampClassroomSidebarWidth(CLASSROOM_SIDEBAR.width.min)).toBe(CLASSROOM_SIDEBAR.width.min)
    expect(clampClassroomSidebarWidth(CLASSROOM_SIDEBAR.width.max)).toBe(CLASSROOM_SIDEBAR.width.max)
  })
})

describe('parseClassroomSidebarWidthCookie', () => {
  it('should return default when value is undefined', () => {
    expect(parseClassroomSidebarWidthCookie(undefined)).toBe(CLASSROOM_SIDEBAR.width.default)
  })

  it('should return default when value is empty string', () => {
    expect(parseClassroomSidebarWidthCookie('')).toBe(CLASSROOM_SIDEBAR.width.default)
  })

  it('should return default when value is not a number', () => {
    expect(parseClassroomSidebarWidthCookie('abc')).toBe(CLASSROOM_SIDEBAR.width.default)
    expect(parseClassroomSidebarWidthCookie('NaN')).toBe(CLASSROOM_SIDEBAR.width.default)
  })

  it('should return default when value is Infinity', () => {
    expect(parseClassroomSidebarWidthCookie('Infinity')).toBe(CLASSROOM_SIDEBAR.width.default)
    expect(parseClassroomSidebarWidthCookie('-Infinity')).toBe(CLASSROOM_SIDEBAR.width.default)
  })

  it('should parse and clamp valid numeric strings', () => {
    expect(parseClassroomSidebarWidthCookie('200')).toBe(200)
    expect(parseClassroomSidebarWidthCookie('240')).toBe(240)
  })

  it('should round decimal values', () => {
    expect(parseClassroomSidebarWidthCookie('199.5')).toBe(200)
    expect(parseClassroomSidebarWidthCookie('199.4')).toBe(199)
  })

  it('should clamp values outside range', () => {
    expect(parseClassroomSidebarWidthCookie('50')).toBe(CLASSROOM_SIDEBAR.width.min)
    expect(parseClassroomSidebarWidthCookie('500')).toBe(CLASSROOM_SIDEBAR.width.max)
  })
})
