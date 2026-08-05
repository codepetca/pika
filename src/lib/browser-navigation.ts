export const PIKA_LOCATION_CHANGE_EVENT = 'pika:location-change'

/** Notify persistent client shells after Pika changes the URL with the History API. */
export function notifyPikaLocationChange() {
  window.dispatchEvent(new Event(PIKA_LOCATION_CHANGE_EVENT))
}
