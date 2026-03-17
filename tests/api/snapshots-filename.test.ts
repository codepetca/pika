import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/snapshots/[filename]/route'

const { readFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  default: { readFile: readFileMock },
}))

describe('GET /api/snapshots/[filename]', () => {
  it('rejects invalid filenames', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/snapshots/../../secret.txt'),
      { params: { filename: '../secret.txt' } }
    )

    expect(response.status).toBe(400)
    await expect(response.text()).resolves.toBe('Invalid filename')
  })

  it('returns 404 when the snapshot file does not exist', async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/snapshots/view.png'),
      { params: { filename: 'view.png' } }
    )

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('Snapshot not found')
  })

  it('returns the png file with cache headers', async () => {
    readFileMock.mockResolvedValueOnce(Buffer.from('png-data'))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/snapshots/view.png'),
      { params: { filename: 'view.png' } }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('png-data')
  })
})
