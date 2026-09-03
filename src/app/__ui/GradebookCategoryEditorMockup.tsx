'use client'

import { useEffect, useRef } from 'react'
import { GradebookCategoryEditor } from '@/components/gradebook/GradebookCategoryEditor'
import { nextGradebookCategoryNumber } from './gradebook-category-editor-state'
import type { GradebookCategory } from '@/types'

export function GradebookCategoryEditorMockup(props: {
  isOpen: boolean
  categories: GradebookCategory[]
  onClose: () => void
  onSave: (categories: GradebookCategory[]) => void
}) {
  const nextNumber = useRef(nextGradebookCategoryNumber(props.categories))
  useEffect(() => {
    if (props.isOpen) nextNumber.current = nextGradebookCategoryNumber(props.categories)
  }, [props.categories, props.isOpen])
  return <GradebookCategoryEditor {...props} createCategoryId={() => `pattern-category-${nextNumber.current++}`} />
}
