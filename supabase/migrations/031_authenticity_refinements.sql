-- Per-assignment opt-in (default true for backwards compat with existing scores)
ALTER TABLE assignments
  ADD COLUMN track_authenticity boolean NOT NULL DEFAULT true;

-- Client-side input tracking on history entries
ALTER TABLE assignment_doc_history
  ADD COLUMN paste_word_count smallint,
  ADD COLUMN keystroke_count integer;
