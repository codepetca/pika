import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  PAL_THEME_ATTRIBUTES,
  PAL_THEME_CONTRACT_VERSION,
  PAL_THEME_PROPERTIES,
} from '@codepet/pal-widget/theme-contract'

const adapter = readFileSync(
  resolve(
    process.cwd(),
    'src/integrations/pal/pal-widget-theme.module.css',
  ),
  'utf8',
)
const pikaTokens = readFileSync(
  resolve(process.cwd(), 'src/styles/tokens.css'),
  'utf8',
)
const tailwindConfig = readFileSync(
  resolve(process.cwd(), 'tailwind.config.ts'),
  'utf8',
)

describe('Pika to Pal widget theme adapter', () => {
  it('pins the published level-up widget release exactly', () => {
    const pikaPackage = JSON.parse(readFileSync(
      resolve(process.cwd(), 'package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> }
    const widgetPackage = JSON.parse(readFileSync(
      resolve(process.cwd(), 'node_modules/@codepet/pal-widget/package.json'),
      'utf8',
    )) as { version?: string }

    expect(pikaPackage.dependencies?.['@codepet/pal-widget']).toBe('0.1.0-alpha.5')
    expect(widgetPackage.version).toBe('0.1.0-alpha.5')
  })

  it('uses the package contract without retaining a second vendored authority', () => {
    expect(existsSync(resolve(process.cwd(), 'src/vendor/pal-widget-theme'))).toBe(false)
    expect(tailwindConfig).toContain('./src/integrations/**/*.{js,ts,jsx,tsx,mdx}')
  })

  it('implements every property from the reviewed Pal contract exactly once', () => {
    expect(PAL_THEME_CONTRACT_VERSION).toBe(1)

    for (const property of PAL_THEME_PROPERTIES) {
      expect(adapter.match(new RegExp(`${property}:`, 'g'))).toHaveLength(1)
    }

    const adapterProperties = [
      ...adapter.matchAll(/^\s*(--pal-[a-z0-9-]+):/gm),
    ].map((match) => match[1])
    expect(adapterProperties.sort()).toEqual([...PAL_THEME_PROPERTIES].sort())
  })

  it('aliases only Pika semantic tokens and introduces no copied visual values', () => {
    const declarations = [
      ...adapter.matchAll(
        /^\s*(--pal-[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);$/gm,
      ),
    ]

    expect(declarations).toHaveLength(PAL_THEME_PROPERTIES.length)
    for (const [, palProperty, pikaProperty] of declarations) {
      expect(palProperty).toMatch(/^--pal-/)
      expect(pikaProperty).not.toMatch(/^--pal-/)
      expect(pikaTokens).toMatch(
        new RegExp(`^\\s*${pikaProperty.replaceAll('-', '\\-')}:`, 'm'),
      )
    }
    expect(adapter).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\d+(?:\.\d+)?(?:px|rem|ms)\b/i)
  })

  it('keeps the companion fixed, non-interactive, and inside mobile safe areas', () => {
    const placement = adapter.match(/\.bottomRight\s*\{([^}]+)\}/)?.[1]

    expect(placement).toContain('position: fixed;')
    expect(placement).toContain('pointer-events: none;')
    expect(placement).toContain('z-index: var(--layer-floating);')
    expect(placement).toContain(
      'right: calc(var(--density-comfortable-gutter) + env(safe-area-inset-right));',
    )
    expect(placement).toContain(
      'bottom: calc(var(--density-comfortable-gutter) + env(safe-area-inset-bottom));',
    )
  })

  it('tracks the scoped appearance values Pika must pass to PalProvider', () => {
    expect(PAL_THEME_ATTRIBUTES).toEqual({
      density: ['compact', 'comfortable'],
      motion: ['system', 'reduced'],
      theme: ['light', 'dark'],
      viewport: ['narrow', 'wide'],
    })
  })
})
