import { afterEach, describe, expect, it, vi } from 'vitest'
import { serializeQrSvg } from '@/lib/qr-svg'

describe('portable QR SVG', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exports resolved colors and a four-module quiet zone without changing the screen SVG', () => {
    const svg = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 41" class="w-full"><path fill="var(--color-qr-background)"/><path fill="var(--color-qr-foreground)"/></svg>',
      'image/svg+xml',
    ).documentElement as unknown as SVGSVGElement
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      fill: element === svg.lastChild ? 'rgb(17, 24, 39)' : 'rgb(255, 255, 255)',
      getPropertyValue: () => '#ffffff',
    }) as unknown as CSSStyleDeclaration)
    const output = serializeQrSvg(svg)
    expect(output).toContain('viewBox="-4 -4 49 49"')
    expect(output).toContain('width="1024"')
    expect(output).toContain('fill="rgb(17, 24, 39)"')
    expect(output).toContain('<rect')
    expect(output).not.toContain('var(')
    expect(output).not.toContain('class=')
    expect(svg.getAttribute('viewBox')).toBe('0 0 41 41')
  })
})
