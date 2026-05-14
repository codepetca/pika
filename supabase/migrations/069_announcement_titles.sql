-- Add an optional short title used for announcement calendar labels.
ALTER TABLE announcements
  ADD COLUMN title text;

ALTER TABLE announcements
  ADD CONSTRAINT announcements_title_length
  CHECK (title IS NULL OR char_length(title) <= 60);
