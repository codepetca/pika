import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import {
  ACTIONBAR_BUTTON_PRIMARY_CLASSNAME,
  PageContent,
  PageLayout,
  PageState,
} from '@/ui'

export default function ClassroomNotFound() {
  return (
    <AppShell showHeader={false}>
      <div data-testid="classroom-not-found">
        <PageLayout width="reading">
          <PageContent>
            <PageState
              kind="forbidden"
              headingLevel="h1"
              title="Classroom unavailable"
              description="It may not exist, or you may not have access."
              action={
                <Link href="/classrooms" className={ACTIONBAR_BUTTON_PRIMARY_CLASSNAME}>
                  Back to classrooms
                </Link>
              }
            />
          </PageContent>
        </PageLayout>
      </div>
    </AppShell>
  )
}
