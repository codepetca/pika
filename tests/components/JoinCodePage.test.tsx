import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JoinPage from '@/app/join/page'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
beforeEach(() => push.mockClear())

describe('public join code entry', () => {
  it('labels the code field and guards empty and whitespace-only submissions', async () => {
    const user = userEvent.setup()
    render(<JoinPage />)
    const input = screen.getByRole('textbox', { name: 'Join code' })
    const join = screen.getByRole('button', { name: 'Join', exact: true })
    expect(join).toBeDisabled()
    await user.type(input, '   ')
    expect(input).toHaveValue('   ')
    expect(join).toBeDisabled()
    fireEvent.submit(input.closest('form')!)
    expect(push).not.toHaveBeenCalled()
  })

  it('preserves controlled uppercase text and spaces while editing and submits by keyboard', async () => {
    const user = userEvent.setup()
    render(<JoinPage />)
    const input = screen.getByRole('textbox', { name: 'Join code' })
    await user.type(input, ' abc123 ')
    expect(input).toHaveValue(' ABC123 ')
    expect(input).toHaveFocus()
    await user.tab()
    const join = screen.getByRole('button', { name: 'Join', exact: true })
    expect(join).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(push).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith('/join/ABC123')
    expect(input).toHaveValue(' ABC123 ')
  })

  it('trims and encodes the same destination when Enter is pressed in the input', async () => {
    const user = userEvent.setup()
    render(<JoinPage />)
    const input = screen.getByRole('textbox', { name: 'Join code' })
    await user.type(input, ' a&b / c ')
    await user.keyboard('{Enter}')
    expect(push).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith('/join/A%26B%20%2F%20C')
    expect(input).toHaveValue(' A&B / C ')
  })
})
