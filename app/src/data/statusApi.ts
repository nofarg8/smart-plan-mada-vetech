import { type SchoolStatus } from './mockStatus';

// ===== חיבור הסטטוס - חי מ-Google Sheets =====
// הסטטוס פרטי, אז נופר פרסמה לשונית מסוננת ("API") עם 11 העמודות הדרושות בלבד
// (בלי טלפונים ובלי השדות המנהליים) כ-CSV ציבורי (Publish to web). האפליקציה
// קוראת אותו ישירות (CORS), בדיוק כמו הגאנט החי. תמיד מעודכן.
// סדר העמודות בלשונית ה-API (מנוסחת QUERY): C,E,F,H,AG,AH,AI,AJ,AL,AM,AO.
const STATUS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTaABzxENIWFfS9Cr9J1OqoFX2BCpVnnJndpRyO8oRgPoVq1EXlUMoTWuREU-GP9n1uxrAYKl5xGWDq/pub?gid=1974770138&single=true&output=csv';

// אינדקסי העמודות בפלט ה-CSV.
const COL = {
  school: 0,
  coordLast: 1,
  coordFirst: 2,
  coordEmail: 3,
  h7: 4,
  h8: 5,
  h9: 6,
  lab: 7,
  schoolFair: 8,
  districtFair: 9,
  initiatives: 10,
};

/** פרסר CSV שמטפל בשדות מצוטטים עם פסיקים ושורות חדשות. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// קאש לכל טעינת דף - הסטטוס לא משתנה תוך כדי סשן, ואין טעם למשוך בכל הקלדה.
let rowsPromise: Promise<string[][]> | null = null;
function getRows(): Promise<string[][]> {
  if (!rowsPromise) {
    rowsPromise = fetch(STATUS_CSV)
      .then((r) => { if (!r.ok) throw new Error('status http ' + r.status); return r.text(); })
      .then(parseCsv)
      .catch((e) => { rowsPromise = null; throw e; });
  }
  return rowsPromise;
}

function num(v: string): number | null {
  const d = (v || '').replace(/[^\d.]/g, '');
  return d ? Number(d) : null;
}
const isYes = (v: string) => /כן|יש|מתקיים|נותן|הציג/.test(v || '');

function toSchool(row: string[], semel: string): SchoolStatus {
  const rawName = row[COL.school] || '';
  const hoursByGrade: Record<number, number> = {};
  ([[7, COL.h7], [8, COL.h8], [9, COL.h9]] as const).forEach(([g, c]) => {
    const h = num(row[c] || '');
    if (h != null) hoursByGrade[g] = h;
  });
  return {
    semel,
    schoolName: rawName.replace(/[_\-\s]*\d{4,}\s*$/, '').replace(/_/g, ' ').trim() || rawName,
    coordinatorName: `${row[COL.coordFirst] || ''} ${row[COL.coordLast] || ''}`.trim(),
    coordinatorEmail: (row[COL.coordEmail] || '').trim(),
    hoursByGrade,
    hasLab: row[COL.lab] ? isYes(row[COL.lab]) : undefined,
    schoolFair: row[COL.schoolFair] ? isYes(row[COL.schoolFair]) : undefined,
    districtFair: row[COL.districtFair] ? isYes(row[COL.districtFair]) : undefined,
    initiatives: (row[COL.initiatives] || '').trim() || undefined,
  };
}

/** שולף פרטי בית ספר לפי סמל מוסד - חי מהסטטוס. נפילה לדמו אם הקריאה נכשלת. */
export async function fetchSchool(semel: string): Promise<SchoolStatus | null> {
  const s = String(semel).replace(/\D/g, '');
  if (!s) return null;
  try {
    const rows = await getRows();
    // אם הרכז/ת הגישו את הטופס יותר מפעם אחת, יש כמה שורות לאותו סמל מוסד.
    // לוקחים את ה*אחרונה* - ההגשה העדכנית ביותר - כדי לשקף שינויים בסטטוס.
    const matches = rows.slice(1).filter((r) => (r[COL.school] || '').replace(/\D/g, '').includes(s));
    const row = matches.length ? matches[matches.length - 1] : undefined;
    return row ? toSchool(row, s) : null;
  } catch {
    // כשל בקריאת הסטטוס החי - מחזירים null (לא נתוני דמו מזויפים). המורה תתבקש לנסות שוב.
    return null;
  }
}
