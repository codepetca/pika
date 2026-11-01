import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassroomAdmissionOffer } from '@/app/classrooms/ClassroomAdmissionOffer'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

describe('explicit classroom admission offer', () => {
  beforeEach(() => { mocks.refresh.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('does not write on mount and only makes one request while pending', async () => {
    let finish!: (response: unknown) => void
    const fetchMock = vi.fn(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassroomAdmissionOffer density="student" />)
    expect(fetchMock).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    finish({ ok: true, json: async () => ({ outcome: 'admitted' }) })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/classrooms/admission/ensure', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
  })

  it.each(['disabled', 'growth_stopped', 'excluded', 'unverified', 'unknown'])('does not claim success for %s', async outcome => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ outcome }) }))
    render(<ClassroomAdmissionOffer density="teacher" />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).not.toHaveTextContent(outcome)
  })

  it('refreshes on an already-admitted reconciliation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ outcome: 'already_admitted' }) }))
    render(<ClassroomAdmissionOffer density="student" />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
  })
})
