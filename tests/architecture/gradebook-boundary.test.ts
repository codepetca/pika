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

  it('keeps legacy quiz storage outside the active gradebook workflow', () => {
    const serverSource = read('src/lib/server/gradebook.ts')
    const calculationSource = read('src/lib/gradebook.ts')
    const allowedServerQuizTombstones = [
      'quizzes_weight: 20,',
      'quizzes_earned: null,',
      'quizzes_possible: null,',
      'quizzes_percent: null,',
      'quizzes: [],',
      'quizzes: [],',
      'quizzes: 0,',
    ]
    let activeServerSource = serverSource
    for (const tombstone of allowedServerQuizTombstones) {
      expect(activeServerSource).toContain(tombstone)
      activeServerSource = activeServerSource.replace(tombstone, '')
    }

    const serverImports = [...serverSource.matchAll(/from ['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort()

    expect(serverImports).toEqual([
      '@/lib/api-error',
      '@/lib/assignments',
      '@/lib/gradebook',
      '@/lib/server/query-chunks',
      '@/lib/supabase',
      '@/lib/validations/gradebook',
      '@/types',
    ])
    expect(serverSource).not.toMatch(/\bimport\s*\(/)
    expect(serverSource).not.toMatch(/\bimport\s*['"]/)
    expect(serverSource).not.toMatch(/\brequire\s*\(/)
    expect(activeServerSource).not.toMatch(/quiz/i)
    expect(calculationSource).not.toContain('quizzes')
    expect(calculationSource).not.toContain('quiz')
  })
})
