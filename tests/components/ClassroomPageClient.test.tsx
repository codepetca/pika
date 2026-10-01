import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Daily viewport containment is exercised through the real ClassroomPageClient
// by the "Daily scroll containment" browser cases in e2e/experience-matrix.spec.ts.
describe('ClassroomPageClient titlebar navigation', () => {
  it('scopes student Daily Log recovery to the signed-in student', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'), 'utf8')
    expect(source).toMatch(/<StudentTodayWorkspace[\s\S]*?studentId=\{user\.id\}/)
    expect(source).toMatch(/<StudentTodayTab[\s\S]*?studentId=\{studentId\}/)
  })

  it('passes Gradebook activation so its retained table refreshes after Classwork edits', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'), 'utf8')
    expect(source).toMatch(/<TeacherGradebookTab\s+classroom=\{classroom\}\s+isActive=\{activeTab === 'gradebook'\}/)
    // The request/refresh transition is exercised in TeacherGradebookTab.test.tsx.
  })

  it('keeps teacher Blueprint section navigation in the classroom URL', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'), 'utf8')

    expect(source).toMatch(/<TeacherBlueprintTab[\s\S]*?sectionParam=\{sectionParam\}[\s\S]*?onSectionChange=\{\(section\) =>[\s\S]*?params\.set\('tab', 'blueprint'\)[\s\S]*?params\.set\('section', section\)/)
    expect(source).toContain("if (tab !== 'settings') {")
    expect(source).toContain("params.delete('section')")
  })

  it('mounts the student Grades owner only for the available Grades tab and propagates teacher visibility updates', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/classrooms/[classroomId]/ClassroomPageClient.tsx'), 'utf8')

    expect(source).toContain('{mountedTabs.grades && (')
    expect(source).toContain("<StudentGradesTab classroom={classroom} isActive={activeTab === 'grades'} />")
    expect(source).toMatch(/<TeacherGradebookTab[\s\S]*?onClassroomUpdated=\{onClassroomUpdated\}/)
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
    expect(source).toContain('readBlueprintClassroomOverflow(classroom.id)')
    expect(source).toContain('blueprint lesson')
    expect(source).toContain('clearBlueprintClassroomOverflow(classroom.id)')
    expect(source).toContain("params.delete('reviewClassDays')")
  })
})
