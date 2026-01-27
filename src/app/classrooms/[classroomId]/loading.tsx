import { AppShell } from '@/components/AppShell'

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

        {/* Main content skeleton */}
        <main className="p-4 space-y-4">
          <div className="h-8 w-48 bg-surface-hover rounded animate-pulse" />
          <div className="h-32 bg-surface-hover rounded animate-pulse" />
          <div className="h-32 bg-surface-hover rounded animate-pulse" />
        </main>

        {/* Right sidebar - empty/collapsed */}
        <div />
      </div>
    </AppShell>
  )
}
