import { headers } from 'next/headers'
import {
  buildLoginRedirectPath,
  PIKA_REQUEST_PATH_HEADER,
} from '@/lib/auth-redirect'

const DEFAULT_AUTHENTICATED_DESTINATION = '/classrooms'

export function getServerLoginRedirectPath(reason?: string): string {
  const currentPath =
    headers().get(PIKA_REQUEST_PATH_HEADER) ?? DEFAULT_AUTHENTICATED_DESTINATION

  return buildLoginRedirectPath(currentPath, reason)
}
