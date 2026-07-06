// מנוע התכנון - דטרמיניסטי, בלי LLM.
// לוקח בנק תכנים + גאנט + קלט מורה, ומחשב תוכנית מתוארכת:
// פריסת נושאים על שבועות (מדלג על חופשות), שיבוץ משימות מודל, מסלול חקר, ודד-ליינים.

import type { BreadthTopic, GradeBank, ModelTask } from '../data';
import { banks, modelTasks as modelTasksByGrade, ganttWeeks, initiatives, officialHolidays } from '../data';
import type { Grade, GanttWeek } from '../data';

export interface EngineInput {
  grade: Grade;
  /** ש"ש בפועל (כולל שעת ה-+1 לחקר/מודל). ז'=5, ח'=6 כברירת מחדל. */
  weeklyHours: number;
  /** ימי משימות המודל בשבוע (לתצוגה). */
  modelTaskDays?: string[];
  /**
   * שמות נושאי רוחב שהמורה בחרה לצמצם במחסור שעות (מנגנון 8.2).
   * הנושאים האלה יורדים מהפריסה - הגאנט האישי נבנה בלעדיהם.
   */
  droppedTopics?: string[];
  /**
   * סדר הנושאים שהמורה קבעה (כיתה ט' - "בחרי וסדרי"). כשמסופק, הנושאים נפרסים
   * לפי הסדר הזה במקום סדר המפרט. נושאים שלא ברשימה נשמרים בסוף, בסדר המקורי.
   */
  topicOrder?: string[];
}

export interface ScheduledTopic {
  topic: BreadthTopic;
  startWeek: number;
  endWeek: number;
  startDate: Date;
  endDate: Date;
}

export interface Milestone {
  date: Date;
  label: string;
  kind: 'משימת מודל' | 'חקר' | 'מבחן' | 'יריד';
}

export interface Plan {
  grade: Grade;
  /** ש"ש מלאות בפועל (כולל שעת ה-+1). */
  weeklyHours: number;
  weeklyContentHours: number;
  scheduledTopics: ScheduledTopic[];
  /** משימות המודל עם תאריך משובץ. */
  modelTasks: { task: ModelTask; date: Date }[];
  /** מסלול החקר (חובה). */
  research: Milestone[];
  /** כל הדד-ליינים, ממוינים לפי תאריך. */
  deadlines: Milestone[];
  /** התראות. */
  alerts: string[];
  /** שעות התוכן שהמורה יכולה ללמד בפועל השנה (קיבולת = שעות-תוכן שבועיות × שבועות פעילים). */
  capacityHours: number;
  /** שעות התוכן של הנושאים שנכנסו לתוכנית (אחרי צמצום נושאים, אם נעשה). */
  plannedCoreHours: number;
  /** פער השעות: כמה שעות תוכן חסרות כדי ללמד את כל מה שנבחר. 0 = הכול נכנס. */
  shortfallHours: number;
}

/** תא חודש בלוח השנה החודשי (מסך התוצאה). כל הנתונים נגזרים מהמנוע + הגאנט הרשמי. */
export interface MonthCell {
  /** שם החודש בעברית. */
  month: string;
  /** שעות הוראה בחודש = ש"ש בפועל × מקדמי השבועות הפעילים. */
  hours: number;
  /** נושאי הלימוד הפעילים בחודש (לפי פריסת המנוע). */
  topics: string[];
  /** חגים ואירועים מהגאנט (שמות נקיים, בלי תאריכים, מנוקים מכפילויות). */
  holidays: string[];
  /** מבחנים בחודש. */
  exams: string[];
  /** משימות מודל משובצות בחודש. */
  modelTasks: string[];
  /** יוזמות STEM / תחרויות שנופלות בחודש. */
  initiatives: string[];
  /** אבני דרך של מסלול החקר בחודש. */
  research: string[];
  /** יוני - חודש הסיכום, מודגש בזהב. */
  isFinal: boolean;
}

/** משימת מודל בשורת טבלה - שם + סיווג. */
export interface TableModelTask {
  name: string;
  /** חובה / רשות, אם הוגדר במקור. */
  classification?: 'חובה' | 'רשות';
  type?: ModelTask['type'];
}

