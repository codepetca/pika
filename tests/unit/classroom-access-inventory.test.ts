import { describe, expect, it } from 'vitest'
import { inventoryClassroomAccess } from '../../scripts/lib/classroom-access-inventory'

describe('reproducible access inventory', () => {
  it('finds imported guard aliases and role access/bindings/writes without copying source', () => {
    const source = `import { requireRole as guard, requireAuth } from '@/lib/auth'
import { assertTeacherOwnsClassroom as owns } from '@/lib/server/classrooms'
const user = await guard('teacher'); await requireAuth(); await owns(user.id, id)
const { role: accountRole } = user; const { role } = user
if (user.role === 'teacher' || user['role'] === 'student') save({ role: accountRole })
save({ role })`
    const signals = inventoryClassroomAccess('src/test.ts', source)
    expect(signals.map(({ signal }) => signal)).toEqual([
      'requireRole', 'requireAuth', 'assertTeacherOwnsClassroom', 'role-binding', 'role-binding',
      'role-access', 'role-access', 'role-write', 'role-write',
    ])
    expect(signals[0]).toEqual({ file: 'src/test.ts', line: 3, signal: 'requireRole' })
    expect(signals[8].line).toBe(6)
  })

  it('ignores comments, strings, unrelated identifiers and unimported lookalike calls', () => {
    expect(inventoryClassroomAccess('src/test.tsx', `import * as auth from '@/lib/auth'
import defaultImport from 'elsewhere'
// requireRole('teacher'); user.role
const x = "user.role requireRole('teacher')"; requireRole('teacher'); user.name
const node = <div role="button">user.role</div>`)).toEqual([])
  })
})
