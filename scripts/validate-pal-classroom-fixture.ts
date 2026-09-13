import { readFileSync } from 'node:fs'
import { v1 } from '../src/vendor/pal-contract'
import { palTermCalendarForPeriodStart } from '../src/lib/server/pal-term-calendar'

const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(line => line.startsWith('PAL_EVENT:'))
const families = new Set<string>()
for (const line of lines) {
  const parsed = v1.validateV1Event(JSON.parse(line.slice('PAL_EVENT:'.length)))
  if (!parsed.ok) throw new Error(`Database emitted an invalid pinned v1 event: ${parsed.error}`)
  const event = parsed.event
  families.add(event.event_type)
  if (!event.learner_id.startsWith('pika-membership-v1-') || !event.idempotency_key.startsWith('pika:membership:v1:')) {
    throw new Error('Fixture mixed membership and legacy delivery namespaces')
  }
  if (event.event_type === 'daily_log_week.configured' && event.metadata.week_start_day) {
    const expected = palTermCalendarForPeriodStart(event.metadata.week_start_day)
    if (event.metadata.term_start_day !== expected.termStartDay || event.metadata.term_end_day !== expected.termEndDay
      || event.metadata.term_week_count !== expected.termWeekCount || event.metadata.week_index !== expected.weekIndex) {
      throw new Error('Database term calendar drifted from the canonical Toronto calendar')
    }
  }
}
if (families.size !== 6) throw new Error('Database fixture did not cover all six event families')
process.stdout.write(`Validated ${lines.length} database-produced events across all six pinned v1 families\n`)
