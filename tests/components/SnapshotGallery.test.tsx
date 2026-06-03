import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SnapshotGallery } from '@/app/snapshots-gallery/SnapshotGallery'

interface MockResponseInit {
  status?: number
  ok?: boolean
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

function mockResponse(payload: unknown, init: MockResponseInit = {}) {
  return {
    status: init.status ?? 200,
    ok: init.ok ?? (init.status === undefined || (init.status >= 200 && init.status < 300)),
    json: init.json ?? (() => Promise.resolve(payload)),
    text: init.text ?? (() => Promise.resolve(typeof payload === 'string' ? payload : JSON.stringify(payload))),
  } as Response
}

describe('SnapshotGallery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders snapshots when the API returns valid data', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse({
      snapshots: [
        { filename: 'teacher-home.png', name: 'Teacher Home' },
        { filename: 'student-home.png', name: 'Student Home' },
      ],
    })))

    render(<SnapshotGallery />)

    await waitFor(() => {
      expect(screen.getByText('Teacher Home')).toBeInTheDocument()
    })

    expect(screen.getByText('2 snapshots captured')).toBeInTheDocument()
  })

  it('shows an error state for non-OK API responses', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse('Unauthorized', {
      status: 401,
      ok: false,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    })))

    render(<SnapshotGallery />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Unable to load snapshots' })).toBeInTheDocument()
    })

    expect(screen.getByText(/signed in as an authorized user/i)).toBeInTheDocument()
  })

  it('handles malformed snapshot payloads safely', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse({ notSnapshots: true })))

    render(<SnapshotGallery />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Unable to load snapshots' })).toBeInTheDocument()
    })

    expect(screen.getByText('Unexpected snapshot list response format.')).toBeInTheDocument()
  })
})
