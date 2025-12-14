export function addDaysToDateString(dateString: string, deltaDays: number): string {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(dateString)) {
    throw new Error(`Invalid date string: ${dateString}`)
  }

  const base = new Date(`${dateString}T00:00:00.000Z`)
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid date string: ${dateString}`)
  }

  base.setUTCDate(base.getUTCDate() + deltaDays)
  return base.toISOString().slice(0, 10)
}

