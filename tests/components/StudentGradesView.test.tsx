import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StudentGradesView } from '@/components/gradebook/StudentGradesView'
import type { StudentGradesResponse } from '@/lib/student-grades'

const grades: StudentGradesResponse = {
  currentPercent: 80,
  items: [
    { id: 'zero', kind: 'Classwork', title: 'Practice with a long complete title', earned: 8, possible: 10, percent: 80, included: false, isZeroWeight: true, href: '/feedback' },
    { id: 'excluded', kind: 'Test', title: 'Positive excluded', earned: 9, possible: 10, percent: 90, included: false, isZeroWeight: false, href: '/test' },
    { id: 'standalone', kind: 'Gradebook item', title: 'Saved mark', earned: 0, possible: 20, percent: 0, included: false, isZeroWeight: true, href: null },
  ],
}

describe('StudentGradesView compact zero-weight rows', () => {
  it('defaults to compact zero-weight rows while retaining accessible links, marks and metadata', () => {
    render(<StudentGradesView grades={grades} />)
    const link = screen.getByRole('link', { name: /Practice with a long complete title.*0 weight.*Classwork.*Not counted.*80%.*8 \/ 10/ })
    expect(link).toHaveAttribute('href', '/feedback')
    expect(link).toHaveAttribute('title', 'Practice with a long complete title · Classwork · Not counted')
    expect(link).toHaveClass('min-h-11', 'py-1')
    expect(within(link).getByText('80%').parentElement).toHaveClass('text-text-muted')
    expect(screen.getByText('Saved mark').closest('li')).toHaveTextContent('0%0 / 20')
    expect(screen.getByText('Saved mark').closest('li')?.querySelector('a')).toBeNull()
    const excluded = screen.getByRole('link', { name: /Positive excluded/ })
    expect(excluded).toHaveClass('py-3')
    expect(within(excluded).getByText('Not counted')).toBeVisible()
    expect(within(excluded).getByText('90%')).toHaveClass('text-text-default')
  })

  it('restores regular rows and colors when compact is explicitly false', () => {
    render(<StudentGradesView grades={{ ...grades, compactZeroWeightAssessments: false }} />)
    const link = screen.getByRole('link', { name: /Practice with a long complete title/ })
    expect(link).toHaveClass('min-h-11', 'py-3')
    expect(within(link).getByText('80%')).toHaveClass('text-text-default')
    expect(within(link).getByText('Classwork')).toBeVisible()
    expect(screen.queryByText('0 weight')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
