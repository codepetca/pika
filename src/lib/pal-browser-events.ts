export const PIKA_PAL_REFRESH_EVENT = 'pika:pal-refresh'

/** Refresh the mounted Pal provider only when this request delivered new state. */
export function notifyImmediatePalDelivery(status: unknown, classroomId?: string) {
  if (status !== 'delivered') return
  window.dispatchEvent(new CustomEvent(PIKA_PAL_REFRESH_EVENT, { detail: { classroomId } }))
}
