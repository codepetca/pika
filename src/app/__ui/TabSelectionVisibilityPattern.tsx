'use client'

import { useState } from 'react'
import { Button, Card, FormField, Input, TabPanel, Tabs, cn } from '@/ui'

const ITEMS = [
  { value: 'overview', label: 'Overview' },
  { value: 'content', label: 'Content' },
  { value: 'guidance', label: 'Authoring guidance' },
  { value: 'settings', label: 'Settings' },
] as const
type Selection = (typeof ITEMS)[number]['value']

export function TabSelectionVisibilityPattern() {
  return (
    <section id="tab-selection-visibility" aria-label="Selected tab visibility" className="scroll-mt-28 space-y-4">
      <h2 className="text-xl font-semibold">Selected tab visibility</h2>
      <p className="text-sm text-text-muted">Canonical Tabs: retained selection stays visible inside its own scroller. Drafts and focus remain with their current owner.</p>
      {(['underline', 'connected', 'rtl'] as const).map((example) => (
        <SelectionExample key={example} example={example} />
      ))}
    </section>
  )
}

function SelectionExample({ example }: { example: 'underline' | 'connected' | 'rtl' }) {
  const [selection, setSelection] = useState<Selection>('settings')
  const [owner, setOwner] = useState(0)
  const [narrow, setNarrow] = useState(false)
  const [draft, setDraft] = useState('Retained draft')
  const prefix = `visibility-${example}`
  return (
    <div data-testid={prefix}>
    <Card tone="panel" padding="md" className="space-y-3">
      <h3 className="font-semibold">{example === 'rtl' ? 'Right-to-left' : example === 'connected' ? 'Connected tabs' : 'Underline tabs'}</h3>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setSelection('overview')}>Show Overview</Button>
        <Button variant="secondary" onClick={() => setSelection('settings')}>Show Settings</Button>
        <Button variant="secondary" onClick={() => setOwner((current) => current + 1)}>Remount tab list</Button>
        <Button variant="secondary" onClick={() => setNarrow((current) => !current)}>{narrow ? 'Widen tab list' : 'Narrow tab list'}</Button>
      </div>
      <div dir={example === 'rtl' ? 'rtl' : 'ltr'} className={cn('min-w-0 w-full', narrow ? 'max-w-48' : 'max-w-xs')}>
        <Tabs
          key={owner}
          ariaLabel={`${example} visibility panels`}
          items={ITEMS}
          value={selection}
          onValueChange={setSelection}
          variant={example === 'connected' ? 'connected' : 'underline'}
          getTabId={(value) => `${prefix}-${value}-tab`}
          getPanelId={(value) => `${prefix}-${value}-panel`}
        />
      </div>
      {ITEMS.map((item) => (
        <TabPanel key={item.value} id={`${prefix}-${item.value}-panel`} labelledBy={`${prefix}-${item.value}-tab`} className={cn(selection !== item.value && 'hidden')}>
          <p className="text-sm text-text-muted">{item.label} panel</p>
        </TabPanel>
      ))}
      <FormField label={`${example} retained draft`}>
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} />
      </FormField>
    </Card>
    </div>
  )
}
