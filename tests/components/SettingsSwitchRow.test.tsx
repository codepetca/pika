import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsSwitch, SettingsSwitchRow } from '@/components/settings/SettingsSwitchRow'
import { TooltipProvider } from '@/ui'

describe('SettingsSwitchRow', () => {
  it('exposes its checked state and toggles from the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SettingsSwitchRow checked onChange={onChange} ariaLabel="Show grades to students">
        Show grades to students
      </SettingsSwitchRow>,
    )

    const toggle = screen.getByRole('switch', { name: 'Show grades to students' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('keeps a disabled switch unavailable', () => {
    render(
      <SettingsSwitchRow checked={false} onChange={vi.fn()} ariaLabel="Disabled setting" disabled>
        Disabled setting
      </SettingsSwitchRow>,
    )

    expect(screen.getByRole('switch', { name: 'Disabled setting' })).toBeDisabled()
  })

  it('can explain a compact switch with a tooltip', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <SettingsSwitch
          checked={false}
          onChange={vi.fn()}
          ariaLabel="Student grades visibility"
          tooltip="Show grades to students"
        />
      </TooltipProvider>,
    )

    await user.hover(screen.getByRole('switch', { name: 'Student grades visibility' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Show grades to students')
  })
})
