-- Normalize existing assignments so authenticity tracking is always enabled.
-- UI control has been removed, and server-side scoring now assumes enabled.
UPDATE assignments
SET track_authenticity = true
WHERE track_authenticity = false;
