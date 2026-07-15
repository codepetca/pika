import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('gradebook feature boundary', () => {
  it('keeps the API route transport-only', () => {
    const source = read('src/app/api/teacher/gradebook/route.ts')

    expect(source).toContain("from '@/lib/server/gradebook'")
    expect(source).toContain("from '@/lib/validations/gradebook'")
    expect(source).not.toContain('getServiceRoleClient')
    expect(source).not.toContain('.from(')
    expect(source.split('\n').length).toBeLessThan(60)
  })

  it('keeps the server workflow independent of Next request and response types', () => {
    const source = read('src/lib/server/gradebook.ts')

    expect(source).not.toContain("from 'next/server'")
    expect(source).not.toContain('NextRequest')
    expect(source).not.toContain('NextResponse')
    expect(source).not.toContain('requireRole')
    expect(source).not.toContain("from '@/lib/api-handler'")
  })
})
