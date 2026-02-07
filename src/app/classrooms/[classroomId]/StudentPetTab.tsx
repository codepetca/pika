'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { PetImagePlaceholder } from '@/components/pet/PetImagePlaceholder'
import { PET_IMAGES } from '@/lib/pet-config'
import type { Classroom, PetState } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentPetTab({ classroom }: Props) {
  const [pet, setPet] = useState<PetState | null>(null)
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState(false)

  const loadPet = useCallback(async () => {
    try {
      const res = await fetch(`/api/student/classrooms/${classroom.id}/pet`)
      if (!res.ok) {
        console.error('Failed to load pet:', res.status)
        return
      }
      const data = await res.json()
      setPet(data.pet)
    } catch (err) {
      console.error('Error loading pet:', err)
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    loadPet()
  }, [loadPet])

  async function handleSelectImage(imageIndex: number) {
    if (selecting || !pet) return
    setSelecting(true)

    try {
      const res = await fetch(`/api/student/classrooms/${classroom.id}/pet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_index: imageIndex }),
      })

      if (res.ok) {
        setPet((prev) => prev ? { ...prev, selected_image: imageIndex } : prev)
      }
    } catch (err) {
      console.error('Error selecting image:', err)
    } finally {
      setSelecting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!pet) {
    return (
      <PageLayout>
        <PageContent>
          <p className="text-text-muted text-center py-8">
            Unable to load your Pika pet. Please try again later.
          </p>
        </PageContent>
      </PageLayout>
    )
  }

  const unlockedIndices = new Set(pet.unlocks.map((u) => u.image_index))
  const selectedImage = PET_IMAGES.find((img) => img.index === pet.selected_image) || PET_IMAGES[0]
  const progressPercent = pet.levelProgressPercent

  return (
    <PageLayout>
      <PageContent>
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Current selected image */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-32 h-32 rounded-xl border-2 border-primary bg-info-bg p-4">
              <PetImagePlaceholder
                index={selectedImage.index}
                name={selectedImage.name}
                description={selectedImage.description}
                unlocked
                selected={false}
                unlockLevel={selectedImage.unlockLevel}
              />
            </div>
            <h2 className="text-xl font-bold text-text-default">{selectedImage.name}</h2>
            <p className="text-sm text-text-muted">{selectedImage.description}</p>
          </div>

          {/* Level and XP progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-text-default">Level {pet.level}</span>
              <span className="text-text-muted">
                {pet.levelProgress} / 100 XP
              </span>
            </div>
            <div className="h-3 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {pet.nextUnlockLevel !== null && (
              <p className="text-xs text-text-muted text-center">
                Next unlock at Level {pet.nextUnlockLevel} —{' '}
                {PET_IMAGES.find((img) => img.unlockLevel === pet.nextUnlockLevel)?.name}
              </p>
            )}
            {pet.nextUnlockLevel === null && (
              <p className="text-xs text-text-muted text-center">
                All images unlocked! Amazing work!
              </p>
            )}
          </div>

          {/* Gallery grid */}
          <div className="space-y-3">
            <h3 className="text-base font-medium text-text-default">Gallery</h3>
            <p className="text-xs text-text-muted">
              Keep learning to unlock new images of Pika. Click any unlocked image to display it.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {PET_IMAGES.map((img) => (
                <PetImagePlaceholder
                  key={img.index}
                  index={img.index}
                  name={img.name}
                  description={img.description}
                  unlocked={unlockedIndices.has(img.index)}
                  selected={pet.selected_image === img.index}
                  unlockLevel={img.unlockLevel}
                  onClick={() => handleSelectImage(img.index)}
                />
              ))}
            </div>
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
