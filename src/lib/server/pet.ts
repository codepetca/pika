import { getServiceRoleClient } from '@/lib/supabase'
import { XP_SOURCES } from '@/lib/pet-config'
import { isValidXpSource, calculateLevel, detectNewUnlocks, enrichPetState } from '@/lib/pet'
import type { UserPet, PetUnlock, PetState } from '@/types'
import type { XpSourceKey } from '@/lib/pet-config'

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

export async function grantXp(
  userId: string,
  classroomId: string,
  source: string,
  metadata?: Record<string, any>
): Promise<PetResult<{ granted: boolean; xpAwarded: number; newLevel: number; newUnlocks: number[] }>> {
  if (!isValidXpSource(source)) {
    return { ok: false, status: 400, error: `Invalid XP source: ${source}` }
  }

  const sourceKey = source as XpSourceKey
  const sourceConfig = XP_SOURCES[sourceKey]

  const petResult = await getOrCreatePet(userId, classroomId)
  if (!petResult.ok) return petResult

  const pet = petResult.data
  const supabase = getServiceRoleClient()

  // Idempotency check for assignment_complete: skip if already granted for this assignment
  if (sourceKey === 'assignment_complete' && metadata?.assignment_id) {
    const { data: existingEvent } = await supabase
      .from('xp_events')
      .select('id')
      .eq('pet_id', pet.id)
      .eq('source', source)
      .contains('metadata', { assignment_id: metadata.assignment_id })
      .limit(1)
      .single()

    if (existingEvent) {
      return {
        ok: true,
        data: { granted: false, xpAwarded: 0, newLevel: calculateLevel(pet.xp), newUnlocks: [] },
      }
    }
  }

  // Daily cap check for sources with a daily cap
  if (sourceConfig.dailyCap !== null) {
    const todayStart = getTodayStartToronto()
    const { data: todayEvents } = await supabase
      .from('xp_events')
      .select('xp_amount')
      .eq('pet_id', pet.id)
      .eq('source', source)
      .gte('created_at', todayStart)

    const todayTotal = (todayEvents || []).reduce((sum, e) => sum + e.xp_amount, 0)
    if (todayTotal >= sourceConfig.dailyCap) {
      return {
        ok: true,
        data: { granted: false, xpAwarded: 0, newLevel: calculateLevel(pet.xp), newUnlocks: [] },
      }
    }
  }

  // Insert XP event
  const { error: eventError } = await supabase
    .from('xp_events')
    .insert({
      pet_id: pet.id,
      source,
      xp_amount: sourceConfig.amount,
      metadata: metadata || null,
    })

  if (eventError) {
    console.error('Error inserting XP event:', eventError)
    return { ok: false, status: 500, error: 'Failed to record XP event' }
  }

  // Atomically increment XP
  const newXp = pet.xp + sourceConfig.amount
  const { error: updateError } = await supabase
    .from('user_pets')
    .update({ xp: newXp })
    .eq('id', pet.id)

  if (updateError) {
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
    data: { granted: true, xpAwarded: sourceConfig.amount, newLevel, newUnlocks },
  }
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

function getTodayStartToronto(): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const dateStr = formatter.format(now) // YYYY-MM-DD
  // Return start of day in Toronto as ISO string
  return `${dateStr}T00:00:00-05:00`
}
