import type { GanttWeek } from './types';

// קריאה חיה של הגאנט המחוזי מ-Google Sheets (ציבורי-לצפייה).
// endpoint ה-CSV של Google תומך ב-CORS, אז הדפדפן מושך ישירות - בלי Apps Script ובלי שרת.
// המבנה (עמודות): 0=חודש (sparse) · 1=שבוע · 2=תאריכים · 3=חגים · 4=אירועים מדעיים ·
//                 5=STEM ארצי/תכנון · 6=STEM · 7=מחוזי מדו"ט · 8+=השתלמויות/תחרויות.
// המנוע צורך רק שבוע/חודש/תאריכים/חגים - עמודות נקיות שלא דורשות שיפוט.
// כל הניקוי (מקפי-מקלדת, בלי "?", סינון אירועי צוות) נעשה כאן, לא במקור.

const SHEET_ID = '12nXRAYl3l6UgAJUL35OuhJ_UfWrK9ThTD_zVluFwFzE';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

/** אירועי צוות ההדרכה - מסוננים מהתצוגה למורה (כלל פרויקט). רלוונטי ל-stem/district בלבד. */
const TEAM_EVENT = /וובינר|כנס צוות|כנסי צוות|מפגש מדריכי|כנס רכזים|מפגש רענון|מפגש פקוח|צוות הדרכה|כנס מורי|השתלמות|השתלמויות|פיתוח מקצועי|קהילת|הקמת צוות|כתיבת תוכנית עבודה מחוזית|אגרת מפמ|רישום לבקשת מנטורים|שיבוץ מנטורים|כנסים מחוזיים למורי|מנהלי בתי הספר מקבלים|סיום היערכות|מעגלי קיץ|התנעת הערכות/;

/** פרסר CSV שמטפל בשדות מצוטטים עם פסיקים ושורות-חדשות בתוכם. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
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

/** ניקוי טקסט גלוי: מקפים גדולים -> מקף מקלדת; הסרת סימני אי-ודאות "?". */
function clean(s: string): string {
  return s.replace(/[‐-―]/g, '-').replace(/\?/g, '').replace(/\s+/g, ' ').trim();
}

/** פיצול תא רב-פריטים (מופרד ב-; / שורה חדשה / תבליט "*") לרשימה נקייה. */
function splitCell(raw: string, filterTeam: boolean): string[] {
  if (!raw) return [];
  return raw
    .split(/[;\n]|(?:^|\s)\*\s/)
    .map((x) => clean(x))
    .filter((x) => x.length > 0)
    .filter((x) => !(filterTeam && TEAM_EVENT.test(x)));
}

/** ממיר את שורות ה-CSV למערך GanttWeek. */
function toGanttWeeks(rows: string[][]): GanttWeek[] {
  const out: GanttWeek[] = [];
  let lastMonth = '';
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const col = (n: number) => (r[n] ?? '').trim();
    const weekRaw = col(1);
    if (!/^\d+$/.test(weekRaw)) continue; // מדלג על שורות בלי מספר שבוע (שורות מטה בתחתית)
    const week = parseInt(weekRaw, 10);
    const dates = col(2);
    if (!dates) continue;
    if (col(0)) lastMonth = clean(col(0));

    const holidays = splitCell(col(3), false);
    const scienceDays = splitCell(col(4), false);
    const stem = [...splitCell(col(5), true), ...splitCell(col(6), true)];
    const district = splitCell(col(7), true);

    const w: GanttWeek = { week, month: lastMonth, dates: clean(dates) };
    if (holidays.length) w.holidays = holidays;
    if (scienceDays.length) w.scienceDays = scienceDays;
    if (stem.length) w.stem = stem;
    if (district.length) w.district = district;
    out.push(w);
  }
  return out;
}

/**
 * מושך את הגאנט החי ומחזיר GanttWeek[]. מחזיר null אם ה-fetch/פרסור נכשל
 * (ואז נשארים עם הגאנט המוטמע כ-fallback).
 */
export async function fetchLiveGantt(): Promise<GanttWeek[] | null> {
  try {
    const res = await fetch(CSV_URL, { redirect: 'follow' });
    if (!res.ok) return null;
    const text = await res.text();
    const weeks = toGanttWeeks(parseCsv(text));
    // בדיקת שפיות: לפחות ~40 שבועות עם תאריכים, אחרת כנראה פרסור שגוי.
    const teaching = weeks.filter((w) => w.week >= 1);
    return teaching.length >= 40 ? weeks : null;
  } catch {
    return null;
  }
}
