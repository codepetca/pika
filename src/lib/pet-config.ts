export const XP_PER_LEVEL = 100

export const XP_SOURCES = {
  daily_login: { amount: 10, dailyCap: 10 },
  assignment_complete: { amount: 25, dailyCap: null },
  weekly_goal: { amount: 50, dailyCap: null },
} as const

export type XpSourceKey = keyof typeof XP_SOURCES

export const PET_IMAGES = [
  { index: 0, unlockLevel: 0, name: 'Hello!', description: 'Pika waves hello on the first day of class' },
  { index: 1, unlockLevel: 2, name: 'Study Time', description: 'Pika sits at a tiny desk with a pencil' },
  { index: 2, unlockLevel: 4, name: 'Book Lover', description: 'Pika curls up with a good book' },
  { index: 3, unlockLevel: 6, name: 'Coffee Break', description: 'Pika enjoys a warm cup of cocoa' },
  { index: 4, unlockLevel: 8, name: 'Library Explorer', description: 'Pika explores towering bookshelves' },
  { index: 5, unlockLevel: 10, name: 'Garden Visit', description: 'Pika tends a tiny garden of flowers' },
  { index: 6, unlockLevel: 12, name: 'Met Ollie', description: 'Pika meets a friendly owl named Ollie' },
  { index: 7, unlockLevel: 14, name: 'Stargazer', description: 'Pika gazes up at a starry night sky' },
  { index: 8, unlockLevel: 16, name: 'Summit!', description: 'Pika reaches the top of a tiny mountain' },
  { index: 9, unlockLevel: 18, name: 'Met Fern', description: 'Pika befriends a cheerful frog named Fern' },
  { index: 10, unlockLevel: 20, name: 'Graduate', description: 'Pika wears a tiny graduation cap' },
] as const
