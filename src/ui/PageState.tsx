import type { ElementType, ReactNode } from 'react'
import { CircleAlert, Inbox, LoaderCircle, LockKeyhole } from 'lucide-react'
import { cn } from './utils'

export type PageStateKind = 'loading' | 'error' | 'empty' | 'forbidden'

export interface PageStateProps {
  kind: PageStateKind
  title: string
  description?: ReactNode
  action?: ReactNode
  headingLevel?: 'h1' | 'h2' | 'h3'
  compact?: boolean
  className?: string
}

const stateStyles: Record<PageStateKind, { icon: ElementType; iconClassName: string }> = {
  loading: { icon: LoaderCircle, iconClassName: 'animate-spin text-primary' },
  error: { icon: CircleAlert, iconClassName: 'text-danger' },
  empty: { icon: Inbox, iconClassName: 'text-text-muted' },
  forbidden: { icon: LockKeyhole, iconClassName: 'text-warning' },
}

export function PageState({
  kind,
  title,
  description,
  action,
  headingLevel = 'h2',
  compact = false,
  className,
}: PageStateProps) {
  const Heading = headingLevel as ElementType
  const stateStyle = stateStyles[kind]
  const Icon = stateStyle.icon
  const isLoading = kind === 'loading'
  const isAssertive = kind === 'error' || kind === 'forbidden'

  return (
    <div
      data-page-state={kind}
      role={isAssertive ? 'alert' : 'status'}
      aria-live={isAssertive ? 'assertive' : 'polite'}
      aria-busy={isLoading || undefined}
      className={cn(
        'flex w-full flex-col items-center justify-center px-4 text-center',
        compact ? 'min-h-40 py-8' : 'min-h-64 py-12',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface-2">
        <Icon className={cn('h-5 w-5', stateStyle.iconClassName)} aria-hidden="true" />
      </div>
      <div className="mt-4 max-w-xl">
        <Heading className="text-lg font-semibold text-text-default">{title}</Heading>
        {description ? (
          <div className="mt-1.5 text-sm leading-6 text-text-muted">{description}</div>
        ) : null}
      </div>
      {action ? <div className="mt-5 flex w-full max-w-sm justify-center">{action}</div> : null}
    </div>
  )
}
