import { useCallback, useState } from 'react'

interface CelebrationState {
  isOpen: boolean
  newLevel: number
}

export function usePetLevelUp(classroomId: string) {
  const [celebrationState, setCelebrationState] = useState<CelebrationState | null>(null)

  const storageKey = `pika_pet_level:${classroomId}`

  const checkLevel = useCallback(
    (currentLevel: number) => {
      const stored = sessionStorage.getItem(storageKey)

      if (stored === null) {
        // First visit this session — store level, no celebration
        sessionStorage.setItem(storageKey, String(currentLevel))
        return
      }

      const storedLevel = parseInt(stored, 10)

      if (currentLevel > storedLevel) {
        sessionStorage.setItem(storageKey, String(currentLevel))
        setCelebrationState({ isOpen: true, newLevel: currentLevel })
      }
    },
    [storageKey]
  )

  const dismissCelebration = useCallback(() => {
    setCelebrationState(null)
  }, [])

  return { checkLevel, celebrationState, dismissCelebration }
}
