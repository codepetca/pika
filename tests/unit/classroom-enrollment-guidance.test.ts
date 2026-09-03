import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const guidance = read('docs/guidance/contextual-enrollment-access.md')
const joinRoute = read('src/app/api/student/classrooms/join/route.ts')

describe('contextual enrollment foundation guidance', () => {
  it('keeps the foundation dormant until atomic and abuse-control gates exist', () => {
    expect(guidance).toContain('no live imports')
    expect(guidance).toMatch(/rate-limit both the\s+authenticated actor and actor-invitation guesses/)
    expect(guidance).toContain("query scoped\n   to the authenticated result's `allowedClassroomIds`")
    expect(guidance).toContain('valid code outside that exact\n   scope must be indistinguishable from an invalid code')
    expect(guidance).toContain('use the migration 157 transaction')
    expect(guidance).toContain('Local verification does not authorize hosted application')
    expect(joinRoute).not.toContain('classroom-enrollment-access')
    expect(joinRoute).not.toContain('classroom-enrollment-policy')
    expect(joinRoute).not.toContain('contextual-classroom-enrollment')
    expect(joinRoute).not.toContain('join_classroom_by_code_atomic_v1')
  })

  it('records that direct classroom IDs cannot create membership', () => {
    expect(guidance).toContain('A classroom ID may recognize an existing')
    expect(guidance).toContain('but can never create a membership')
  })
})
