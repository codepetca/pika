export function rateLimitDescription(value: unknown) {
  const seconds = typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null
  return seconds
    ? `Too many attempts. Wait ${seconds} seconds before trying again.`
    : 'Too many attempts. Wait before trying again.'
}
