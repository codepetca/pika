import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminPrototypePage from '@/app/pattern-lab/admin-prototype/page'
import { getCurrentUser } from '@/lib/auth'

const { mockNotFound } = vi.hoisted(() => ({ mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))

vi.mock('next/navigation', () => ({ notFound: mockNotFound }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn(() => { throw new Error('Live authentication called') }) }))
vi.mock('@/app/__ui/AdminPrototype', () => ({ AdminPrototype: () => <div>Fictional admin prototype</div> }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('admin prototype route', () => {
  it('is unavailable in production even when the gallery flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_UI_GALLERY', 'true')
    await expect(AdminPrototypePage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalledOnce()
    expect(getCurrentUser).not.toHaveBeenCalled()
  })

  it('is unavailable when the gallery flag is off', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ENABLE_UI_GALLERY', 'false')
    await expect(AdminPrototypePage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalledOnce()
    expect(getCurrentUser).not.toHaveBeenCalled()
  })

  it('renders fictional content without a live authentication lookup in an enabled development gallery', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ENABLE_UI_GALLERY', 'true')
    render(await AdminPrototypePage())
    expect(screen.getByText('Fictional admin prototype')).toBeInTheDocument()
    expect(getCurrentUser).not.toHaveBeenCalled()
  })
})
