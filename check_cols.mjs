import { readFileSync } from 'fs';
import ExcelJS from 'exceljs';

// Check column widths in weekly export
const wbuf = readFileSync('/tmp/weekly_mar30.xlsx');
const wwb = new ExcelJS.Workbook();
await wwb.xlsx.load(wbuf);
const wws = wwb.worksheets[0];
console.log('Weekly columns:', JSON.stringify(wws.columns));

// Check template columns
const tbuf = readFileSync('/home/wiskal/Downloads/latewatch/src/lateness-book.xlsx');
const twb = new ExcelJS.Workbook();
await twb.xlsx.load(tbuf);
const tmpl = twb.getWorksheet('WEEK 4') || twb.getWorksheet('WEEK 1');
console.log('\nTemplate columns:', JSON.stringify(tmpl.columns));

// Check monthly export
const mbuf = readFileSync('/tmp/apr_monthly5.xlsx');
const mwb = new ExcelJS.Workbook();
await mwb.xlsx.load(mbuf);
const mws = mwb.worksheets[0];
console.log('\nMonthly WEEK 1 columns:', JSON.stringify(mws.columns));