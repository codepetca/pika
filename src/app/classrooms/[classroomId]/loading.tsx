import { AppShell } from '@/components/AppShell'
import { PageState } from '@/ui'

export default function ClassroomLoading() {
  return (
    <AppShell showHeader={false} mainClassName="max-w-none px-0 py-0">
      {/* Match ThreePanelShell grid structure exactly */}
      <div
        data-testid="classroom-skeleton"
        className="min-h-[calc(100vh-3rem)] bg-page grid grid-cols-1 lg:grid-cols-[52px_1fr_0px]"
      >
        {/* Left sidebar skeleton - matches collapsed LeftSidebar (52px) */}
        <aside className="hidden lg:flex flex-col sticky top-12 h-[calc(100vh-3rem)] border-r border-border bg-surface">
          <div className="flex-1 py-3 px-0.5 space-y-2">
            <div className="h-12 w-12 mx-auto bg-surface-hover rounded animate-pulse" />
            <div className="h-12 w-12 mx-auto bg-surface-hover rounded animate-pulse" />
            <div className="h-12 w-12 mx-auto bg-surface-hover rounded animate-pulse" />
          </div>
        </aside>

        <main className="min-w-0">
          <PageState
            kind="loading"
            title="Loading classroom"
            description="Getting the latest classroom information."
            className="min-h-[calc(100vh-3rem)]"
          />
        </main>

        {/* Right sidebar - empty/collapsed */}
        <div />
      </div>
    </AppShell>
  )
}
