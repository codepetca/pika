'use client'

import {
  PalCompanion,
  PalProvider,
  PalRewardCelebration,
  usePalWidget,
} from '@codepet/pal-widget'
import { Component, useCallback, useMemo, type ReactNode } from 'react'

import { useTheme } from '@/contexts/ThemeContext'
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint'
import { ModalLayer } from '@/ui'

import { createPikaPalClient } from './pal-client'
import { PalWidgetThemeBoundary } from './PalWidgetThemeBoundary'

const PAL_REFRESH_INTERVAL_MS = 60_000

interface PalFailureBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  resetKey: string
}

interface PalFailureBoundaryState {
  failed: boolean
}

/** Keep an optional Pal failure from taking down the academic classroom shell. */
export class PalFailureBoundary extends Component<
  PalFailureBoundaryProps,
  PalFailureBoundaryState
> {
  state: PalFailureBoundaryState = { failed: false }

  static getDerivedStateFromError(): PalFailureBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previousProps: PalFailureBoundaryProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function StudentPalHostLayers() {
  const { dismissReward, isRewardPending, snapshot } = usePalWidget()
  const reward = snapshot?.rewards[0]
  const rewardPending = reward ? isRewardPending(reward.id) : false

  const closeReward = useCallback(() => {
    if (!reward || rewardPending) return
    void dismissReward(reward.id)
  }, [dismissReward, reward, rewardPending])

  return (
    <>
      <PalWidgetThemeBoundary
        className="pointer-events-none fixed bottom-4 right-4 z-floating"
      >
        <PalCompanion variant="compact" />
      </PalWidgetThemeBoundary>

      <ModalLayer
        isOpen={Boolean(reward)}
        onClose={closeReward}
        ariaLabel="Reward earned"
        closeOnEscape={!rewardPending}
        closeOnBackdrop={false}
        panelClassName="w-full max-w-lg"
      >
        <PalWidgetThemeBoundary>
          <PalRewardCelebration hostManaged />
        </PalWidgetThemeBoundary>
      </ModalLayer>
    </>
  )
}

export function StudentPalExperience({
  apiBaseUrl,
  children,
  scopeKey,
  showAmbientSurfaces = true,
}: {
  apiBaseUrl: string
  children: ReactNode
  scopeKey: string
  showAmbientSurfaces?: boolean
}) {
  const { theme } = useTheme()
  const narrowViewport = useIsBreakpoint('max', 768)
  const client = useMemo(() => createPikaPalClient(apiBaseUrl), [apiBaseUrl])

  return (
    <PalProvider
      client={client}
      scopeKey={scopeKey}
      theme={theme}
      density={narrowViewport ? 'compact' : 'comfortable'}
      viewport={narrowViewport ? 'narrow' : 'wide'}
      motion="system"
      refreshIntervalMs={PAL_REFRESH_INTERVAL_MS}
    >
      {children}
      {showAmbientSurfaces ? <StudentPalHostLayers /> : null}
    </PalProvider>
  )
}
