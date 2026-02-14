export const WORLD_TIMEZONE = 'America/Toronto'

export const DAILY_SPAWN_HOUR_TORONTO = 5
export const DAILY_SPAWN_MINUTE_TORONTO = 0

export const WEEKLY_EVAL_DAY_TORONTO = 5 // Friday in JS day-of-week (0=Sun)
export const WEEKLY_EVAL_HOUR_TORONTO = 5
export const WEEKLY_EVAL_MINUTE_TORONTO = 0

export const SPECIAL_MIN_ENABLED_BUCKETS = 2

export const DAILY_CARE_EVENT_KEYS = [
  'daily_fill_water_bowl',
  'daily_tidy_mess',
  'daily_greet_pika',
] as const

export const ERA_ORDER = ['seed', 'garden', 'village', 'observatory'] as const
export type WorldEra = (typeof ERA_ORDER)[number]

export const WEEKLY_EVENT_TIERS = ['baseline', 'nicer', 'special'] as const
export type WeeklyTier = (typeof WEEKLY_EVENT_TIERS)[number]

export const BASE_EVENT_WEIGHTS = {
  daily_fill_water_bowl: 1,
  daily_tidy_mess: 1,
  daily_greet_pika: 1,
} as const

