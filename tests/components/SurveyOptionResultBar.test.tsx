import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SurveyOptionResultBar } from '@/components/surveys/SurveyOptionResultBar'

describe('SurveyOptionResultBar', () => {
  it.each([[0, 20, '0%'], [1, 20, '5%'], [10, 20, '50%'], [20, 20, '100%'], [0, 0, '0%']])(
    'keeps the option and percentage in the bar without a visible tally (%i/%i)',
    (count, totalResponses, percentage) => {
      render(<SurveyOptionResultBar option="Group discussion" count={count as number} totalResponses={totalResponses as number} />)

      const bar = screen.getByLabelText(`Group discussion: ${count} responses, ${percentage}`)
      expect(bar).toContainElement(screen.getByText('Group discussion'))
      expect(bar).toContainElement(screen.getByText(percentage))
      expect(screen.queryByText(String(count))).not.toBeInTheDocument()
    },
  )
})
