ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_no text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS rank text;

WITH staff_export_metadata(normalized_name, staff_no, gender, rank) AS (
  VALUES
    ('georgekojolutterodt', 'GRA003825', 'MALE', 'PRO'),
    ('charlesdogbatse', 'GRA004026', 'MALE', 'SRO'),
    ('charlesdodgatse', 'GRA004026', 'MALE', 'SRO'),
    ('eyrammensahgbagbo', 'GRA005895', 'MALE', 'SRO'),
    ('annalisahammond', 'GRA007661', 'FEMALE', 'ARO'),
    ('annalisaeahammond', 'GRA007661', 'FEMALE', 'ARO'),
    ('claudekwasiboadi', 'GRA008351', 'MALE', 'ARO'),
    ('danielasarekwarteng', 'GRA009051', 'MALE', 'JRAIII'),
    ('raphaeladjeimensah', 'GRA008624', 'MALE', 'ARO'),
    ('dennisakuetteharyeetey', 'GRA002628', 'MALE', 'RA III'),
    ('estheradjorkoradjei', 'GRA008565', 'FEMALE', 'ARO'),
    ('estheradjokoradjei', 'GRA008565', 'FEMALE', 'ARO'),
    ('eunicetweneboaaadu', 'GRA008404', 'FEMALE', 'ARO')
)
UPDATE staff
SET
  staff_no = staff_export_metadata.staff_no,
  gender = staff_export_metadata.gender,
  rank = staff_export_metadata.rank,
  updated_at = now()
FROM staff_export_metadata
WHERE regexp_replace(lower(staff.full_name), '[^a-z0-9]+', '', 'g') = staff_export_metadata.normalized_name;
