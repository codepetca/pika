import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '@/ui/Button'
import { Tabs } from '@/ui/Tabs'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { DataTable, DataTableHead, DataTableRow, SortableHeaderCell } from '@/ui/DataTable'
import { PageState } from '@/ui/PageState'

function ImmediateControls() {
  const [tab, setTab] = useState('details')
  const [density, setDensity] = useState('compact')
  const [sorting, setSorting] = useState(false)
  const [saving, setSaving] = useState(false)
  return (
    <>
      <Tabs ariaLabel="Workspace" value={tab} onValueChange={setTab}
        items={[{ value: 'details', label: 'Details' }, { value: 'history', label: 'History' }]} />
      <SegmentedControl ariaLabel="Density" value={density} onChange={setDensity}
        options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} />
      <DataTable>
        <DataTableHead><DataTableRow>
          <SortableHeaderCell label="Name" isActive={sorting} direction="asc" onClick={() => setSorting(true)} />
        </DataTableRow></DataTableHead>
      </DataTable>
      <Button loading={saving} onClick={() => setSaving(true)}>{saving ? 'Saving' : 'Save'}</Button>
      {saving && <PageState compact kind="loading" title="Saving work" />}
    </>
  )
}

describe('shared control interaction', () => {
  it('applies keyboard selection, sorting and busy feedback immediately', () => {
    render(<ImmediateControls />)
    const history = screen.getByRole('tab', { name: 'History' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Details' }), { key: 'ArrowRight' })
    expect(history).toHaveAttribute('aria-selected', 'true')
    expect(history).toHaveFocus()

    const comfortable = screen.getByRole('button', { name: 'Comfortable' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Compact' }), { key: 'ArrowRight' })
    expect(comfortable).toHaveAttribute('aria-pressed', 'true')
    expect(comfortable).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')

    const save = screen.getByRole('button', { name: 'Save', exact: true })
    fireEvent.click(save)
    expect(screen.getByRole('button', { name: 'Saving', exact: true })).toBe(save)
    expect(save).toHaveAttribute('aria-busy', 'true')
    expect(save).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Saving work')
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })
})
