'use client'

import { useState } from 'react'
import { AlertDialog, Button, Card, ConfirmDialog, ContentDialog, DialogPanel } from '@/ui'
import { CreationModalShell } from '@/components/creation/CreationModalShell'

const TITLE = 'A longer dialog title that remains readable beside the shared close control'
const KINDS = ['content', 'panel', 'creation', 'confirm', 'alert'] as const

export function ModalClosePattern() {
  const [kind, setKind] = useState<typeof KINDS[number] | null>(null)
  const [busy, setBusy] = useState(false)
  const close = () => { setKind(null); setBusy(false) }
  const body = <div className="space-y-3">
    <Button variant="secondary" onClick={() => setBusy(!busy)} aria-pressed={busy}>Toggle busy state</Button>
    {Array.from({ length: 12 }, (_, i) => <p key={i}>Reading paragraph {i + 1}. The close action stays in the modal corner while this content scrolls.</p>)}
  </div>
  return <section id="modal-close" data-testid="modal-close-pattern">
    <Card tone="panel" padding="md">
      <h3 className="font-semibold">Modal close controls</h3>
      <p className="mt-2 text-sm text-text-muted">Shared corner dismissal, disabled close and scrolling content.</p>
      <div className="mt-3 flex flex-wrap gap-2">{KINDS.map(value => <Button key={value} variant="surface"
        onClick={() => { setBusy(false); setKind(value) }}>Open {value} close example</Button>)}</div>
    </Card>
    <ContentDialog isOpen={kind === 'content'} title={TITLE} onClose={close} closeDisabled={busy} showFooterClose={false}>{body}</ContentDialog>
    <DialogPanel isOpen={kind === 'panel'} ariaLabelledBy="corner-panel-title" onClose={close} closeDisabled={busy}>
      <h2 id="corner-panel-title" className="font-semibold">{TITLE}</h2>
      <div className="mt-3 min-h-0 overflow-y-auto">{body}</div>
    </DialogPanel>
    <CreationModalShell isOpen={kind === 'creation'} title={TITLE} titleId="corner-creation-title" closeLabel="Close"
      onClose={close} closeDisabled={busy} showTitle>{body}</CreationModalShell>
    <ConfirmDialog isOpen={kind === 'confirm'} title={TITLE} description="Closing cancels this example."
      onCancel={close} onConfirm={close} />
    <AlertDialog isOpen={kind === 'alert'} title={TITLE} description="A dismissible informational example." onClose={close} />
  </section>
}
