import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { mergeAttributes } from '@tiptap/core'

const rootRequire = createRequire(import.meta.url)
const tailwindRequire = createRequire(rootRequire.resolve('tailwindcss/package.json'))
const micromatchRequire = createRequire(tailwindRequire.resolve('micromatch'))
const braces = micromatchRequire('braces')

describe('installed dependency security boundaries', () => {
  it('does not turn an own prototype key into inherited DOM attributes', () => {
    const attributes = mergeAttributes(JSON.parse('{"__proto__":{"onload":"unexpected"},"alt":"safe"}'))
    expect(attributes.onload).toBeUndefined()
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype)
    expect(attributes.alt).toBe('safe')
  })

  it.each(['parse', 'compile', 'expand', 'stringify'] as const)(
    'rejects excessive pattern nesting before recursive %s work', (operation) => {
      const pattern = '{'.repeat(400) + 'x' + '}'.repeat(400)
      expect(() => braces[operation](pattern)).toThrow('Brace pattern exceeds maximum nesting depth')
    }
  )

  it('counts parentheses and mixed nesting, while preserving quoted and escaped literals', () => {
    expect(() => braces.compile('('.repeat(400) + 'x' + ')'.repeat(400)))
      .toThrow('Brace pattern exceeds maximum nesting depth')
    expect(braces.compile('"' + '{'.repeat(400) + '"')).toBe('{'.repeat(400))
    expect(braces.compile('\\{'.repeat(400))).toBe('{'.repeat(400))
  })

  it.each(['compile', 'expand', 'stringify'] as const)(
    'bounds caller-supplied AST recursion in %s', (operation) => {
      let ast: unknown = { type: 'text', value: 'x' }
      for (let i = 0; i < 400; i++) ast = { type: 'root', nodes: [ast] }
      expect(() => braces[operation](ast)).toThrow('Brace pattern exceeds maximum nesting depth')
    }
  )

  it('preserves ordinary build globs, numeric ranges and escaped braces', () => {
    expect(braces.compile('src/{app,lib}/**/*.{ts,tsx}')).toBe('src/(app|lib)/**/*.(ts|tsx)')
    expect(braces.expand('file-{01..03}.{ts,tsx}')).toEqual([
      'file-01.ts', 'file-01.tsx', 'file-02.ts', 'file-02.tsx', 'file-03.ts', 'file-03.tsx',
    ])
    expect(braces.compile('src/\\{literal\\}/**/*.ts')).toBe('src/{literal}/**/*.ts')
    expect(braces.compile('('.repeat(32) + '{a,b}' + ')'.repeat(32)))
      .toBe('('.repeat(32) + '(a|b)' + ')'.repeat(32))
  })
})
