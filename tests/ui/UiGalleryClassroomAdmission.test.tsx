import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClassroomAdmissionOfferPattern } from '@/app/__ui/ClassroomAdmissionOfferPattern'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(() => vi.unstubAllGlobals())

describe('Pattern Lab classroom admission offer', () => {
  it.each(['teacher', 'student'] as const)('supports keyboard-driven fixture states for %s without a network request', async role => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ClassroomAdmissionOfferPattern role={role} />)
    const section = within(screen.getByTestId('pattern-section-classroom-admission-offer'))

    await user.tab()
    expect(section.getByRole('button', { name: 'Show ready' })).toHaveFocus()
    await user.tab()
    expect(section.getByRole('button', { name: 'Show pending' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(section.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(section.getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-busy', 'true')

    await user.tab()
    expect(section.getByRole('button', { name: 'Show error' })).toHaveFocus()
    await user.keyboard(' ')
    expect(section.getByRole('alert')).toHaveTextContent('Could not update classroom access')
    const retry = section.getByRole('button', { name: 'Try again' })
    await user.tab()
    expect(retry).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(section.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
