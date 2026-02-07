import { XP_PER_LEVEL, XP_SOURCES, PET_IMAGES } from './pet-config'
import type { XpSourceKey } from './pet-config'
import type { UserPet, PetUnlock, PetState } from '@/types'

export function calculateLevel(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL)
}

export function calculateLevelProgress(xp: number): number {
  return xp % XP_PER_LEVEL
}

export function calculateLevelProgressPercent(xp: number): number {
  return Math.round((calculateLevelProgress(xp) / XP_PER_LEVEL) * 100)
}

export function getUnlockedImageIndices(level: number): number[] {
  return PET_IMAGES.filter((img) => img.unlockLevel <= level).map((img) => img.index)
}

export function detectNewUnlocks(existingIndices: number[], newLevel: number): number[] {
  const allUnlockable = getUnlockedImageIndices(newLevel)
  const existingSet = new Set(existingIndices)
  return allUnlockable.filter((idx) => !existingSet.has(idx))
}

export function getNextUnlockLevel(currentLevel: number): number | null {
  const next = PET_IMAGES.find((img) => img.unlockLevel > currentLevel)
  return next ? next.unlockLevel : null
}

export function isValidXpSource(source: string): source is XpSourceKey {
  return source in XP_SOURCES
}

export function enrichPetState(pet: UserPet, unlocks: PetUnlock[]): PetState {
  const level = calculateLevel(pet.xp)
  return {
    ...pet,
    level,
    levelProgress: calculateLevelProgress(pet.xp),
    levelProgressPercent: calculateLevelProgressPercent(pet.xp),
    nextUnlockLevel: getNextUnlockLevel(level),
    unlocks,
  }
}
