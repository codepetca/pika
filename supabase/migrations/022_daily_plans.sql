-- Migration: 022_daily_plans.sql
-- Add daily_plans table and future_plans_visibility column to classrooms

-- Add visibility setting to classrooms
ALTER TABLE classrooms
ADD COLUMN future_plans_visibility text NOT NULL DEFAULT 'current'
CHECK (future_plans_visibility IN ('current', 'next', 'all'));

COMMENT ON COLUMN classrooms.future_plans_visibility IS 'Controls how far ahead students can see weekly plans: current (this week only), next (this and next week), all (no limit)';

-- Create daily_plans table
CREATE TABLE daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  date date NOT NULL,
  rich_content jsonb NOT NULL DEFAULT '{"type": "doc", "content": []}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(classroom_id, date)
);

CREATE INDEX daily_plans_classroom_id_idx ON daily_plans(classroom_id);
CREATE INDEX daily_plans_date_idx ON daily_plans(date);
CREATE INDEX daily_plans_classroom_date_idx ON daily_plans(classroom_id, date);

COMMENT ON TABLE daily_plans IS 'Daily lesson plans created by teachers, displayed in the Weekly Plan tab';
COMMENT ON COLUMN daily_plans.rich_content IS 'TiptapContent JSON for the lesson plan';
