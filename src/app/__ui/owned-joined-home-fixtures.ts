// Deterministic presentation fixtures, never an authorization or entitlement source.
export type HomeExampleAccount = 'mixed' | 'teaching' | 'joined' | 'new'
export type HomeRelationship = 'teaching' | 'joined'
export interface HomeClassroomExample {
  id: string
  title: string
  term: string
  dates: string
  detail: string
  accent: string
  relationship: HomeRelationship
  archived: boolean
}

export const HOME_CLASSROOM_EXAMPLES: HomeClassroomExample[] = [
  { id: 'science', title: 'Grade 10 Science', term: 'Semester 1', dates: 'Sep 1, 2026 – Jan 29, 2027', detail: '28 students', accent: 'bg-info', relationship: 'teaching', archived: false },
  { id: 'biology', title: 'Grade 11 Biology', term: 'Semester 1', dates: 'Sep 1, 2026 – Jan 29, 2027', detail: '24 students', accent: 'bg-success', relationship: 'teaching', archived: false },
  { id: 'chemistry', title: 'Grade 12 Chemistry', term: 'Full year', dates: 'Sep 1, 2026 – Jun 25, 2027', detail: '26 students', accent: 'bg-warning', relationship: 'teaching', archived: false },
  { id: 'learning-design', title: 'Learning Design', term: 'Fall 2026', dates: 'Sep 8 – Dec 15, 2026', detail: 'Alex Morgan', accent: 'bg-info', relationship: 'joined', archived: false },
  { id: 'earth-space', title: 'Earth and Space Science', term: 'Semester 2', dates: 'Feb 2 – Jun 26, 2026', detail: '25 students', accent: 'bg-info', relationship: 'teaching', archived: true },
]

export const JOIN_EXAMPLE: HomeClassroomExample = {
  id: 'creative-computing', title: 'Creative Computing', term: 'Fall 2026',
  dates: 'Sep 8 – Dec 15, 2026', detail: 'Jamie Lee', accent: 'bg-success',
  relationship: 'joined', archived: false,
}

export function classroomsForExample(account: HomeExampleAccount) {
  return HOME_CLASSROOM_EXAMPLES.filter((classroom) => account === 'mixed' || classroom.relationship === account)
    .map((classroom) => ({ ...classroom }))
}

export function activeClassroomsForExample(classrooms: HomeClassroomExample[], hiddenIds: ReadonlySet<string>) {
  return classrooms.filter((classroom) => !classroom.archived && !(classroom.relationship === 'joined' && hiddenIds.has(classroom.id)))
}
