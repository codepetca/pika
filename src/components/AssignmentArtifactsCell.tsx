'use client'

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type HTMLAttributes } from 'react'
import { ExternalLink, FolderGit2, Image as ImageIcon, Link2 } from 'lucide-react'
import {
  summarizeArtifactUrl,
  type AssignmentArtifact,
} from '@/lib/assignment-artifacts'
import { ContentDialog, Tooltip } from '@/ui'

interface AssignmentArtifactsCellProps {
  artifacts: AssignmentArtifact[]
  isCompact: boolean
}

// These private native adapters receive Radix's public asChild handlers. Let
// keyboard focus reveal the table cell before invoking its focus handler; Root
// has not opened yet, so cancelling this frame leaves no provider-close debt.
function useArtifactFocus<T extends HTMLElement>(props: HTMLAttributes<T>) {
  const focusHandler = useRef(props.onFocus)
  // Hover can open Radix while a focus frame is pending. Its current controlled
  // handler must decide whether opening is still needed, not the old closure.
  useLayoutEffect(() => { focusHandler.current = props.onFocus })
  const cleanupFocus = useRef<(() => void) | null>(null)
  const cleanupPointer = useRef<(() => void) | null>(null)
  const pointerDown = useRef(false)
  const cancelFocus = useCallback(() => {
    cleanupFocus.current?.()
    cleanupFocus.current = null
  }, [])
  const resetPointer = useCallback(() => {
    cleanupPointer.current?.()
    cleanupPointer.current = null
    pointerDown.current = false
  }, [])

  useEffect(() => () => { cancelFocus(); resetPointer() }, [cancelFocus, resetPointer])

  return {
    onFocus: (event: React.FocusEvent<T>) => {
      cancelFocus()
      if (document.visibilityState === 'hidden') return
      if (pointerDown.current || event.defaultPrevented) {
        props.onFocus?.(event)
        return
      }
      // React clears currentTarget after dispatch; retain the element separately.
      const target = event.currentTarget
      const hide = () => { if (document.visibilityState === 'hidden') cancelFocus() }
      const intentEvents = ['keydown', 'pointerdown', 'wheel', 'touchmove'] as const
      const frame = requestAnimationFrame(() => {
        cancelFocus()
        if (target.isConnected && document.activeElement === target &&
            document.visibilityState !== 'hidden' && !target.closest('[inert]') &&
            !target.matches(':disabled, [aria-disabled="true"]')) focusHandler.current?.(event)
      })
      for (const type of intentEvents) document.addEventListener(type, cancelFocus, true)
      document.addEventListener('visibilitychange', hide)
      window.addEventListener('blur', cancelFocus)
      cleanupFocus.current = () => {
        cancelAnimationFrame(frame)
        for (const type of intentEvents) document.removeEventListener(type, cancelFocus, true)
        document.removeEventListener('visibilitychange', hide)
        window.removeEventListener('blur', cancelFocus)
      }
    },
    onBlur: (event: React.FocusEvent<T>) => {
      cancelFocus()
      resetPointer()
      props.onBlur?.(event)
    },
    onPointerDown: (event: React.PointerEvent<T>) => {
      cancelFocus()
      resetPointer()
      pointerDown.current = true
      document.addEventListener('pointerup', resetPointer, { once: true })
      document.addEventListener('pointercancel', resetPointer, { once: true })
      cleanupPointer.current = () => {
        document.removeEventListener('pointerup', resetPointer)
        document.removeEventListener('pointercancel', resetPointer)
      }
      props.onPointerDown?.(event)
    },
    onClick: (event: React.MouseEvent<T>) => {
      cancelFocus()
      resetPointer()
      props.onClick?.(event)
    },
  }
}

const ArtifactButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(function ArtifactButton(props, ref) {
  const focusHandlers = useArtifactFocus<HTMLButtonElement>(props)
  return <button {...props} {...focusHandlers} ref={ref} />
})

const ArtifactLink = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<'a'>>(function ArtifactLink(props, ref) {
  const focusHandlers = useArtifactFocus<HTMLAnchorElement>(props)
  return <a {...props} {...focusHandlers} ref={ref} />
})

