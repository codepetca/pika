export const classroomLaunchAlerts = {
  'signup-email': 'Pika could not issue or deliver a WorkOS sign-in code.',
  admission: 'Pika could not complete a classroom admission registry request.',
  canary: 'Synthetic Pika launch alert. No action is needed.',
} as const

export type ClassroomLaunchAlert = Exclude<keyof typeof classroomLaunchAlerts, 'canary'>
