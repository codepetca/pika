import { describe, expect, it } from 'vitest'
import {
  createSourceGraphFromSources,
  findBrowserBoundaryViolations,
} from '../../scripts/lib/architecture-boundaries'

function sourceHasSupabaseRuntimeImport(source: string): boolean {
  const graph = createSourceGraphFromSources({
    'src/components/fixture.tsx': `'use client'\n${source}`,
  })
  return findBrowserBoundaryViolations(graph).some(
    (violation) => violation.rule === 'browser-runtime',
  )
}

describe('browser Supabase access guard', () => {
  it('ignores type-only Supabase imports', () => {
    expect(sourceHasSupabaseRuntimeImport(`
      'use client'
      import { useMemo } from 'react'
      import type { SupabaseClient } from '@supabase/supabase-js'
      import { type SupabaseClient as InlineTypeClient } from '@supabase/supabase-js'
    `)).toBe(false)
  })

  it('detects runtime Supabase imports', () => {
    expect(sourceHasSupabaseRuntimeImport(`
      'use client'
      import {
        getServiceRoleClient,
      } from '@/lib/supabase'
    `)).toBe(true)
    expect(sourceHasSupabaseRuntimeImport("const supabase = require('@supabase/supabase-js')")).toBe(true)
    expect(sourceHasSupabaseRuntimeImport("const supabase = await import('@/lib/supabase')")).toBe(true)
  })
})
