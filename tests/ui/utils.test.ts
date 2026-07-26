import { describe, expect, it } from 'vitest'
import { cn } from '../../src/ui/utils'

describe('UI class merging', () => {
  it('keeps caller-last overrides working for every portable alias family', () => {
    expect(cn('max-w-reading', 'max-w-none')).toBe('max-w-none')
    expect(cn('min-h-control', 'min-h-0')).toBe('min-h-0')
    expect(cn('min-w-control', 'min-w-0')).toBe('min-w-0')
    expect(cn('px-density-compact-gutter', 'px-8')).toBe('px-8')
    expect(cn('-mx-density-compact-gutter', 'mx-0')).toBe('mx-0')
    expect(cn('pt-density-compact-content-top', 'pt-8')).toBe('pt-8')
    expect(cn('space-y-density-compact-stack-gap', 'space-y-8')).toBe('space-y-8')
    expect(cn('duration-standard', 'duration-500')).toBe('duration-500')
    expect(cn('ease-standard', 'ease-linear')).toBe('ease-linear')
    expect(cn('z-modal', 'z-10')).toBe('z-10')
    expect(cn('ring-foundation', 'ring-4')).toBe('ring-4')
    expect(cn('ring-offset-foundation', 'ring-offset-4')).toBe('ring-offset-4')
  })
})
