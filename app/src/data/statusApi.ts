import { type SchoolStatus } from './mockStatus';

// ===== חיבור הסטטוס - חי מ-Google Sheets =====
// הסטטוס פרטי, אז נופר פרסמה לשונית מסוננת ("API") עם 11 העמודות הדרושות בלבד
// (בלי טלפונים ובלי השדות המנהליים) כ-CSV ציבורי (Publish to web). האפליקציה
// קוראת אותו ישירות (CORS), בדיוק כמו הגאנט החי. תמיד מעודכן.
// סדר העמודות בלשונית ה-API (מנוסחת QUERY): C,E,F,H,AG,AH,AI,AJ,AL,AM,AO.
const STATUS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTaABzxENIWFfS9Cr9J1OqoFX2BCpVnnJndpRyO8oRgPoVq1EXlUMoTWuREU-GP9n1uxrAYKl5xGWDq/pub?gid=1974770138&single=true&output=csv';

// לשונית "רכזים נוספים" בסטטוס: סמל מוסד | מייל | שם (לידיעה בלבד). כאן נופר
// מוסיפה מי שצריך/ה להיכנס לבית ספר שכבר יש לו רכז/ת רשומ/ה - מנהלת אשכול,
// רכזת פדגוגית, רכזת נוספת. שורה כאן = כתובת נוספת שמאפשרת כניסה, ותו לא:
// פרטי בית הספר והמייל שאליו נשלחות התוכניות נשארים לפי לשונית ה-API.
const EXTRA_COORDINATORS_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTaABzxENIWFfS9Cr9J1OqoFX2BCpVnnJndpRyO8oRgPoVq1EXlUMoTWuREU-GP9n1uxrAYKl5xGWDq/pub?gid=281228248&single=true&output=csv';

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

function toSchool(row: string[], semel: string, authorizedEmails: string[]): SchoolStatus {
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
    authorizedEmails,
    hoursByGrade,
    hasLab: row[COL.lab] ? isYes(row[COL.lab]) : undefined,
    schoolFair: row[COL.schoolFair] ? isYes(row[COL.schoolFair]) : undefined,
    districtFair: row[COL.districtFair] ? isYes(row[COL.districtFair]) : undefined,
    initiatives: (row[COL.initiatives] || '').trim() || undefined,
  };
}

// קאש לכתובות הנוספות. אם הלשונית לא נגישה (לא פורסמה, או תקלת רשת) מחזירים
// מפה ריקה - הכניסה פשוט עובדת לפי הרכז/ת הרשומ/ה, כמו לפני השינוי.
let extraPromise: Promise<Map<string, string[]>> | null = null;
function getExtraEmails(): Promise<Map<string, string[]>> {
  if (!extraPromise) {
    extraPromise = fetch(EXTRA_COORDINATORS_CSV)
      .then((r) => { if (!r.ok) throw new Error('extra http ' + r.status); return r.text(); })
      .then((text) => {
        const map = new Map<string, string[]>();
        for (const row of parseCsv(text).slice(1)) {
          const semel = (row[0] || '').replace(/\D/g, '');
          const email = (row[1] || '').trim();
          if (!semel || !email) continue;
          map.set(semel, [...(map.get(semel) ?? []), email]);
        }
        return map;
      })
      .catch(() => new Map<string, string[]>());
  }
  return extraPromise;
}

/** האם יש בשורה נתוני שעות - כלומר זו הגשת סטטוס אמיתית ולא שורת אימות בלבד. */
function hasHours(row: string[]): boolean {
  return [COL.h7, COL.h8, COL.h9].some((c) => num(row[c] || '') != null);
}

/** שולף פרטי בית ספר לפי סמל מוסד - חי מהסטטוס. מחזיר null אם הקריאה נכשלת. */
export async function fetchSchool(semel: string): Promise<SchoolStatus | null> {
  const s = String(semel).replace(/\D/g, '');
  if (!s) return null;
  try {
    const [rows, extra] = await Promise.all([getRows(), getExtraEmails()]);
    // לאותו סמל מוסד יכולות להיות כמה שורות: הגשות חוזרות של הסטטוס, וגם שורות
    // שנוספו רק כדי לאפשר כניסה לאדם נוסף בבית הספר (מנהלת אשכול, רכזת נוספת).
    const matches = rows.slice(1).filter((r) => (r[COL.school] || '').replace(/\D/g, '').includes(s));
    if (!matches.length) return null;
    // פרטי בית הספר נלקחים מההגשה העדכנית ביותר שיש בה שעות - כך ששורת אימות
    // בלי שעות לא מוחקת את נתוני בית הספר ולא הופכת לרכז/ת הראשי/ת.
    const withHours = matches.filter(hasHours);
    const dataRows = withHours.length ? withHours : matches;
    const base = dataRows[dataRows.length - 1];
    // כל הכתובות של בית הספר מאפשרות כניסה: מכל שורות הסטטוס, ובנוסף הכתובות
    // שנרשמו ללשונית "רכזים נוספים".
    const emails = [
      ...matches.map((r) => (r[COL.coordEmail] || '').trim()),
      ...(extra.get(s) ?? []),
    ]
      .filter(Boolean)
      .filter((e, i, a) => a.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
    return toSchool(base, s, emails);
  } catch {
    // כשל בקריאת הסטטוס החי - מחזירים null (לא נתוני דמו מזויפים). המורה תתבקש לנסות שוב.
    return null;
  }
}

/** האם הכתובת שהוזנה מאושרת לבית הספר הזה (הרכז/ת או כל מי שנוסף/ה בסטטוס). */
export function isAuthorizedEmail(school: SchoolStatus, email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const list = school.authorizedEmails?.length
    ? school.authorizedEmails
    : [school.coordinatorEmail];
  return list.some((x) => (x || '').trim().toLowerCase() === e);
}
