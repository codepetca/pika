import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (filePath: string) => fs.readFileSync(path.join(root, filePath), 'utf8')

describe('portable design foundations', () => {
  const tokens = read('src/styles/tokens.css')
  const tailwind = read('tailwind.config.ts')

  it('preserves the implemented values behind host-neutral semantic tokens', () => {
    expect(tokens).toContain('--size-control-min: 2.75rem;')
    expect(tokens).toContain('--focus-ring-color: var(--color-primary);')
    expect(tokens).toContain('--focus-ring-width: 2px;')
    expect(tokens).toContain('--focus-ring-offset: 2px;')
    expect(tokens).toContain('--motion-duration-fast: 150ms;')
    expect(tokens).toContain('--motion-duration-standard: 200ms;')
    expect(tokens).toContain('--motion-duration-deliberate: 300ms;')
    expect(tokens).toContain('@media (prefers-reduced-motion: reduce)')
    expect(tokens.match(/--motion-duration-fast: 0ms;/g)).toHaveLength(1)
    expect(tokens).toContain('--page-width-reading: 42rem;')
    expect(tokens).toContain('--page-width-standard: 56rem;')
    expect(tokens).toContain('--page-width-wide: 80rem;')
    expect(tokens).toContain('--density-compact-gutter: 0.75rem;')
    expect(tokens).toContain('--density-comfortable-gutter: 1rem;')
    expect(tokens).toContain('--layer-local-menu: 20;')
    expect(tokens).toContain('--layer-floating: 40;')
    expect(tokens).toContain('--layer-app-message: 80;')
  })

  it('defines light and dark overlay scrims without widget-specific aliases', () => {
    expect(tokens.match(/--color-overlay-scrim:/g)).toHaveLength(2)
    expect(tokens).toContain('--color-overlay-scrim: rgb(0 0 0 / 0.5);')
    expect(tokens).toContain('--color-overlay-scrim: rgb(0 0 0 / 0.7);')
    expect(tokens).not.toContain('--pal-')
  })

  it('exposes each foundation through the Tailwind adapter', () => {
    for (const variable of [
      '--font-family-ui',
      '--font-family-mono',
      '--size-control-min',
      '--focus-ring-color',
      '--focus-ring-width',
      '--focus-ring-offset',
      '--motion-duration-fast',
      '--motion-duration-standard',
      '--motion-duration-deliberate',
      '--motion-easing-standard',
      '--page-width-reading',
      '--page-width-standard',
      '--page-width-wide',
      '--density-compact-gutter',
      '--density-comfortable-gutter',
      '--layer-local-menu',
      '--layer-floating',
      '--layer-app-chrome',
      '--layer-popover',
      '--layer-modal',
      '--layer-app-message',
      '--color-overlay-scrim',
    ]) {
      expect(tailwind).toContain(`var(${variable})`)
    }
  })

  it('routes canonical owners through semantic aliases', () => {
    const expectedAliases: Record<string, string[]> = {
      'src/ui/Button.tsx': [
        'min-h-control',
        'focus-visible:ring-foundation',
        'focus-visible:ring-focus',
      ],
      'src/ui/Page.tsx': [
        'max-w-reading',
        'px-density-compact-gutter',
        'z-local-menu',
      ],
      'src/ui/ModalLayer.tsx': ['bg-overlay-scrim', 'z-modal'],
      'src/ui/AppMessage.tsx': ['z-app-message'],
      'src/ui/Tooltip.tsx': ['z-popover'],
      'src/components/FloatingActionCluster.tsx': [
        'z-floating',
        'duration-standard',
        'ease-standard',
      ],
    }

    for (const [filePath, aliases] of Object.entries(expectedAliases)) {
      const source = read(filePath)
      for (const alias of aliases) expect(source).toContain(alias)
    }
  })

})
