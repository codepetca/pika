"use client"

import { forwardRef, useCallback } from "react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Icons ---
import { ResetFormattingIcon } from "@/components/tiptap-icons/reset-formatting-icon"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button } from "@/components/tiptap-ui-primitive/button"

import type { Editor } from "@tiptap/react"

export interface ClearFormattingButtonProps extends Omit<ButtonProps, "type"> {
  editor?: Editor | null
}

/**
 * Button component for clearing all formatting (marks and nodes) in the editor.
 */
export const ClearFormattingButton = forwardRef<
  HTMLButtonElement,
  ClearFormattingButtonProps
>(({ editor: providedEditor, onClick, children, ...buttonProps }, ref) => {
  const { editor } = useTiptapEditor(providedEditor)

  const canClear = editor?.isEditable ?? false

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      editor?.chain().focus().clearNodes().unsetAllMarks().run()
    },
    [editor, onClick]
  )

  return (
    <Button
      type="button"
      disabled={!canClear}
      data-style="ghost"
      data-disabled={!canClear}
      role="button"
      tabIndex={-1}
      aria-label="Reset formatting"
      tooltip="Reset formatting"
      onClick={handleClick}
      {...buttonProps}
      ref={ref}
    >
      {children ?? <ResetFormattingIcon className="tiptap-button-icon" />}
    </Button>
  )
})

ClearFormattingButton.displayName = "ClearFormattingButton"
