import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchLiveGantt, setLiveGantt, fetchSchool, banks, topicsByDomain, modelTasks, coreSubtopics, type SchoolStatus } from './data';
import type { Grade } from './data';
import { buildPlan, buildMonthlyCalendar, buildWeeklySchedule, type Plan, type WeekSchedule, type TeacherSlot, type CustomEvent } from './engine/plan';
import { finalizePlan, listSchoolPlans, submitFeedback, FEEDBACK_URL, type SchoolPlanFile } from './export';

interface Session {
  teacherName: string;
  teacherEmail: string;
  /** מספר הנייד של המורה (למשל 050-1234567) - לסיוע בתקלות; זורם לטופס המשוב. */
  teacherPhone?: string;
  school: SchoolStatus;
}

// כניסת דיבאג מהירה למסך הפתיחה (לשימוש נופר בזמן פיתוח).
// מופיע רק בהרצה מקומית (localhost) - בבנייה לאתר החי הכפתור נעלם אוטומטית.
const DEBUG_ENTRY = import.meta.env.DEV;

/** סשן דמו לכניסת דיבאג - בית ספר לדוגמה, בלי אימות. */
function debugSession(): Session {
  return {
    teacherName: 'נופר גרגרוד',
    teacherEmail: 'gergrood@gmail.com',
    school: { semel: 'DB', schoolName: 'בית ספר לדוגמה', coordinatorName: 'נופר גרגרוד', coordinatorEmail: 'gergrood@gmail.com', hoursByGrade: { 7: 5, 8: 6 } },
  };
}

// ===== שמירת מצב מקומית - המורה חוזרת בדיוק לאיפה שעצרה, גם אחרי רענון או סגירה =====
const STORAGE_KEY = 'tomehet-horaa-state-v1';
interface SavedState {
  session: Session;
  grade: Grade;
  scheduleByGrade: Partial<Record<Grade, Record<string, number>>>;
  appliedByGrade: Partial<Record<Grade, string[]>>;
  /** שם הכיתה (למשל ז'1) לכל שכבה - לכותרות ה-PDF והיומן. */
  classByGrade?: Partial<Record<Grade, string>>;
  /** אירועי בית ספר שהמורה הוסיפה (טיול, שבוע מבחנים) - לכל בית הספר. */
  customEvents?: CustomEvent[];
  /** שיעורים שהמורה ערכה ידנית: תאריך ISO -> הטקסט שלה, לכל שכבה. */
  overridesByGrade?: Partial<Record<Grade, Record<string, string>>>;
  /** סדר הנושאים שהמורה קבעה (כיתה ט' - "בחרי וסדרי"), לכל שכבה. */
  topicOrderByGrade?: Partial<Record<Grade, string[]>>;
  /** השלב בשאלון (1 פרטי בית הספר, 2 מערכת שעות, 3 התוכנית). */
  step?: number;
  /** מצב פר-כיתה: מערכת שעות, צמצומים ועריכות של כל כיתה בנפרד. מפתח: "שכבה|כיתה". */
  byClass?: Record<string, { schedule?: Record<string, number>; applied?: string[]; overrides?: Record<string, string> }>;
}
function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedState;
    return s && s.session && s.session.school && s.session.school.semel ? s : null;
  } catch {
    return null;
  }
}
function writeSavedState(s: SavedState | null): void {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* אחסון חסום בדפדפן - ממשיכים בלי שמירה */
  }
}

// ===== היסטוריית טופס הכניסה - השלמות תוך כדי הקלדה, כמו השלמת אימייל בדפדפן =====
// נשמר מקומית בדפדפן של המורה בלבד; מוצג כרשימת הצעות (datalist) מתחת לכל שדה.
const LOGIN_HISTORY_KEY = 'tomehet-login-history-v1';
interface LoginHistory { names: string[]; emails: string[]; semels: string[]; rakaz: string[]; phones: string[] }
function loadLoginHistory(): LoginHistory {
  try {
    const h = JSON.parse(localStorage.getItem(LOGIN_HISTORY_KEY) || '{}') as Partial<LoginHistory>;
    return { names: h.names ?? [], emails: h.emails ?? [], semels: h.semels ?? [], rakaz: h.rakaz ?? [], phones: h.phones ?? [] };
  } catch {
    return { names: [], emails: [], semels: [], rakaz: [], phones: [] };
  }
}
function rememberLogin(entry: { name?: string; email?: string; semel?: string; rakaz?: string; phone?: string }): void {
  try {
    const h = loadLoginHistory();
    const push = (list: string[], v?: string) =>
      v && v.trim() ? [v.trim(), ...list.filter((x) => x !== v.trim())].slice(0, 8) : list;
    localStorage.setItem(LOGIN_HISTORY_KEY, JSON.stringify({
      names: push(h.names, entry.name),
      emails: push(h.emails, entry.email),
      semels: push(h.semels, entry.semel),
      rakaz: push(h.rakaz, entry.rakaz),
      phones: push(h.phones, entry.phone),
    }));
  } catch {
    /* אחסון חסום בדפדפן - בלי היסטוריה */
  }
}

const GRADE_LABEL: Record<Grade, string> = { 7: 'כיתה ז׳', 8: 'כיתה ח׳', 9: 'כיתה ט׳' };
const GRADE_LETTER: Record<Grade, string> = { 7: 'ז', 8: 'ח', 9: 'ט' };
const GRADES: Grade[] = [7, 8, 9];
const WEEK_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];
/** ברירת מחדל לשעות ההוראה בשבוע (כשאין ש"ש בסטטוס). */
const DEFAULT_SCHEDULE: Record<string, number> = { 'ב׳': 2, 'ג׳': 1, 'ה׳': 2 };

/** מחלק סך ש"ש (מהסטטוס) לחלוקת ימים סבירה - המורה יכולה לשנות. */
function scheduleFromHours(total?: number): Record<string, number> {
  if (!total || total <= 0) return { ...DEFAULT_SCHEDULE };
  const out: Record<string, number> = {};
  let rem = total;
  for (const d of ['ב׳', 'ד׳', 'ה׳', 'ג׳', 'א׳']) {
    if (rem <= 0) break;
    out[d] = Math.min(2, rem);
    rem -= out[d];
  }
  return out;
}
const KIND_CLASS: Record<WeekSchedule['slots'][number]['kind'], string> = {
  'נושא': 'topic', 'משימת מודל': 'task', 'חקר': 'research', 'מבחן': 'exam', 'חג': 'holiday', 'אירוע': 'schoolevent', 'תחרויות': 'stemcomp',
};

/* ---------- אייקונים (inline SVG, לפי ה-handoff) ---------- */
const IconDownload = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3M7 10l5 5 5-5" />
    <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
  </svg>
);
const IconAlert = ({ color }: { color: string }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2">
    <path d="M12 9v4M12 16.5v.5" strokeLinecap="round" />
    <path d="M10.3 3.6 2.5 17.5a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
  </svg>
);
const IconCheck = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2f8a5f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13l4 4L19 7" />
  </svg>
);

/* ---------- כותרת מותג ---------- */
function Brand({ onHome }: { onHome?: () => void }) {
  return (
    <div className="brand">
      <button
        type="button"
        className={`brand-home ${onHome ? 'clickable' : ''}`}
        onClick={onHome}
        disabled={!onHome}
        title={onHome ? 'חזרה למסך הראשי' : undefined}
      >
        <img className="brand-logo" src="/favicon.png" alt="תומכת הוראה אישית" />
        <span className="bname">תומכת הוראה אישית</span>
      </button>
      <div className="bsep" />
      <img src="/logo-misrad.png" alt="משרד החינוך" />
      <img src="/logo-mada.png" alt="מדע וטכנולוגיה" />
    </div>
  );
}

/* ---------- כותרת מסך התוצאה ---------- */
function Header({ grade, onGrade, session, onFinalize, working, onLogout, showFinalize, onHome, onEditHours }: {
  grade: Grade; onGrade: (g: Grade) => void; session: Session; onFinalize: () => void; working: boolean;
  onLogout: () => void; showFinalize: boolean; onHome: () => void; onEditHours: () => void;
}) {
  return (
    <div className="hd">
      <Brand onHome={onHome} />
      <div className="hd-actions">
        <span className="hd-meta">{session.teacherName} · {session.school.schoolName}</span>
        <button className="hd-hours" onClick={onEditHours} title="עדכון ימים ושעות ההוראה">עדכון שעות</button>
        <button className="hd-logout" onClick={onLogout} title="יציאה והחלפת פרטים">יציאה</button>
        <div className="grade-toggle">
          {GRADES.map((g) => (
            <button key={g} className={`gt ${g === grade ? 'active' : ''}`} onClick={() => onGrade(g)}>
              {GRADE_LABEL[g]}
            </button>
          ))}
        </div>
        {showFinalize && (
          <button className="btn btn-pr" style={{ padding: '13px 26px', fontSize: 14 }} onClick={onFinalize} disabled={working}>
            {working ? 'מפיקה...' : <><IconDownload />הורידי PDF וקבלי גוגל קלנדר</>}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- מסך הבית: קישוט אטום + אייקוני הכרטיסים ---------- */
/** אטום דקורטיבי (מסלולים + אלקטרונים) - מסתובב לאט ברקע ה-Hero. */
const AtomDecor = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 200 200" fill="none" aria-hidden="true">
    <g className="atom-orbits">
      <ellipse cx="100" cy="100" rx="88" ry="32" stroke="currentColor" strokeWidth="1.3" />
      <ellipse cx="100" cy="100" rx="88" ry="32" transform="rotate(60 100 100)" stroke="currentColor" strokeWidth="1.3" />
      <ellipse cx="100" cy="100" rx="88" ry="32" transform="rotate(120 100 100)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="100" cy="100" r="7" fill="currentColor" />
      <circle cx="188" cy="100" r="4.5" fill="currentColor" />
      <circle cx="57" cy="29" r="4.5" fill="currentColor" />
      <circle cx="57" cy="171" r="4.5" fill="currentColor" />
    </g>
  </svg>
);

/** אייקוני שלושת הכרטיסים במסך הבית. */
const IconFeatSchedule = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    <circle cx="12" cy="15" r="3.4" />
    <path d="M12 13.4V15l1.2 1" />
  </svg>
);
const IconFeatBell = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 9a6 6 0 0 0-12 0c0 5.5-2.2 7-2.2 7h16.4S18 14.5 18 9z" />
    <path d="M10.2 19.5a2 2 0 0 0 3.6 0" />
  </svg>
);
const IconFeatSend = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 3 10.5 13.5" />
    <path d="M21 3l-6.8 18-3.7-7.5L3 9.8 21 3z" />
  </svg>
);

/** שלושת הכרטיסים - מה המערכת נותנת. */
const HOME_FEATURES: { icon: () => ReactNode; title: string; text: string }[] = [
  {
    icon: IconFeatSchedule,
    title: 'פריסה אישית לפי השעות שלך',
    text: 'מזינה מתי את מלמדת - ומקבלת כל שבוע מחולק לשיעורים שלך, עם נושא, משימת מודל, חקר ומבחן במקום הנכון.',
  },
  {
    icon: IconFeatBell,
    title: 'תזכורות ברגע הנכון',
    text: 'המערכת מזכירה לך מראש את מה שחשוב: הכנה לתחרויות ה-STEM, הגשות החקר והמועדים המחוזיים - בגאנט וביומן.',
  },
  {
    icon: IconFeatSend,
    title: 'מוכן בלחיצה אחת',
    text: 'גאנט PDF אישי, יומן Google שמתעדכן לבד, ועותק לרכזת - הכל נשלח בלחיצה.',
  },
];

/* ---------- הצצה לתוצר בעמוד הבית ---------- */
// תמונה אמיתית אחת של התוצר (public/showcase) - מראה למורה איך נראית
// התוכנית שהיא מקבלת, עוד לפני שהיא מתחילה.
function Showcase() {
  return (
    <section className="showcase">
      <div className="sc-head">
        <h2 className="sc-title">כך תיראה התוכנית שתקבלי</h2>
        <p className="sc-sub">פריסה שבועית מלאה - נושא בכל שיעור, לפי המפרט הרשמי של משרד החינוך.</p>
      </div>
      <div className="sc-single">
        <img src="/showcase/gantt-grade7.jpg" alt="דוגמה לתוכנית עבודה שנתית - כיתה ז" loading="lazy" />
      </div>
    </section>
  );
}

