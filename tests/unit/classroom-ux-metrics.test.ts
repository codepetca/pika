import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRecentClassroomTabMetrics,
  markClassroomTabSwitchReady,
  markClassroomTabSwitchStart,
} from '@/lib/classroom-ux-metrics'

describe('classroom ux tab switch metrics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    window.__classroomPendingTabMark = null
    window.__classroomTabMetrics = []
  })

  it('records duration when a matching tab is marked ready', () => {
    const perfSpy = vi.spyOn(performance, 'now')
    perfSpy.mockReturnValueOnce(10).mockReturnValueOnce(26)

    markClassroomTabSwitchStart('assignments')
    markClassroomTabSwitchReady('assignments')

    expect(getRecentClassroomTabMetrics()).toEqual([
      {
        tab: 'assignments',
        startedAt: 10,
        readyAt: 26,
        durationMs: 16,
      },
    ])
    expect(window.__classroomPendingTabMark).toBeNull()
  })

  it('ignores ready marks for a different tab', () => {
    markClassroomTabSwitchStart('attendance')
    markClassroomTabSwitchReady('gradebook')

    expect(getRecentClassroomTabMetrics()).toEqual([])
    expect(window.__classroomPendingTabMark).toEqual({ tab: 'attendance', startedAt: expect.any(Number) })
  })

  it('keeps only the most recent 20 metrics', () => {
    const nowSpy = vi.spyOn(performance, 'now')
    for (let i = 0; i < 21; i += 1) {
      nowSpy.mockReturnValueOnce(i * 10).mockReturnValueOnce(i * 10 + 3)
      const tab = `tab-${i}`
      markClassroomTabSwitchStart(tab)
      markClassroomTabSwitchReady(tab)
    }

    const metrics = getRecentClassroomTabMetrics()
    expect(metrics).toHaveLength(20)
    expect(metrics[0]?.tab).toBe('tab-1')
    expect(metrics[19]?.tab).toBe('tab-20')
  })

  it('clamps negative durations to 0 when clock moves backward', () => {
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValueOnce(100).mockReturnValueOnce(90)

    markClassroomTabSwitchStart('tests')
    markClassroomTabSwitchReady('tests')

    expect(getRecentClassroomTabMetrics()[0]?.durationMs).toBe(0)
  })
})
