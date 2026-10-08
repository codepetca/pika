import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SurveyQuestionOptions } from '@/components/surveys/SurveyQuestionOptions'
import { MAX_SURVEY_OPTIONS } from '@/lib/surveys'
import { TooltipProvider } from '@/ui'

function OptionsHarness({ initial, disabled = false, onChange = () => {} }: {
  initial: string[]
  disabled?: boolean
  onChange?: (options: string[]) => void
}) {
  const [options, setOptions] = useState(initial)
  return <TooltipProvider><SurveyQuestionOptions options={options} disabled={disabled} onChange={(next) => { setOptions(next); onChange(next) }} /></TooltipProvider>
}

describe('SurveyQuestionOptions', () => {
  it('reorders populated choices with arrow keys and follows the moved choice with focus', async () => {
    const onChange = vi.fn()
    render(<OptionsHarness initial={['Game', 'Website', 'Animation']} onChange={onChange} />)
    const handleA = screen.getByRole('button', { name: /Reorder option A;/ })
    handleA.focus()
    fireEvent.keyDown(handleA, { key: 'ArrowDown' })
    expect(screen.getByLabelText('Option A')).toHaveValue('Website')
    expect(screen.getByLabelText('Option B')).toHaveValue('Game')
    expect(onChange).toHaveBeenLastCalledWith(['Website', 'Game', 'Animation', ''])
    await waitFor(() => expect(screen.getByRole('button', { name: /Reorder option B;/ })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder option B;/ }), { key: 'ArrowUp' })
    expect(screen.getByLabelText('Option A')).toHaveValue('Game')
    await waitFor(() => expect(screen.getByRole('button', { name: /Reorder option A;/ })).toHaveFocus())
    onChange.mockClear()
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder option A;/ }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder option C;/ }), { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('adds a trailing blank row as an option is filled and removes populated choices down to two', () => {
    render(<OptionsHarness initial={['Game', 'Website']} />)
    expect(screen.getByLabelText('Option C')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Reorder option C;/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Delete option C' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete option A' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Option C'), { target: { value: 'Animation' } })
    expect(screen.getByLabelText('Option D')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Delete option C' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete option B' }))
    expect(screen.getByLabelText('Option B')).toHaveValue('Animation')
    expect(screen.getByLabelText('Option C')).toHaveValue('')
    expect(screen.queryByLabelText('Option D')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete option A' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete option B' })).toBeDisabled()
  })

  it('limits option rows to the supported maximum and keeps all actions disabled when read-only', () => {
    const onChange = vi.fn()
    render(<OptionsHarness initial={Array.from({ length: MAX_SURVEY_OPTIONS }, (_, index) => `Choice ${index + 1}`)} disabled onChange={onChange} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(MAX_SURVEY_OPTIONS)
    for (const input of screen.getAllByRole('textbox')) expect(input).toBeDisabled()
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder option A;/ }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete option A' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
