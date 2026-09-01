import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TestEditingPolicyFixture } from '@/app/e2e-fixtures/test-editing-policy/preview'
vi.mock('@dnd-kit/sortable', () => ({ useSortable: () => ({ attributes:{}, listeners:{}, setNodeRef:vi.fn(), transform:null, transition:undefined, isDragging:false }) }))
vi.mock('@dnd-kit/utilities', () => ({ CSS:{ Transform:{ toString:()=>undefined } } }))
it('does not expose answer controls before simulated Start', async () => {
  const user = userEvent.setup()
  render(<TestEditingPolicyFixture />)
  await user.click(screen.getByRole('button', { name: 'Show before Start' }))
  expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: /Select option/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Start the Test' }))
  expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
})