function getArtifactLabel(artifact: AssignmentArtifact): string {
  const prefix = artifact.title?.trim() || (artifact.type === 'image' ? 'Image' : artifact.type === 'repo' ? 'Repo' : 'Link')
  return `${prefix} . ${summarizeArtifactUrl(artifact.url)}`
}

function getArtifactSummary(artifact: AssignmentArtifact): string {
  return summarizeArtifactUrl(artifact.url)
}

function getArtifactTypeLabel(artifact: AssignmentArtifact): string {
  if (artifact.title?.trim()) return artifact.title.trim()
  if (artifact.type === 'image') return 'Image'
  if (artifact.type === 'repo') return 'Repo'
  return 'Link'
}

function getArtifactKindLabel(artifact: AssignmentArtifact): string {
  if (artifact.type === 'image') return 'Image'
  if (artifact.type === 'repo') return 'Repo'
  return 'Link'
}

function isRequiredSubmissionArtifact(artifact: AssignmentArtifact): boolean {
  return artifact.is_required_submission === true
}

function getSubmissionArtifactStatusLabel(artifact: AssignmentArtifact): string | null {
  if (isRequiredSubmissionArtifact(artifact)) return 'Required submission'
  if (artifact.requirement_id) return 'Optional submission'
  return null
}

function getArtifactValidationLabel(artifact: AssignmentArtifact): string {
  if (artifact.validation_status === 'valid') {
    return artifact.validation_level === 'verified' ? 'Verified' : 'Saved'
  }
  if (artifact.validation_status === 'warning' || artifact.validation_status === 'inaccessible') return 'Needs review'
  if (artifact.validation_status === 'invalid') return 'Fix needed'
  if (artifact.validation_status === 'pending') return 'Checking'
  return 'Added'
}

function getArtifactIconClassName(artifact: AssignmentArtifact) {
  return [
    'h-3.5 w-3.5 shrink-0',
    isRequiredSubmissionArtifact(artifact) ? 'text-primary' : 'text-text-muted',
  ].join(' ')
}

function ArtifactTypeIcon({ artifact }: { artifact: AssignmentArtifact }) {
  const className = getArtifactIconClassName(artifact)

  if (artifact.type === 'image') {
    return <ImageIcon className={className} aria-hidden="true" />
  }
  if (artifact.type === 'repo') {
    return <FolderGit2 className={className} aria-hidden="true" />
  }
  return <Link2 className={className} aria-hidden="true" />
}

