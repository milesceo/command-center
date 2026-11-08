-- What a plan's own page saved (its checklist ticks, "read" marks): the page's localStorage items
-- as a JSON object of strings. The page runs in an opaque-origin sandbox and cannot keep them
-- itself, so the app keeps them here and hands them back when the plan is opened.
ALTER TABLE business_plans ADD COLUMN storage TEXT;
