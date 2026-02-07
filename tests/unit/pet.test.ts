import { describe, expect, it } from 'vitest'
import {
  calculateLevel,
  calculateLevelProgress,
  calculateLevelProgressPercent,
  getUnlockedImageIndices,
  detectNewUnlocks,
  getNextUnlockLevel,
  isValidXpSource,
  enrichPetState,
} from '@/lib/pet'
import { createMockUserPet, createMockPetUnlock } from '../helpers/mocks'

describe('calculateLevel', () => {
  it('returns 0 for 0 XP', () => {
    expect(calculateLevel(0)).toBe(0)
  })

  it('returns 0 for 99 XP', () => {
    expect(calculateLevel(99)).toBe(0)
  })

  it('returns 1 for 100 XP', () => {
    expect(calculateLevel(100)).toBe(1)
  })

  it('returns 2 for 250 XP', () => {
    expect(calculateLevel(250)).toBe(2)
  })

  it('returns 20 for 2000 XP', () => {
    expect(calculateLevel(2000)).toBe(20)
  })
})

describe('calculateLevelProgress', () => {
  it('returns 0 for 0 XP', () => {
    expect(calculateLevelProgress(0)).toBe(0)
  })

  it('returns 50 for 50 XP', () => {
    expect(calculateLevelProgress(50)).toBe(50)
  })

  it('returns 50 for 150 XP', () => {
    expect(calculateLevelProgress(150)).toBe(50)
  })

  it('returns 0 for 200 XP (exact level boundary)', () => {
    expect(calculateLevelProgress(200)).toBe(0)
  })
})

describe('calculateLevelProgressPercent', () => {
  it('returns 0 for 0 XP', () => {
    expect(calculateLevelProgressPercent(0)).toBe(0)
  })

  it('returns 50 for 50 XP', () => {
    expect(calculateLevelProgressPercent(50)).toBe(50)
  })

  it('returns 75 for 175 XP', () => {
    expect(calculateLevelProgressPercent(175)).toBe(75)
  })

  it('returns 0 for exact level boundary', () => {
    expect(calculateLevelProgressPercent(300)).toBe(0)
  })
})

describe('getUnlockedImageIndices', () => {
  it('returns [0] for level 0', () => {
    expect(getUnlockedImageIndices(0)).toEqual([0])
  })

  it('returns [0] for level 1 (no new unlock at level 1)', () => {
    expect(getUnlockedImageIndices(1)).toEqual([0])
  })

  it('returns [0, 1] for level 2', () => {
    expect(getUnlockedImageIndices(2)).toEqual([0, 1])
  })

  it('returns all 11 indices for level 20', () => {
    expect(getUnlockedImageIndices(20)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('detectNewUnlocks', () => {
  it('returns new indices not in existing unlocks', () => {
    const existingIndices = [0]
    const newLevel = 2 // unlocks index 1
    expect(detectNewUnlocks(existingIndices, newLevel)).toEqual([1])
  })

  it('returns empty array when all already unlocked', () => {
    const existingIndices = [0, 1]
    const newLevel = 2
    expect(detectNewUnlocks(existingIndices, newLevel)).toEqual([])
  })

  it('returns multiple new unlocks when skipping levels', () => {
    const existingIndices = [0]
    const newLevel = 6 // unlocks 0,1,2,3 → new ones: 1,2,3
    expect(detectNewUnlocks(existingIndices, newLevel)).toEqual([1, 2, 3])
  })
})

describe('getNextUnlockLevel', () => {
  it('returns 2 for level 0', () => {
    expect(getNextUnlockLevel(0)).toBe(2)
  })

  it('returns 4 for level 2', () => {
    expect(getNextUnlockLevel(2)).toBe(4)
  })

  it('returns 4 for level 3 (between unlock levels)', () => {
    expect(getNextUnlockLevel(3)).toBe(4)
  })

  it('returns null for level 20 (all unlocked)', () => {
    expect(getNextUnlockLevel(20)).toBeNull()
  })

  it('returns null for level above 20', () => {
    expect(getNextUnlockLevel(25)).toBeNull()
  })
})

describe('isValidXpSource', () => {
  it('returns true for daily_login', () => {
    expect(isValidXpSource('daily_login')).toBe(true)
  })

  it('returns true for assignment_complete', () => {
    expect(isValidXpSource('assignment_complete')).toBe(true)
  })

  it('returns true for weekly_goal', () => {
    expect(isValidXpSource('weekly_goal')).toBe(true)
  })

  it('returns false for invalid source', () => {
    expect(isValidXpSource('invalid_source')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValidXpSource('')).toBe(false)
  })
})

describe('enrichPetState', () => {
  it('computes PetState from UserPet and unlocks', () => {
    const pet = createMockUserPet({ xp: 250 })
    const unlocks = [
      createMockPetUnlock({ image_index: 0 }),
      createMockPetUnlock({ id: 'unlock-2', image_index: 1 }),
    ]

    const state = enrichPetState(pet, unlocks)

    expect(state.level).toBe(2)
    expect(state.levelProgress).toBe(50)
    expect(state.levelProgressPercent).toBe(50)
    expect(state.nextUnlockLevel).toBe(4)
    expect(state.unlocks).toBe(unlocks)
    expect(state.xp).toBe(250)
  })

  it('handles zero XP pet', () => {
    const pet = createMockUserPet({ xp: 0 })
    const unlocks = [createMockPetUnlock({ image_index: 0 })]

    const state = enrichPetState(pet, unlocks)

    expect(state.level).toBe(0)
    expect(state.levelProgress).toBe(0)
    expect(state.levelProgressPercent).toBe(0)
    expect(state.nextUnlockLevel).toBe(2)
  })

  it('handles max level pet', () => {
    const pet = createMockUserPet({ xp: 2000 })
    const unlocks = Array.from({ length: 11 }, (_, i) =>
      createMockPetUnlock({ id: `unlock-${i}`, image_index: i })
    )

    const state = enrichPetState(pet, unlocks)

    expect(state.level).toBe(20)
    expect(state.nextUnlockLevel).toBeNull()
  })
})
