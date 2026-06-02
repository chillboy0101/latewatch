WITH staff_profile_restore AS (
  SELECT
    s.id,
    COALESCE(NULLIF(trim(s.staff_no), ''), (
      SELECT NULLIF(trim(COALESCE(a.before_json->>'staffNo', a.after_json->>'staffNo', '')), '')
      FROM audit_event a
      WHERE a.entity_type = 'staff'
        AND a.entity_id = s.id::text
        AND NULLIF(trim(COALESCE(a.before_json->>'staffNo', a.after_json->>'staffNo', '')), '') IS NOT NULL
      ORDER BY a.timestamp DESC
      LIMIT 1
    )) AS staff_no,
    COALESCE(NULLIF(trim(s.gender), ''), (
      SELECT NULLIF(trim(COALESCE(a.before_json->>'gender', a.after_json->>'gender', '')), '')
      FROM audit_event a
      WHERE a.entity_type = 'staff'
        AND a.entity_id = s.id::text
        AND NULLIF(trim(COALESCE(a.before_json->>'gender', a.after_json->>'gender', '')), '') IS NOT NULL
      ORDER BY a.timestamp DESC
      LIMIT 1
    )) AS gender,
    COALESCE(NULLIF(trim(s.rank), ''), (
      SELECT NULLIF(trim(COALESCE(a.before_json->>'rank', a.after_json->>'rank', '')), '')
      FROM audit_event a
      WHERE a.entity_type = 'staff'
        AND a.entity_id = s.id::text
        AND NULLIF(trim(COALESCE(a.before_json->>'rank', a.after_json->>'rank', '')), '') IS NOT NULL
      ORDER BY a.timestamp DESC
      LIMIT 1
    )) AS rank
  FROM staff s
)
UPDATE staff
SET
  staff_no = staff_profile_restore.staff_no,
  gender = staff_profile_restore.gender,
  rank = staff_profile_restore.rank,
  updated_at = now()
FROM staff_profile_restore
WHERE staff.id = staff_profile_restore.id
  AND (
    (NULLIF(trim(COALESCE(staff.staff_no, '')), '') IS NULL AND staff_profile_restore.staff_no IS NOT NULL)
    OR (NULLIF(trim(COALESCE(staff.gender, '')), '') IS NULL AND staff_profile_restore.gender IS NOT NULL)
    OR (NULLIF(trim(COALESCE(staff.rank, '')), '') IS NULL AND staff_profile_restore.rank IS NOT NULL)
  );
