'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface AppNavigationItem {
  href: string
  label: string
  match?: 'exact' | 'prefix'
}

interface AppNavigationProps {
  label: string
  items: AppNavigationItem[]
  width?: 'reading' | 'standard' | 'wide'
}

const widthClasses = {
  reading: 'max-w-4xl',
  standard: 'max-w-6xl',
  wide: 'max-w-7xl',
} as const

function isItemActive(pathname: string, item: AppNavigationItem): boolean {
  if (item.match !== 'prefix') return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function AppNavigation({ label, items, width = 'wide' }: AppNavigationProps) {
  const pathname = usePathname()

  return (
    <nav aria-label={label} className="border-b border-border bg-surface">
      <div className={`mx-auto px-4 ${widthClasses[width]}`}>
        <div className="flex min-h-11 items-stretch gap-1 overflow-x-auto" data-app-navigation-scroll>
          {items.map((item) => {
            const isActive = isItemActive(pathname, item)

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'inline-flex min-h-11 flex-none items-center border-b-2 px-3 text-sm font-medium transition-colors',
                  'focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-muted hover:border-border-strong hover:text-text-default',
                ].join(' ')}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
