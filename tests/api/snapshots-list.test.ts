import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/snapshots/list/route'

const { readdirMock, requireAuthMock } = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  requireAuthMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
  default: { readdir: readdirMock },
}))
vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }))

const originalEnableUiGallery = process.env.ENABLE_UI_GALLERY

describe('GET /api/snapshots/list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_UI_GALLERY = 'true'
    requireAuthMock.mockResolvedValue({ id: 'user-1' })
  })

  afterEach(() => {
    if (originalEnableUiGallery === undefined) {
      delete process.env.ENABLE_UI_GALLERY
    } else {
      process.env.ENABLE_UI_GALLERY = originalEnableUiGallery
    }
  })

  it('returns 404 before reading files when the UI gallery is disabled', async () => {
    delete process.env.ENABLE_UI_GALLERY

    const response = await GET()

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('Not found')
    expect(requireAuthMock).not.toHaveBeenCalled()
    expect(readdirMock).not.toHaveBeenCalled()
  })

  it('returns sorted png snapshots with readable names', async () => {
    readdirMock.mockResolvedValue([
      'b-view-chromium-desktop-darwin.png',
      'notes.txt',
      'a-calendar-chromium-desktop-darwin.png',
    ])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.snapshots).toEqual([
      {
        filename: 'a-calendar-chromium-desktop-darwin.png',
        name: 'A Calendar',
      },
      {
        filename: 'b-view-chromium-desktop-darwin.png',
        name: 'B View',
      },
    ])
  })

  it('returns an empty list when the snapshots directory does not exist', async () => {
    readdirMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ snapshots: [] })
  })

  it('rethrows unexpected filesystem errors', async () => {
    readdirMock.mockRejectedValue(new Error('permission denied'))

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Internal server error' })
  })
})
