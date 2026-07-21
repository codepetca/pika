import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Rgba = { red: number; green: number; blue: number; alpha: number }
type Theme = 'light' | 'dark'

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const minimumTextContrast = 4.5
const backdropTokens = ['color-page', 'color-surface', 'color-surface-2'] as const

const neutralBackgrounds = [
  'color-page',
  'color-surface',
  'color-surface-2',
  'color-surface-3',
  'color-surface-panel',
  'color-surface-accent',
  'color-surface-selected',
  'color-surface-hover',
] as const

const foregroundContracts = [
  { foreground: 'color-text-default', backgrounds: neutralBackgrounds },
  { foreground: 'color-text-muted', backgrounds: neutralBackgrounds },
  { foreground: 'color-primary', backgrounds: neutralBackgrounds },
  { foreground: 'color-primary-hover', backgrounds: neutralBackgrounds },
  { foreground: 'color-success', backgrounds: neutralBackgrounds },
  { foreground: 'color-success-hover', backgrounds: neutralBackgrounds },
  { foreground: 'color-danger', backgrounds: neutralBackgrounds },
  { foreground: 'color-danger-hover', backgrounds: neutralBackgrounds },
  { foreground: 'color-warning', backgrounds: neutralBackgrounds },
  { foreground: 'color-info', backgrounds: neutralBackgrounds },
  { foreground: 'color-text-default', backgrounds: ['color-info-bg', 'color-info-bg-hover'] },
  { foreground: 'color-primary', backgrounds: ['color-info-bg', 'color-info-bg-hover'] },
  {
    foreground: 'color-success',
    backgrounds: ['color-success-bg', 'color-success-bg-muted', 'color-success-bg-hover'],
  },
  { foreground: 'color-danger', backgrounds: ['color-danger-bg', 'color-danger-bg-hover'] },
  { foreground: 'color-warning', backgrounds: ['color-warning-bg'] },
  { foreground: 'color-info', backgrounds: ['color-info-bg', 'color-info-bg-hover'] },
] as const

const solidFillContracts = [
  ['color-text-inverse', 'color-primary-solid'],
  ['color-text-inverse', 'color-primary-solid-hover'],
  ['color-text-inverse', 'color-success-solid'],
  ['color-text-inverse', 'color-success-solid-hover'],
  ['color-text-inverse', 'color-danger-solid'],
  ['color-text-inverse', 'color-danger-solid-hover'],
] as const

function parseThemeTokens(theme: Theme) {
  const selector = theme === 'light' ? ':root' : '.dark'
  const escapedSelector = selector.replace('.', '\\.')
  const body = tokensCss.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`))
    ?.groups?.body

  expect(body, `Missing ${selector} token block`).toBeDefined()

  return new Map(
    Array.from(body?.matchAll(/--(?<name>[\w-]+):\s*(?<value>[^;]+);/g) ?? []).map((match) => [
      match.groups?.name ?? '',
      match.groups?.value.trim() ?? '',
    ])
  )
}

function parseColor(value: string): Rgba {
  const hex = value.match(/^#(?<hex>[0-9a-f]{6})$/i)?.groups?.hex
  if (hex) {
    return {
      red: Number.parseInt(hex.slice(0, 2), 16),
      green: Number.parseInt(hex.slice(2, 4), 16),
      blue: Number.parseInt(hex.slice(4, 6), 16),
      alpha: 1,
    }
  }

  const rgba = value.match(
    /^rgba?\(\s*(?<red>\d+)\s*,\s*(?<green>\d+)\s*,\s*(?<blue>\d+)(?:\s*,\s*(?<alpha>[\d.]+))?\s*\)$/
  )?.groups
  if (rgba) {
    return {
      red: Number(rgba.red),
      green: Number(rgba.green),
      blue: Number(rgba.blue),
      alpha: rgba.alpha === undefined ? 1 : Number(rgba.alpha),
    }
  }

  throw new Error(`Unsupported color value: ${value}`)
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
  const channel = (foregroundChannel: number, backgroundChannel: number) =>
    (foregroundChannel * foreground.alpha + backgroundChannel * background.alpha * (1 - foreground.alpha)) /
    alpha

  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha,
  }
}

function luminance(color: Rgba) {
  const linearize = (channel: number) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }

  return (
    linearize(color.red) * 0.2126 +
    linearize(color.green) * 0.7152 +
    linearize(color.blue) * 0.0722
  )
}

function contrastRatio(foreground: Rgba, background: Rgba) {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function getColor(tokens: Map<string, string>, token: string) {
  const value = tokens.get(token)
  expect(value, `Missing --${token}`).toBeDefined()
  return parseColor(value ?? '')
}

describe.each<Theme>(['light', 'dark'])('%s semantic token contrast', (theme) => {
  const tokens = parseThemeTokens(theme)

  it('keeps semantic text readable on its supported backgrounds', () => {
    for (const contract of foregroundContracts) {
      for (const backgroundToken of contract.backgrounds) {
        for (const backdropToken of backdropTokens) {
          const backdrop = getColor(tokens, backdropToken)
          const background = composite(getColor(tokens, backgroundToken), backdrop)
          const foreground = composite(getColor(tokens, contract.foreground), background)
          const ratio = contrastRatio(foreground, background)

          expect(
            ratio,
            `${theme}: --${contract.foreground} on --${backgroundToken} over --${backdropToken} (${ratio.toFixed(2)}:1)`
          ).toBeGreaterThanOrEqual(minimumTextContrast)
        }
      }
    }
  })

  it('keeps inverse text readable on solid semantic fills', () => {
    for (const [foregroundToken, backgroundToken] of solidFillContracts) {
      const background = getColor(tokens, backgroundToken)
      expect(background.alpha, `${theme}: --${backgroundToken} must remain opaque`).toBe(1)
      const foreground = composite(getColor(tokens, foregroundToken), background)
      const ratio = contrastRatio(foreground, background)

      expect(
        ratio,
        `${theme}: --${foregroundToken} on --${backgroundToken} (${ratio.toFixed(2)}:1)`
      ).toBeGreaterThanOrEqual(minimumTextContrast)
    }
  })
})
