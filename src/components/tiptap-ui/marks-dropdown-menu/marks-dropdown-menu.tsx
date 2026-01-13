"use client"

import { forwardRef, useCallback, useState } from "react"
import type { Editor } from "@tiptap/react"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { StrikeIcon } from "@/components/tiptap-icons/strike-icon"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Tiptap UI ---
import { MarkButton } from "@/components/tiptap-ui/mark-button"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/tiptap-ui-primitive/dropdown-menu"
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card"

export interface MarksDropdownMenuProps extends Omit<ButtonProps, "type"> {
  editor?: Editor
  portal?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export const MarksDropdownMenu = forwardRef<
  HTMLButtonElement,
  MarksDropdownMenuProps
>(({ editor: providedEditor, portal = false, onOpenChange, ...buttonProps }, ref) => {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = useState(false)

  const isStrikeActive = editor?.isActive("strike") ?? false
  const isCodeActive = editor?.isActive("code") ?? false
  const isSuperscriptActive = editor?.isActive("superscript") ?? false
  const isSubscriptActive = editor?.isActive("subscript") ?? false
  const isActive = isStrikeActive || isCodeActive || isSuperscriptActive || isSubscriptActive

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      onOpenChange?.(open)
    },
    [onOpenChange]
  )

  return (
    <DropdownMenu modal open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          data-active-state={isActive ? "on" : "off"}
          role="button"
          tabIndex={-1}
          aria-label="Text marks"
          aria-pressed={isActive}
          tooltip="Marks"
          {...buttonProps}
          ref={ref}
        >
          <StrikeIcon className="tiptap-button-icon" />
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" portal={portal}>
        <Card>
          <CardBody>
            <ButtonGroup>
              <DropdownMenuItem asChild>
                <MarkButton editor={editor} type="strike" />
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <MarkButton editor={editor} type="code" />
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <MarkButton editor={editor} type="superscript" />
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <MarkButton editor={editor} type="subscript" />
              </DropdownMenuItem>
            </ButtonGroup>
          </CardBody>
        </Card>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

MarksDropdownMenu.displayName = "MarksDropdownMenu"

export default MarksDropdownMenu
