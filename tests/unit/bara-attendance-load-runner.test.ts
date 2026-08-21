import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runner = readFileSync(
  resolve(process.cwd(), 'scripts/measure-local-bara-attendance-engine.ts'),
  'utf8',
)

describe('local Bara attendance load runner', () => {
  it('uses stable opaque mappings and a fresh UUID for every logical scan', () => {
    expect(runner).toContain(".from('attendance_principal_mappings')")
    expect(runner).toContain('principalRef: principalRefByStudentId.get(student.id)!')
    expect(runner).toContain('attemptId: randomUUID()')
    expect(runner).not.toContain('resolveActor: async () => ({\n          workosSubject:')
  })
})
