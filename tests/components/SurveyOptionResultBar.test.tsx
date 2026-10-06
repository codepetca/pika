import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SurveyOptionResultBar } from '@/components/surveys/SurveyOptionResultBar'

describe('SurveyOptionResultBar', () => {
  it.each([[0, 20, '0%'], [1, 20, '5%'], [10, 20, '50%'], [20, 20, '100%'], [0, 0, '0%'], [1, 1000, '0%']])(
    'keeps the option in the bar and shows percentages only for selected options (%i/%i)',
    (count, totalResponses, percentage) => {
      render(<SurveyOptionResultBar option="Group discussion" count={count as number} totalResponses={totalResponses as number} />)

      const bar = screen.getByRole('group', { name: `Group discussion: ${count} responses, ${percentage}` })
      expect(bar).toContainElement(screen.getByText('Group discussion'))
      if (count === 0) expect(screen.queryByText(percentage)).not.toBeInTheDocument()
      else expect(bar).toContainElement(screen.getByText(percentage))
      expect(screen.queryByText(String(count))).not.toBeInTheDocument()
    },
  )
})
