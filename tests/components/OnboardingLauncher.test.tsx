import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingLauncher } from '@/components/onboarding/OnboardingLauncher'

const mockClassroomSetupOnboarding = vi.fn(() => <div data-testid="onboarding-chain" />)

vi.mock('@/components/onboarding/ClassroomSetupOnboarding', () => ({
  ClassroomSetupOnboarding: (props: unknown) => mockClassroomSetupOnboarding(props),
}))

describe('OnboardingLauncher', () => {
  it('renders only a help button and never mounts the fetching chain until clicked', () => {
    render(
      <OnboardingLauncher
        classroomId="classroom-1"
        activeTab="daily"
        autoStart={false}
        onNavigate={vi.fn()}
        onAutoStartConsumed={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /reopen the getting-started guide/i })).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-chain')).not.toBeInTheDocument()
    expect(mockClassroomSetupOnboarding).not.toHaveBeenCalled()
  })

  it('mounts the chain once the help button is clicked', () => {
    render(
      <OnboardingLauncher
        classroomId="classroom-1"
        activeTab="daily"
        autoStart={false}
        onNavigate={vi.fn()}
        onAutoStartConsumed={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /reopen the getting-started guide/i }))

    expect(screen.getByTestId('onboarding-chain')).toBeInTheDocument()
    expect(mockClassroomSetupOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ classroomId: 'classroom-1', autoStart: true }),
    )
  })

  it('mounts immediately when autoStart is already true (fresh classroom creation)', () => {
    render(
      <OnboardingLauncher
        classroomId="classroom-1"
        activeTab="settings"
        autoStart
        onNavigate={vi.fn()}
        onAutoStartConsumed={vi.fn()}
      />,
    )

    expect(screen.getByTestId('onboarding-chain')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reopen the getting-started guide/i })).not.toBeInTheDocument()
  })
})
