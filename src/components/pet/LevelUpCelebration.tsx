'use client'

import { useEffect } from 'react'
import { PET_IMAGES } from '@/lib/pet-config'
import { getTitleForLevel } from '@/lib/pet'

interface Props {
  isOpen: boolean
  newLevel: number
  onClose: () => void
}

const CONFETTI_COLORS = [
  '#f43f5e', // rose
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
]

const PARTICLE_COUNT = 30

export function LevelUpCelebration({ isOpen, newLevel, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const unlockedImage = PET_IMAGES.find((img) => img.unlockLevel === newLevel)
  const title = getTitleForLevel(newLevel)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Confetti particles */}
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
        const left = Math.random() * 100
        const size = 6 + Math.random() * 8
        const delay = Math.random() * 2
        const duration = 2.5 + Math.random() * 1.5

        return (
          <div
            key={i}
            className="absolute pointer-events-none"
            style={{
              left: `${left}%`,
              top: 0,
              width: `${size}px`,
              height: `${size * 0.6}px`,
              backgroundColor: color,
              borderRadius: '2px',
              animation: `confetti-fall ${duration}s ease-in ${delay}s both`,
            }}
          />
        )
      })}

      {/* Center card */}
      <div
        className="relative z-10 bg-surface rounded-2xl shadow-xl p-8 text-center max-w-xs mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl font-bold text-primary mb-2">
          Level {newLevel}!
        </div>
        <p className="text-sm font-medium text-text-default mb-3">
          New title: {title}
        </p>
        {unlockedImage && (
          <p className="text-sm text-text-muted mb-3">
            New image: {unlockedImage.name}
          </p>
        )}
        <p className="text-sm text-text-default">
          Amazing work — keep it up!
        </p>
      </div>
    </div>
  )
}
