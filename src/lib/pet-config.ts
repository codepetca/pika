export const XP_PER_LEVEL = 100

export const ACHIEVEMENTS = {
  assignment_submitted: { label: 'Submitted', xp: 10, repeatable: 'per_assignment' },
  on_time_submit: { label: 'On Time!', xp: 15, repeatable: 'per_assignment' },
  first_submission: { label: 'First Steps', xp: 25, repeatable: 'one_time' },
  full_week: { label: 'Full Week', xp: 50, repeatable: 'per_week' },
  streak_3: { label: '3-Day Streak', xp: 25, repeatable: 'per_cycle' },
  streak_5: { label: '5-Day Streak', xp: 50, repeatable: 'per_cycle' },
  streak_10: { label: '10-Day Streak', xp: 100, repeatable: 'per_cycle' },
} as const

export type AchievementId = keyof typeof ACHIEVEMENTS

export const PET_IMAGES = [
  { index: 0, unlockLevel: 0, name: 'Hello!', description: 'Pika waves hello on the first day of class' },
  { index: 1, unlockLevel: 3, name: 'Study Time', description: 'Pika sits at a tiny desk with a pencil' },
  { index: 2, unlockLevel: 6, name: 'Book Lover', description: 'Pika curls up with a good book' },
  { index: 3, unlockLevel: 9, name: 'Coffee Break', description: 'Pika enjoys a warm cup of cocoa' },
  { index: 4, unlockLevel: 12, name: 'Library Explorer', description: 'Pika explores towering bookshelves' },
  { index: 5, unlockLevel: 15, name: 'Garden Visit', description: 'Pika tends a tiny garden of flowers' },
  { index: 6, unlockLevel: 18, name: 'Met Ollie', description: 'Pika meets a friendly owl named Ollie' },
  { index: 7, unlockLevel: 21, name: 'Stargazer', description: 'Pika gazes up at a starry night sky' },
  { index: 8, unlockLevel: 24, name: 'Summit!', description: 'Pika reaches the top of a tiny mountain' },
  { index: 9, unlockLevel: 27, name: 'Met Fern', description: 'Pika befriends a cheerful frog named Fern' },
  { index: 10, unlockLevel: 30, name: 'Graduate', description: 'Pika wears a tiny graduation cap' },
] as const

export const PET_TITLES: readonly { level: number; title: string }[] = [
  { level: 0, title: 'Newcomer' },
  { level: 1, title: 'Curious' },
  { level: 2, title: 'Eager Learner' },
  { level: 3, title: 'Bookworm' },
  { level: 4, title: 'Explorer' },
  { level: 5, title: 'Diligent' },
  { level: 6, title: 'Scholar' },
  { level: 7, title: 'Thinker' },
  { level: 8, title: 'Adventurer' },
  { level: 9, title: 'Dreamer' },
  { level: 10, title: 'Trailblazer' },
  { level: 11, title: 'Devoted' },
  { level: 12, title: 'Sage' },
  { level: 13, title: 'Naturalist' },
  { level: 14, title: 'Creative' },
  { level: 15, title: 'Gardener' },
  { level: 16, title: 'Storyteller' },
  { level: 17, title: 'Wise' },
  { level: 18, title: 'Companion' },
  { level: 19, title: 'Visionary' },
  { level: 20, title: 'Night Owl' },
  { level: 21, title: 'Pathfinder' },
  { level: 22, title: 'Dedicated' },
  { level: 23, title: 'Inspirer' },
  { level: 24, title: 'Mountaineer' },
  { level: 25, title: 'Champion' },
  { level: 26, title: 'Luminary' },
  { level: 27, title: 'True Friend' },
  { level: 28, title: 'Legend' },
  { level: 29, title: 'Mentor' },
  { level: 30, title: 'Master' },
] as const
