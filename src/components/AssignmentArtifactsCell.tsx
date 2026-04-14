'use client'

import { useMemo, useState } from 'react'
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

function getArtifactLabel(artifact: AssignmentArtifact): string {
  const prefix = artifact.type === 'image' ? 'Image' : artifact.type === 'repo' ? 'Repo' : 'Link'
  return `${prefix} . ${summarizeArtifactUrl(artifact.url)}`
}

function getArtifactSummary(artifact: AssignmentArtifact): string {
  return summarizeArtifactUrl(artifact.url)
}

function ArtifactTypeIcon({ artifact }: { artifact: AssignmentArtifact }) {
  if (artifact.type === 'image') {
    return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
  }
  if (artifact.type === 'repo') {
    return <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
  }
  return <Link2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
}

function getBackgroundImageStyle(url: string): { backgroundImage: string } {
  return { backgroundImage: `url("${encodeURI(url)}")` }
}

function ArtifactTooltipContent({ artifact }: { artifact: AssignmentArtifact }) {
  const label = getArtifactLabel(artifact)

  if (artifact.type === 'image') {
    return (
      <div className="w-44">
        <div className="mb-1 rounded border border-border bg-surface p-1">
          <div
            className="h-24 w-full rounded bg-surface-2 bg-contain bg-center bg-no-repeat"
            style={getBackgroundImageStyle(artifact.url)}
          />
        </div>
        <div className="truncate text-[11px] text-text-default">{label}</div>
      </div>
    )
  }

  return (
    <div className="max-w-56">
      <div className="truncate text-[11px] font-medium text-text-default">{label}</div>
      <div className="truncate text-[11px] text-text-muted">{artifact.url}</div>
    </div>
  )
}

export function AssignmentArtifactsCell({
  artifacts,
  isCompact,
}: AssignmentArtifactsCellProps) {
  const [modalIndex, setModalIndex] = useState<number | null>(null)
  const selectedArtifact = modalIndex !== null ? artifacts[modalIndex] : null

  const visibleArtifacts = useMemo(() => (isCompact ? [] : artifacts), [artifacts, isCompact])
  const compactArtifact = artifacts[0] ?? null
  const compactRemainingCount = Math.max(artifacts.length - 1, 0)

  if (artifacts.length === 0) {
    return <span className="text-text-muted">-</span>
  }

  return (
    <>
      {isCompact ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setModalIndex(0)
          }}
          className="inline-flex w-full max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-default hover:bg-surface-hover"
          aria-label={`View ${artifacts.length} work item${artifacts.length === 1 ? '' : 's'}`}
        >
          {compactArtifact && (
            <>
              <ArtifactTypeIcon artifact={compactArtifact} />
              <span className="min-w-0 flex-1 truncate text-left">
                {getArtifactSummary(compactArtifact)}
              </span>
            </>
          )}
          {compactRemainingCount > 0 && (
            <span className="shrink-0 text-text-muted">+{compactRemainingCount}</span>
          )}
        </button>
      ) : (
        <div className="flex w-full max-w-[32rem] flex-wrap gap-1">
          {visibleArtifacts.map((artifact, index) => (
            <Tooltip key={`${artifact.url}:${index}`} content={<ArtifactTooltipContent artifact={artifact} />} side="top" align="start">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setModalIndex(index)
                }}
                className="inline-flex w-full max-w-[10rem] items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-default hover:bg-surface-hover"
                aria-label={`Preview ${getArtifactLabel(artifact)}`}
              >
                <ArtifactTypeIcon artifact={artifact} />
                <span className="ml-1 truncate">{getArtifactSummary(artifact)}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      )}

      <ContentDialog
        isOpen={selectedArtifact !== null}
        onClose={() => setModalIndex(null)}
        title={
          selectedArtifact?.type === 'image'
            ? 'Image Preview'
            : selectedArtifact?.type === 'repo'
              ? 'Repo Preview'
              : 'Link Preview'
        }
        subtitle={
          modalIndex !== null
            ? `${modalIndex + 1} of ${artifacts.length}`
            : undefined
        }
        maxWidth="max-w-3xl"
      >
        {selectedArtifact && (
          <div className="space-y-3">
            {artifacts.length > 1 && modalIndex !== null && (
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalIndex((current) => (current !== null && current > 0 ? current - 1 : current))}
                  disabled={modalIndex === 0}
                  className="rounded border border-border px-2 py-1 text-xs text-text-default disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setModalIndex((current) =>
                      current !== null && current < artifacts.length - 1 ? current + 1 : current
                    )
                  }
                  disabled={modalIndex >= artifacts.length - 1}
                  className="rounded border border-border px-2 py-1 text-xs text-text-default disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}

            {selectedArtifact.type === 'image' ? (
              <div className="rounded border border-border bg-surface p-2">
                <div
                  className="h-[60vh] w-full rounded bg-surface-2 bg-contain bg-center bg-no-repeat"
                  style={getBackgroundImageStyle(selectedArtifact.url)}
                />
              </div>
            ) : (
              <div className="rounded border border-border bg-surface p-3">
                <p className="text-sm text-text-default break-all">{selectedArtifact.url}</p>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-text-muted truncate">
                {getArtifactLabel(selectedArtifact)}
              </p>
              <a
                href={selectedArtifact.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-default hover:bg-surface-hover"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open
              </a>
            </div>
          </div>
        )}
      </ContentDialog>
    </>
  )
}
