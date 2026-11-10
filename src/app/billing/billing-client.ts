const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function billingDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto', timeZoneName: 'short' }).format(new Date(value))
}

export function billingOperation(key: string) {
  const stored = sessionStorage.getItem(key)
  if (stored && uuid.test(stored)) return stored
  const id = crypto.randomUUID()
  sessionStorage.setItem(key, id)
  return id
}
