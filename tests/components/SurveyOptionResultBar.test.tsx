import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SurveyOptionResultBar } from '@/components/surveys/SurveyOptionResultBar'

describe('SurveyOptionResultBar', () => {
  it('uses the accessible solid fill when percentage text appears inside the bar', () => {
    render(<SurveyOptionResultBar option="Option A" count={1} totalResponses={2} />)

    expect(screen.getByText('50%').parentElement).toHaveClass('bg-primary-solid')
    expect(screen.getByText('50%')).toHaveClass('text-text-inverse')
  })
})
