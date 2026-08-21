import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const applyChanges = process.argv.includes('--apply');
const migrationFiles = [
  'drizzle/0030_attendance_leave_permissions.sql',
  'drizzle/0031_staff_inactive_periods.sql',
];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in .env.local');
  process.exit(1);
}

function splitStatements(source) {
  const statements = [];
  let buffer = '';
  let dollarTag = null;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '$') {
      const match = source.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match && (!dollarTag || match[0] === dollarTag)) {
        dollarTag = dollarTag ? null : match[0];
        buffer += match[0];
        index += match[0].length - 1;
        continue;
      }
    }
    if (source[index] === ';' && !dollarTag) {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += source[index];
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

const plans = migrationFiles.map((file) => {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  return { file, statements: splitStatements(source) };
});

for (const plan of plans) {
  console.log(`${plan.file}: ${plan.statements.length} SQL statements`);
}

if (!applyChanges) {
  console.log('Dry run only. Add --apply to execute these additive migrations.');
  process.exit(0);
}

const sql = neon(process.env.DATABASE_URL);
for (const plan of plans) {
  for (const statement of plan.statements) {
    await sql.query(statement);
  }
  console.log(`Applied ${plan.file}`);
}

console.log('Leave and inactive-period schema is ready.');