function ArtifactsTooltipList({
  artifacts,
  activeIndex,
}: {
  artifacts: AssignmentArtifact[]
  activeIndex: number
}) {
  const handleArtifactClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
  }

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)]">
      <div className="mb-1 text-[11px] font-semibold text-text-muted">
        {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}
      </div>
      <div className="space-y-1">
        {artifacts.map((artifact, index) => {
          const statusLabel = getSubmissionArtifactStatusLabel(artifact)
          const isRequiredSubmission = isRequiredSubmissionArtifact(artifact)
          const borderClass = isRequiredSubmission
            ? 'border-primary/50'
            : index === activeIndex
              ? 'border-primary/40'
              : 'border-border'
          const surfaceClass = index === activeIndex ? 'bg-surface-selected' : 'bg-surface-2'

          return (
            <a
              key={`${artifact.url}:${index}`}
              href={artifact.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleArtifactClick}
              aria-label={`Open ${statusLabel ? `${statusLabel.toLowerCase()} ` : ''}artifact ${index + 1}: ${getArtifactTypeLabel(artifact)} . ${getArtifactSummary(artifact)}`}
              className={[
                'flex min-h-control min-w-control items-start gap-2 rounded-md border px-2 py-1.5',
                borderClass,
                surfaceClass,
                'hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface',
              ].join(' ')}
            >
              <span className="mt-0.5 inline-flex h-5 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full border border-border bg-surface text-[11px] font-medium text-text-default">
                <ArtifactTypeIcon artifact={artifact} />
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-text-default">
                  {getArtifactTypeLabel(artifact)} . {getArtifactSummary(artifact)}
                </span>
                <span className="block truncate text-[11px] text-text-muted">
                  {statusLabel ?? getArtifactKindLabel(artifact)} . {getArtifactValidationLabel(artifact)}
                </span>
                {artifact.validation_message ? (
                  <span className="block truncate text-[11px] text-warning">
                    {artifact.validation_message}
                  </span>
                ) : null}
                <span className="block truncate text-[11px] text-text-muted">
                  {artifact.url}
                </span>
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

export function AssignmentArtifactsCell({
  artifacts,
}: AssignmentArtifactsCellProps) {
  const [isChooserOpen, setIsChooserOpen] = useState(false)

  const hasMultipleArtifacts = artifacts.length > 1

  const handleOpenChooser = (event: React.MouseEvent) => {
    event.stopPropagation()
    setIsChooserOpen(true)
  }

  const handleOpenSingle = (event: React.MouseEvent) => {
    event.stopPropagation()
  }

  if (artifacts.length === 0) {
    return <span className="text-text-muted">-</span>
  }

  return (
    <>
      <div className="flex w-full max-w-full flex-wrap gap-1">
        {artifacts.map((artifact, index) => (
          <Tooltip
            key={`${artifact.url}:${index}`}
            content={<ArtifactsTooltipList artifacts={artifacts} activeIndex={index} />}
            interactive
            side="bottom"
            align="start"
          >
            {(() => {
              const isRequiredSubmission = isRequiredSubmissionArtifact(artifact)
              const requiredLabel = isRequiredSubmission ? 'required submission ' : ''
              const pillClassName = [
                'inline-flex h-6 min-w-9 items-center justify-center gap-1 rounded-full border px-1.5 text-xs font-medium',
                isRequiredSubmission
                  ? 'border-transparent bg-info-bg-hover text-primary hover:bg-info-bg-hover'
                  : 'border-border bg-surface-2 text-text-default hover:bg-surface-hover',
              ].join(' ')

              return hasMultipleArtifacts ? (
                <ArtifactButton
                  type="button"
                  onClick={handleOpenChooser}
                  className="inline-flex min-h-control min-w-control shrink-0 items-center justify-center rounded-control focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface"
                  aria-label={`View work items; ${requiredLabel}artifact ${index + 1} is ${getArtifactLabel(artifact)}`}
                >
                  <span className={pillClassName}><ArtifactTypeIcon artifact={artifact} /><span>{index + 1}</span></span>
                </ArtifactButton>
              ) : (
                <ArtifactLink
                  href={artifact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleOpenSingle}
                  className="inline-flex min-h-control min-w-control shrink-0 items-center justify-center rounded-control focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface"
                  aria-label={`Open ${requiredLabel}artifact ${index + 1}: ${getArtifactLabel(artifact)}`}
                >
                  <span className={pillClassName}><ArtifactTypeIcon artifact={artifact} /><span>{index + 1}</span></span>
                </ArtifactLink>
              )
            })()}
          </Tooltip>
        ))}
      </div>

      <ContentDialog
        isOpen={isChooserOpen}
        onClose={() => setIsChooserOpen(false)}
        title="Open artifact"
        subtitle={`${artifacts.length} work items`}
        maxWidth="max-w-md"
        showFooterClose={false}
      >
        <div className="space-y-2">
          {artifacts.map((artifact, index) => {
            const statusLabel = getSubmissionArtifactStatusLabel(artifact)
            const isRequiredSubmission = isRequiredSubmissionArtifact(artifact)

            return (
              <a
                key={`${artifact.url}:${index}`}
                href={artifact.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsChooserOpen(false)}
                className="flex min-h-control min-w-control items-center gap-3 rounded-md border border-border bg-surface p-2.5 text-left hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface"
              >
                <span className={[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
                  isRequiredSubmission
                    ? 'border-primary/50 bg-info-bg'
                    : 'border-border bg-surface-2',
                ].join(' ')}>
                  <ArtifactTypeIcon artifact={artifact} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-default">
                    {getArtifactTypeLabel(artifact)} . {getArtifactSummary(artifact)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-text-muted">
                    {statusLabel ?? getArtifactKindLabel(artifact)} . {getArtifactValidationLabel(artifact)}
                  </span>
                  {artifact.validation_message ? (
                    <span className="mt-0.5 block truncate text-xs text-warning">
                      {artifact.validation_message}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block truncate text-xs text-text-muted">{artifact.url}</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
              </a>
            )
          })}
        </div>
      </ContentDialog>
    </>
  )
}