/* ---------- מסך פתיחה + הזדהות ---------- */
/** בדיקת תקינות בסיסית לכתובת אימייל - טעות הקלדה במייל מפילה את היומן והמיילים. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** קישור הסטטוס שהרכז/ת ממלאים - מוצג כשבית הספר עוד לא מופיע במערכת. */
const STATUS_FORM_URL = 'https://nofarg8.github.io/STATUS-MADATECH/';

function LoginScreen({ onEnter, onCoord }: { onEnter: (s: Session) => void; onCoord: () => void }) {
  // היסטוריית כניסות קודמות מהדפדפן הזה - ממלאת מראש ומציעה השלמות בהקלדה.
  const hist = useMemo(loadLoginHistory, []);
  const [name, setName] = useState(hist.names[0] ?? '');
  const [email, setEmail] = useState(hist.emails[0] ?? '');
  const [semel, setSemel] = useState(hist.semels[0] ?? '');
  const [rakazEmail, setRakazEmail] = useState(hist.rakaz[0] ?? '');
  // נייד מפוצל: קידומת (למשל 050) + שאר המספר. משוחזר מהכניסה הקודמת.
  const [phonePrefix, setPhonePrefix] = useState((hist.phones[0] ?? '').split('-')[0] ?? '');
  const [phoneRest, setPhoneRest] = useState((hist.phones[0] ?? '').split('-')[1] ?? '');
  const [error, setError] = useState<ReactNode>('');
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<SchoolStatus | null>(null);
  // כפתור ה-Hero "בואו נתחיל" גולל אל טופס ההזדהות.
  const formRef = useRef<HTMLDivElement>(null);
  // סמל שמולא מראש מההיסטוריה - מציגים את שם בית הספר מיד (כמו בהקלדה).
  useEffect(() => {
    const digits = (hist.semels[0] ?? '').replace(/\D/g, '');
    if (digits.length >= 5) fetchSchool(digits).then(setFound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // שליפת פרטי בית הספר לפי סמל מוסד בזמן הקלדה (תצוגה מקדימה).
  const onSemel = (v: string) => {
    setSemel(v);
    setError('');
    const digits = v.replace(/\D/g, '');
    if (digits.length >= 5) fetchSchool(v).then(setFound);
    else setFound(null);
  };

  // כניסת דיבאג: מתחברת לסטטוס האמיתי של נופר (סמל 999999), בלי אימות.
  const enterDebug = async () => {
    const school = await fetchSchool('999999');
    if (school) onEnter({ teacherName: school.coordinatorName || 'נופר גרגרוד', teacherEmail: school.coordinatorEmail, school });
    else onEnter(debugSession()); // fallback אם הסטטוס לא נגיש
  };

  const submit = async () => {
    if (checking) return;
    // כניסת דיבאג: סמל מוסד "DB" עוקף את בדיקת הסטטוס (לבדיקות בלבד).
    if (semel.trim().toUpperCase() === 'DB') {
      await enterDebug();
      return;
    }
    if (!name.trim() || !email.trim() || !semel.trim() || !rakazEmail.trim() || !phonePrefix.trim() || !phoneRest.trim()) {
      setError('יש למלא את כל השדות.');
      return;
    }
    // בדיקת תקינות המיילים לפני הכול - טעות הקלדה כאן תפיל את היומן והמיילים בהמשך.
    if (!EMAIL_RE.test(email.trim())) {
      setError('כתובת האימייל שלך לא נראית תקינה - בדקי אותה שוב (למשל: name@gmail.com). לכתובת הזו יישלחו התוכנית והיומן שלך.');
      return;
    }
    if (!/^05\d$/.test(phonePrefix.trim()) || !/^\d{7}$/.test(phoneRest.trim())) {
      setError('מספר הנייד לא נראה תקין - קידומת של 3 ספרות (למשל 050) ואחריה 7 ספרות.');
      return;
    }
    if (!EMAIL_RE.test(rakazEmail.trim())) {
      setError('אימייל הרכז/ת לא נראה תקין - בדקי אותו שוב.');
      return;
    }
    const teacherPhone = `${phonePrefix.trim()}-${phoneRest.trim()}`;
    setChecking(true);
    let school: SchoolStatus | null = null;
    try {
      school = await fetchSchool(semel);
    } finally {
      setChecking(false);
    }
    if (!school) {
      setError(
        <span>
          בית הספר שלך עדיין לא מופיע במערכת. אנא בקשו מהרכז/ת למלא את הסטטוס:{' '}
          <a className="err-link" href={STATUS_FORM_URL} target="_blank" rel="noopener noreferrer">
            לינק לסטטוס מו"ט תשפ"ז
          </a>
          {' '}ברגע שהסטטוס ימולא - תוכלי להיכנס ולבנות את התוכנית שלך.
        </span>,
      );
      return;
    }
    if (!school.coordinatorEmail.trim()) {
      setError(
        <span>
          בפרטי בית הספר שלך חסר אימייל של הרכז/ת. בקשו מהרכז/ת למלא את סטטוס תשפ"ז:{' '}
          <a className="err-link" href={STATUS_FORM_URL} target="_blank" rel="noopener noreferrer">לינק לסטטוס מו"ט תשפ"ז</a>
        </span>,
      );
      return;
    }
    if (school.coordinatorEmail.trim().toLowerCase() !== rakazEmail.trim().toLowerCase()) {
      setError(
        <span>
          אימייל הרכז/ת שהזנת אינו תואם את פרטי בית הספר - בדקי את הכתובת מול הרכז/ת שלך.
          אם פרטי הרכז/ת השתנו, בקשו מהרכז/ת לעדכן את סטטוס תשפ"ז:{' '}
          <a className="err-link" href={STATUS_FORM_URL} target="_blank" rel="noopener noreferrer">לינק לסטטוס מו"ט תשפ"ז</a>
        </span>,
      );
      return;
    }
    // כניסה מוצלחת - נשמרת להשלמות בכניסה הבאה (בדפדפן הזה בלבד).
    rememberLogin({ name, email, semel, rakaz: rakazEmail, phone: teacherPhone });
    onEnter({ teacherName: name.trim(), teacherEmail: email.trim(), teacherPhone, school });
  };

  return (
    <div className="login-page" dir="rtl">
      <div className="hd"><Brand /></div>

      {/* ===== Hero - מה המערכת עושה, במבט אחד ===== */}
      <section className="home-hero">
        <AtomDecor className="hero-atom hero-atom-a" />
        <AtomDecor className="hero-atom hero-atom-b" />
        <h1 className="hero-title">
          תוכנית העבודה השנתית שלך במדע וטכנולוגיה
          <span className="hero-title-accent">מוכנה בכמה דקות</span>
        </h1>
        <p className="hero-tag">
          מזינה את שעות ההוראה שלך, והמערכת בונה פריסה שבועית אישית ומתוארכת - שיעור אחר שיעור,
          לפי המפרט הרשמי של משרד החינוך.
        </p>
        <button
          type="button"
          className="btn btn-pr hero-cta"
          onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          בואו נתחיל
        </button>

        {/* שלושת הכרטיסים - מה מקבלים */}
        <div className="home-feats">
          {HOME_FEATURES.map((f) => (
            <div key={f.title} className="feat">
              <div className="feat-ic">{f.icon()}</div>
              <div className="feat-title">{f.title}</div>
              <p className="feat-text">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== גלריית תוצרים - מה המורה מקבלת בפועל ===== */}
      <Showcase />

      <div className="login-body" ref={formRef}>
        <div className="login-card">
          <h2>כמה פרטים ונתחיל</h2>
          <p className="login-sub">נשתמש בהם כדי לשלוף את פרטי בית הספר שלך ולבנות תוכנית אישית.</p>

          {/* טופס אמיתי: Enter שולח, והדפדפן + רשימות ההיסטוריה מציעים השלמות בהקלדה. */}
          <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="field">
              <label className="flab">שם מלא</label>
              <input className="inp" name="teacher-name" autoComplete="name" list="hist-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם פרטי ושם משפחה" />
              <datalist id="hist-names">{hist.names.map((v) => <option key={v} value={v} />)}</datalist>
            </div>

            <div className="field">
              <label className="flab">אימייל</label>
              <input className="inp" type="email" name="teacher-email" autoComplete="email" list="hist-emails" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" />
              <datalist id="hist-emails">{hist.emails.map((v) => <option key={v} value={v} />)}</datalist>
            </div>

            <div className="field">
              <label className="flab">נייד</label>
              {/* המספר נכתב משמאל לימין כמקובל: קידומת ואז שאר המספר */}
              <div className="phone-row" dir="ltr">
                <input
                  className="inp phone-prefix" name="phone-prefix" inputMode="numeric" autoComplete="tel-country-code"
                  maxLength={3} value={phonePrefix} placeholder="050"
                  onChange={(e) => setPhonePrefix(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
                <span className="phone-dash">-</span>
                <input
                  className="inp phone-rest" name="phone-rest" inputMode="numeric" autoComplete="tel-national"
                  maxLength={7} value={phoneRest} placeholder="1234567"
                  onChange={(e) => setPhoneRest(e.target.value.replace(/\D/g, '').slice(0, 7))}
                />
              </div>
            </div>

            <div className="field">
              <label className="flab">סמל מוסד</label>
              <input className="inp" name="school-semel" inputMode="numeric" autoComplete="on" list="hist-semels" value={semel} onChange={(e) => onSemel(e.target.value)} placeholder="סמל בית הספר" />
              <datalist id="hist-semels">{hist.semels.map((v) => <option key={v} value={v} />)}</datalist>
              {found && (
                <div className="found-row">
                  <IconCheck />
                  <span>{found.schoolName}</span>
                  <span className="found-note">פרטי בית הספר נמצאו</span>
                </div>
              )}
            </div>

            <div className="field">
              <label className="flab">אימייל הרכז/ת</label>
              <input className="inp" type="email" name="coordinator-email" autoComplete="email" list="hist-rakaz" value={rakazEmail} onChange={(e) => setRakazEmail(e.target.value)} placeholder="אימייל הרכז/ת" />
              <datalist id="hist-rakaz">{hist.rakaz.map((v) => <option key={v} value={v} />)}</datalist>
            </div>

            {error && <div className="login-err"><IconAlert color="#c2603f" />{error}</div>}

            <button type="submit" className="btn btn-pr login-btn" disabled={checking}>
              {checking ? 'בודקת את פרטי בית הספר...' : 'המשך'}
            </button>
          </form>

          {/* כניסת רכזת - כרטיס מובחן, כדי שהרכזות ישימו לב שיש להן מסך משלהן */}
          <button className="coord-cta" onClick={onCoord}>
            <span className="cc-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <span className="cc-text">
              <span className="cc-title">רכזת מדע וטכנולוגיה?</span>
              <span className="cc-sub">כל תוכניות העבודה של הצוות שלך - במקום אחד</span>
            </span>
            <span className="cc-arrow" aria-hidden="true">‹</span>
          </button>

          {DEBUG_ENTRY && (
            <button className="debug-enter" onClick={enterDebug}>
              כניסת דיבאג - מחוברת לסטטוס שלי (יוסר לפני פרסום)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- תצוגת רכז/ת: כל התוכניות של צוות בית הספר ---------- */
function CoordinatorScreen({ onBack }: { onBack: () => void }) {
  // היסטוריית כניסות קודמות - מילוי מראש והשלמות, כמו במסך המורה.
  const hist = useMemo(loadLoginHistory, []);
  const [email, setEmail] = useState(hist.rakaz[0] ?? '');
  const [semel, setSemel] = useState(hist.semels[0] ?? '');
  const [error, setError] = useState<ReactNode>('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ school: string; files: SchoolPlanFile[] } | null>(null);
  // סינון לפי שם מורה - כשיש הרבה מורות בבית הספר.
  const [filter, setFilter] = useState('');

  const enter = async () => {
    if (loading) return;
    setError('');
    if (!semel.trim() || !email.trim()) {
      setError('יש למלא אימייל וסמל מוסד.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('כתובת האימייל לא נראית תקינה - בדקי אותה שוב.');
      return;
    }
    setLoading(true);
    try {
      const school = await fetchSchool(semel);
      if (!school) {
        setError(
          <span>
            בית הספר עדיין לא מופיע במערכת. מלאי את הסטטוס:{' '}
            <a className="err-link" href={STATUS_FORM_URL} target="_blank" rel="noopener noreferrer">לינק לסטטוס מו"ט תשפ"ז</a>
          </span>,
        );
        return;
      }
      if (school.coordinatorEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
        setError(
          <span>
            האימייל אינו תואם את אימייל הרכז/ת שבפרטי בית הספר. אם הפרטים השתנו - עדכני את סטטוס תשפ"ז:{' '}
            <a className="err-link" href={STATUS_FORM_URL} target="_blank" rel="noopener noreferrer">לינק לסטטוס מו"ט תשפ"ז</a>
          </span>,
        );
        return;
      }
      const r = await listSchoolPlans(semel);
      if (!r.ok) {
        setError(r.error || 'לא הצלחנו לקרוא את התוכניות. נסי שוב.');
        return;
      }
      // כניסה מוצלחת - נשמרת להשלמות בכניסה הבאה (בדפדפן הזה בלבד).
      rememberLogin({ semel, rakaz: email });
      setData({ school: school.schoolName, files: r.files ?? [] });
    } finally {
      setLoading(false);
    }
  };

  // ארגון הקבצים לתצוגה מסודרת: מורה -> כיתה -> גאנט PDF + גאנט יומן.
  // שם הקובץ: "שם המורה - כיתה ז (ז'3) - גאנט אישי.pdf" / "... - קלנדר.ics"
  // (קבצים ישנים בלי כיתה: "שם המורה - גאנט אישי.pdf").
  interface ClassPlans { pdf?: SchoolPlanFile; ics?: SchoolPlanFile; updated: string }
  const byTeacher = new Map<string, Map<string, ClassPlans>>();
  for (const f of data?.files ?? []) {
    const base = f.name.replace(/\.(pdf|ics)$/i, '');
    const parts = base.split(' - ').map((s) => s.trim()).filter(Boolean);
    const teacher = parts[0] || base;
    const klass = parts.length >= 3 ? parts.slice(1, -1).join(' - ') : '';
    const classes = byTeacher.get(teacher) ?? new Map<string, ClassPlans>();
    const entry = classes.get(klass) ?? { updated: f.updated };
    if (/\.pdf$/i.test(f.name)) entry.pdf = f; else entry.ics = f;
    // תאריך העדכון של השורה = הקובץ שעודכן אחרון.
    if (f.updated > entry.updated) entry.updated = f.updated;
    classes.set(klass, entry);
    byTeacher.set(teacher, classes);
  }
  const teachers = [...byTeacher.entries()]
    .map(([teacher, classes]) => ({
      teacher,
      classes: [...classes.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')),
    }))
    .sort((a, b) => a.teacher.localeCompare(b.teacher, 'he'));
  const shown = filter.trim()
    ? teachers.filter((t) => t.teacher.includes(filter.trim()))
    : teachers;

  return (
    <div className="login-page" dir="rtl">
      <div className="hd"><Brand /></div>
      <div className="login-body">
        <div className={`login-card ${data ? 'wide' : ''}`}>
          {!data ? (
            <>
              <h2>כניסת רכז/ת</h2>
              <p className="login-sub">צפייה בכל תוכניות העבודה שמורות הצוות שלך הפיקו - במקום אחד.</p>
              <form onSubmit={(e) => { e.preventDefault(); enter(); }}>
                <div className="field">
                  <label className="flab">אימייל הרכז/ת (כפי שמופיע בפרטי בית הספר)</label>
                  <input className="inp" type="email" name="coordinator-email" autoComplete="email" list="hist-coord-emails" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" />
                  <datalist id="hist-coord-emails">{hist.rakaz.map((v) => <option key={v} value={v} />)}</datalist>
                </div>
                <div className="field">
                  <label className="flab">סמל מוסד</label>
                  <input className="inp" name="school-semel" inputMode="numeric" autoComplete="on" list="hist-coord-semels" value={semel} onChange={(e) => setSemel(e.target.value)} placeholder="סמל בית הספר" />
                  <datalist id="hist-coord-semels">{hist.semels.map((v) => <option key={v} value={v} />)}</datalist>
                </div>
                {error && <div className="login-err"><IconAlert color="#c2603f" />{error}</div>}
                <button type="submit" className="btn btn-pr login-btn" disabled={loading}>
                  {loading ? 'בודקת...' : 'כניסה'}
                </button>
              </form>
              <button className="coord-link" onClick={onBack}>חזרה לכניסת מורה</button>
            </>
          ) : (
            <>
              <h2>התוכניות של {data.school}</h2>
              {teachers.length === 0 ? (
                <p className="login-sub">עדיין לא הופקו תוכניות בבית הספר שלך. ברגע שמורה תפיק תוכנית - היא תופיע כאן.</p>
              ) : (
                <>
                  <p className="login-sub">{teachers.length === 1 ? 'מורה אחת הפיקה תוכניות' : `${teachers.length} מורות הפיקו תוכניות`} - לכל כיתה: גאנט PDF וגאנט יומן.</p>
                  {teachers.length > 4 && (
                    <input
                      className="inp coord-filter"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="חיפוש לפי שם מורה"
                    />
                  )}
                  <div className="coord-list">
                    {shown.map(({ teacher, classes }) => (
                      <div key={teacher} className="coord-teacher">
                        <div className="ct-name">{teacher}</div>
                        <div className="ct-classes">
                          {classes.map(([klass, plans]) => (
                            <div key={klass || 'כללי'} className="ct-class">
                              <span className="ct-klass">{klass || 'תוכנית'}</span>
                              <span className="ct-links">
                                {plans.pdf && (
                                  <a className="ct-file" href={plans.pdf.url} target="_blank" rel="noopener noreferrer">גאנט PDF</a>
                                )}
                                {plans.ics && (
                                  <a className="ct-file" href={plans.ics.url} target="_blank" rel="noopener noreferrer">גאנט יומן</a>
                                )}
                              </span>
                              <span className="ct-date">עודכן {plans.updated}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {shown.length === 0 && <p className="login-sub">אין מורה בשם הזה.</p>}
                  </div>
                </>
              )}
              <button className="coord-link" onClick={() => { setData(null); setFilter(''); }}>בדיקת בית ספר אחר</button>
              <button className="coord-link" onClick={onBack}>חזרה לכניסת מורה</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- כפתור משוב ודיווח תקלות (צף, בסגנון הלוגו) ---------- */
// נשלח לחשבון האישי של נופר (apps-script/feedback.gs). מוצג רק כשיש כתובת פעילה.
const FEEDBACK_ENABLED = !!FEEDBACK_URL || import.meta.env.DEV;

/** שאלה בטופס המשוב/תקלות. */
interface FbQuestion {
  id: string;
  label: string;
  kind: 'scale' | 'choice' | 'text' | 'longtext';
  options?: string[];
  /** תווית לקצוות הסולם, למשל "1 = קשה מאוד, 5 = קל מאוד". */
  hint?: string;
  optional?: boolean;
  /** מוצגת רק כשתשובה אחרת שונה מ"כן" (למשל פירוט אי-התאמה). */
  onlyIfNotYes?: string;
}

/** השאלות הכלליות - מופיעות תמיד, בשני המסלולים. */
const FB_GENERAL: FbQuestion[] = [
  { id: 'name', label: 'שם מלא', kind: 'text' },
  { id: 'school', label: 'שם בית הספר', kind: 'text' },
  { id: 'role', label: 'תפקיד', kind: 'choice', options: ['רכזת מדע וטכנולוגיה', 'מורה מקצועית', 'אחר'] },
  { id: 'email', label: 'האימייל שאיתו נכנסת לתומכת ההוראה', kind: 'text' },
  { id: 'phone', label: 'מספר נייד', kind: 'text' },
];

/** שאלות המשוב, מקובצות. הכול חובה מלבד "הערות נוספות". */
const FB_FEEDBACK: { group: string; items: FbQuestion[] }[] = [
  {
    group: 'חוויית השימוש',
    items: [
      { id: 'easeOfUse', label: 'עד כמה היה קל להבין ולהשתמש במערכת?', kind: 'scale', hint: '1 = קשה מאוד, 5 = קל מאוד' },
      { id: 'personalFit', label: 'עד כמה תוכנית העבודה שקיבלת מרגישה מותאמת אישית לשעות ולכיתות שלך?', kind: 'scale', hint: '1 = כלל לא, 5 = מאוד' },
      { id: 'timeSaved', label: 'כמה זמן המערכת חסכה לך, בהשוואה לבניית תוכנית עבודה בעצמך?', kind: 'choice', options: ['לא חסכה', 'עד שעה', 'כמה שעות', 'יום שלם ומעלה'] },
      { id: 'mostUseful', label: 'מה הדבר הכי שימושי במערכת עבורך?', kind: 'longtext' },
      { id: 'mostConfusing', label: 'מה היה הכי מבלבל או לא ברור?', kind: 'longtext' },
    ],
  },
  {
    group: 'תוכן ודיוק',
    items: [
      { id: 'matchesReality', label: 'האם הנושאים, השעות והתאריכים שקיבלת תואמים את המציאות בכיתה שלך?', kind: 'choice', options: ['כן', 'לא לגמרי', 'לא'] },
      { id: 'mismatchDetail', label: 'מה לא תאם?', kind: 'longtext', onlyIfNotYes: 'matchesReality' },
      { id: 'scientificIssue', label: 'האם היה משהו בתוכנית שהרגיש שגוי מבחינה מדעית או מבחינת תוכנית הלימודים?', kind: 'longtext' },
    ],
  },
  {
    group: 'המסירה (PDF, יומן, מייל)',
    items: [
      { id: 'deliveryOk', label: 'האם קיבלת את קובץ ה-PDF והיומן המשותף בהצלחה?', kind: 'choice', options: ['כן', 'לא', 'לא ניסיתי'] },
      { id: 'emailClarity', label: 'עד כמה המייל שקיבלת היה ברור ומספק?', kind: 'scale', hint: '1 = בכלל לא, 5 = מאוד' },
    ],
  },
  {
    group: 'לסיום',
    items: [
      { id: 'wouldChange', label: 'מה היית משנה או מוסיפה במערכת?', kind: 'longtext' },
      { id: 'recommend', label: 'האם תמליצי על המערכת לרכזת או למורה אחרת?', kind: 'scale', hint: '1 = לא אמליץ, 5 = בהחלט אמליץ' },
      { id: 'notes', label: 'הערות נוספות (לא חובה)', kind: 'longtext', optional: true },
    ],
  },
];

/** שאלות דיווח התקלה - קצר וממוקד. */
const FB_BUG: { group: string; items: FbQuestion[] }[] = [
  {
    group: 'מה קרה',
    items: [
      { id: 'bugDescription', label: 'תארי מה קרה ובאיזה שלב (מה לחצת, מה ציפית שיקרה, ומה קרה בפועל)', kind: 'longtext' },
      { id: 'device', label: 'באיזה מכשיר השתמשת?', kind: 'choice', options: ['מחשב', 'נייד', 'טאבלט'] },
      { id: 'browser', label: 'באיזה דפדפן?', kind: 'choice', options: ['כרום', 'ספארי', 'אחר'] },
    ],
  },
];

function FeedbackWidget({ session }: { session: Session | null }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'type' | 'details' | 'questions' | 'done'>('type');
  const [fbType, setFbType] = useState<'משוב' | 'דיווח תקלה' | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const set = (id: string, v: string) => setVals((s) => ({ ...s, [id]: v }));

  // פתיחה: מילוי מראש ממה שכבר ידוע (לא שואלים מה שיש) + איפוס אחרי שליחה קודמת.
  const openWidget = () => {
    if (step === 'done') { setStep('type'); setFbType(null); setVals({}); setTried(false); setError(''); }
    setVals((v) => ({
      ...v,
      name: v.name || session?.teacherName || '',
      email: v.email || session?.teacherEmail || '',
      school: v.school || session?.school.schoolName || '',
      phone: v.phone || session?.teacherPhone || '',
    }));
    setOpen(true);
  };
  // Escape סוגר.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!FEEDBACK_ENABLED) return null;

  const groups = fbType === 'משוב' ? FB_FEEDBACK : FB_BUG;
  const visible = (q: FbQuestion) => !q.onlyIfNotYes || (vals[q.onlyIfNotYes] && vals[q.onlyIfNotYes] !== 'כן');
  const missing = (q: FbQuestion) => !q.optional && visible(q) && !(vals[q.id] ?? '').trim();
  const detailsOk = FB_GENERAL.every((q) => !missing(q));
  const questionsOk = groups.every((g) => g.items.every((q) => !missing(q)));

  const send = async () => {
    setTried(true);
    if (!questionsOk) return;
    setSending(true);
    setError('');
    try {
      const answers: Record<string, string> = {};
      for (const g of groups) for (const q of g.items) if (visible(q)) answers[q.label] = vals[q.id] ?? '';
      const ok = await submitFeedback({
        action: 'feedback',
        type: fbType,
        name: vals.name, school: vals.school, role: vals.role, email: vals.email, phone: vals.phone,
        semel: session?.school.semel ?? '',
        answers,
        userAgent: navigator.userAgent,
      });
      if (ok) setStep('done');
      else setError('השליחה נכשלה - נסי שוב בעוד רגע.');
    } finally {
      setSending(false);
    }
  };

  const field = (q: FbQuestion) => {
    if (!visible(q)) return null;
    const invalid = tried && missing(q);
    // "לסיוע בתקלות" מוצג רק במסלול דיווח תקלה - במשוב זה סתם מספר נייד.
    const label = q.id === 'phone' && fbType === 'דיווח תקלה' ? 'מספר נייד (לסיוע בתקלות)' : q.label;
    return (
      <div key={q.id} className={`fb-q ${invalid ? 'invalid' : ''}`}>
        <label className="flab">{label}</label>
        {q.hint && <span className="fb-hint">{q.hint}</span>}
        {q.kind === 'scale' && (
          <div className="fb-chips">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`fb-chip ${vals[q.id] === String(n) ? 'on' : ''}`} onClick={() => set(q.id, String(n))}>{n}</button>
            ))}
          </div>
        )}
        {q.kind === 'choice' && (
          <div className="fb-chips">
            {(q.options ?? []).map((o) => (
              <button key={o} type="button" className={`fb-chip wide ${vals[q.id] === o ? 'on' : ''}`} onClick={() => set(q.id, o)}>{o}</button>
            ))}
          </div>
        )}
        {q.kind === 'text' && <input className="inp" value={vals[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} />}
        {q.kind === 'longtext' && <textarea className="inp fb-ta" value={vals[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} rows={3} />}
        {invalid && <span className="fb-missing">נשאר למלא את זה</span>}
      </div>
    );
  };

  return (
    <>
      <button type="button" className="fb-fab" onClick={openWidget} aria-label="משוב ודיווח תקלות" title="משוב ודיווח תקלות">
        <img src="/favicon.png" alt="" />
        <span className="fb-fab-label">משוב ותקלות</span>
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => !sending && setOpen(false)}>
          <div className="modal fb-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fb-close" onClick={() => setOpen(false)} aria-label="סגירה">×</button>

            {step === 'type' && (
              <>
                <h3 className="modal-h">נשמח לשמוע ממך</h3>
                <p className="modal-p">מה תרצי לעשות?</p>
                <div className="fb-types">
                  <button type="button" className="fb-type" onClick={() => { setFbType('דיווח תקלה'); setStep('details'); }}>
                    <span className="fb-type-icon">🛠️</span>
                    <span className="fb-type-name">דיווח על תקלה</span>
                    <span className="fb-type-sub">משהו לא עובד כמו שצריך</span>
                  </button>
                  <button type="button" className="fb-type" onClick={() => { setFbType('משוב'); setStep('details'); }}>
                    <span className="fb-type-icon">💚</span>
                    <span className="fb-type-name">משוב על המערכת</span>
                    <span className="fb-type-sub">ספרי לנו איך היה לך</span>
                  </button>
                </div>
              </>
            )}

            {step === 'details' && (
              <>
                <h3 className="modal-h">{fbType === 'משוב' ? 'משוב על המערכת' : 'דיווח על תקלה'}</h3>
                <p className="modal-p">כמה פרטים עלייך, כדי שנדע עם מי אנחנו מדברות:</p>
                <div className="fb-qs">{FB_GENERAL.map(field)}</div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-pr" onClick={() => { setTried(true); if (detailsOk) { setStep('questions'); setTried(false); } }}>המשך</button>
                  <button type="button" className="modal-ghost" onClick={() => { setStep('type'); setTried(false); }}>חזרה</button>
                </div>
              </>
            )}

            {step === 'questions' && (
              <>
                <h3 className="modal-h">{fbType === 'משוב' ? 'המשוב שלך' : 'פרטי התקלה'}</h3>
                <div className="fb-qs">
                  {groups.map((g) => (
                    <div key={g.group} className="fb-group">
                      {groups.length > 1 && <div className="fb-group-name">{g.group}</div>}
                      {g.items.map(field)}
                    </div>
                  ))}
                </div>
                {error && <div className="login-err"><IconAlert color="#c2603f" />{error}</div>}
                <div className="modal-actions">
                  <button type="button" className="btn btn-pr" onClick={send} disabled={sending}>
                    {sending ? 'שולחת...' : 'שליחה'}
                  </button>
                  <button type="button" className="modal-ghost" onClick={() => { setStep('details'); setTried(false); }}>חזרה</button>
                </div>
              </>
            )}

            {step === 'done' && (
              <>
                <div className="modal-badge ok"><IconCheck /></div>
                <h3 className="modal-h">תודה רבה!</h3>
                <p className="modal-p">
                  {fbType === 'משוב'
                    ? 'המשוב שלך התקבל ועוזר לנו לשפר את המערכת עבור כולן.'
                    : 'הדיווח התקבל. אם נצטרך פרטים נוספים - ניצור איתך קשר.'}
                </p>
                <button type="button" className="btn btn-pr modal-close" onClick={() => setOpen(false)}>סגירה</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- מקרא (לפי השכבה: חקר רק בט', משימות מודל רק בז'/ח') ---------- */
function legendFor(grade: Grade): { color: string; label: string }[] {
  return [
    { color: '#1c4e5e', label: 'נושא לימוד' },
    { color: '#c2603f', label: 'חג / אירוע' },
    { color: '#e0992f', label: 'מבחן' },
    ...(grade !== 9 ? [{ color: '#6b5aa6', label: 'משימת מודל' }] : []),
    { color: '#3066a6', label: 'יוזמת STEM' },
    ...(grade === 9 ? [{ color: '#2f8a5f', label: 'חקר' }] : []),
  ];
}

/* ---------- כרטיס חודש ---------- */
// כרטיס חודש - סקירה קומפקטית בלבד (מה לומדים החודש + שעות).
// האירועים/משימות/יוזמות מופיעים בפירוט בפריסה השבועית למטה, לא כאן.
function MonthCard({ cell }: { cell: ReturnType<typeof buildMonthlyCalendar>[number] }) {
  return (
    <div className="mcard">
      <div className="mbar">
        <span className="mname">{cell.month}</span>
        <span className="mhours">{cell.hours} ש'</span>
      </div>
      <div className="mbody-c">
        {cell.topics.length > 0 ? cell.topics.join(' · ') : '-'}
      </div>
    </div>
  );
}

/* ---------- פרטי בית הספר (מהסטטוס - לא נשאלים מהמורה) ---------- */
function SchoolInfo({ school, grade }: { school: SchoolStatus; grade: Grade }) {
  const facts: { label: string; value: string }[] = [];
  const h = school.hoursByGrade?.[grade];
  if (h) facts.push({ label: `שעות שבועיות (${GRADE_LABEL[grade]})`, value: `${h} ש"ש` });
  if (school.hasLab !== undefined) facts.push({ label: 'מעבדת מדעים', value: school.hasLab ? 'יש' : 'אין' });
  // יריד החקר שייך לכיתה ט' בלבד - לא מציגים אותו כשבונים תוכנית לז'/ח'.
  if (grade === 9 && school.schoolFair !== undefined) facts.push({ label: 'יריד חקר בית ספרי', value: school.schoolFair ? 'משתתפים' : 'לא' });
  if (!facts.length) return null;
  return (
    <div className="school-info">
      <div className="si-title">פרטי בית הספר שלך</div>
      <div className="si-facts">
        {facts.map((f) => (
          <div key={f.label} className="si-fact">
            <span className="si-label">{f.label}</span>
            <span className="si-value">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- עורך מערכת השעות של המורה ---------- */
function ScheduleEditor({ schedule, onChange, targetHours }: {
  schedule: Record<string, number>; onChange: (day: string, hours: number) => void; targetHours?: number;
}) {
  const total = WEEK_DAYS.reduce((a, d) => a + (schedule[d] || 0), 0);
  const mismatch = targetHours != null && total !== targetHours;
  return (
    <div className="sched">
      <div className="sched-title">
        מערכת השעות שלך - כמה שעות בכל יום?
        {targetHours != null
          ? <span className="sched-hint"> (לפי בית הספר: {targetHours} ש"ש - חלקי אותן לימים שלך)</span>
          : <span className="sched-hint"> (כך נבנית הפריסה האישית)</span>}
      </div>
      <div className="sched-days">
        {WEEK_DAYS.map((d) => (
          <label key={d} className={`sched-day ${schedule[d] ? 'on' : ''}`}>
            <span className="sd-name">{d}</span>
            <input
              type="number" min={0} max={5} value={schedule[d] || 0}
              onChange={(e) => onChange(d, Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
            />
            <span className="sd-unit">ש'</span>
          </label>
        ))}
        <span className="sched-total">סה"כ {total} ש"ש</span>
        {mismatch && (
          <span className="sched-mismatch">לא תואם ל-{targetHours} ש"ש שבבית הספר</span>
        )}
      </div>
    </div>
  );
}

/* ---------- שורת שבוע (פריסה לפי השיעורים של המורה) ---------- */
/** האם בית הספר ציין את היוזמה בטקסט הסטטוס - אז "מזכירים", אחרת "הצעה". */
function isRegistered(keywords: string[], school: SchoolStatus): boolean {
  const txt = (school.initiatives ?? '').toLowerCase();
  if (!txt) return false;
  return keywords.some((k) => txt.includes(k.toLowerCase()));
}

function WeekRow({ week, expandAll, school, onOverride }: {
  week: WeekSchedule; expandAll: boolean; school: SchoolStatus;
  onOverride?: (dateISO: string, text: string | null) => void;
}) {
  const short = week.factor === 0.5;
  // עריכה ידנית של שיעור: איזה שיעור בעריכה כרגע + הטקסט.
  const [editSlot, setEditSlot] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  // אילו שיעורים פתחו את תתי-הנושא (ברירת מחדל: מצומצם).
  const [openSubs, setOpenSubs] = useState<Set<number>>(new Set());
  const toggleSubs = (i: number) =>
    setOpenSubs((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  // סנכרון לכפתור הגלובלי "הרחיבי/סגרי את כל תתי-הנושאים".
  useEffect(() => {
    setOpenSubs(
      expandAll
        ? new Set(week.slots.map((sl, i) => (sl.subItems && sl.subItems.length ? i : -1)).filter((i) => i >= 0))
        : new Set(),
    );
  }, [expandAll, week.slots]);
  // עימוד PDF: שבוע "קצר" (מעט תתי-נושא) נשמר שלם בין עמודים - זה מצמצם את נקודות
  // ההחלטה של מנוע העימוד של html2pdf ומונע חיתוכים. שבוע גבוה (עלול לחרוג מעמוד)
  // נשאר בעימוד ברמת השיעור הבודד.
  const totalSubs = week.slots.reduce((a, sl) => a + (sl.subItems?.length ?? 0), 0);
  const pdfAvoid = week.vacation || totalSubs <= 14;
  return (
    <div className={`week-row ${week.vacation ? 'vacation' : ''} ${pdfAvoid ? 'pdf-avoid' : ''}`}>
      <div className="wk-meta">
        <span className="wk-num">שבוע {week.week}</span>
        <span className="wk-dates">{week.dateLabel}</span>
        {short && !week.vacation && <span className="wk-tag-short">שבוע מקוצר</span>}
      </div>
      <div className="wk-body">
        {week.vacation ? (
          <div className="wk-vac">חופשה{week.holidays.length > 0 && ` · ${week.holidays.join(' · ')}`}</div>
        ) : (
          <>
            <div className="slots">
              {week.slots.map((sl, i) => (
                <div key={i} className={`slot ${KIND_CLASS[sl.kind]}`}>
                  <span className="slot-day">{sl.day} · {sl.hours} ש'</span>
                  <div className="slot-main">
                    {sl.kind === 'חג' || sl.kind === 'אירוע' ? (
                      <span className="slot-label">
                        <span className="slot-kind">{sl.kind === 'חג' ? 'חג: ' : 'אירוע בית ספרי: '}</span>{sl.label}
                        <span className="slot-noclass">אין שיעור</span>
                      </span>
                    ) : (
                      <span className="slot-label">
                        {sl.kind !== 'נושא' && <span className="slot-kind">{sl.kind}: </span>}
                        {sl.label}
                        {sl.taskType && <span className="slot-tasktype">{sl.taskType}</span>}
                        {sl.isAssessment && <span className="slot-assess">אירוע הערכה</span>}
                        {sl.overridden && <span className="slot-owned">שונה ידנית</span>}
                      </span>
                    )}
                    {sl.detail && <span className="slot-detail">{sl.detail}</span>}
                    {/* עריכה ידנית: רק בשיעורי נושא (משימות המודל, החקר והמבחנים רשמיים ולא נערכים). */}
                    {sl.kind === 'נושא' && sl.dateISO && onOverride && (
                      editSlot === i ? (
                        <span className="slot-editrow">
                          <input
                            className="inp slot-editinp"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            placeholder="מה יילמד בשיעור הזה"
                          />
                          <button className="se-save" onClick={() => { onOverride(sl.dateISO!, editText); setEditSlot(null); }}>שמרי</button>
                          <button className="se-cancel" onClick={() => setEditSlot(null)}>ביטול</button>
                        </span>
                      ) : (
                        <span className="slot-editrow">
                          <button className="slot-editbtn" onClick={() => { setEditSlot(i); setEditText(sl.overridden ? sl.label : ''); }}>
                            {sl.overridden ? 'ערכי שוב' : 'ערכי שיעור'}
                          </button>
                          {sl.overridden && (
                            <button className="slot-editbtn reset" onClick={() => onOverride(sl.dateISO!, null)}>שחזרי למקור</button>
                          )}
                        </span>
                      )
                    )}
                    {sl.subItems && sl.subItems.length > 0 && (
                      <>
                        <button
                          type="button"
                          className={`slot-expand ${openSubs.has(i) ? 'open' : ''}`}
                          onClick={() => toggleSubs(i)}
                        >
                          <span className="se-caret">{openSubs.has(i) ? '−' : '+'}</span>
                          {openSubs.has(i) ? 'הסתר תתי-נושא' : `הצג תתי-נושא (${sl.subItems.length})`}
                        </button>
                        {/* מרונדר תמיד (מוסתר ב-CSS כשמכווץ) כדי שיופיע ב-PDF גם בלי הרחבה */}
                        <span className={`slot-subs ${openSubs.has(i) ? 'open' : ''}`}>
                          {sl.subItems.map((si, k) => (
                            <span key={k} className="slot-sub">
                              <span className={`sub-lvl ${si.level === 'חובה' ? 'core' : si.level === 'הרחבה' ? 'exp' : 'opt'}`}>{si.level}</span>
                              {si.name}
                            </span>
                          ))}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {(week.holidays.length > 0 || week.initiatives.length > 0 || week.scienceDays.length > 0 || week.reminders.length > 0) && (
              <div className="wk-ctx">
                {week.holidays.map((h) => <span key={h} className="mchip event">{h}</span>)}
                {week.reminders.map((r) => (
                  <span key={r} className="mchip reminder">
                    <span className="chip-tag">תזכורת</span>{r}
                  </span>
                ))}
                {week.initiatives.map((ini) => {
                  // בית ספר שרשום ליוזמה -> "תזכורת" (מבנה אחיד עם תזכורות החקר וה-STEM);
                  // יוזמה שלא צוינה בסטטוס -> "הצעה" (הזדמנות, לא תזכורת למועד).
                  const reg = isRegistered(ini.keywords, school);
                  return reg ? (
                    <span key={ini.name} className="mchip reminder">
                      <span className="chip-tag">תזכורת</span>{ini.name}
                    </span>
                  ) : (
                    <span key={ini.name} className="mchip init sug">
                      <span className="chip-tag">הצעה</span>{ini.name}
                    </span>
                  );
                })}
                {week.scienceDays.map((sd) => (
                  <span key={sd} className="mchip sci">
                    <span className="chip-tag">הצעה</span>יום מדעי · {sd}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- הפריסה השבועית האישית (מקובצת לפי חודש) ---------- */
function WeeklyPlan({ weeks, expandAll, school, onOverride }: {
  weeks: WeekSchedule[]; expandAll: boolean; school: SchoolStatus;
  onOverride?: (dateISO: string, text: string | null) => void;
}) {
  const rows: ReactNode[] = [];
  let lastMonth = '';
  for (const w of weeks) {
    if (w.month !== lastMonth) {
      lastMonth = w.month;
      rows.push(<div key={`m-${w.month}`} className="wk-month">{w.month}</div>);
    }
    rows.push(<WeekRow key={w.week} week={w} expandAll={expandAll} school={school} onOverride={onOverride} />);
  }
  return <div className="weekly-plan">{rows}</div>;
}

/* ---------- כיתה ט': סידור גושי התוכן (לפי תחומי המפרט; אין מתווה חודשי כפוי) ---------- */
// המורה מסדרת את הגושים (כימיה, ביולוגיה, פיזיקה...) ולא נושא-נושא; בתוך כל גוש
// הנושאים נלמדים לפי סדר המפרט. topicOrder נשמר כרשימת נושאים שטוחה - המנוע לא השתנה.
function Grade9OrderPanel({ order, onOrder }: { order: string[]; onOrder: (names: string[]) => void }) {
  const bank = banks[9];
  const domainOf = new Map(bank.topics.map((t) => [t.name, t.domain]));
  // סדר הגושים הנוכחי - לפי ההופעה הראשונה של כל תחום ב-topicOrder השמור.
  const domains: string[] = [];
  for (const name of order) {
    const d = domainOf.get(name);
    if (d && !domains.includes(d)) domains.push(d);
  }
  for (const t of bank.topics) if (!domains.includes(t.domain)) domains.push(t.domain);
  const topicsOf = (domain: string) => bank.topics.filter((t) => t.domain === domain);
  const applyOrder = (ds: string[]) => onOrder(ds.flatMap((d) => topicsOf(d).map((t) => t.name)));
  // סדר שנשמר מהגרסה הקודמת (נושא-נושא) מיושר פעם אחת למבנה גושים - כך המנוע
  // פורס בדיוק לפי מה שמוצג כאן.
  useEffect(() => {
    const norm = domains.flatMap((d) => topicsOf(d).map((t) => t.name));
    if (norm.join('|') !== order.join('|')) onOrder(norm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= domains.length) return;
    const next = [...domains];
    [next[i], next[j]] = [next[j], next[i]];
    applyOrder(next);
  };
  const totalHours = bank.topics.reduce((a, t) => a + t.hours, 0);
  return (
    <div className="g9-panel">
      <div className="g9-head">
        <div className="g9-title">סדר גושי התוכן שלך לאורך השנה</div>
        <span className="g9-hours">{totalHours} שעות תוכן</span>
      </div>
      <p className="g9-sub">
        התוכנית בכיתה ט' מחולקת לגושים לפי תחומי התוכן של המפרט. סדרי בחיצים את הגושים
        לפי הסדר שבו תלמדי אותם (למעלה = מוקדם יותר בשנה); בתוך כל גוש הנושאים נלמדים
        לפי סדר המפרט. המערכת תפרוס את השנה לפי הסדר שלך, ותקדיש את השבועות שלפני
        יריד החקר לעבודת החקר.
      </p>
      <div className="g9-list">
        {domains.map((domain, i) => {
          const topics = topicsOf(domain);
          const hours = topics.reduce((a, t) => a + t.hours, 0);
          return (
            <div key={domain} className="g9-row">
              <span className="g9-pos">{i + 1}</span>
              <div className="g9-move">
                <button className="g9-arrow" onClick={() => move(i, -1)} disabled={i === 0} title="הזיזי למעלה (מוקדם יותר)">▲</button>
                <button className="g9-arrow" onClick={() => move(i, 1)} disabled={i === domains.length - 1} title="הזיזי למטה (מאוחר יותר)">▼</button>
              </div>
              <div className="g9-body">
                <div className="g9-name">{domain}</div>
                <div className="g9-meta">
                  <span className="g9-h">{hours} ש'</span>
                  <span className="g9-domain">{topics.length === 1 ? 'נושא אחד' : `${topics.length} נושאים`}</span>
                </div>
                <div className="g9-topics">{topics.map((t) => t.name).join(' · ')}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- פס התקדמות (שאלון בשלושה שלבים) ---------- */
const STEP_NAMES = ['פרטי בית הספר', 'מערכת השעות', 'התוכנית שלך'];
function StepsBar({ step, maxStep, onStep }: { step: number; maxStep: number; onStep: (s: number) => void }) {
  return (
    <div className="steps-bar">
      <span className="steps-label">שלב {step} מתוך {STEP_NAMES.length}</span>
      <div className="steps">
        {STEP_NAMES.map((name, i) => {
          const n = i + 1;
          const cls = n === step ? 'now' : n <= maxStep ? 'done' : 'next';
          return (
            <button key={name} className={`step-chip ${cls}`} onClick={() => n <= maxStep && onStep(n)} disabled={n > maxStep}>
              <span className="step-num">{n < step ? '✓' : n}</span>
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- אירועים של בית הספר (טיול, שבוע מבחנים...) ---------- */
function EventsPanel({ events, onChange }: { events: CustomEvent[]; onChange: (evs: CustomEvent[]) => void }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const add = () => {
    if (!name.trim() || !date) return;
    onChange([...events.filter((e) => e.date !== date), { date, name: name.trim() }]);
    setName('');
    setDate('');
  };
  const fmt = (iso: string) => {
    const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${+m[3]}.${+m[2]}.${m[1].slice(2)}` : iso;
  };
  return (
    <div className="events-panel">
      <div className="ep-title">אירועים של בית הספר שלך (לא חובה)</div>
      <p className="ep-sub">טיול שנתי, שבוע מבחנים, יום שיא... הוסיפי תאריכים שבהם אין שיעור רגיל - התוכנית תסמן אותם ולא תשבץ בהם חומר לימוד.</p>
      <div className="ep-form">
        <input className="inp ep-date" type="date" min="2026-09-01" max="2027-06-20" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="inp ep-name" placeholder="שם האירוע (למשל: טיול שנתי)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-pr ep-add" onClick={add} disabled={!name.trim() || !date}>הוסיפי</button>
      </div>
      {events.length > 0 && (
        <div className="ep-list">
          {[...events].sort((a, b) => a.date.localeCompare(b.date)).map((ev) => (
            <span key={ev.date} className="ep-item">
              <b>{fmt(ev.date)}</b> {ev.name}
              <button className="ep-del" onClick={() => onChange(events.filter((x) => x.date !== ev.date))} title="הסירי את האירוע">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- התאמת התוכנית לשעות בפועל (מנגנון מחסור, סעיף 8.2) ---------- */
// נפתח רק כשהתוכנית המלאה דורשת יותר שעות ממה שיש למורה השנה.
// המורה בוחרת נושאים לצמצום, מד-התקדמות חי מראה כמה שעות פינתה,
// והנושאים המסומנים יורדים בפועל מהגאנט האישי (buildPlan עם droppedTopics).
function AdjustPanel({ grade, plan, pending, applied, onToggle, onConfirm, onReset, openSignal, onClose }: {
  grade: Grade; plan: Plan; pending: Set<string>; applied: Set<string>;
  onToggle: (name: string) => void; onConfirm: () => void; onReset: () => void;
  openSignal?: number; onClose?: () => void;
}) {
  // אחרי אישור, החלק נסגר לגמרי ומוצג רק סרגל סיכום; "פתח לעריכה" מחזיר אותו.
  const [editing, setEditing] = useState(false);
  // כפתור "עריכת הלו"ז" במסך התוכנית פותח את הפאנל - גם כשאין מחסור שעות.
  useEffect(() => {
    if (openSignal) setEditing(true);
  }, [openSignal]);
  const bank = banks[grade];
  const fullCore = bank.topics.reduce((a, t) => a + t.hours, 0);
  const gap = Math.max(0, fullCore - plan.capacityHours);
  // בלי מחסור, בלי צמצומים קיימים ובלי פתיחה יזומה - הפאנל לא מוצג.
  if (gap === 0 && !openSignal && applied.size === 0) return null;

  // המד עוקב אחרי הבחירה (pending) - משוב מיידי בזמן הסימון.
  const freed = bank.topics.filter((t) => pending.has(t.name)).reduce((a, t) => a + t.hours, 0);
  const remaining = Math.max(0, gap - freed);
  const covered = remaining === 0;
  const pct = gap > 0 ? Math.min(100, Math.round((Math.min(freed, gap) / gap) * 100)) : 100;
  // האם יש בחירה שטרם אושרה (שונה ממה שכבר הוחל על הגאנט).
  const dirty = pending.size !== applied.size || Array.from(pending).some((n) => !applied.has(n));
  const appliedHours = bank.topics.filter((t) => applied.has(t.name)).reduce((a, t) => a + t.hours, 0);
  // נושאים שעליהם נשענות משימות מודל - לא מוצגים לצמצום (כדי לא לפגוע בלומדות/משימות המודל).
  const modelLocked = new Set<string>();
  for (const mt of modelTasks[grade]) for (const n of mt.topicNames ?? []) modelLocked.add(n);
  // תהליך התכן ההנדסי (ז') - רובו חובה במפרט, לא מוצע לצמצום.
  if (grade === 7) modelLocked.add('תהליך התכן ההנדסי');
  // נושאים גדולים שעיקרם חובה (הרבה שעות, מעט תתי-נושא רשות/הרחבה) - לא מועמדים לצמצום,
  // בכל השכבות. נושא גדול עם הרבה חומר רשות (למשל הגנום בט') נשאר מועמד.
  for (const t of bank.topics) {
    if (t.hours >= 10 && (t.optional ?? []).length < 3) modelLocked.add(t.name);
  }
  const domains = topicsByDomain(bank)
    .map((d) => ({ ...d, topics: d.topics.filter((t) => !modelLocked.has(t.name)) }))
    .filter((d) => d.topics.length > 0);
  const confirm = () => { onConfirm(); setEditing(false); };

  // מצב סגור: המורה כבר אישרה צמצום ואינה עורכת - מציגים רק סרגל סיכום + כפתור פתיחה.
  // אם נשאר חוסר (צמצום חלקי) - מזהירים בכנות במקום להציג "הכול תקין".
  if (applied.size > 0 && !editing && !dirty) {
    const nTopics = applied.size === 1 ? 'נושא אחד' : `${applied.size} נושאים`;
    const still = plan.shortfallHours; // כמה שעות עדיין לא נכנסות אחרי הצמצום שאושר
    if (still > 0) {
      return (
        <div className="adjust warn collapsed">
          <span className="ac-warn">
            <IconAlert color="#c2603f" /> צמצמת {appliedHours} {appliedHours === 1 ? 'שעה' : 'שעות'} ({nTopics}), ועדיין חסרות {still} שעות - כל הנושאים נשארים בתוכנית, וכל נושא מקבל מעט פחות זמן ממה שכתוב בתוכנית הלימודים.
          </span>
          <button className="adjust-edit" onClick={() => setEditing(true)}>פתחי לעריכה</button>
        </div>
      );
    }
    return (
      <div className="adjust done collapsed">
        <span className="ac-applied">
          <IconCheck /> התוכנית הותאמה לשעות שלך - {appliedHours} {appliedHours === 1 ? 'שעה' : 'שעות'} ({nTopics}) ירדו מהגאנט.
        </span>
        <button className="adjust-edit" onClick={() => setEditing(true)}>פתחי לעריכה</button>
      </div>
    );
  }

  return (
    <div className={`adjust ${covered ? 'done' : ''}`}>
      <div className="adjust-head">
        <div className="adjust-title">
          {gap === 0 ? 'עריכת הלו"ז - בחירת נושאים' : covered ? 'מצוין - סגרת את הפער' : 'בואי נתאים את התוכנית לשעות שלך'}
        </div>
        <div className="adjust-intro">
          {gap === 0 ? (
            <>יש לך מספיק שעות לכל התוכנית המלאה - לא חייבים לצמצם דבר. אם בכל זאת תרצי לוותר על נושאים, סמני אותם ולחצי אישור - הם יירדו מהגאנט ומהיומן.</>
          ) : (
            <>
              {!covered && <div className="adjust-gap-big">חסרות לך {remaining} שעות</div>}
              <div className="adjust-points">
                <div className="adjust-point warn">
                  <span className="ap-mark">✔</span>
                  <span>נושא שתסמני כאן <b>יירד מהתוכנית שלך</b> - לא יופיע בגאנט, ב-PDF וביומן.</span>
                </div>
                <div className="adjust-point">
                  <span className="ap-mark ok">✓</span>
                  <span><b>לא חייבת לצמצם.</b> אם תשאירי הכול, כל הנושאים יישארו בתוכנית - פשוט יידחסו, וכל נושא יקבל מעט פחות זמן.</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {domains.length > 0 && modelLocked.size > 0 && (
        <div className="adjust-note lock">
          <b>שימי לב:</b> {grade === 9
            ? 'נושאים גדולים עם מעט חומר הרחבה/רשות אינם מוצגים כאן לצמצום.'
            : 'נושאים שעליהם נשענות משימות מודל, ונושאים גדולים שעיקרם חובה - אינם מוצגים כאן לצמצום.'}
        </div>
      )}

      <div className="adjust-list">
        {domains.length === 0 && (
          <div className="adjust-note lock">כל הנושאים בשכבה זו נשענים על משימות מודל, ולכן אין נושאים שניתן לצמצם. הפער ייסגר בדחיסה קלה של כל הנושאים.</div>
        )}
        {domains.map(({ domain, topics }) => (
          <div key={domain} className="adjust-domain">
            <div className="ad-name">{domain}</div>
            <div className="ad-topics">
              {topics.map((t) => {
                const sel = pending.has(t.name);
                const opt = t.optional ?? [];
                const nOpt = opt.length;
                // יחס החומר שאינו חובה מתוך כלל תתי-הנושא (ליבה + הרחבה/רשות). נושא שרובו
                // המוחלט חובה (יחס נמוך) לא יסומן "מועדף לצמצום" - רק נושא עם חלק משמעותי
                // של הרחבה/רשות. (item 3 - משקף בלבד, בלי הטיה לצמצם נושא שהוא כמעט כולו חובה.)
                const nCore = coreSubtopics[grade]?.[t.name]?.length ?? 0;
                const total = nCore + nOpt;
                const optRatio = total > 0 ? nOpt / total : 0;
                // "מועדף לצמצום" רק כשלפחות ~חמישית מהנושא היא הרחבה/רשות. נושא שרובו
                // המוחלט חובה (יחס < 0.2) לא מומלץ - עדיין ניתן לבחור, בלי תג המלצה.
                const preferred = nOpt > 0 && optRatio >= 0.2;
                const strong = optRatio >= 0.4; // חלק גדול מהנושא אינו חובה = המלצה חזקה יותר
                const subj = nOpt === 1 ? 'תת-נושא אחד מסומן' : `${nOpt} תתי-נושא מסומנים`;
                const tail = strong ? ' חלק ניכר מהנושא הוא חומר שאינו חובה.' : '';
                const reason = nOpt > 0
                  ? `בנושא הזה ${subj} במפרט כהרחבה/רשות - חומר העשרה, לא ליבת החובה.${tail}`
                  : '';
                return (
                  <label key={t.name} className={`ad-topic ${sel ? 'off' : ''}`}>
                    <input type="checkbox" checked={sel} onChange={() => onToggle(t.name)} />
                    <span className="adt-body">
                      <span className="adt-top">
                        <span className="adt-name">{t.name}</span>
                        <span className="adt-hours">{t.hours} ש'</span>
                        {grade !== 9 && <span className="adt-cls core">חובה</span>}
                        {preferred && !sel && <span className="adt-rec">מועדף לצמצום</span>}
                        {sel && <span className="adt-off">יורד מהתוכנית שלך</span>}
                      </span>
                      {nOpt > 0 ? (
                        <>
                          <span className="adt-why">{reason}</span>
                          <div className="adt-opts">
                            {opt.map((o) => (
                              <span key={o.name} className="opt-item">
                                <span className={`opt-lvl ${o.level === 'הרחבה' ? 'exp' : 'opt'}`}>{o.level}</span>
                                {o.name}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <span className="adt-core">{grade === 9 ? 'אין בנושא הזה תתי-נושא הרחבה/רשות.' : 'כל תתי-הנושא כאן מסומנים במפרט כחובה (אין בנושא הזה הרחבה/רשות).'}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="adjust-foot">
        {gap > 0 && (
          <div className="adjust-meter">
            <div className="am-track"><div className="am-fill" style={{ width: `${pct}%` }} /></div>
            <div className="am-label">
              {covered
                ? <span className="am-done"><IconCheck /> סימנת {freed} שעות - הפער נסגר</span>
                : <span>סימנת {freed} מתוך {gap} שעות - נותרו {remaining}</span>}
            </div>
            {(pending.size > 0 || applied.size > 0) && <button className="am-reset" onClick={onReset}>אפסי בחירה</button>}
          </div>
        )}
        <div className="af-line">
          {gap === 0
            ? 'סמני נושאים שאת רוצה להוריד מהלו"ז ולחצי אישור - או סגרי אם אין שינוי.'
            : covered
            ? 'מצוין - כל הנושאים ייכנסו בזמן המלא, בלי דחיסה.'
            : `נותרו ${remaining} שעות של פער. באישור כך - כל הנושאים יישארו בתוכנית, וכל נושא יקבל מעט פחות זמן ממה שכתוב בתוכנית הלימודים.`}
        </div>
        <div className="adjust-confirm">
          {dirty ? (
            <>
              <button className="ac-btn" onClick={confirm}>אישור - עדכני את התוכנית</button>
              <span className="ac-hint">אחרי אישור החלק ייסגר ותישאר התוכנית המותאמת. תמיד אפשר לפתוח שוב.</span>
            </>
          ) : applied.size > 0 ? (
            <button className="ac-btn ghost" onClick={() => { setEditing(false); onClose?.(); }}>סיום - חזרה לתוכנית</button>
          ) : (
            <button className="ac-btn ghost" onClick={() => { setEditing(false); onClose?.(); }}>סגירה - חזרה לתוכנית</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- מסך התוצאה ---------- */
function ResultScreen({ grade, onGrade, ganttVersion, session, saved, onLogout }: {
  grade: Grade; onGrade: (g: Grade) => void; ganttVersion: number; session: Session;
  saved: SavedState | null; onLogout: () => void;
}) {
  const statusHours = session.school.hoursByGrade?.[grade];
  // תמונת המצב לכל שכבה (מערכת שעות + צמצומים) - נשמרת בין החלפות שכבה ובין ביקורים.
  const stateRef = useRef({
    scheduleByGrade: { ...(saved?.scheduleByGrade ?? {}) } as Partial<Record<Grade, Record<string, number>>>,
    appliedByGrade: { ...(saved?.appliedByGrade ?? {}) } as Partial<Record<Grade, string[]>>,
    classByGrade: { ...(saved?.classByGrade ?? {}) } as Partial<Record<Grade, string>>,
    overridesByGrade: { ...(saved?.overridesByGrade ?? {}) } as Partial<Record<Grade, Record<string, string>>>,
    topicOrderByGrade: { ...(saved?.topicOrderByGrade ?? {}) } as Partial<Record<Grade, string[]>>,
    // מצב פר-כיתה: לכל כיתה (ז'1, ז'2...) מערכת שעות, צמצומים ועריכות משלה.
    byClass: { ...(saved?.byClass ?? {}) } as Record<string, { schedule?: Record<string, number>; applied?: string[]; overrides?: Record<string, string> }>,
  });
  // סדר הנושאים שנבחר (כיתה ט' בלבד). ברירת מחדל: סדר המפרט, כל הנושאים.
  const defaultOrder = (g: Grade) => banks[g].topics.map((t) => t.name);
  const [topicOrder, setTopicOrder] = useState<string[]>(
    () => stateRef.current.topicOrderByGrade[grade] ?? defaultOrder(grade),
  );
  // השלב בשאלון: 1 פרטי בית הספר, 2 מערכת שעות ואירועים, 3 התוכנית המלאה.
  // מורה חוזרת נוחתת תמיד על מסך השעות (שלב 2) - השעות ממולאות מהפעם הקודמת,
  // היא מאשרת/מעדכנת וממשיכה. מורה חדשה מתחילה מפרטי בית הספר (שלב 1).
  const [step, setStep] = useState<number>(saved?.session ? 2 : 1);
  // שם הכיתה (רשות, למשל ז'1) - נכנס לכותרות, ל-PDF וליומן.
  const [klass, setKlass] = useState<string>(stateRef.current.classByGrade[grade] ?? '');
  // אירועי בית ספר שהמורה הוסיפה - שיעור שנופל עליהם לא משובץ.
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>(saved?.customEvents ?? []);
  // שיעורים שנערכו ידנית: תאריך ISO -> הטקסט של המורה.
  const [overrides, setOverrides] = useState<Record<string, string>>(stateRef.current.overridesByGrade[grade] ?? {});
  const setOverride = (dateISO: string, text: string | null) =>
    setOverrides((o) => {
      const n = { ...o };
      if (text && text.trim()) n[dateISO] = text.trim();
      else delete n[dateISO];
      return n;
    });
  const [schedule, setSchedule] = useState<Record<string, number>>(
    () => stateRef.current.scheduleByGrade[grade] ?? scheduleFromHours(statusHours),
  );
  const setDayHours = (day: string, hours: number) =>
    setSchedule((s) => ({ ...s, [day]: hours }));

  // נושאים לצמצום במחסור שעות (מנגנון 8.2): pending = מה שהמורה סימנה,
  // applied = מה שאושר בפועל ונכנס למנוע. הגאנט מתעדכן רק אחרי "אישור".
  const [pending, setPending] = useState<Set<string>>(() => new Set(stateRef.current.appliedByGrade[grade] ?? []));
  const [applied, setApplied] = useState<Set<string>>(() => new Set(stateRef.current.appliedByGrade[grade] ?? []));
  const togglePending = (name: string) =>
    setPending((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  // אחרי שהמורה מאשרת את הצמצום - התוכנית מוכנה, אז פותחים אוטומטית את חלון הייצוא.
  const confirmDrop = () => { setApplied(new Set(pending)); setShowExport(true); };
  const resetDrop = () => { setPending(new Set()); setApplied(new Set()); };

  // כפתור גלובלי: הרחבת/סגירת כל תתי-הנושאים בגאנט בבת אחת.
  const [expandAll, setExpandAll] = useState(false);
  // סיום והפקה בלחיצה אחת: PDF + קלנדר למורה, ועותקים לתיקייה שלנו ולרכז/ת.
  const pageRef = useRef<HTMLDivElement>(null);
  // ראש התוכנית - כדי לגלול אליו כשהמורה בוחרת "להסתכל קודם על התוכנית".
  const titleRef = useRef<HTMLDivElement>(null);
  const [delivery, setDelivery] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; msg?: string }>({ status: 'idle' });
  // חלון הייצוא הקופץ - נפתח מכפתור הסיום (בכותרת או בתחתית), ומרכז את פעולת ההפקה.
  const [showExport, setShowExport] = useState(false);
  // פתיחת פאנל עריכת הלו"ז (צמצום/בחירת נושאים) מכפתור העריכה - מונה כדי שכל לחיצה תפתח.
  const [adjustSignal, setAdjustSignal] = useState(0);
  const adjustRef = useRef<HTMLDivElement>(null);
  const openAdjust = () => {
    setAdjustSignal((n) => n + 1);
    setTimeout(() => adjustRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };
  const doFinalize = async () => {
    const el = pageRef.current;
    if (!el || delivery.status === 'working') return;
    setDelivery({ status: 'working' });
    el.classList.add('exporting');
    try {
      const bank = banks[grade];
      const moeFullHours = bank.topics.reduce((a, t) => a + t.hours, 0);
      const deviation = {
        gradeLabel: `${GRADE_LABEL[grade]}${klass.trim() ? ` (${klass.trim()})` : ''}`,
        statusHours: statusHours ?? null,
        actualHours: weeklyHours,
        hoursDeviates: statusHours != null && weeklyHours !== statusHours,
        moeFullHours,
        capacityHours: plan.capacityHours,
        // הפער מול משרד החינוך = כל שעות התוכן הרשמיות פחות מה שהמורה יכולה ללמד בפועל
        // (מבני, לא תלוי בצמצומים - לכן לא plan.shortfallHours שמתאפס אחרי צמצום).
        shortfallHours: Math.max(0, moeFullHours - plan.capacityHours),
        droppedTopics: Array.from(applied),
      };
      const r = await finalizePlan(plan, session, weekly, el, deviation, klass);
      // הכוונת ספאם: מיילים אוטומטיים עם קובץ מצורף נוחתים לעיתים בספאם/עדכונים - מכוונים את המורה לחפש שם.
      const mailNote = ' לא רואה את המייל עם ה-PDF? חפשי בתיבת הספאם או בלשונית "עדכונים" וסמני "לא ספאם" - כך המיילים הבאים יגיעו רגיל.';
      if (r.ok && r.calendarShared) setDelivery({ status: 'done', msg: 'התוכנית מוכנה! ה-PDF ירד למחשב, ושלחנו למייל שלך גם את ה-PDF וגם את קובץ היומן (אפשר לצרף אותו ליומן Google שלך בקלות). בנוסף נוצר עבורך יומן משותף שיופיע בגוגל קלנדר (אשרי את השיתוף אם תתבקשי), ועותק נשלח לרכז/ת שלך.' + mailNote });
      else if (r.ok) setDelivery({ status: 'done', msg: 'ה-PDF ירד למחשב, שלחנו אותו ואת קובץ היומן למייל שלך, ועותק נשלח לרכז/ת שלך. (היומן המשותף עדיין לא הופעל - נשלים אותו.)' + mailNote });
      else setDelivery({ status: 'error', msg: r.error || 'ההפקה נכשלה. נסי שוב.' });
    } catch {
      setDelivery({ status: 'error', msg: 'ההפקה נכשלה. נסי שוב.' });
    } finally {
      el.classList.remove('exporting');
    }
  };

  // בשינוי שכבה - משחזרים את הכיתה האחרונה של השכבה ואת סדר הנושאים (ט').
  useEffect(() => {
    setKlass(stateRef.current.classByGrade[grade] ?? '');
    setTopicOrder(stateRef.current.topicOrderByGrade[grade] ?? defaultOrder(grade));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade]);

  // כל כיתה = מצב משלה. בבחירת כיתה משחזרים את מה ששמור לה; כיתה חדשה מתחילה נקי
  // (בלי צמצומים ועריכות של כיתה אחרת) - כך מחסור שעות יופיע ויוביל לצמצום כרגיל.
  useEffect(() => {
    const c = klass.trim() ? stateRef.current.byClass[`${grade}|${klass.trim()}`] : undefined;
    setSchedule(c?.schedule ?? stateRef.current.scheduleByGrade[grade] ?? scheduleFromHours(session.school.hoursByGrade?.[grade]));
    const savedApplied = c?.applied ?? [];
    setPending(new Set(savedApplied));
    setApplied(new Set(savedApplied));
    setOverrides(c?.overrides ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, klass]);

  const slots: TeacherSlot[] = WEEK_DAYS
    .filter((d) => (schedule[d] || 0) > 0)
    .map((d) => ({ day: d, hours: schedule[d] }));
  const weeklyHours = slots.reduce((a, s) => a + s.hours, 0) || 1;
  const scheduleKey = JSON.stringify(schedule);
  const appliedKey = Array.from(applied).sort().join('|');
  const eventsKey = JSON.stringify(customEvents);
  const overridesKey = JSON.stringify(overrides);
  const orderKey = topicOrder.join('|');

  // שמירה אוטומטית: כל שינוי (שעות, צמצומים, אירועים, עריכות, סדר, שלב) נשמר בדפדפן.
  useEffect(() => {
    stateRef.current.scheduleByGrade[grade] = schedule;
    stateRef.current.appliedByGrade[grade] = Array.from(applied);
    stateRef.current.classByGrade[grade] = klass;
    stateRef.current.overridesByGrade[grade] = overrides;
    stateRef.current.topicOrderByGrade[grade] = topicOrder;
    if (klass.trim()) {
      stateRef.current.byClass[`${grade}|${klass.trim()}`] = { schedule, applied: Array.from(applied), overrides };
    }
    writeSavedState({
      session,
      grade,
      scheduleByGrade: stateRef.current.scheduleByGrade,
      appliedByGrade: stateRef.current.appliedByGrade,
      classByGrade: stateRef.current.classByGrade,
      overridesByGrade: stateRef.current.overridesByGrade,
      topicOrderByGrade: stateRef.current.topicOrderByGrade,
      byClass: stateRef.current.byClass,
      customEvents,
      step,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, grade, scheduleKey, appliedKey, klass, eventsKey, overridesKey, orderKey, step]);

  const { plan, months, weekly } = useMemo(() => {
    const p = buildPlan({ grade, weeklyHours, droppedTopics: Array.from(applied), topicOrder: grade === 9 ? topicOrder : undefined, teachingDays: slots.length });
    const rawWeekly = buildWeeklySchedule(p, slots, customEvents);
    // החלת עריכות ידניות: שיעור נושא שהמורה שינתה מקבל את הטקסט שלה.
    const weeklyEdited = rawWeekly.map((w) => ({
      ...w,
      slots: w.slots.map((sl) =>
        sl.kind === 'נושא' && sl.dateISO && overrides[sl.dateISO]
          ? { ...sl, label: overrides[sl.dateISO], topicList: undefined, subItems: undefined, overridden: true }
          : sl,
      ),
    }));
    return {
      plan: p,
      months: buildMonthlyCalendar(p),
      weekly: weeklyEdited,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, weeklyHours, scheduleKey, appliedKey, eventsKey, overridesKey, orderKey, ganttVersion]);

  const goStep = (s: number) => setStep(s);
  // החלפת שכבה: לכל שכבה מספר שעות/ימים שונה - מקפיצים למסך השעות כדי שהמורה תאשר/תעדכן.
  const changeGrade = (g: Grade) => { if (g !== grade) setStep(2); onGrade(g); };
  return (
    <>
    <div className="result-page" dir="rtl" ref={pageRef}>
      <Header grade={grade} onGrade={changeGrade} session={session} onFinalize={() => setShowExport(true)} working={delivery.status === 'working'} onLogout={onLogout} showFinalize={step === 3} onHome={() => goStep(1)} onEditHours={() => goStep(2)} />

      {delivery.status !== 'idle' && (
        <div className={`deliver-bar ${delivery.status}`}>
          <span>{delivery.status === 'working' ? 'מפיקה את התוכנית ושולחת... (כמה דקות)' : delivery.msg}</span>
          {delivery.status !== 'working' && <button className="deliver-x" onClick={() => setDelivery({ status: 'idle' })}>סגרי</button>}
        </div>
      )}

      <StepsBar step={step} maxStep={3} onStep={goStep} />

      {step === 1 && (
        <div className="step-page">
          <h2 className="step-h">שלום {session.teacherName}! אלה פרטי בית הספר שלך</h2>
          <p className="step-sub">הפרטים מולאו על ידי הרכז/ת של {session.school.schoolName}. בדקי שהכול נכון, בחרי שכבה למעלה, והמשיכי.</p>
          <SchoolInfo school={session.school} grade={grade} />
          <div className="step-nav">
            <button className="btn btn-pr" onClick={() => goStep(2)}>הבא - מערכת השעות שלך</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="step-page">
          <h2 className="step-h">מתי את מלמדת {GRADE_LABEL[grade]}?</h2>
          <p className="step-sub">הלו"ז נבנה לכל כיתה בנפרד: בחרי את הכיתה, וחלקי את השעות השבועיות שלה לימים - לפי זה תיבנה הפריסה האישית, שיעור אחר שיעור.</p>
          <div className="step-grade">
            <label className="flab">שכבה</label>
            <div className="grade-toggle big">
              {GRADES.map((g) => (
                <button key={g} className={`gt ${g === grade ? 'active' : ''}`} onClick={() => onGrade(g)}>
                  {GRADE_LABEL[g]}
                </button>
              ))}
            </div>
          </div>
          <div className="klass-field">
            <label className="flab">לאיזו כיתה בונים עכשיו את הלו"ז? (חובה)</label>
            <select className="inp klass-inp" value={klass} onChange={(e) => setKlass(e.target.value)}>
              <option value="">בחרי כיתה</option>
              {[1, 2, 3, 4, 5].map((n) => {
                const name = `${GRADE_LETTER[grade]}'${n}`;
                return <option key={n} value={name}>{name}</option>;
              })}
            </select>
            <span className="klass-hint">כל כיתה מקבלת גאנט ויומן משלה. כניסה חוזרת לאותה כיתה מעדכנת אותה - לא יוצרת כפילות.</span>
          </div>
          <ScheduleEditor schedule={schedule} onChange={setDayHours} targetHours={statusHours} />
          {grade === 9 && <Grade9OrderPanel order={topicOrder} onOrder={setTopicOrder} />}
          <EventsPanel events={customEvents} onChange={setCustomEvents} />
          {plan.shortfallHours > 0 && applied.size === 0 && (
            <div className="alerts">
              <div className="alert warn">
                <IconAlert color="#c2603f" />
                <span>שימי לב: לפי השעות שהזנת אפשר ללמד {plan.capacityHours} שעות תוכן, והתוכנית המלאה דורשת יותר - חסרות {plan.shortfallHours} שעות. בשלב הבא יופיע מקטע <b>"בואי נתאים את התוכנית לשעות שלך"</b> שבו תוכלי לצמצם נושאים.</span>
              </div>
            </div>
          )}
          <div className="step-nav">
            <button className="ac-btn ghost" onClick={() => goStep(1)}>הקודם</button>
            <button className="btn btn-pr" onClick={() => goStep(3)} disabled={!klass.trim()}>הבא - התוכנית שלך</button>
            {!klass.trim() && <span className="step-need">מלאי את שם הכיתה כדי להמשיך</span>}
          </div>
        </div>
      )}

      {step === 3 && (
      <>
      <div className="finalize-hint">
        <IconDownload />
        <span>בסיום, בלחיצה על <b>"הורידי PDF וקבלי גוגל קלנדר"</b>: הגאנט יירד למחשב, ויישלח גם למייל שלך יחד עם קובץ היומן - שאותו אפשר לצרף בקלות ליומן Google שלך. בנוסף ייווצר עבורך יומן אישי שיופיע לבד בגוגל קלנדר, ועותק יישלח לרכז/ת שלך.</span>
      </div>

      <div style={{ height: 18 }} />

      <div className="title-row" ref={titleRef}>
        <div>
          <h2>תוכנית עבודה שנתית · מדע וטכנולוגיה</h2>
          <p className="sub">{GRADE_LABEL[grade]}{klass.trim() ? ` (${klass.trim()})` : ''} · {plan.weeklyHours} ש"ש · {session.teacherName} · {session.school.schoolName} · תשפ"ז</p>
        </div>
        <div className="legend">
          {legendFor(grade).map((l) => (
            <span key={l.label}><span className="sq" style={{ background: l.color }} />{l.label}</span>
          ))}
        </div>
      </div>

      <div className="edit-plan-row">
        <button className="edit-plan-btn" onClick={openAdjust}>
          ✎ עריכת הלו"ז - בחירת נושאים וצמצום
        </button>
      </div>

      {plan.shortfallHours > 0 && applied.size === 0 && (
        <div className="alerts">
          <div className="alert warn">
            <IconAlert color="#c2603f" />
            <span>שימי לב - חסרות {plan.shortfallHours} שעות: בשעות שיש לך השנה אפשר ללמד {plan.capacityHours} שעות תוכן, וזה פחות ממה שהתוכנית המלאה דורשת. אפשר להתאים אותה בהמשך המסך, במקטע "בואי נתאים את התוכנית לשעות שלך".</span>
          </div>
        </div>
      )}

      <div ref={adjustRef}>
        <AdjustPanel grade={grade} plan={plan} pending={pending} applied={applied} onToggle={togglePending} onConfirm={confirmDrop} onReset={resetDrop} openSignal={adjustSignal} onClose={() => setAdjustSignal(0)} />
      </div>
      {grade === 9 && (
        <div className="g9-note">
          <IconAlert color="#1c4e5e" />
          <span>הסדר לפי מה שקבעת ב<b>"מערכת השעות"</b> (בפס ההתקדמות למעלה). השבועות שלפני יריד החקר מוקדשים לעבודת החקר.</span>
        </div>
      )}

      <div className="lbl">מבט שנתי - נושאים לפי חודשים</div>
      <div className="month-grid">
        {months.map((c) => <MonthCard key={c.month} cell={c} />)}
      </div>

      <div className="hero-row">
        <div>
          <div className="lbl lbl-hero">הפריסה השבועית האישית שלך - שיעור אחר שיעור</div>
          <p className="hero-sub">לפי השעות שלך: כל שבוע מחולק לשיעורים שלך, עם הנושא ללמידה ומתי בדיוק עושים {grade === 9 ? 'חקר או מבחן' : 'משימת מודל או מבחן'}. אפשר גם לערוך כל שיעור ידנית.</p>
        </div>
        <button className="expand-all" onClick={() => setExpandAll((v) => !v)}>
          <span className="se-caret">{expandAll ? '−' : '+'}</span>
          {expandAll ? 'סגרי את כל תתי-הנושאים' : 'הרחיבי את כל תתי-הנושאים'}
        </button>
      </div>
      <WeeklyPlan weeks={weekly} expandAll={expandAll} school={session.school} onOverride={setOverride} />

      <div className="finish-cta">
        <div className="fc-text">
          <div className="fc-title">סיימת לבנות את התוכנית?</div>
          <div className="fc-sub">בלחיצה אחת: הורדת PDF, יומן Google אישי שמופיע לך אוטומטית, ועותק לרכז/ת שלך.</div>
        </div>
        <button className="btn btn-pr fc-btn" onClick={() => setShowExport(true)}>
          <IconDownload />הורידי PDF וקבלי יומן Google
        </button>
      </div>
      </>
      )}
    </div>

    {showExport && (
      <div
        className="modal-overlay"
        onClick={delivery.status === 'working' ? undefined : () => { setShowExport(false); if (delivery.status !== 'idle') setDelivery({ status: 'idle' }); }}
      >
        <div className="modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
          {delivery.status === 'working' ? (
            <>
              <h3 className="modal-h">מפיקה את התוכנית שלך...</h3>
              <div className="modal-bar"><div className="modal-bar-fill" /></div>
              <p className="modal-p">רק כמה דקות ומסיימות. מכינה לך את הגאנט להורדה, את יומן Google האישי, ושולחת אלייך את הכול במייל. אפשר להמתין כאן ברוגע - אין צורך לעשות דבר.</p>
            </>
          ) : delivery.status === 'done' ? (
            <>
              <div className="modal-badge ok"><IconCheck /></div>
              <h3 className="modal-h">הכול מוכן!</h3>
              <p className="modal-p">{delivery.msg}</p>
              <button className="btn btn-pr modal-close" onClick={() => { setShowExport(false); setDelivery({ status: 'idle' }); }}>סגירה</button>
            </>
          ) : delivery.status === 'error' ? (
            <>
              <div className="modal-badge err"><IconAlert color="#c2603f" /></div>
              <h3 className="modal-h">משהו השתבש</h3>
              <p className="modal-p">{delivery.msg}</p>
              <div className="modal-actions">
                <button className="btn btn-pr" onClick={doFinalize}>נסי שוב</button>
                <button className="modal-ghost" onClick={() => { setShowExport(false); setDelivery({ status: 'idle' }); }}>סגירה</button>
              </div>
            </>
          ) : (
            <>
              <h3 className="modal-h">סיום והפקת התוכנית</h3>
              <p className="modal-p">התוכנית שלך מוכנה. בלחיצה על "הפיקי עכשיו" יקרה כך:</p>
              <ul className="modal-list">
                <li>קובץ ה-PDF של הגאנט יירד למחשב שלך.</li>
                <li>יישלח אלייך מייל עם ה-PDF וקובץ היומן, לכתובת: <b dir="ltr">{session.teacherEmail}</b></li>
                <li>יומן אישי יופיע אוטומטית ביומן Google שלך.</li>
                <li>עותק יישלח לרכז/ת שלך.</li>
              </ul>
              <p className="modal-note">אם הכתובת לא נכונה - לחצי "יציאה" למעלה והיכנסי שוב עם הכתובת הנכונה.</p>
              <div className="modal-actions">
                <button className="btn btn-pr" onClick={doFinalize}><IconDownload />הפיקי עכשיו</button>
                <button className="btn modal-secondary" onClick={() => { setShowExport(false); setTimeout(() => titleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }}>👀 להסתכל קודם על התוכנית שהתקבלה</button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}

export default function App() {
  // שחזור מצב שמור - מורה שרעננה או סגרה חוזרת ישר לתוכנית שלה.
  const saved = useMemo(loadSavedState, []);
  const [grade, setGrade] = useState<Grade>(saved?.grade ?? 7);
  const [ganttVersion, setGanttVersion] = useState(0);
  const [session, setSession] = useState<Session | null>(saved?.session ?? null);
  // תצוגת רכז/ת (כניסה נפרדת ממסך הפתיחה).
  const [coordView, setCoordView] = useState(false);
  // יציאה: ניקוי המצב השמור וחזרה למסך הפתיחה (למשל להחלפת מייל או מורה אחרת).
  const logout = () => {
    writeSavedState(null);
    setSession(null);
  };

  useEffect(() => {
    let alive = true;
    fetchLiveGantt().then((weeks) => {
      if (alive && weeks && weeks.length) {
        setLiveGantt(weeks);
        setGanttVersion((v) => v + 1);
      }
    });
    return () => { alive = false; };
  }, []);

  const screen = !session
    ? (coordView
        ? <CoordinatorScreen onBack={() => setCoordView(false)} />
        : <LoginScreen onEnter={setSession} onCoord={() => setCoordView(true)} />)
    : <ResultScreen grade={grade} onGrade={setGrade} ganttVersion={ganttVersion} session={session} saved={saved} onLogout={logout} />;
  return (
    <>
      {screen}
      <FeedbackWidget session={session} />
    </>
  );
}
