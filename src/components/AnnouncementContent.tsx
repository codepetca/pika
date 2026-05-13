'use client'

import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { cn } from '@/ui/utils'

type AnnouncementContentTone = 'default' | 'muted'
type AnnouncementContentSize = 'sm' | 'lg'

interface AnnouncementContentProps {
  content: string
  tone?: AnnouncementContentTone
  size?: AnnouncementContentSize
  className?: string
}

const toneClasses: Record<AnnouncementContentTone, string> = {
  default:
    '[&_p]:!text-text-default [&_li]:!text-text-default [&_blockquote]:!text-text-muted [&_h1]:!text-text-default [&_h2]:!text-text-default [&_h3]:!text-text-default',
  muted:
    '[&_p]:!text-text-muted [&_li]:!text-text-muted [&_blockquote]:!text-text-muted [&_h1]:!text-text-muted [&_h2]:!text-text-muted [&_h3]:!text-text-muted',
}

const sizeClasses: Record<AnnouncementContentSize, string> = {
  sm:
    '[&_p]:!text-sm [&_li]:!text-sm [&_blockquote]:!text-sm [&_h1]:!text-base [&_h2]:!text-base [&_h3]:!text-sm',
  lg:
    '[&_p]:!text-xl [&_p]:!leading-relaxed [&_li]:!text-xl [&_li]:!leading-relaxed [&_blockquote]:!text-xl [&_blockquote]:!leading-relaxed [&_h1]:!text-2xl [&_h2]:!text-2xl [&_h3]:!text-xl sm:[&_p]:!text-2xl sm:[&_li]:!text-2xl sm:[&_blockquote]:!text-2xl sm:[&_h1]:!text-3xl sm:[&_h2]:!text-3xl sm:[&_h3]:!text-2xl',
}

export function AnnouncementContent({
  content,
  tone = 'default',
  size = 'sm',
  className,
}: AnnouncementContentProps) {
  return (
    <LimitedMarkdown
      content={content}
      className={cn('break-words', toneClasses[tone], sizeClasses[size], className)}
      emptyPlaceholder={null}
    />
  )
}
