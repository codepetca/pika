import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const scriptPath = resolve(testDir, '../../scripts/ui-guidance-candidate.mjs')

const tempDirs: string[] = []

function makeTempWorkspace() {
  const workspace = mkdtempSync(resolve(tmpdir(), 'pika-ui-guidance-'))
  tempDirs.push(workspace)
  mkdirSync(resolve(workspace, 'docs/guidance/ui/experimental'), { recursive: true })
  return workspace
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('ui-guidance-candidate script', () => {
  it('writes a draft under the experimental guidance directory with the required sections', () => {
    const workspace = makeTempWorkspace()

    execFileSync('node', [
      scriptPath,
      '--scope',
      'assignments',
      '--files',
      'src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx',
      'src/components/AssignmentModal.tsx',
      '--title',
      'Assignments candidate guidance',
    ], { cwd: workspace, encoding: 'utf8' })

    const generatedFiles = readdirSync(resolve(workspace, 'docs/guidance/ui/experimental'))
    expect(generatedFiles).toHaveLength(1)

    const generatedPath = resolve(workspace, 'docs/guidance/ui/experimental', generatedFiles[0])
    const markdown = readFileSync(generatedPath, 'utf8')

    expect(markdown).toContain('status: experimental')
    expect(markdown).toContain('human_review_required: true')
    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('## Affected Screens / Files')
    expect(markdown).toContain('## Observed Pattern')
    expect(markdown).toContain('## Proposed Guidance')
    expect(markdown).toContain('## Why This Is Experimental')
    expect(markdown).toContain('## Human Review Required')
    expect(markdown).toContain('## Promotion Criteria')
  })

  it('refuses to write to stable guidance', () => {
    const workspace = makeTempWorkspace()

    expect(() => execFileSync('node', [
      scriptPath,
      '--scope',
      'attendance',
      '--files',
      'src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx',
      '--out',
      'docs/guidance/ui/stable.md',
    ], { cwd: workspace, encoding: 'utf8', stdio: 'pipe' })).toThrow(/Stable guidance is human-promoted only/)

    expect(existsSync(resolve(workspace, 'docs/guidance/ui/stable.md'))).toBe(false)
  })

  it('supports stdout mode without writing a file', () => {
    const workspace = makeTempWorkspace()

    const output = execFileSync('node', [
      scriptPath,
      '--scope',
      'shared-shell',
      '--files',
      'src/components/AppShell.tsx',
      '--stdout',
    ], { cwd: workspace, encoding: 'utf8' })

    expect(output).toContain('# Shared Shell Candidate Guidance')
    expect(readdirSync(resolve(workspace, 'docs/guidance/ui/experimental'))).toHaveLength(0)
  })
})
