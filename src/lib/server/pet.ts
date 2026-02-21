import { getServiceRoleClient } from '@/lib/supabase'
import { ACHIEVEMENTS } from '@/lib/pet-config'
import type { AchievementId } from '@/lib/pet-config'
import { isValidAchievement, calculateLevel, detectNewUnlocks, enrichPetState } from '@/lib/pet'
import { getTodayInToronto } from '@/lib/timezone'
import type { UserPet, PetUnlock, PetState, AchievementGrant } from '@/types'

type PetResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

export async function getOrCreatePet(
  userId: string,
  classroomId: string
): Promise<PetResult<UserPet>> {
  const supabase = getServiceRoleClient()

  // Try to fetch existing pet
  const { data: existing, error: fetchError } = await supabase
    .from('user_pets')
    .select('*')
    .eq('user_id', userId)
    .eq('classroom_id', classroomId)
    .single()

  if (existing) {
    return { ok: true, data: existing as UserPet }
  }

  // Not found — create new pet + initial unlock (image 0)
  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Error fetching user pet:', fetchError)
    return { ok: false, status: 500, error: 'Failed to fetch pet' }
  }

  const { data: newPet, error: insertError } = await supabase
    .from('user_pets')
    .insert({ user_id: userId, classroom_id: classroomId })
    .select()
    .single()

  if (insertError || !newPet) {
    // Handle race condition: another request may have created it
    if (insertError?.code === '23505') {
      const { data: raced } = await supabase
        .from('user_pets')
        .select('*')
        .eq('user_id', userId)
        .eq('classroom_id', classroomId)
        .single()
      if (raced) return { ok: true, data: raced as UserPet }
    }
    console.error('Error creating user pet:', insertError)
    return { ok: false, status: 500, error: 'Failed to create pet' }
  }

  // Insert initial unlock for image 0
  await supabase
    .from('pet_unlocks')
    .insert({ pet_id: newPet.id, image_index: 0 })

  return { ok: true, data: newPet as UserPet }
}

export async function getPetWithUnlocks(
  userId: string,
  classroomId: string
): Promise<PetResult<PetState>> {
  const petResult = await getOrCreatePet(userId, classroomId)
  if (!petResult.ok) return petResult

  const pet = petResult.data
  const supabase = getServiceRoleClient()

  const { data: unlocks, error } = await supabase
    .from('pet_unlocks')
    .select('*')
    .eq('pet_id', pet.id)
    .order('image_index', { ascending: true })

  if (error) {
    console.error('Error fetching pet unlocks:', error)
    return { ok: false, status: 500, error: 'Failed to fetch pet unlocks' }
  }

  return { ok: true, data: enrichPetState(pet, (unlocks || []) as PetUnlock[]) }
}

interface AchievementItem {
  achievementId: AchievementId
  rewardKey: string
  metadata?: Record<string, any>
}

interface AchievementsResult {
  achievements: AchievementGrant[]
  totalXpAwarded: number
  newLevel: number
  newUnlocks: number[]
}

export async function grantAchievements(
  userId: string,
  classroomId: string,
  items: AchievementItem[]
): Promise<PetResult<AchievementsResult>> {
  if (items.length === 0) {
    return { ok: true, data: { achievements: [], totalXpAwarded: 0, newLevel: 0, newUnlocks: [] } }
  }

  // Validate all achievement IDs
  for (const item of items) {
    if (!isValidAchievement(item.achievementId)) {
      return { ok: false, status: 400, error: `Invalid achievement: ${item.achievementId}` }
    }
  }

  const petResult = await getOrCreatePet(userId, classroomId)
  if (!petResult.ok) return petResult

  const pet = petResult.data
  const supabase = getServiceRoleClient()
  const granted: AchievementGrant[] = []
  let totalXp = 0

  for (const item of items) {
    const config = ACHIEVEMENTS[item.achievementId]

    // Attempt insert into pet_rewards — unique constraint handles idempotency
    const { error: rewardError } = await supabase
      .from('pet_rewards')
      .insert({
        pet_id: pet.id,
        reward_type: item.achievementId,
        reward_key: item.rewardKey,
        metadata: item.metadata || null,
      })

    if (rewardError) {
      if (rewardError.code === '23505') {
        // Already granted — skip
        continue
      }
      console.error('Error inserting pet_reward:', rewardError)
      continue
    }

    // Record XP event
    const { error: eventError } = await supabase
      .from('xp_events')
      .insert({
        pet_id: pet.id,
        source: item.achievementId,
        xp_amount: config.xp,
        metadata: item.metadata || null,
      })

    if (eventError) {
      console.error('Error inserting XP event:', eventError)
    }

    granted.push({ achievementId: item.achievementId, label: config.label, xp: config.xp })
    totalXp += config.xp
  }

  if (totalXp === 0) {
    return {
      ok: true,
      data: {
        achievements: granted,
        totalXpAwarded: 0,
        newLevel: calculateLevel(pet.xp),
        newUnlocks: [],
      },
    }
  }

  // Atomically increment XP to prevent lost updates under concurrency
  const { data: newXp, error: updateError } = await supabase
    .rpc('increment_pet_xp', { p_pet_id: pet.id, p_amount: totalXp })

  if (updateError || newXp == null) {
    console.error('Error updating pet XP:', updateError)
    return { ok: false, status: 500, error: 'Failed to update XP' }
  }

  const newLevel = calculateLevel(newXp)

  // Detect and insert new unlocks
  const { data: existingUnlocks } = await supabase
    .from('pet_unlocks')
    .select('image_index')
    .eq('pet_id', pet.id)

  const existingIndices = (existingUnlocks || []).map((u) => u.image_index)
  const newUnlocks = detectNewUnlocks(existingIndices, newLevel)

  if (newUnlocks.length > 0) {
    await supabase
      .from('pet_unlocks')
      .insert(newUnlocks.map((idx) => ({ pet_id: pet.id, image_index: idx })))
  }

  return {
    ok: true,
    data: { achievements: granted, totalXpAwarded: totalXp, newLevel, newUnlocks },
  }
}

