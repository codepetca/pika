import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ClassroomPageClient titlebar navigation', () => {
  it('passes Gradebook activation so its retained table refreshes after Classwork edits', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'), 'utf8')
    expect(source).toMatch(/<TeacherGradebookTab\s+classroom=\{classroom\}\s+isActive=\{activeTab === 'gradebook'\}/)
    // The request/refresh transition is exercised in TeacherGradebookTab.test.tsx.
  })

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

  it('keeps missing class-day setup visible and routes teachers to the setup section', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'),
      'utf8',
    )

    expect(source).toContain('classDays.length === 0')
    expect(source).toContain('hasLoadedClassDays')
    expect(source).toContain('Set up class days')
    expect(source).toContain("params.set('section', 'class-days')")
  })

  it('prompts teachers to review automatically generated class days after creation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'),
      'utf8',
    )

    expect(source).toContain("searchParams.get('reviewClassDays') === '1'")
    expect(source).toContain('Review class days')
    expect(source).toContain('Review holidays, PA days, and other non-class days.')
    expect(source).toContain("params.delete('reviewClassDays')")
  })
})
