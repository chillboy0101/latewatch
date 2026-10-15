-- The office grounds as a shape (outline with room for phone error, stopping just past the road)
-- instead of a circle, plus a proposed shape waiting for an admin's approval.
ALTER TABLE office_location ADD COLUMN IF NOT EXISTS boundary_json jsonb;
ALTER TABLE office_location ADD COLUMN IF NOT EXISTS boundary_draft_json jsonb;
