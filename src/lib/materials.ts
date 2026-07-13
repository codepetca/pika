import type { ClassworkMaterial } from '@/types'

export const GENERATED_MATERIAL_TITLE = 'Untitled Material'

export function isGeneratedMaterialTitle(title: string): boolean {
  return title.trim() === GENERATED_MATERIAL_TITLE
}

export function getDisplayedMaterialTitle(material: ClassworkMaterial | null): string {
  if (!material) return ''
  return isGeneratedMaterialTitle(material.title) ? '' : material.title
}
