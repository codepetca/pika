'use client'

import { Lock } from 'lucide-react'

interface PetImagePlaceholderProps {
  index: number
  name: string
  description: string
  unlocked: boolean
  selected: boolean
  unlockLevel: number
  onClick?: () => void
}

/**
 * SVG silhouette placeholders for Pika pet images.
 * Final art will be commissioned separately.
 */
export function PetImagePlaceholder({
  index,
  name,
  description,
  unlocked,
  selected,
  unlockLevel,
  onClick,
}: PetImagePlaceholderProps) {
  return (
    <button
      type="button"
      onClick={unlocked ? onClick : undefined}
      disabled={!unlocked}
      title={unlocked ? `${name} — ${description}` : `Unlocks at Level ${unlockLevel}`}
      className={[
        'relative flex flex-col items-center rounded-lg border-2 p-3 transition-colors',
        selected
          ? 'border-primary bg-info-bg'
          : unlocked
            ? 'border-border bg-surface hover:bg-surface-hover cursor-pointer'
            : 'border-border bg-surface-2 opacity-60 cursor-not-allowed',
      ].join(' ')}
    >
      <div className="w-20 h-20 flex items-center justify-center">
        {unlocked ? (
          <MouseSilhouette pose={index} />
        ) : (
          <div className="relative">
            <MouseSilhouette pose={index} locked />
            <div className="absolute inset-0 flex items-center justify-center">
              <Lock className="h-6 w-6 text-text-muted" />
            </div>
          </div>
        )}
      </div>
      <span className={[
        'mt-2 text-xs font-medium text-center',
        unlocked ? 'text-text-default' : 'text-text-muted',
      ].join(' ')}>
        {unlocked ? name : `Level ${unlockLevel}`}
      </span>
    </button>
  )
}

