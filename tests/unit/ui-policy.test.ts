import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  auditUiPolicy,
  inventoryNativeControls,
  parseUiControlExceptionRegistry,
  type UiControlExceptionRegistry,
} from '../../scripts/lib/ui-policy'

function registry(
  entries: UiControlExceptionRegistry['entries'],
): UiControlExceptionRegistry {
  return parseUiControlExceptionRegistry({ version: 1, entries })
}

describe('UI policy', () => {
  it('allows canonical imports and exact, reasoned native-control exceptions', () => {
    const files = {
      'src/components/Picker.tsx': `
        import { Button } from '@/ui'
        export function Picker() {
          return <><input type="file" /><button type="button">Clear</button></>
        }
      `,
    }
    const exceptions = registry([
      {
        file: 'src/components/Picker.tsx',
        reviewBy: 'phase-3-assignments',
        controls: [
          { kind: 'button', count: 1, reason: 'icon-or-inline-action' },
          { kind: 'input:file', count: 1, reason: 'native-input-capability' },
        ],
      },
    ])

    expect(auditUiPolicy(files, exceptions)).toEqual([])
  })

  it('rejects unregistered controls and count drift in either direction', () => {
    const files = {
      'src/app/example/page.tsx': 'export default function Page() { return <><button>A</button><button>B</button></> }',
    }

    expect(auditUiPolicy(files, registry([]))).toContainEqual({
      file: 'src/app/example/page.tsx',
      message: 'Native controls require an entry in scripts/ui-control-exceptions.json.',
    })

    const violations = auditUiPolicy(files, registry([
      {
        file: 'src/app/example/page.tsx',
        reviewBy: 'phase-2-shared-foundation-debt',
        controls: [
          { kind: 'button', count: 1, reason: 'legacy-form-control' },
          { kind: 'textarea', count: 1, reason: 'native-textarea' },
        ],
      },
    ]))

    expect(violations).toContainEqual({
      file: 'src/app/example/page.tsx',
      message: 'Native control button count is 2; registry expects 1.',
    })
    expect(violations).toContainEqual({
      file: 'src/app/example/page.tsx',
      message: 'Native-control registry entry textarea is stale; no matching control remains.',
    })
  })

  it('tracks static, absent, and dynamic input types separately', () => {
    const inventory = inventoryNativeControls({
      'src/components/Inputs.tsx': `
        export function Inputs({ type }: { type: string }) {
          return <><input type="checkbox" /><input /><input type={type} /></>
        }
      `,
    })

    expect(Object.fromEntries(inventory.get('src/components/Inputs.tsx') ?? [])).toEqual({
      'input:checkbox': 1,
      'input:dynamic': 1,
      'input:unspecified': 1,
    })
  })

  it('rejects UI subpath and legacy component imports', () => {
    const violations = auditUiPolicy({
      'src/components/BadImports.tsx': `
        import { Button } from '@/components/Button'
        export { Card } from '@/ui/Card'
      `,
    }, registry([]))

    expect(violations).toEqual([
      {
        file: 'src/components/BadImports.tsx',
        message: 'Import @/ui/Card through the canonical @/ui barrel.',
      },
      {
        file: 'src/components/BadImports.tsx',
        message: 'Legacy import @/components/Button is forbidden; import from @/ui.',
      },
    ])
  })

  it('rejects duplicate registry files and kinds', () => {
    const entry = {
      file: 'src/components/Picker.tsx',
      reviewBy: 'phase-3-assignments',
      controls: [{ kind: 'button' as const, count: 1, reason: 'composite-widget' as const }],
    }

    expect(() => registry([entry, entry])).toThrow('Duplicate native-control registry file')
    expect(() => registry([{ ...entry, controls: [...entry.controls, ...entry.controls] }]))
      .toThrow('Duplicate native-control kind')
  })

  it('rejects reasons that do not match the native control semantics', () => {
    expect(() => registry([
      {
        file: 'src/components/Picker.tsx',
        reviewBy: 'phase-3-assignments',
        controls: [
          { kind: 'input:file', count: 1, reason: 'legacy-form-control' },
        ],
      },
    ])).toThrow('Invalid native-control reason legacy-form-control for input:file')
  })

  it('keeps the repository command and pull-request policy workflow wired together', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ui-policy.yml'), 'utf8')
    const stableGuidance = readFileSync(resolve(process.cwd(), 'docs/guidance/ui/stable.md'), 'utf8')

    expect(packageJson.scripts['check:ui-policy']).toBe('tsx scripts/check-ui-policy.ts')
    expect(workflow).toContain('run: pnpm run check:ui-policy')
    expect(stableGuidance).toContain('specialized-control-policy.md')
  })

  it('excludes design-system and Tiptap implementation controls', () => {
    const inventory = inventoryNativeControls({
      'src/ui/Button.tsx': 'export function Button() { return <button /> }',
      'src/components/tiptap-ui/Button.tsx': 'export function Button() { return <button /> }',
      'src/components/tiptap-custom/Picker.tsx': 'export function Picker() { return <input /> }',
    })

    expect(inventory.size).toBe(0)
  })
})
