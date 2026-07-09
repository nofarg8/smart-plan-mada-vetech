// ייצוא התוצרים האישיים של המורה: קלנדר (.ics) ו-PDF (דרך הדפסה).
// הכל בצד-לקוח, בלי שרת. הקלנדר מכיל את האירועים המתוארכים של התוכנית:
// משימות מודל, אבני דרך חקר, מבחנים, יוזמות/תחרויות, וחופשות רשמיות.

import html2pdf from 'html2pdf.js';
import { initiatives, officialHolidays } from './data';
import type { Plan, WeekSchedule } from './engine/plan';

interface SessionLike {
  teacherName: string;
  teacherEmail: string;
  school: { schoolName: string; semel: string; coordinatorEmail: string };
}

// כתובת ה-Web App של סקריפט המסירה (רץ בחשבון ההתיישבותי, יוצר תיקיות ושומר קבצים).
const DELIVERY_URL =
  'https://script.google.com/macros/s/AKfycbwG9kC9bbaSgDlPqX3y4fKtBB5lSq3yZUo1JOt1lfMunm6fUiimp63NhgZy3M4Rpw9tiA/exec';

/** תאריך ל-ICS בפורמט יום-שלם: YYYYMMDD. */
function icsDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** הבא-יום, לצורך DTEND של אירוע יום-שלם. */
function nextDay(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + 1);
  return r;
}

/** בריחה לטקסט ICS (פסיק, נקודה-פסיק, שורה חדשה). */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** קיפול שורה לפי RFC 5545: שורות מעל ~75 אוקטטים מתקפלות עם רווח בתחילת ההמשך. */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  let out = '';
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    if (curBytes + chBytes > 73) {
      out += (out ? '\r\n ' : '') + cur;
      cur = ch;
      curBytes = chBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  return out + (out ? '\r\n ' : '') + cur;
}

