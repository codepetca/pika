import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/ui'
import { SettingsSwitchMotionPattern } from '@/app/__ui/SettingsSwitchMotionPattern'

afterEach(() => vi.restoreAllMocks())

it('keeps both production switch values while saving and restores keyboard activation without API writes', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Fixture must not call an API'))
  const user = userEvent.setup()
  render(<TooltipProvider><SettingsSwitchMotionPattern /></TooltipProvider>)
  const setting = screen.getByRole('switch', { name: 'Example setting' })
  const visibility = screen.getByRole('switch', { name: 'Student grades visibility' })

  await user.tab()
  expect(setting).toHaveFocus()
  await user.keyboard(' ')
  expect(setting).toHaveAttribute('aria-checked', 'true')
  await user.tab()
  expect(visibility).toHaveFocus()
  await user.keyboard(' ')
  expect(visibility).toHaveAttribute('aria-checked', 'true')

  await user.click(screen.getByRole('button', { name: 'Simulate saving' }))
  expect(setting).toBeDisabled()
  expect(visibility).toBeDisabled()
  expect(screen.getByTestId('teacher-gradebook-visibility-control')).toHaveAttribute('aria-busy', 'true')
  await user.click(setting)
  expect(setting).toHaveAttribute('aria-checked', 'true')
  expect(visibility).toHaveAttribute('aria-checked', 'true')

  await user.click(screen.getByRole('button', { name: 'Make switches available' }))
  expect(setting).toBeEnabled()
  expect(visibility).toBeEnabled()
  expect(screen.getByTestId('teacher-gradebook-visibility-control')).not.toHaveAttribute('aria-busy')
  await user.tab({ shift: true })
  expect(visibility).toHaveFocus()
  await user.keyboard(' ')
  expect(visibility).toHaveAttribute('aria-checked', 'false')
  expect(setting).toHaveAttribute('aria-checked', 'true')
  expect(fetch).not.toHaveBeenCalled()
})
