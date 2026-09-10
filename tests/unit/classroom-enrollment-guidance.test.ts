import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const guidance = read('docs/guidance/contextual-enrollment-access.md')
const joinRoute = read('src/app/api/student/classrooms/join/route.ts')

describe('contextual enrollment foundation guidance', () => {
  it('records the disabled-by-default route adoption and its safety gates', () => {
    expect(guidance).toContain('guarded route adopter')
    expect(guidance).toMatch(/rate-limit both the\s+authenticated actor and actor-invitation guesses/)
    expect(guidance).toContain("query scoped\n   to the authenticated result's `allowedClassroomIds`")
    expect(guidance).toContain('valid code outside that exact\n   scope must be indistinguishable from an invalid code')
    expect(guidance).toContain('use the migration 159 transaction')
    expect(guidance).toMatch(
      /Local verification does not\s+authorize hosted migration application/,
    )
    expect(joinRoute).toContain('classroom-enrollment-access')
    expect(joinRoute).toContain('classroom-enrollment-policy')
    expect(joinRoute).toContain('contextual-classroom-enrollment')
    expect(joinRoute).not.toContain('join_classroom_by_code_atomic_v1')
  })

  it('records that direct classroom IDs cannot create membership', () => {
    expect(guidance).toContain('A classroom ID may recognize an existing')
    expect(guidance).toContain('but can never create a membership')
  })
})