/** שורה בטבלת התוכנית המלאה (מסך התוצאה). */
export interface PlanTableRow {
  topic: string;
  hours: number;
  /** טווח החודשים שבהם נלמד הנושא, לדוגמה "אוקטובר - נובמבר". */
  months: string;
  classification: string;
  /** משימות המודל המשויכות לנושא תוכנית (לפי topicNames, לא לפי זמן). */
  modelTasks: TableModelTask[];
}

// --- עזרי תאריכים ---
function parseDate(token: string): Date | null {
  const t = token.trim();
  let m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2})/);
  if (m) return new Date(2000 + +m[3], +m[2] - 1, +m[1]);
  return null;
}
function weekStart(w: GanttWeek): Date | null {
  return parseDate(w.dates.split('-')[0]);
}
function weekEnd(w: GanttWeek): Date | null {
  const parts = w.dates.split('-');
  const end = parseDate(parts[1] ?? parts[0]);
  const start = weekStart(w);
  if (end && start && end.getFullYear() < start.getFullYear()) return start; // תיקון טעות מקור (2025)
  return end ?? start;
}
export function formatHe(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
/** תאריך מקומי בפורמט YYYY-MM-DD (בלי המרת UTC, כדי לא להזיז יום). */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** טווחי החופשות הרשמיים (משרד החינוך תשפ"ז), מפוענחים פעם אחת. */
const OFFICIAL_HOLIDAY_RANGES = officialHolidays
  .map((h) => ({ name: h.name, start: parseDate(h.start), end: parseDate(h.end) }))
  .filter((r): r is { name: string; start: Date; end: Date } => r.start != null && r.end != null);

/** שם החג הרשמי שחל בתאריך נתון, או null אם אין (בית הספר פתוח). */
function officialHolidayOn(date: Date): string | null {
  for (const r of OFFICIAL_HOLIDAY_RANGES) {
    if (date >= r.start && date <= r.end) return r.name;
  }
  return null;
}

/** מקדם הוראה לשבוע: 0 חופשה, 0.5 שבוע מקוצר, 1 שבוע מלא. */
function weekFactor(w: GanttWeek): number {
  const txt = (w.holidays ?? []).join(' ');
  if (/סוכות|פסח|חנוכה|יציאה לחופש/.test(txt)) return 0;
  if (/ראש השנה|כיפור|פורים|שבועות|עצמאות|חג הקורבן|גשר/.test(txt)) return 0.5;
  return 1;
}

const teachingWeeks = (): GanttWeek[] => ganttWeeks.filter((w) => w.week >= 1);

function weekByNumber(n: number): GanttWeek | undefined {
  return ganttWeeks.find((w) => w.week === n);
}

/** פריסת נושאי החובה על השבועות עם תאריכים. */
function scheduleTopics(bank: GradeBank, weeklyContent: number, dropped: Set<string>, topicOrder?: string[]): {
  scheduled: ScheduledTopic[];
  overflowHours: number;
  plannedHours: number;
  capacityHours: number;
} {
  const weeks = teachingWeeks();
  // נושאי התוכן שנכנסים לפריסה: כל הנושאים פחות אלה שהמורה בחרה לצמצם (מנגנון 8.2).
  let activeTopics = bank.topics.filter((t) => !dropped.has(t.name));
  // כיתה ט': סדר הנושאים לפי בחירת המורה (topicOrder). נושאים מחוץ לרשימה נשמרים בסוף.
  if (topicOrder && topicOrder.length) {
    const idx = new Map(topicOrder.map((n, i) => [n, i]));
    activeTopics = [...activeTopics].sort((a, b) => (idx.get(a.name) ?? 9999) - (idx.get(b.name) ?? 9999));
  }
  // קצב הוראה = סך שעות התוכן / סכום מקדמי השבועות. פורסים על *כל* שבועות השנה,
  // בלי מכסה - כך כל הנושאים נכנסים לתוכנית. במחסור שעות הקצב עולה מעל שעות המורה
  // (דחיסה פרופורציונלית: כל נושא מקבל פחות זמן), במקום להשמיט את הנושאים האחרונים.
  const totalHours = activeTopics.reduce((acc, t) => acc + t.hours, 0);
  const totalFactor = weeks.reduce((acc, w) => acc + weekFactor(w), 0);
  const pace = totalFactor > 0 ? totalHours / totalFactor : weeklyContent;
  // קיבולת ההוראה בפועל: שעות-תוכן שבועיות × סך מקדמי השבועות הפעילים.
  const capacityHours = weeklyContent * totalFactor;
  // קיבולת שעות לכל שבוע לפי הקצב (מדלג על חופשות דרך weekFactor)
  const cap = weeks.map((w) => ({ w, hours: pace * weekFactor(w) }));
  let wi = 0;
  let remainInWeek = cap[0]?.hours ?? 0;

  const scheduled: ScheduledTopic[] = [];
  let overflowHours = 0;

  for (const topic of activeTopics) {
    let need = topic.hours;
    let startW: GanttWeek | null = null;
    let endW: GanttWeek | null = null;

    while (need > 0) {
      // דלג על שבועות עם 0 קיבולת
      while (wi < cap.length && remainInWeek <= 0) {
        wi++;
        remainInWeek = cap[wi]?.hours ?? 0;
      }
      if (wi >= cap.length) {
        overflowHours += need;
        break;
      }
      if (!startW) startW = cap[wi].w;
      const take = Math.min(need, remainInWeek);
      need -= take;
      remainInWeek -= take;
      endW = cap[wi].w;
    }

    if (startW && endW) {
      scheduled.push({
        topic,
        startWeek: startW.week,
        endWeek: endW.week,
        startDate: weekStart(startW)!,
        endDate: weekEnd(endW)!,
      });
    }
  }
  return { scheduled, overflowHours, plannedHours: totalHours, capacityHours };
}

/**
 * שיבוץ משימות מודל - מפוזרות על שבועות הלימוד ולא נערמות בשבוע אחד.
 * לכל משימה קובעים טווח שבועות מתאים (לפי החודש הרשמי, או לפי הנושא המשויך),
 * ומשבצים אותה בשבוע הפחות-עמוס בטווח - כך מספר משימות באותו חודש/נושא מתפזרות.
 */
function scheduleModelTasks(
  tasks: ModelTask[],
  scheduled: ScheduledTopic[],
): { task: ModelTask; date: Date }[] {
  const teaching = teachingWeeks().filter((w) => weekFactor(w) > 0); // שבועות הוראה בפועל

  /** טווח שבועות היעד למשימה. עדיפות: הנושא המשויך (עוקב אחרי פריסת הנושאים) -> חודש -> מחרוזת. */
  function targetWeeks(task: ModelTask): GanttWeek[] {
    // 1. לפי הנושא המשויך (topicNames) - כך המשימה נופלת מתי שהנושא באמת נלמד.
    if (task.topicNames?.length) {
      const sts = scheduled.filter((s) => task.topicNames!.includes(s.topic.name));
      if (sts.length) {
        const start = Math.min(...sts.map((s) => s.startWeek));
        const end = Math.max(...sts.map((s) => s.endWeek));
        const inRange = teaching.filter((w) => w.week >= start && w.week <= end);
        if (inRange.length) return inRange;
      }
    }
    // 2. משימות חוצות-שנה (מיפוי/מפמ"ר/מבחן) - לפי החודש הרשמי.
    if (task.month) {
      const firstMonth = task.month.split('-')[0].trim();
      const inMonth = teaching.filter((w) => w.month === firstMonth);
      if (inMonth.length) return inMonth;
    }
    // 3. fallback: התאמת מחרוזת הנושא.
    const st = scheduled.find(
      (s) => task.topic.includes(s.topic.name) || s.topic.name.includes(task.topic.split(' ')[0]),
    );
    if (st) return teaching.filter((w) => w.week >= st.startWeek && w.week <= st.endWeek);
    return [];
  }

  const occupancy = new Map<number, number>();
  const out: { task: ModelTask; date: Date }[] = [];
  for (const task of tasks) {
    const weeks = targetWeeks(task);
    if (!weeks.length) continue;
    // השבוע הפחות-עמוס בטווח (שובר שוויון: המוקדם ביותר).
    let best = weeks[0];
    let bestCount = Infinity;
    for (const w of weeks) {
      const count = occupancy.get(w.week) ?? 0;
      if (count < bestCount) {
        bestCount = count;
        best = w;
      }
    }
    occupancy.set(best.week, (occupancy.get(best.week) ?? 0) + 1);
    const date = weekStart(best);
    if (date) out.push({ task, date });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * מסלול החקר - חובה. אבני דרך רשמיות מהגאנט המחוזי (xlsx מעודכן), בתאריכים מהמקור.
 * הסדר: הגשות -> יריד חקר מחוזי (16.3) -> שמתקדמים ממנו ליריד חקר ארצי (1.6).
 */
function researchTrack(): Milestone[] {
  const items: [string, string, Milestone['kind']][] = [
    ['18.1.27', 'הגשת נושא ושאלת חקר + בדיקת בטיחות', 'חקר'],
    ['1.2.27', 'הגשת טיוטה ופוסטרים להערות', 'חקר'],
    ['15.2.27', 'הגשת פוסטרים ליריד החקר', 'חקר'],
    ['16.3.27', 'יריד החקר המחוזי', 'יריד'],
    ['2.5.27', 'מועד אחרון להגשת עבודות לכנס הארצי', 'חקר'],
    ['1.6.27', 'יריד החקר הארצי', 'יריד'],
  ];
  const out: Milestone[] = [];
  for (const [d, label, kind] of items) {
    const date = parseDate(d);
    if (date) out.push({ date, label, kind });
  }
  return out;
}

export function buildPlan(input: EngineInput): Plan {
  const bank = banks[input.grade];
  const weeklyContent = Math.max(1, input.weeklyHours - 1); // שעת ה-+1 לחקר/מודל
  const dropped = new Set(input.droppedTopics ?? []);
  const { scheduled, overflowHours, plannedHours, capacityHours } = scheduleTopics(bank, weeklyContent, dropped, input.topicOrder);
  const mtasks = scheduleModelTasks(modelTasksByGrade[input.grade], scheduled);
  const research = researchTrack();

  // מבחן מפמ"ר (16.5)
  const mapmar: Milestone = { date: new Date(2027, 4, 16), label: 'מבחן מפמ"ר פנימי', kind: 'מבחן' };

  const deadlines: Milestone[] = [
    ...mtasks.map((m) => ({ date: m.date, label: `משימת מודל: ${m.task.name}`, kind: 'משימת מודל' as const })),
    ...research,
    mapmar,
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  // הפער = כמה שעות תוכן חסרות מול הקיבולת בפועל. כשחיובי, התוכנית נדחסת
  // (כל הנושאים נכנסים אך צפופים). מוצג בפאנל החי (מנגנון 8.2). overflowHours נשאר 0
  // כי הקצב אינו מוגבל - שומרים אותו רק כבדיקת שפיות.
  void overflowHours;
  const shortfallHours = Math.max(0, Math.round(plannedHours - capacityHours));

  return {
    grade: input.grade,
    weeklyHours: input.weeklyHours,
    weeklyContentHours: weeklyContent,
    scheduledTopics: scheduled,
    modelTasks: mtasks,
    research,
    deadlines,
    alerts: [],
    capacityHours: Math.round(capacityHours),
    plannedCoreHours: Math.round(plannedHours),
    shortfallHours,
  };
}

// ===== מסך התוצאה: לוח השנה החודשי + הטבלה המלאה =====

const HE_MONTHS_ORDER = ['ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני'];

/** סדר החודשים בפועל לפי הגאנט (ספטמבר עד יוני), בלי כפילויות. */
function monthOrder(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of teachingWeeks()) {
    if (!seen.has(w.month)) {
      seen.add(w.month);
      out.push(w.month);
    }
  }
  // מיון לפי הסדר הלוחי הידוע (ליתר ביטחון), עם שמירה על מה שקיים בגאנט.
  return out.sort((a, b) => HE_MONTHS_ORDER.indexOf(a) - HE_MONTHS_ORDER.indexOf(b));
}

/** מנקה שם אירוע מקידומת תאריך - משאיר מהאות העברית הראשונה והלאה. */
function cleanEventName(s: string): string {
  const m = s.match(/[֐-׿].*$/);
  return (m ? m[0] : s).trim();
}

/** מאתר את חודש הגאנט שמכיל תאריך נתון. */
function monthOfDate(d: Date): string {
  for (const w of teachingWeeks()) {
    const s = weekStart(w);
    const e = weekEnd(w);
    if (s && e && d >= s && d <= e) return w.month;
  }
  const after = teachingWeeks().find((w) => {
    const s = weekStart(w);
    return s != null && s >= d;
  });
  return after?.month ?? '';
}

/** בונה את לוח השנה החודשי: כל חודש עם שעות, נושאים, חגים, מבחנים, ומשימות מודל. */
export function buildMonthlyCalendar(plan: Plan): MonthCell[] {
  const months = monthOrder();

  // שעות הוראה לכל חודש = ש"ש בפועל × סך מקדמי השבועות בחודש.
  const hoursByMonth = new Map<string, number>();
  for (const w of teachingWeeks()) {
    hoursByMonth.set(w.month, (hoursByMonth.get(w.month) ?? 0) + plan.weeklyHours * weekFactor(w));
  }

  // נושאים פעילים בכל חודש - לפי השבועות שעליהם נפרש כל נושא.
  const topicsByMonth = new Map<string, string[]>();
  for (const st of plan.scheduledTopics) {
    const monthsHit = new Set<string>();
    for (let wn = st.startWeek; wn <= st.endWeek; wn++) {
      const w = weekByNumber(wn);
      if (w) monthsHit.add(w.month);
    }
    for (const m of monthsHit) {
      if (!topicsByMonth.has(m)) topicsByMonth.set(m, []);
      const list = topicsByMonth.get(m)!;
      if (!list.includes(st.topic.name)) list.push(st.topic.name);
    }
  }

  // חגים ואירועים לכל חודש - מנוקים ומנוקי-כפילויות.
  const holidaysByMonth = new Map<string, string[]>();
  for (const w of teachingWeeks()) {
    for (const h of w.holidays ?? []) {
      const name = cleanEventName(h);
      if (!name) continue;
      if (!holidaysByMonth.has(w.month)) holidaysByMonth.set(w.month, []);
      const list = holidaysByMonth.get(w.month)!;
      if (!list.includes(name)) list.push(name);
    }
  }

  // מבחנים, משימות מודל, וחקר - לפי החודש שבו נופל התאריך.
  const examsByMonth = new Map<string, string[]>();
  for (const m of plan.deadlines.filter((d) => d.kind === 'מבחן')) {
    const mon = monthOfDate(m.date);
    if (!examsByMonth.has(mon)) examsByMonth.set(mon, []);
    examsByMonth.get(mon)!.push(m.label);
  }
  const tasksByMonth = new Map<string, string[]>();
  for (const { task, date } of plan.modelTasks) {
    const mon = monthOfDate(date);
    if (!tasksByMonth.has(mon)) tasksByMonth.set(mon, []);
    tasksByMonth.get(mon)!.push(task.name);
  }
  const researchByMonth = new Map<string, string[]>();
  for (const r of plan.research) {
    const mon = monthOfDate(r.date);
    if (!researchByMonth.has(mon)) researchByMonth.set(mon, []);
    researchByMonth.get(mon)!.push(r.label);
  }
  // יוזמות STEM / תחרויות - לפי החודש שבו נופל התאריך.
  const initiativesByMonth = new Map<string, string[]>();
  for (const ini of initiatives) {
    const d = parseDate(ini.date);
    if (!d) continue;
    const mon = monthOfDate(d);
    if (!initiativesByMonth.has(mon)) initiativesByMonth.set(mon, []);
    initiativesByMonth.get(mon)!.push(ini.name);
  }

  return months.map((month) => ({
    month,
    hours: Math.round(hoursByMonth.get(month) ?? 0),
    topics: topicsByMonth.get(month) ?? [],
    holidays: holidaysByMonth.get(month) ?? [],
    exams: examsByMonth.get(month) ?? [],
    modelTasks: tasksByMonth.get(month) ?? [],
    initiatives: initiativesByMonth.get(month) ?? [],
    research: researchByMonth.get(month) ?? [],
    isFinal: month === 'יוני',
  }));
}

// ===== הפריסה השבועית - הלב של תומכת ההוראה =====
// לכל שבוע לימוד: מה ללמד, ואילו משימות מודל / אירועים / יוזמות / חקר נופלים בו.

/** תא שבוע בפריסה השבועית. */
export interface WeekCell {
  week: number;
  month: string;
  /** טווח תאריכים קצר, לדוגמה "8.11 - 12.11". */
  dateLabel: string;
  /** 0 = חופשה, 0.5 = שבוע מקוצר, 1 = שבוע מלא. */
  factor: number;
  /** שעות הוראה בשבוע = ש"ש × מקדם השבוע. */
  hours: number;
  /** נושאי הלימוד הפעילים בשבוע (מה ללמד). */
  topics: string[];
  holidays: string[];
  modelTasks: string[];
  initiatives: string[];
  research: string[];
  exams: string[];
}

const uniq = (arr: string[]): string[] => Array.from(new Set(arr));

/** יום-בשבוע (0=ראשון .. 5=שישי) לכל אות יום עברית - למיפוי חג ליום ההוראה. */
const DAY_DOW: Record<string, number> = { 'א׳': 0, 'ב׳': 1, 'ג׳': 2, 'ד׳': 3, 'ה׳': 4, 'ו׳': 5 };

/** בונה את הפריסה השבועית: שורה לכל שבוע לימוד, עם התוכן והאירועים משובצים. */
export function buildWeeklyPlan(plan: Plan): WeekCell[] {
  return teachingWeeks().map((w) => {
    const s = weekStart(w);
    const e = weekEnd(w);
    const inWeek = (d: Date) => (s && e ? d >= s && d <= e : false);

    const topics = plan.scheduledTopics
      .filter((st) => st.startWeek <= w.week && w.week <= st.endWeek)
      .map((st) => st.topic.name);
    const modelTasks = plan.modelTasks.filter((m) => inWeek(m.date)).map((m) => m.task.name);
    const research = plan.research.filter((m) => inWeek(m.date)).map((m) => m.label);
    const exams = plan.deadlines.filter((m) => m.kind === 'מבחן' && inWeek(m.date)).map((m) => m.label);
    const inits = initiatives
      .map((ini) => ({ ini, d: parseDate(ini.date) }))
      .filter((x) => x.d != null && inWeek(x.d as Date))
      .map((x) => x.ini.name);
    const holidays = uniq((w.holidays ?? []).map(cleanEventName).filter(Boolean));

    const factor = weekFactor(w);
    return {
      week: w.week,
      month: w.month,
      dateLabel: s && e ? `${formatHe(s)} - ${formatHe(e)}` : w.dates,
      factor,
      hours: Math.round(plan.weeklyHours * factor),
      topics: uniq(topics),
      holidays,
      modelTasks: uniq(modelTasks),
      initiatives: uniq(inits),
      research: uniq(research),
      exams: uniq(exams),
    };
  });
}

// ===== פריסה שבועית אישית - לפי שעות ההוראה בפועל של המורה =====
// המורה מזינה מתי היא מלמדת (למשל ב' 2ש', ג' 1ש', ה' 2ש'), והמערכת ממלאת
// כל שיעור ושיעור: מתי מלמדים איזה נושא, ומתי עושים משימת מודל/חקר/מבחן.

/** משבצת הוראה של המורה: יום + מספר שעות. */
export interface TeacherSlot {
  day: string; // "א׳".."ו׳"
  hours: number;
}

/** שיבוץ למשבצת בשבוע ספציפי. */
export interface SlotAssignment {
  day: string;
  hours: number;
  /** מה קורה בשיעור: שם הנושא / שם משימת המודל / אבן דרך חקר / מבחן / חג / אירוע בית ספרי (אין שיעור). */
  label: string;
  kind: 'נושא' | 'משימת מודל' | 'חקר' | 'מבחן' | 'חג' | 'אירוע';
  /** השיעור נערך ידנית על ידי המורה (טקסט מותאם אישית). */
  overridden?: boolean;
  /** למשימת מודל: סוג (לומדה/הערכה מסכמת...), פירוט, והאם אירוע הערכה. */
  taskType?: string;
  detail?: string;
  isAssessment?: boolean;
  /** לשיעור נושא: כל הנושאים שנלמדים בשיעור זה (כדי שאף נושא לא ייעלם מהגאנט). */
  topicList?: string[];
  /** תתי-נושא רשמיים (הרחבה/רשות מהמפרט) של הנושאים בשיעור זה. */
  subItems?: { name: string; level: string }[];
  /** התאריך המדויק של השיעור (ISO) - לשיבוץ בקלנדר. */
  dateISO?: string;
}

/** יוזמה/תחרות בשבוע, עם מילות מפתח לזיהוי רישום מול הסטטוס. */
export interface WeekInitiative {
  name: string;
  scope?: 'מחוזי' | 'ארצי';
  keywords: string[];
}

/** שבוע בפריסה האישית. */
export interface WeekSchedule {
  week: number;
  month: string;
  dateLabel: string;
  factor: number;
  vacation: boolean;
  holidays: string[];
  initiatives: WeekInitiative[];
  /** ימים מדעיים בינלאומיים שנופלים בשבוע (מהגאנט) - מוצגים כהצעות עוגן לנושא. */
  scienceDays: string[];
  /** משבצות ההוראה של המורה בשבוע זה, מלאות בתוכן. */
  slots: SlotAssignment[];
}

/** אירוע בית ספרי שהמורה הוסיפה (טיול, שבוע מבחנים, יום שיא) - היום לא מקבל תוכן לימוד. */
export interface CustomEvent {
  /** תאריך ISO מקומי: YYYY-MM-DD. */
  date: string;
  name: string;
}

/**
 * בונה את הפריסה השבועית האישית: לכל שבוע לימוד, ממלא את משבצות ההוראה של המורה
 * בתוכן - נושאי הלימוד לפי סדר המפרט, ומשימות המודל/חקר/מבחנים בשיעורים המתאימים.
 * `customEvents` - אירועי בית ספר שהמורה הוסיפה; שיעור שנופל עליהם מסומן ולא משובץ.
 */
export function buildWeeklySchedule(plan: Plan, teacherSlots: TeacherSlot[], customEvents?: CustomEvent[]): WeekSchedule[] {
  const slots = teacherSlots.filter((s) => s.hours > 0);
  const eventByDate = new Map<string, string>((customEvents ?? []).map((ev) => [ev.date, ev.name]));
  return teachingWeeks().map((w) => {
    const s = weekStart(w);
    const e = weekEnd(w);
    const inWeek = (d: Date) => (s && e ? d >= s && d <= e : false);
    const factor = weekFactor(w);
    const holidays = uniq((w.holidays ?? []).map(cleanEventName).filter(Boolean));
    const inits: WeekInitiative[] = initiatives
      .map((ini) => ({ ini, d: parseDate(ini.date) }))
      .filter((x) => x.d != null && inWeek(x.d as Date))
      .map((x) => ({ name: x.ini.name, scope: x.ini.scope, keywords: x.ini.keywords ?? [] }));
    const sciDays = uniq((w.scienceDays ?? []).map(cleanEventName).filter(Boolean));
    const base = {
      week: w.week,
      month: w.month,
      dateLabel: s && e ? `${formatHe(s)} - ${formatHe(e)}` : w.dates,
      factor,
      holidays,
      initiatives: inits,
      scienceDays: sciDays,
    };
    if (factor === 0) return { ...base, vacation: true, slots: [] };

    // הנושאים הפעילים בשבוע, לפי סדר המפרט (פריסת scheduleTopics).
    const activeST = plan.scheduledTopics.filter((st) => st.startWeek <= w.week && w.week <= st.endWeek);
    const topics = activeST.map((st) => st.topic.name);
    // מיפוי נושא -> תתי-הנושא הרשמיים (הרחבה/רשות) שלו, לתצוגה בגאנט.
    const optByTopic = new Map<string, { name: string; level: string }[]>(
      activeST.map((st) => [st.topic.name, (st.topic.optional ?? []).map((o) => ({ name: o.name, level: o.level }))]),
    );

    // "אירועי שיעור" שתופסים שיעור בשבוע: משימות מודל, אבני דרך חקר, מבחנים.
    type Special = { label: string; kind: SlotAssignment['kind']; taskType?: string; detail?: string; isAssessment?: boolean };
    const specials: Special[] = [];
    for (const m of plan.modelTasks.filter((m) => inWeek(m.date)))
      specials.push({ label: m.task.name, kind: 'משימת מודל', taskType: m.task.type, detail: m.task.detail, isAssessment: m.task.isAssessment });
    for (const r of plan.research.filter((m) => inWeek(m.date))) specials.push({ label: r.label, kind: 'חקר' });
    for (const x of plan.deadlines.filter((m) => m.kind === 'מבחן' && inWeek(m.date))) specials.push({ label: x.label, kind: 'מבחן' });

    // התאריך של יום הוראה בשבוע = ההיסט מיום תחילת השבוע ליום-בשבוע המבוקש (0=ראשון).
    // בשבוע חלקי (שמתחיל/מסתיים באמצע) יום שאינו נופל בטווח השבוע -> null (אין שיעור).
    const slotDate = (day: string): Date | null => {
      if (!s) return null;
      const dow = DAY_DOW[day];
      if (dow == null) return null;
      const date = addDays(s, (dow - s.getDay() + 7) % 7);
      return e && date > e ? null : date;
    };
    // חג שנופל על יום ההוראה - מול רשימת החופשות הרשמית של משרד החינוך.
    const holidayOnDay = (day: string): string | null => {
      const date = slotDate(day);
      return date ? officialHolidayOn(date) : null;
    };

    const slotList: SlotAssignment[] = slots.map((sl) => {
      const sd = slotDate(sl.day);
      const dateISO = sd ? isoDay(sd) : undefined;
      const hol = holidayOnDay(sl.day);
      if (hol) return { day: sl.day, hours: sl.hours, label: hol, kind: 'חג' as const, dateISO };
      // אירוע בית ספרי שהמורה הוסיפה (טיול/שבוע מבחנים) - השיעור מסומן ולא משובץ בו תוכן.
      const customEv = dateISO ? eventByDate.get(dateISO) : undefined;
      if (customEv) return { day: sl.day, hours: sl.hours, label: customEv, kind: 'אירוע' as const, dateISO };
      return { day: sl.day, hours: sl.hours, label: '', kind: 'נושא' as const, dateISO };
    });

    // רק השיעורים שלא נפלו עליהם חג או אירוע בית ספרי מקבלים תוכן/משימות.
    const activeIdx = slotList.map((sl, i) => (sl.kind === 'חג' || sl.kind === 'אירוע' ? -1 : i)).filter((i) => i >= 0);
    const specialCount = Math.min(specials.length, activeIdx.length);
    const teachingSlots = Math.max(0, activeIdx.length - specialCount);

    // שיעורי התוכן: מחלקים את *כל* הנושאים הפעילים על השיעורים הפנויים, בלי לדלג
    // על אף נושא (כל נושא חייב להופיע בגאנט). כל שיעור מקבל מקטע רציף של נושאים.
    for (let i = 0; i < teachingSlots; i++) {
      const slot = slotList[activeIdx[i]];
      slot.kind = 'נושא';
      const start = Math.floor((i * topics.length) / teachingSlots);
      const end = Math.floor(((i + 1) * topics.length) / teachingSlots);
      let chunk = topics.slice(start, end);
      // אם לשיעור לא נפל נושא (יותר שיעורים מנושאים) - ממשיכים את הנושא של השיעור הקודם.
      if (chunk.length === 0 && topics.length) chunk = [topics[Math.min(topics.length - 1, i)]];
      slot.topicList = chunk;
      slot.label = chunk.length ? chunk.join(' · ') : '-';
      slot.subItems = chunk.flatMap((name) => optByTopic.get(name) ?? []);
    }
    // שיעורי המודל/חקר/מבחן: תופסים את השיעורים הפנויים האחרונים בשבוע.
    for (let j = 0; j < specialCount; j++) {
      const slot = slotList[activeIdx[teachingSlots + j]];
      const sp = specials[j];
      slot.label = sp.label;
      slot.kind = sp.kind;
      slot.taskType = sp.taskType;
      slot.detail = sp.detail;
      slot.isAssessment = sp.isAssessment;
    }
    return { ...base, vacation: false, slots: slotList };
  });
}

/** בונה את טבלת התוכנית המלאה: שורה לכל נושא רוחב. */
export function buildPlanTable(plan: Plan): PlanTableRow[] {
  const allTasks = modelTasksByGrade[plan.grade];
  return plan.scheduledTopics.map((st) => {
    const startMonth = monthOfDate(st.startDate);
    const endMonth = monthOfDate(st.endDate);
    const months = startMonth === endMonth ? startMonth : `${startMonth} - ${endMonth}`;

    // משימות מודל המשויכות לנושא לפי השיוך התוכני (topicNames), לא לפי זמן.
    const modelTasks: TableModelTask[] = allTasks
      .filter((t) => t.topicNames?.includes(st.topic.name))
      .map((t) => ({ name: t.name, classification: t.classification, type: t.type }));

    return {
      topic: st.topic.name,
      hours: st.topic.hours,
      months,
      classification: st.topic.classification ?? 'חובה',
      modelTasks,
    };
  });
}

/** משימות מודל חוצות-שנה שאינן משויכות לנושא יחיד (מיפוי, מפמ"ר, מבחן מסכם). */
export function crossYearModelTasks(plan: Plan): TableModelTask[] {
  return modelTasksByGrade[plan.grade]
    .filter((t) => !t.topicNames || t.topicNames.length === 0)
    .map((t) => ({ name: t.name, classification: t.classification, type: t.type }));
}
