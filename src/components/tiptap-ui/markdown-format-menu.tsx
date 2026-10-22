'use client'

import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'
import { Button, ButtonGroup } from '@/components/tiptap-ui-primitive/button'
import { Card, CardBody } from '@/components/tiptap-ui-primitive/card'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/tiptap-ui-primitive/dropdown-menu'
import { HeadingButton } from '@/components/tiptap-ui/heading-button'
import { ListButton } from '@/components/tiptap-ui/list-button'
import { BlockquoteButton } from '@/components/tiptap-ui/blockquote-button'
import { CodeBlockButton } from '@/components/tiptap-ui/code-block-button'
import { MarkButton } from '@/components/tiptap-ui/mark-button'

export function MarkdownFormatMenu() {
  const { editor } = useTiptapEditor()
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" data-style="ghost" aria-label="Format" tooltip="Format"
          tabIndex={-1} ref={triggerRef} disabled={!editor?.isEditable}>
          <span className="tiptap-button-text">Format</span>
          <ChevronDown className="tiptap-button-dropdown-small" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" portal onCloseAutoFocus={(event) => {
        event.preventDefault()
        triggerRef.current?.focus()
      }}>
        <Card><CardBody><ButtonGroup className="[&_.tiptap-button]:min-h-control [&_.tiptap-button]:min-w-control">
          {([1, 2, 3] as const).map((level) => (
            <DropdownMenuItem key={level} asChild>
              <HeadingButton editor={editor} level={level} text={`Heading ${level}`} showTooltip={false} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem asChild>
            <ListButton editor={editor} type="bulletList" text="Bullet list" aria-label="Bullet list" showTooltip={false} />
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <ListButton editor={editor} type="orderedList" text="Numbered list" aria-label="Numbered list" showTooltip={false} />
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <BlockquoteButton editor={editor} text="Quote" showTooltip={false} />
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <CodeBlockButton editor={editor} text="Code block" aria-label="Code block" showTooltip={false} />
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <MarkButton editor={editor} type="code" text="Inline code" aria-label="Inline code" showTooltip={false} />
          </DropdownMenuItem>
        </ButtonGroup></CardBody></Card>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
