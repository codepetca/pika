import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ClassroomPageClient titlebar navigation', () => {
  it('keeps Home navigation without wiring classroom switching into AppShell', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'),
      'utf8',
    )

    expect(source).toContain('onNavigateHome={handleHomeNavigationAttempt}')
    expect(source).not.toContain('onNavigateClassroom')
    expect(source).not.toContain('handleClassroomNavigationAttempt')
    expect(source).not.toContain("source: 'classroom_switch'")
  })

  it('hands Daily a manual attendance fallback when QR attendance is unavailable', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'),
      'utf8',
    )

    expect(source).toContain('attendanceEnabled={featureVisibility.attendance}')
    expect(source).toContain('manualAttendanceEnabled={!featureVisibility.attendance}')
    expect(source.match(/classroomQrAvailable=\{classroomQrAvailable\}/g)).toHaveLength(2)
  })
})
