-- Migration: Add counselor_email column to classroom_roster
-- Purpose: Allow teachers to store guidance counselor emails for students
--          to facilitate easy email communication via mailto: links

ALTER TABLE classroom_roster
ADD COLUMN counselor_email text;

-- Add comment for documentation
COMMENT ON COLUMN classroom_roster.counselor_email IS 'Email address of the student''s guidance counselor';
