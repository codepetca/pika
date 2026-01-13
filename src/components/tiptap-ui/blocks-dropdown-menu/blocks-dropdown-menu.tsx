"use client"

import { forwardRef, useCallback, useState } from "react"
import type { Editor } from "@tiptap/react"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { BlockquoteIcon } from "@/components/tiptap-icons/blockquote-icon"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Tiptap UI ---
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button"
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button"

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

export interface BlocksDropdownMenuProps extends Omit<ButtonProps, "type"> {
  editor?: Editor
  portal?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export const BlocksDropdownMenu = forwardRef<
  HTMLButtonElement,
  BlocksDropdownMenuProps
>(({ editor: providedEditor, portal = false, onOpenChange, ...buttonProps }, ref) => {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = useState(false)

  const isBlockquoteActive = editor?.isActive("blockquote") ?? false
  const isCodeBlockActive = editor?.isActive("codeBlock") ?? false
  const isActive = isBlockquoteActive || isCodeBlockActive

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
          aria-label="Block formatting"
          aria-pressed={isActive}
          tooltip="Blocks"
          {...buttonProps}
          ref={ref}
        >
          <BlockquoteIcon className="tiptap-button-icon" />
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" portal={portal}>
        <Card>
          <CardBody>
            <ButtonGroup>
              <DropdownMenuItem asChild>
                <BlockquoteButton editor={editor} />
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <CodeBlockButton editor={editor} />
              </DropdownMenuItem>
            </ButtonGroup>
          </CardBody>
        </Card>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

BlocksDropdownMenu.displayName = "BlocksDropdownMenu"

export default BlocksDropdownMenu
