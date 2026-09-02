import { headers } from 'next/headers'
import {
  buildLoginRedirectPath,
  PIKA_REQUEST_PATH_HEADER,
} from '@/lib/auth-redirect'

const DEFAULT_AUTHENTICATED_DESTINATION = '/classrooms'

export async function getServerLoginRedirectPath(reason?: string): Promise<string> {
  const currentPath =
    (await headers()).get(PIKA_REQUEST_PATH_HEADER) ?? DEFAULT_AUTHENTICATED_DESTINATION

  return buildLoginRedirectPath(currentPath, reason)
}
