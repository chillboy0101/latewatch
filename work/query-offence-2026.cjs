const { neon } = require('@neondatabase/serverless');

(async () => {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT
        TO_CHAR(month_key, 'YYYY-MM') AS month,
        MAX(CASE WHEN item_type = 'opening_balance' THEN amount END) AS opening_balance,
        MAX(CASE WHEN item_type = 'closing_balance' THEN amount END) AS closing_balance
      FROM offence_book_item
      WHERE month_key >= '2026-01-01'
        AND month_key <  '2027-01-01'
      GROUP BY month_key
      ORDER BY month_key;
    `;
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('QUERY ERROR:', err.message);
    process.exitCode = 1;
  }
})();
