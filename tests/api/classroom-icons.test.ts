import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { GET, generateStaticParams } from '@/app/classroom-icons/[color]/route'
import { CLASSROOM_THEME_PALETTE } from '@/lib/classroom-theme'

describe('classroom favicons', () => {
  it('serves every supported classroom color with the original white Pika mark', async () => {
    const mark = await readFile(path.join(process.cwd(), 'public/pika-icon-dark.svg'), 'utf8')
    const originalImage = mark.match(/href="([^"]+)"/)?.[1]
    expect(generateStaticParams()).toHaveLength(CLASSROOM_THEME_PALETTE.length)
    for (const color of CLASSROOM_THEME_PALETTE) {
      const response = await GET(new NextRequest(`http://localhost/classroom-icons/${color.value}`), { params: Promise.resolve({ color: color.value }) })
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
      expect(response.headers.get('Cache-Control')).toContain('public')
      const svg = await response.text()
      expect(svg).toContain(`fill="${color.textColor}"`)
      expect(svg).toContain(originalImage)
    }
  })

  it('rejects arbitrary input without reflecting it in SVG', async () => {
    const response = await GET(new NextRequest('http://localhost/classroom-icons/invalid'), { params: Promise.resolve({ color: '<svg onload="alert(1)">' }) })
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('<svg')
  })
})
