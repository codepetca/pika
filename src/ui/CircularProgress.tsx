import { LoaderCircle } from 'lucide-react'
import { cn } from './utils'

export interface CircularProgressProps {
  className?: string
}

/** Decorative loading indicator; the owning status or control supplies its label. */
export function CircularProgress({ className }: CircularProgressProps) {
  return (
    <LoaderCircle
      className={cn('h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none', className)}
      aria-hidden="true"
    />
  )
}
