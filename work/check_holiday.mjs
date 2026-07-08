import { neon } from '@neondatabase/serverless';
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing'); process.exit(1); }
const sql = neon(url);
const rows = await sql.query("SELECT date::text, is_holiday, holiday_note, source, is_removed FROM work_calendar WHERE date BETWEEN '2026-06-25' AND '2026-07-10' ORDER BY date");
console.table(rows);
