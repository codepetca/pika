"use client"

import { forwardRef, useCallback, useState } from "react"
import type { Editor } from "@tiptap/react"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { AlignLeftIcon } from "@/components/tiptap-icons/align-left-icon"
import { AlignCenterIcon } from "@/components/tiptap-icons/align-center-icon"
import { AlignRightIcon } from "@/components/tiptap-icons/align-right-icon"
import { AlignJustifyIcon } from "@/components/tiptap-icons/align-justify-icon"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Tiptap UI ---
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button"

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

export interface AlignmentDropdownMenuProps extends Omit<ButtonProps, "type"> {
  editor?: Editor
  portal?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

const alignmentIcons = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
  justify: AlignJustifyIcon,
}

type Alignment = keyof typeof alignmentIcons

export const AlignmentDropdownMenu = forwardRef<
  HTMLButtonElement,
  AlignmentDropdownMenuProps
>(({ editor: providedEditor, portal = false, onOpenChange, ...buttonProps }, ref) => {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = useState(false)

  // Determine active alignment
  const getActiveAlignment = (): Alignment => {
    if (editor?.isActive({ textAlign: "center" })) return "center"
    if (editor?.isActive({ textAlign: "right" })) return "right"
    if (editor?.isActive({ textAlign: "justify" })) return "justify"
    return "left"
  }

  const activeAlignment = getActiveAlignment()
  const isActive = activeAlignment !== "left"
  const Icon = alignmentIcons[activeAlignment]

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
          aria-label="Text alignment"
          aria-pressed={isActive}
          tooltip="Alignment"
          {...buttonProps}
          ref={ref}
        >
          <Icon className="tiptap-button-icon" />
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" portal={portal}>
        <Card>
          <CardBody>
            <ButtonGroup>
              <DropdownMenuItem asChild>
                <TextAlignButton editor={editor} align="left" />
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <TextAlignButton editor={editor} align="center" />
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <TextAlignButton editor={editor} align="right" />
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <TextAlignButton editor={editor} align="justify" />
              </DropdownMenuItem>
            </ButtonGroup>
          </CardBody>
        </Card>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

AlignmentDropdownMenu.displayName = "AlignmentDropdownMenu"

export default AlignmentDropdownMenu