function parseDMY(s: string): Date | null {
  const m = s.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
function parseDMYY(s: string): Date | null {
  const m = s.trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{2})/);
  return m ? new Date(2000 + +m[3], +m[2] - 1, +m[1]) : null;
}
/** YYYY-MM-DD מקומי -> Date מקומי (בלי הזזת יום). */
function parseYmd(s: string): Date | null {
  const m = s.trim().match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

interface IcsEvent {
  start: Date;
  end: Date; // בלעדי (יום אחרי היום האחרון)
  summary: string;
  category: string;
  /** פירוט תתי-הנושא (חובה/הרחבה/רשות) - נכנס לתיאור האירוע ביומן וב-ICS. */
  description?: string;
}

/** בונה את רשימת אירועי הקלנדר מהתוכנית + הפריסה השבועית. */
function collectEvents(plan: Plan, weekly: WeekSchedule[]): IcsEvent[] {
  const out: IcsEvent[] = [];

  // מה ללמד בכל יום הוראה - אירוע לכל שיעור תוכן, בתאריך המדויק שלו.
  for (const w of weekly) {
    if (w.vacation) continue;
    for (const sl of w.slots) {
      if (!sl.dateISO) continue;
      const d = parseYmd(sl.dateISO);
      if (!d) continue;
      // אירוע בית ספרי שהמורה הוסיפה - נכנס לקלנדר בשמו.
      if (sl.kind === 'אירוע') {
        out.push({ start: d, end: nextDay(d), summary: `אירוע בית ספרי: ${sl.label}`, category: 'אירוע' });
        continue;
      }
      // שיעורי תחרויות STEM (ט') - נפרדים מהחקר.
      if (sl.kind === 'תחרויות') {
        out.push({ start: d, end: nextDay(d), summary: `תחרויות STEM: ${sl.label}`, category: 'יוזמה' });
        continue;
      }
      // שיעור חקר (כיתה ט', לקראת היריד) - נכנס לקלנדר כשעת חקר.
      if (sl.kind === 'חקר') {
        out.push({ start: d, end: nextDay(d), summary: `חקר: ${sl.label}`, category: 'חקר' });
        continue;
      }
      if (sl.kind !== 'נושא') continue;
      // שיעור שנערך ידנית - הטקסט של המורה גובר.
      const topics = sl.overridden ? sl.label : (sl.topicList && sl.topicList.length ? sl.topicList.join(' · ') : sl.label);
      if (!topics || topics === '-') continue;
      // תיאור: פירוט תתי-הנושא (חובה/הרחבה/רשות) לאותו שיעור.
      const description = (sl.subItems && sl.subItems.length)
        ? sl.subItems.map((si) => `${si.level}: ${si.name}`).join(' · ')
        : undefined;
      out.push({ start: d, end: nextDay(d), summary: topics, category: 'נושא', description });
    }
  }

  // משימות מודל / מבחנים - מתוך הדד-ליינים המתוארכים.
  // אבני דרך החקר (הגשות/ירידים) הן תזכורות בלבד - מסומנות "תזכורת:" ובקטגוריה נפרדת,
  // כדי שיובחנו משיעורי החקר שהם שעת לימוד ממש (kind 'חקר' שכבר נכנס למעלה).
  for (const m of plan.deadlines) {
    const isReminder = m.kind === 'חקר' || m.kind === 'יריד';
    out.push({
      start: m.date,
      end: nextDay(m.date),
      summary: isReminder ? `תזכורת: ${m.label}` : m.label,
      category: isReminder ? 'תזכורת' : m.kind,
    });
  }

  // יוזמות ותחרויות STEM.
  for (const ini of initiatives) {
    const d = parseDMYY(ini.date);
    if (d) out.push({ start: d, end: nextDay(d), summary: `יוזמה: ${ini.name}`, category: 'יוזמה' });
  }

  // תזכורות הכנה לתחרויות STEM (בכל השכבות) - נכנסות ליומן כ"תזכורת:".
  for (const r of plan.reminders) {
    out.push({ start: r.date, end: nextDay(r.date), summary: `תזכורת: ${r.label}`, category: 'תזכורת' });
  }

  // חופשות וחגים רשמיים (טווח יום-שלם).
  for (const h of officialHolidays) {
    const s = parseDMY(h.start);
    const e = parseDMY(h.end);
    if (s && e) out.push({ start: s, end: nextDay(e), summary: `חופשה: ${h.name}`, category: 'חופשה' });
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** מחזיר מחרוזת ICS מלאה לתוכנית של המורה. */
export function buildICS(plan: Plan, session: SessionLike, weekly: WeekSchedule[], stamp: string): string {
  const events = collectEvents(plan, weekly);
  const gradeLabel = plan.grade === 7 ? 'כיתה ז׳' : plan.grade === 8 ? 'כיתה ח׳' : 'כיתה ט׳';
  const calName = `תוכנית עבודה - ${session.teacherName} - ${gradeLabel}`;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//תומכת הוראה אישית//תוכנית עבודה שנתית//HE',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  events.forEach((ev, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${i}-${icsDate(ev.start)}-${plan.grade}@tomehet-horaa`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(ev.start)}`,
      `DTEND;VALUE=DATE:${icsDate(ev.end)}`,
      `SUMMARY:${esc(ev.summary)}`,
      `CATEGORIES:${esc(ev.category)}`,
      `DESCRIPTION:${esc(ev.description ? `${ev.description}\n${gradeLabel} · ${session.school.schoolName} · תשפ"ז` : `${gradeLabel} · ${session.school.schoolName} · תשפ"ז`)}`,
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  // ICS דורש CRLF בין השורות, ושורות ארוכות מקופלות לפי התקן.
  return lines.map(foldLine).join('\r\n');
}

/** אירועי התוכנית כרשימה פשוטה (תאריכים מקומיים + קטגוריה + תיאור) - לבניית יומן משותף ב-Apps Script. */
export function planEvents(plan: Plan, weekly: WeekSchedule[]): { start: string; end: string; title: string; category: string; description?: string }[] {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return collectEvents(plan, weekly).map((e) => ({ start: fmt(e.start), end: fmt(e.end), title: e.summary, category: e.category, description: e.description }));
}

/** מוריד Blob בשם נתון. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** מוריד קובץ טקסט בשם נתון. */
function downloadText(content: string, filename: string, mime: string): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

/** ממיר base64 ל-Blob (להורדת ה-PDF שנוצר, בלי לייצר אותו פעמיים). */
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** מוריד את הקלנדר של המורה כקובץ .ics. */
export function downloadICS(plan: Plan, session: SessionLike, weekly: WeekSchedule[]): void {
  const stamp = icsDate(new Date()) + 'T000000Z';
  const ics = buildICS(plan, session, weekly, stamp);
  const grade = plan.grade === 7 ? 'ז' : plan.grade === 8 ? 'ח' : 'ט';
  downloadText(ics, `תוכנית עבודה - ${session.teacherName} - כיתה ${grade}.ics`, 'text/calendar;charset=utf-8');
}

/**
 * מוריד את קובץ הקלנדר, ופותח את מסך הייבוא של גוגל קלנדר בטאב חדש.
 * הערה: גוגל לא מאפשרת לאתר לייבא אוטומטית ליומן (אבטחה) - המורה עדיין
 * בוחרת את הקובץ ולוחצת "ייבוא". זה מוביל אותה ישר למסך הנכון.
 */
export function exportToGoogleCalendar(plan: Plan, session: SessionLike, weekly: WeekSchedule[]): void {
  downloadICS(plan, session, weekly);
  window.open('https://calendar.google.com/calendar/u/0/r/settings/import', '_blank', 'noopener');
}

/** מפעיל הדפסה - המשתמש שומר כ-PDF. עיצוב ההדפסה ב-index.css (@media print). */
export function printPlan(): void {
  window.print();
}

/** מייצר PDF מאלמנט הדף ומחזיר base64 (בלי הקידומת data:). מיוצא לצורכי בדיקה מקומית. */
export async function generatePdfBase64(element: HTMLElement): Promise<string> {
  const opt = {
    margin: 6,
    image: { type: 'jpeg' as const, quality: 0.85 },
    html2canvas: {
      scale: 1.4,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: element.scrollWidth,
      // מצב הייצוא מוחל ישירות על העותק שהספרייה מצלמת - מבטיח PDF נקי:
      // בלי כפתורי עריכה/פקדים, עם כל תתי-הנושא פתוחים, בלי זום ובלי sticky.
      onclone: (doc: Document) => {
        doc.querySelector('.result-page')?.classList.add('exporting');
        // מזריקים את כל חוקי העיצוב ישירות לעותק המצולם - בלי תלות בטעינת קבצים
        // אסינכרונית (מרוץ הטעינה הזה גרם ל-PDF לצאת לפעמים בלי עיצוב בכלל).
        let css = '';
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n';
          } catch {
            /* גיליון חוצה-מקור (גופני Google) - נשאר דרך הקישור הרגיל */
          }
        }
        const style = doc.createElement('style');
        style.textContent = css;
        doc.head.appendChild(style);
      },
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    pagebreak: { mode: ['css', 'legacy'] },
  };
  try { await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* לא חוסם */ }
  const dataUri = await html2pdf().set(opt).from(element).outputPdf('datauristring');
  const i = dataUri.indexOf('base64,');
  return i >= 0 ? dataUri.slice(i + 7) : dataUri;
}

export interface DeliverResult {
  ok: boolean;
  folderUrl?: string;
  error?: string;
  unverified?: boolean;
  calendarShared?: boolean;
}

/** נתוני חריגה שנרשמים לגיליון הדיווחים הפנימי (חריגה מהסטטוס / משעות משרד החינוך). */
export interface DeviationInfo {
  gradeLabel: string;
  statusHours: number | null; // ש"ש לפי הסטטוס
  actualHours: number; // ש"ש שהמורה הזינה בפועל
  hoursDeviates: boolean; // האם ההזנה שונה מהסטטוס
  moeFullHours: number; // סך שעות התוכן לפי משרד החינוך
  capacityHours: number; // סך שעות התוכן שהמורה יכולה ללמד בפועל
  shortfallHours: number; // הפער מול משרד החינוך
  droppedTopics: string[]; // נושאים שהמורה בחרה לצמצם
}

/** שולח את התוצרים לסקריפט המסירה (חשבון ההתיישבותי): תיקייה + PDF + יומן משותף + מיילים + דיווח חריגות. */
async function postDelivery(plan: Plan, session: SessionLike, pdfBase64: string, icsContent: string, events: { start: string; end: string; title: string; category?: string }[], deviation?: DeviationInfo, className?: string): Promise<DeliverResult> {
  const grade = plan.grade === 7 ? 'ז' : plan.grade === 8 ? 'ח' : 'ט';
  const classLabel = (className ?? '').trim() ? ` (${(className ?? '').trim()})` : '';
  const payload = {
    action: 'deliverPlan',
    schoolId: session.school.semel,
    schoolName: session.school.schoolName,
    teacherName: session.teacherName,
    teacherEmail: session.teacherEmail,
    coordinatorEmail: session.school.coordinatorEmail,
    gradeLabel: `כיתה ${grade}${classLabel}`,
    calendarName: `תוכנית עבודה מדע וטכנולוגיה - ${session.teacherName} - כיתה ${grade}${classLabel}`,
    pdfBase64,
    icsContent,
    events,
    deviation,
  };
  try {
    // Content-Type text/plain כדי להימנע מ-preflight מול Apps Script (כמו בסטטוס).
    const res = await fetch(DELIVERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const data = await res.json();
    return data && data.ok
      ? { ok: true, folderUrl: data.folderUrl, calendarShared: !!data.calendar && !data.calendarError }
      : { ok: false, error: (data && data.error) || 'שגיאה לא ידועה' };
  } catch {
    // הבקשה אולי נשלחה בהצלחה גם אם הדפדפן חסם את קריאת התשובה - לא מכריזים כישלון ודאי.
    return { ok: true, unverified: true };
  }
}

/**
 * סיום והפקה בלחיצה אחת:
 *  - מוריד למורה את הגאנט (PDF).
 *  - שולח להתיישבותי: מתייק PDF+קלנדר בתיקיית בית הספר, יוצר/מעדכן יומן ומשתף
 *    אותו עם המורה (מופיע לבד בגוגל קלנדר, בלי ייבוא ידני), ושולח עותק לרכז/ת.
 * `element` = אלמנט הדף (במצב exporting) שממנו מפיקים את ה-PDF.
 */
export async function finalizePlan(plan: Plan, session: SessionLike, weekly: WeekSchedule[], element: HTMLElement, deviation?: DeviationInfo, className?: string): Promise<DeliverResult> {
  const stamp = icsDate(new Date()) + 'T000000Z';
  const grade = plan.grade === 7 ? 'ז' : plan.grade === 8 ? 'ח' : 'ט';
  const classLabel = (className ?? '').trim() ? ` ${(className ?? '').trim()}` : '';
  const icsContent = buildICS(plan, session, weekly, stamp);
  const events = planEvents(plan, weekly);
  const pdfBase64 = await generatePdfBase64(element);
  downloadBlob(base64ToBlob(pdfBase64, 'application/pdf'), `גאנט אישי - ${session.teacherName} - כיתה ${grade}${classLabel}.pdf`);
  return postDelivery(plan, session, pdfBase64, icsContent, events, deviation, className);
}

// ===== משוב ודיווח תקלות (הכפתור הצף) =====
// נשלח ל-Web App נפרד (apps-script/feedback.gs) שרץ בחשבון האישי של נופר
// (gergrood@gmail.com), לא בחשבון ההתיישבותי - הדיווחים נאספים בגיליון אצלה.
// כל עוד הכתובת ריקה - הכפתור לא מוצג באתר (יופעל ברגע שנופר תפרסם ותשלח URL).
export const FEEDBACK_URL =
  'https://script.google.com/macros/s/AKfycbyFb6fi_XepNoSMZyD_UcAUx7tSehc8G7hPb0kTK6Px745pP7A6gGpn6NYN_6ST8gX6/exec';

/** שולח משוב/דיווח תקלה. מחזיר הצלחה; בפיתוח בלי כתובת - מדמה הצלחה לבדיקת החוויה. */
export async function submitFeedback(payload: Record<string, unknown>): Promise<boolean> {
  if (!FEEDBACK_URL) return import.meta.env.DEV;
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const data = await res.json();
    return !!(data && data.ok);
  } catch {
    // כמו במסירה: הבקשה כנראה יצאה גם אם הדפדפן חסם את קריאת התשובה.
    return true;
  }
}

/** רשומת תוכנית מתויקת של מורה - לתצוגת הרכז/ת. */
export interface SchoolPlanFile {
  name: string;
  updated: string;
  url: string;
}

/** שולף לרכז/ת את רשימת התוכניות המתויקות של בית הספר (דרך סקריפט המסירה). */
export async function listSchoolPlans(semel: string): Promise<{ ok: boolean; school?: string; files?: SchoolPlanFile[]; error?: string }> {
  try {
    const res = await fetch(DELIVERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'listPlans', semel }),
      redirect: 'follow',
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'לא הצלחנו לקרוא את הנתונים. נסי שוב בעוד רגע.' };
  }
}
