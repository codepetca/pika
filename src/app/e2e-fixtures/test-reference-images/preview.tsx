'use client'

import { useEffect, useState } from 'react'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'
import { TestDocumentsEditor } from '@/components/TestDocumentsEditor'
import { Button, PageDensityProvider } from '@/ui'
import type { TestDocument } from '@/types'

const CLASSROOM_ID = '30000000-0000-4000-8000-000000000031'
const TEST_ID = '30000000-0000-4000-8000-000000000032'
const STARTER_DOCUMENTS: TestDocument[] = [{
  id: '30000000-0000-4000-8000-000000000033',
  title: 'Karel grid PNG',
  source: 'upload',
  storage_bucket: 'test-documents',
  storage_path: `classrooms/${CLASSROOM_ID}/tests/${TEST_ID}/documents/30000000-0000-4000-8000-000000000033/images/karel-grid.png`,
}]

/**
 * A production-owner fixture for the fully mocked image-reference browser
 * contract. Playwright owns the API and storage responses so this has no
 * dependency on a seeded classroom or an authenticated session.
 */
export function TestReferenceImagesFixture() {
  const [documents, setDocuments] = useState<TestDocument[]>(STARTER_DOCUMENTS)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <PageDensityProvider density="teacher">
      <main className="min-h-screen bg-page p-4 text-text-default">
        {hydrated ? <span data-testid="test-reference-images-ready" className="sr-only">Ready</span> : null}
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Development fixture</p>
              <h1 className="text-xl font-semibold">Test image references</h1>
            </div>
            <Button type="button" onClick={() => setPreviewOpen(true)}>
              Open teacher preview
            </Button>
          </div>

          <section aria-label="Test document authoring" className="rounded-card border border-border bg-surface p-4">
            <TestDocumentsEditor
              testId={TEST_ID}
              documents={documents}
              isEditable
              headerTitle="Reference documents"
              addButtonPlacement="header"
              onDocumentsChange={setDocuments}
            />
          </section>
        </div>

        {previewOpen ? (
          <TeacherTestPreviewPage
            classroomId={CLASSROOM_ID}
            testId={TEST_ID}
            embedded
            listenForUpdates
            onClose={() => setPreviewOpen(false)}
          />
        ) : null}
      </main>
    </PageDensityProvider>
  )
}
