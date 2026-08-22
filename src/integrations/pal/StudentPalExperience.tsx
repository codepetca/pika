'use client'

import {
  PalCompanion,
  PalProvider,
  PalRewardCelebration,
  usePalWidget,
} from '@codepet/pal-widget'
import { useSearchParams } from 'next/navigation'
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { useTheme } from '@/contexts/ThemeContext'
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint'
import { PIKA_LOCATION_CHANGE_EVENT } from '@/lib/browser-navigation'
import { PIKA_PAL_REFRESH_EVENT } from '@/lib/pal-browser-events'
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
  const searchParams = useSearchParams()
  const narrowViewport = useIsBreakpoint('max', 768)
  const { dismissReward, isRewardPending, snapshot } = usePalWidget()
  const [ambientSurfacesEnabled, setAmbientSurfacesEnabled] = useState(
    () => searchParams.get('tab') !== 'tests',
  )
  const reward = snapshot?.rewards[0]
  const rewardPending = reward ? isRewardPending(reward.id) : false

  useEffect(() => {
    const syncFromLocation = () => {
      setAmbientSurfacesEnabled(
        new URLSearchParams(window.location.search).get('tab') !== 'tests',
      )
    }

    syncFromLocation()
    window.addEventListener('popstate', syncFromLocation)
    window.addEventListener(PIKA_LOCATION_CHANGE_EVENT, syncFromLocation)
    return () => {
      window.removeEventListener('popstate', syncFromLocation)
      window.removeEventListener(PIKA_LOCATION_CHANGE_EVENT, syncFromLocation)
    }
  }, [searchParams])

  const closeReward = useCallback(() => {
    if (!reward || rewardPending) return
    void dismissReward(reward.id)
  }, [dismissReward, reward, rewardPending])

  if (!ambientSurfacesEnabled) return null

  return (
    <>
      <PalWidgetThemeBoundary
        className="pointer-events-none fixed bottom-4 right-4 z-floating"
      >
        <PalCompanion scale={narrowViewport ? 0.4 : 0.55} />
      </PalWidgetThemeBoundary>

      <ModalLayer
        isOpen={Boolean(reward)}
        onClose={closeReward}
        ariaLabel="Reward earned"
        closeOnEscape={!rewardPending}
        closeOnBackdrop={!rewardPending}
        panelClassName="flex w-full max-w-lg justify-center"
      >
        <PalWidgetThemeBoundary>
          <PalRewardCelebration
            effect="fireworks"
            hostManaged
            showDismissAction={false}
          />
        </PalWidgetThemeBoundary>
      </ModalLayer>
    </>
  )
}

function StudentPalRefreshListener() {
  const { refresh } = usePalWidget()

  useEffect(() => {
    const refreshAfterDelivery = () => {
      void refresh()
    }
    window.addEventListener(PIKA_PAL_REFRESH_EVENT, refreshAfterDelivery)
    return () => {
      window.removeEventListener(PIKA_PAL_REFRESH_EVENT, refreshAfterDelivery)
    }
  }, [refresh])

  return null
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
  const client = useMemo(
    () => {
      // A scope transition must also discard the previous learner's token cache.
      void scopeKey
      return createPikaPalClient(apiBaseUrl)
    },
    [apiBaseUrl, scopeKey],
  )

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
      <StudentPalRefreshListener />
      {children}
      {showAmbientSurfaces ? (
        <PalFailureBoundary fallback={null} resetKey={`${scopeKey}:ambient`}>
          <StudentPalHostLayers />
        </PalFailureBoundary>
      ) : null}
    </PalProvider>
  )
}
