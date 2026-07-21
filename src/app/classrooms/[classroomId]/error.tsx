'use client'

import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import {
  ACTIONBAR_BUTTON_SECONDARY_CLASSNAME,
  Button,
  PageContent,
  PageLayout,
  PageState,
} from '@/ui'

export default function ClassroomError({ reset }: { error: Error; reset: () => void }) {
  return (
    <AppShell showHeader={false}>
      <PageLayout width="reading">
        <PageContent>
          <PageState
            kind="error"
            headingLevel="h1"
            title="Could not load this classroom"
            description="The classroom data could not be retrieved. Your work has not been changed."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button type="button" onClick={reset}>
                  Try again
                </Button>
                <Link href="/classrooms" className={ACTIONBAR_BUTTON_SECONDARY_CLASSNAME}>
                  Back to classrooms
                </Link>
              </div>
            }
          />
        </PageContent>
      </PageLayout>
    </AppShell>
  )
}
