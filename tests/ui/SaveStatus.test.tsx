import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SaveStatus, type SaveStatusState } from '@/ui'

describe('SaveStatus', () => {
  it.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['unsaved', 'Unsaved'],
    ['error', 'Save failed'],
  ] satisfies Array<[SaveStatusState, string]>)(
    'renders %s as an announced status',
    (status, label) => {
      render(<SaveStatus status={status} />)

      const indicator = screen.getByRole('status')
      expect(indicator).toHaveTextContent(label)
      expect(indicator).toHaveAttribute('aria-live', 'polite')
      expect(indicator).toHaveAttribute('aria-atomic', 'true')
    },
  )
})
