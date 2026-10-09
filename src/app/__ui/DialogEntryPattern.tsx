'use client'

import { useState } from 'react'
import { Button, ContentDialog, FormField, Input, PageDensityProvider, PageStack } from '@/ui'
import styles from './DialogEntryPattern.module.scss'

type EntryMode = 'immediate' | 'quiet'
type Role = 'teacher' | 'student'

const READING_PARAGRAPHS = [
  'The class explored how a clear explanation connects a claim with evidence. Each example begins with an observation, identifies a useful detail, and explains why that detail supports the conclusion. These fixed notes provide reading content for the dialog comparison.',
  'During the opening activity, learners compared two short responses to the same question. Both responses reached a similar conclusion, but the second response made the reasoning easier to follow. The discussion focused on the connection between a specific example and the main idea.',
  'A small group then sorted observations into relevant and unrelated details. The group kept details that helped answer the question and set aside details that introduced a different topic. Their shared explanation used ordinary language and one carefully chosen example.',
  'The next activity asked learners to revise a sentence that made a broad claim. They added a concrete observation and explained its meaning. The revised sentence made the relationship between the evidence and the conclusion visible without adding unnecessary background.',
  'Independent work gave each learner time to try the same process. A first draft captured the main idea, while a second pass checked whether the evidence actually supported it. Learners could keep a useful sentence and change only the part that needed a clearer connection.',
  'The class paused to read one response aloud. Listeners identified the claim, located the supporting detail, and described the reasoning in their own words. This check helped the writer see which parts were clear and which parts needed another sentence.',
  'Peer feedback stayed focused on one useful change. A partner could suggest a more precise example, ask how a detail supported the claim, or point to a sentence that moved away from the question. The writer chose a revision after considering that feedback.',
  'The final reading example combined a short claim with two related observations. Each observation served a different purpose, and the explanation connected both to the same conclusion. The response stayed organized because every sentence contributed to the question being answered.',
  'At the end of the activity, learners recorded a next step for their own work. Some planned to choose more specific evidence, while others planned to explain the evidence more fully. These notes remain fixed so repeated entries show the same content and scroll length.',
  'The review closed with a reminder to check the relationship between a claim and its support. A useful explanation does more than list facts: it makes the reasoning visible to another reader. This final paragraph marks the end of the fixture reading content.',
]

/** Development-only composition. Entry mode belongs to this fixture, not the dialog owner. */
export function DialogEntryPattern({ role }: { role: Role }) {
  const [entry, setEntry] = useState<EntryMode | null>(null)
  // Keep the selected exit contract when logical close clears the entry.
  const [exitMotion, setExitMotion] = useState<'none' | 'opacity'>('none')
  const [draft, setDraft] = useState('Explain how the example supports your conclusion.')
  const [metadataRevision, setMetadataRevision] = useState(0)
  const [nestedOpen, setNestedOpen] = useState(false)
  const [destination, setDestination] = useState<string | null>(null)
  const presentation = role === 'teacher' ? 'Teacher' : 'Student'

  function closePreview() {
    setNestedOpen(false)
    setEntry(null)
  }

  // This callback only updates local fixture state; it does not navigate a product route.
  function selectFixtureDestination() {
    setDestination(role === 'teacher' ? 'Teacher dashboard' : 'Student history')
    closePreview()
  }

  return (
    <PageDensityProvider density={role}>
      <div data-testid="dialog-entry-pattern" className="space-y-3">
        <p className="text-sm text-text-muted">Experimental · development-only. Compare immediate entry and dismissal with quiet 200ms opacity entry and dismissal.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="surface" onClick={() => { setExitMotion('none'); setEntry('immediate') }}>Open immediate dialog entry</Button>
          <Button type="button" variant="surface" onClick={() => { setExitMotion('opacity'); setEntry('quiet') }}>Open quiet dialog entry</Button>
        </div>
        <p role="status" data-testid="dialog-entry-destination" className="text-sm text-text-muted">
          {destination ? `Fixture destination selected: ${destination}` : 'No fixture destination selected.'}
        </p>
        <ContentDialog
          isOpen={entry !== null}
          exitMotion={exitMotion}
          onClose={closePreview}
          title="Dialog entry preview"
          subtitle={`${presentation} presentation · local fixture`}
          panelClassName={entry === 'quiet' ? styles.quietEntry : undefined}
          footer={<Button type="button" onClick={selectFixtureDestination}>Select fixture destination</Button>}
        >
          <div data-testid="dialog-entry-body">
            <PageStack>
              <div className="text-sm text-text-muted">
                <p>{presentation} presentation</p>
                <p data-testid="dialog-entry-mode">Entry: {entry === 'quiet' ? 'Quiet' : 'Immediate'}</p>
                <p data-testid="dialog-entry-metadata">Metadata revision: {metadataRevision}</p>
              </div>
              <FormField label="Dialog entry draft">
                <Input value={draft} onChange={(event) => setDraft(event.target.value)} data-testid="dialog-entry-draft" />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setMetadataRevision((revision) => revision + 1)}>Refresh dialog entry metadata</Button>
                <Button type="button" variant="secondary" onClick={() => setNestedOpen(true)}>Open dialog entry confirmation</Button>
              </div>
              <div className="space-y-4 text-sm leading-6 text-text-default" data-testid="dialog-entry-reading">
                {READING_PARAGRAPHS.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </PageStack>
          </div>
        </ContentDialog>
        <ContentDialog
          isOpen={nestedOpen}
          exitMotion={exitMotion}
          onClose={() => setNestedOpen(false)}
          title="Dialog entry nested confirmation"
          maxWidth="max-w-sm"
          showFooterClose={false}
          footer={<Button type="button" variant="secondary" onClick={() => setNestedOpen(false)}>Return to dialog entry preview</Button>}
        >
          <p className="text-sm text-text-default">Keep this local draft and return to the preview.</p>
        </ContentDialog>
      </div>
    </PageDensityProvider>
  )
}