export async function checkEntryAchievements(
  userId: string,
  classroomId: string
): Promise<void> {
  const supabase = getServiceRoleClient()

  // Fetch all class days (is_class_day=true, date <= today Toronto) for this classroom
  const today = getTodayInToronto()
  const { data: classDays, error: classDaysError } = await supabase
    .from('class_days')
    .select('date')
    .eq('classroom_id', classroomId)
    .eq('is_class_day', true)
    .lte('date', today)
    .order('date', { ascending: true })

  if (classDaysError || !classDays) {
    console.error('Error fetching class days for achievements:', classDaysError)
    return
  }

  // Fetch all entries for this student in this classroom
  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('date')
    .eq('student_id', userId)
    .eq('classroom_id', classroomId)

  if (entriesError) {
    console.error('Error fetching entries for achievements:', entriesError)
    return
  }

  const entryDates = new Set((entries || []).map((e) => e.date))
  const items: AchievementItem[] = []

  // --- Streak detection ---
  let streak = 0
  let cycle = 0

  for (const cd of classDays) {
    if (entryDates.has(cd.date)) {
      streak++

      if (streak >= 3) {
        items.push({ achievementId: 'streak_3', rewardKey: `cycle:${cycle}` })
      }
      if (streak >= 5) {
        items.push({ achievementId: 'streak_5', rewardKey: `cycle:${cycle}` })
      }
      if (streak >= 10) {
        items.push({ achievementId: 'streak_10', rewardKey: `cycle:${cycle}` })
        cycle++
        streak = 0
      }
    } else {
      streak = 0
    }
  }

  // --- Full week detection ---
  // Group class days by ISO week (Mon-Sun)
  const weekMap = new Map<string, string[]>() // "YYYY-Www" -> dates[]

  for (const cd of classDays) {
    const d = new Date(cd.date + 'T00:00:00')
    const weekKey = getISOWeekKey(d)
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, [])
    }
    weekMap.get(weekKey)!.push(cd.date)
  }

  for (const [weekKey, dates] of weekMap) {
    // Check the week is complete (today >= last class day of the week)
    const lastClassDay = dates[dates.length - 1]!
    if (today < lastClassDay) continue

    // All class days must have entries
    const allHaveEntries = dates.every((d) => entryDates.has(d))
    if (allHaveEntries) {
      items.push({ achievementId: 'full_week', rewardKey: `week:${weekKey}` })
    }
  }

  if (items.length > 0) {
    await grantAchievements(userId, classroomId, items)
  }
}

function getISOWeekKey(date: Date): string {
  // Calculate ISO week number
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

export async function selectPetImage(
  userId: string,
  classroomId: string,
  imageIndex: number
): Promise<PetResult<UserPet>> {
  const petResult = await getOrCreatePet(userId, classroomId)
  if (!petResult.ok) return petResult

  const pet = petResult.data
  const supabase = getServiceRoleClient()

  // Verify image is unlocked
  const { data: unlock } = await supabase
    .from('pet_unlocks')
    .select('id')
    .eq('pet_id', pet.id)
    .eq('image_index', imageIndex)
    .single()

  if (!unlock) {
    return { ok: false, status: 400, error: 'Image not unlocked' }
  }

  const { data: updated, error } = await supabase
    .from('user_pets')
    .update({ selected_image: imageIndex })
    .eq('id', pet.id)
    .select()
    .single()

  if (error || !updated) {
    console.error('Error updating selected image:', error)
    return { ok: false, status: 500, error: 'Failed to update selected image' }
  }

  return { ok: true, data: updated as UserPet }
}
