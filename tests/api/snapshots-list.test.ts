import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/snapshots/list/route'

const { readdirMock, requireSnapshotGalleryAccessMock } = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  requireSnapshotGalleryAccessMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
  default: { readdir: readdirMock },
}))
vi.mock('@/lib/auth', () => ({
  requireSnapshotGalleryAccess: requireSnapshotGalleryAccessMock,
}))

const originalEnableUiGallery = process.env.ENABLE_UI_GALLERY

describe('GET /api/snapshots/list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_UI_GALLERY = 'true'
    requireSnapshotGalleryAccessMock.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@yrdsb.ca',
      role: 'teacher',
    })
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
    expect(requireSnapshotGalleryAccessMock).not.toHaveBeenCalled()
    expect(readdirMock).not.toHaveBeenCalled()
  })

  it('returns 401 when snapshot gallery access is unauthenticated', async () => {
    requireSnapshotGalleryAccessMock.mockRejectedValue(Object.assign(new Error('Not authenticated'), { name: 'AuthenticationError' }))

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(readdirMock).not.toHaveBeenCalled()
  })

  it('returns 403 when snapshot gallery access is unauthorized', async () => {
    requireSnapshotGalleryAccessMock.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Forbidden' })
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
