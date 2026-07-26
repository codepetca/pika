import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  auditDesignPolicy,
  DESIGN_POLICY_EXCLUDED_FILES,
  DESIGN_POLICY_SOURCE_EXTENSIONS,
  inventoryDesignValues,
  parseDesignValueExceptionRegistry,
  type DesignValueExceptionRegistry,
} from '../../scripts/lib/design-policy'

function registry(
  entries: DesignValueExceptionRegistry['entries'],
): DesignValueExceptionRegistry {
  return parseDesignValueExceptionRegistry({ version: 1, entries })
}

describe('design value policy', () => {
  it('inventories raw colors, arbitrary spacing, and raw z-index values', () => {
    const inventory = inventoryDesignValues({
      'src/components/Example.tsx': `
        export function Example() {
          return <div className="bg-blue-500 text-white max-w-[42rem] z-[61]" style={{ color: '#fff' }} />
        }
      `,
    })

    expect(
      Object.fromEntries(
        [...(inventory.get('src/components/Example.tsx') ?? [])].map(
          ([kind, evidence]) => [kind, evidence.count],
        ),
      ),
    ).toEqual({
      'raw-color-class': 2,
      'raw-css-color': 1,
      'arbitrary-spacing': 1,
      'raw-z-index': 1,
    })
  })

  it('covers arbitrary Tailwind properties and literal inline styles', () => {
    const inventory = inventoryDesignValues({
      'src/components/Bypass.tsx': `
        export function Bypass() {
          return (
            <div
              className="bg-[red] w-[40%] [z-index:99]"
              style={{ zIndex: 99, color: 'rebeccapurple', width: '40%' }}
            />
          )
        }
      `,
    })

    expect(
      Object.fromEntries(
        [...(inventory.get('src/components/Bypass.tsx') ?? [])].map(
          ([kind, evidence]) => [kind, evidence.count],
        ),
      ),
    ).toEqual({
      'raw-color-class': 1,
      'raw-css-color': 1,
      'arbitrary-spacing': 2,
      'raw-z-index': 2,
    })
  })

  it('covers stylesheet values while exempting the canonical token source', () => {
    const inventory = inventoryDesignValues({
      'src/components/example.scss': `
        .example {
          color: rebeccapurple;
          width: 40%;
          z-index: 99;
        }
      `,
    })

    expect(
      Object.fromEntries(
        [...(inventory.get('src/components/example.scss') ?? [])].map(
          ([kind, evidence]) => [kind, evidence.count],
        ),
      ),
    ).toEqual({
      'raw-css-color': 1,
      'arbitrary-spacing': 1,
      'raw-z-index': 1,
    })
    expect(DESIGN_POLICY_SOURCE_EXTENSIONS).toEqual(
      expect.arrayContaining(['.css', '.scss', '.ts', '.tsx']),
    )
    expect(DESIGN_POLICY_EXCLUDED_FILES).toEqual(
      new Set(['src/styles/tokens.css']),
    )
  })

  it('accepts exact, owned exceptions', () => {
    const files = {
      'src/components/Example.tsx':
        'export const classes = "bg-blue-500 max-w-[42rem]"',
    }
    const exceptions = registry([
      {
        file: 'src/components/Example.tsx',
        reviewBy: 'phase-3-example',
        values: [
          {
            kind: 'raw-color-class',
            count: 1,
            fingerprint: '44eeb93b9ff2ce08',
            reason: 'legacy-visual-value',
          },
          {
            kind: 'arbitrary-spacing',
            count: 1,
            fingerprint: '5a4abb22a9ee0616',
            reason: 'layout-geometry',
          },
        ],
      },
    ])

    expect(auditDesignPolicy(files, exceptions)).toEqual([])
  })

  it('rejects unregistered, count-drifted, and stale values', () => {
    const files = {
      'src/components/Example.tsx':
        'export const classes = "bg-blue-500 bg-red-500 z-[61]"',
    }
    const exceptions = registry([
      {
        file: 'src/components/Example.tsx',
        reviewBy: 'phase-3-example',
        values: [
          {
            kind: 'raw-color-class',
            count: 1,
            fingerprint: '44eeb93b9ff2ce08',
            reason: 'legacy-visual-value',
          },
          {
            kind: 'arbitrary-spacing',
            count: 1,
            fingerprint: '5a4abb22a9ee0616',
            reason: 'layout-geometry',
          },
        ],
      },
    ])

    expect(auditDesignPolicy(files, exceptions)).toEqual([
      {
        file: 'src/components/Example.tsx',
        message: 'arbitrary-spacing registry entry is stale; no matching value remains.',
      },
      {
        file: 'src/components/Example.tsx',
        message: 'raw-color-class count is 2; registry expects 1.',
      },
      {
        file: 'src/components/Example.tsx',
        message: 'raw-z-index values require an entry in scripts/design-value-exceptions.json.',
      },
    ])
  })

  it('rejects a same-count substitution of a governed value', () => {
    const exceptions = registry([
      {
        file: 'src/components/Example.tsx',
        reviewBy: 'phase-3-example',
        values: [
          {
            kind: 'raw-color-class',
            count: 1,
            fingerprint: '44eeb93b9ff2ce08',
            reason: 'legacy-visual-value',
          },
        ],
      },
    ])

    expect(
      auditDesignPolicy(
        { 'src/components/Example.tsx': 'export const classes = "bg-red-500"' },
        exceptions,
      ),
    ).toEqual([
      {
        file: 'src/components/Example.tsx',
        message: 'raw-color-class values changed without updating their governed exception.',
      },
    ])
  })

  it('rejects malformed or duplicate registry ownership', () => {
    expect(() => parseDesignValueExceptionRegistry({
      version: 1,
      entries: [
        {
          file: 'src/components/Example.tsx',
          reviewBy: 'phase-3-example',
          values: [
            {
              kind: 'raw-color-class',
              count: 1,
              fingerprint: '44eeb93b9ff2ce08',
              reason: 'legacy-visual-value',
            },
            {
              kind: 'raw-color-class',
              count: 1,
              fingerprint: '44eeb93b9ff2ce08',
              reason: 'legacy-visual-value',
            },
          ],
        },
      ],
    })).toThrow('Duplicate raw-color-class exception')
  })

  it('keeps the repository command, CI workflow, and guidance wired together', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    const workflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/ui-policy.yml'),
      'utf8',
    )
    const stableGuidance = readFileSync(
      resolve(process.cwd(), 'docs/guidance/ui/stable.md'),
      'utf8',
    )

    expect(packageJson.scripts['check:design-policy']).toBe(
      'tsx scripts/check-design-policy.ts',
    )
    expect(workflow).toContain('run: pnpm run check:design-policy')
    expect(stableGuidance).toContain('scripts/design-value-exceptions.json')
    expect(stableGuidance).toContain('exact fingerprint')
  })
})
