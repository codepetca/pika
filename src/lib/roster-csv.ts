import { ApiError } from '@/lib/api-error'
import { rosterStudentsSchema, type RosterStudent } from '@/lib/validations/roster-mutations'

function parseCsvField(value: string | undefined) {
  const trimmed = (value || '').trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"').trim()
  return trimmed
}
/** Deliberately retain the existing simple comma/quotation decoder. */
export function decodeRosterCsv(csv: string): RosterStudent[] {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) throw new ApiError(400, 'CSV must have at least a header and one data row')
  const hasNumber = parseCsvField(lines[0].split(',')[0]).toLowerCase().replace(/[^a-z0-9]/g, '').includes('student')
  const students: RosterStudent[] = []
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    const parts = line.split(',').map(parseCsvField)
    const [number, firstName, lastName, email, secondary] = hasNumber ? parts : [undefined, ...parts]
    if (email && firstName && lastName) students.push({ email: email.toLowerCase().trim(), firstName, lastName,
      studentNumber: number || null, counselorEmail: secondary?.toLowerCase().trim() || null })
  }
  if (students.length === 0) throw new ApiError(400, 'No valid student data found in CSV')
  return rosterStudentsSchema.parse(students)
}
