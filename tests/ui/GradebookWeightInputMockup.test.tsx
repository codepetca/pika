import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GradebookWeightInputMockup } from '@/app/__ui/GradebookWeightInputMockup'

describe('GradebookWeightInputMockup', () => {
  it('labels the input and restores the last valid weight after an invalid draft', () => {
    function Harness() {
      const [weight, setWeight] = useState(10)
      return <>
        <GradebookWeightInputMockup title="Ecosystems" weight={weight} onChange={setWeight} />
        <output aria-label="Saved weight">{weight}</output>
      </>
    }
    render(<Harness />)
    const input = screen.getByRole('spinbutton', { name: 'Category weight for Ecosystems' })
    expect(input).toHaveClass('[appearance:textfield]')
    fireEvent.change(input, { target: { value: '20' } })
    expect(screen.getByLabelText('Saved weight')).toHaveTextContent('20')
    for (const value of ['', '0', '-1', '2.5', '1000']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Saved weight')).toHaveTextContent('20')
      fireEvent.blur(input)
      expect(input).toHaveValue(20)
      expect(input).toHaveAttribute('aria-invalid', 'false')
    }
  })
})
