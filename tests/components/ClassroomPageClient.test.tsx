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
})