function MouseSilhouette({ pose, locked }: { pose: number; locked?: boolean }) {
  const fill = locked ? 'var(--color-text-muted)' : 'var(--color-primary)'
  const opacity = locked ? 0.25 : 0.7

  // Different simple mouse silhouettes for each pose
  const poses: Record<number, JSX.Element> = {
    0: ( // Hello! - waving mouse
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="32" cy="40" rx="14" ry="16" fill={fill} opacity={opacity} />
        <circle cx="32" cy="22" r="10" fill={fill} opacity={opacity} />
        <circle cx="24" cy="14" r="6" fill={fill} opacity={opacity} />
        <circle cx="40" cy="14" r="6" fill={fill} opacity={opacity} />
        <line x1="46" y1="28" x2="54" y2="18" stroke={fill} strokeWidth="3" strokeLinecap="round" opacity={opacity} />
      </svg>
    ),
    1: ( // Study Time - sitting mouse
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="32" cy="44" rx="16" ry="12" fill={fill} opacity={opacity} />
        <circle cx="32" cy="26" r="10" fill={fill} opacity={opacity} />
        <circle cx="24" cy="18" r="5" fill={fill} opacity={opacity} />
        <circle cx="40" cy="18" r="5" fill={fill} opacity={opacity} />
        <rect x="20" y="50" width="24" height="4" rx="2" fill={fill} opacity={opacity} />
      </svg>
    ),
    2: ( // Book Lover - curled up
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="32" cy="40" rx="18" ry="14" fill={fill} opacity={opacity} />
        <circle cx="28" cy="26" r="9" fill={fill} opacity={opacity} />
        <circle cx="20" cy="19" r="5" fill={fill} opacity={opacity} />
        <circle cx="34" cy="19" r="5" fill={fill} opacity={opacity} />
        <rect x="40" y="36" width="12" height="8" rx="2" fill={fill} opacity={opacity * 0.6} />
      </svg>
    ),
    3: ( // Coffee Break
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="28" cy="42" rx="14" ry="14" fill={fill} opacity={opacity} />
        <circle cx="28" cy="24" r="10" fill={fill} opacity={opacity} />
        <circle cx="20" cy="16" r="5" fill={fill} opacity={opacity} />
        <circle cx="36" cy="16" r="5" fill={fill} opacity={opacity} />
        <rect x="44" y="34" width="8" height="12" rx="3" fill={fill} opacity={opacity * 0.6} />
      </svg>
    ),
    4: ( // Library Explorer
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="32" cy="46" rx="12" ry="10" fill={fill} opacity={opacity} />
        <circle cx="32" cy="30" r="9" fill={fill} opacity={opacity} />
        <circle cx="25" cy="23" r="5" fill={fill} opacity={opacity} />
        <circle cx="39" cy="23" r="5" fill={fill} opacity={opacity} />
        <rect x="8" y="10" width="4" height="44" rx="1" fill={fill} opacity={opacity * 0.3} />
        <rect x="52" y="10" width="4" height="44" rx="1" fill={fill} opacity={opacity * 0.3} />
      </svg>
    ),
    5: ( // Garden Visit
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="32" cy="44" rx="14" ry="12" fill={fill} opacity={opacity} />
        <circle cx="32" cy="28" r="9" fill={fill} opacity={opacity} />
        <circle cx="25" cy="21" r="5" fill={fill} opacity={opacity} />
        <circle cx="39" cy="21" r="5" fill={fill} opacity={opacity} />
        <circle cx="12" cy="48" r="4" fill={fill} opacity={opacity * 0.4} />
        <circle cx="52" cy="46" r="3" fill={fill} opacity={opacity * 0.4} />
      </svg>
    ),
    6: ( // Met Ollie
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="24" cy="44" rx="12" ry="12" fill={fill} opacity={opacity} />
        <circle cx="24" cy="28" r="8" fill={fill} opacity={opacity} />
        <circle cx="18" cy="22" r="4" fill={fill} opacity={opacity} />
        <circle cx="30" cy="22" r="4" fill={fill} opacity={opacity} />
        <ellipse cx="48" cy="38" rx="8" ry="10" fill={fill} opacity={opacity * 0.5} />
        <circle cx="48" cy="26" r="6" fill={fill} opacity={opacity * 0.5} />
      </svg>
    ),
    7: ( // Stargazer
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="32" cy="46" rx="14" ry="12" fill={fill} opacity={opacity} />
        <circle cx="32" cy="30" r="9" fill={fill} opacity={opacity} />
        <circle cx="25" cy="23" r="5" fill={fill} opacity={opacity} />
        <circle cx="39" cy="23" r="5" fill={fill} opacity={opacity} />
        <circle cx="14" cy="10" r="2" fill={fill} opacity={opacity * 0.4} />
        <circle cx="50" cy="8" r="1.5" fill={fill} opacity={opacity * 0.4} />
        <circle cx="40" cy="6" r="1" fill={fill} opacity={opacity * 0.4} />
      </svg>
    ),
    8: ( // Summit!
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <polygon points="32,14 8,56 56,56" fill={fill} opacity={opacity * 0.3} />
        <ellipse cx="32" cy="26" rx="10" ry="8" fill={fill} opacity={opacity} />
        <circle cx="32" cy="14" r="7" fill={fill} opacity={opacity} />
        <circle cx="26" cy="9" r="4" fill={fill} opacity={opacity} />
        <circle cx="38" cy="9" r="4" fill={fill} opacity={opacity} />
      </svg>
    ),
    9: ( // Met Fern
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="22" cy="44" rx="12" ry="12" fill={fill} opacity={opacity} />
        <circle cx="22" cy="28" r="8" fill={fill} opacity={opacity} />
        <circle cx="16" cy="22" r="4" fill={fill} opacity={opacity} />
        <circle cx="28" cy="22" r="4" fill={fill} opacity={opacity} />
        <ellipse cx="48" cy="44" rx="8" ry="8" fill={fill} opacity={opacity * 0.5} />
        <circle cx="48" cy="34" r="5" fill={fill} opacity={opacity * 0.5} />
      </svg>
    ),
    10: ( // Graduate
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true">
        <ellipse cx="32" cy="44" rx="14" ry="14" fill={fill} opacity={opacity} />
        <circle cx="32" cy="26" r="10" fill={fill} opacity={opacity} />
        <circle cx="24" cy="18" r="5" fill={fill} opacity={opacity} />
        <circle cx="40" cy="18" r="5" fill={fill} opacity={opacity} />
        <rect x="22" y="14" width="20" height="4" rx="1" fill={fill} opacity={opacity} />
        <rect x="28" y="10" width="8" height="4" rx="1" fill={fill} opacity={opacity} />
      </svg>
    ),
  }

  return poses[pose] || poses[0]
}
