/**
 * תומכת הוראה אישית - מסירת התוצרים (Google Apps Script).
 * רץ תחת חשבון ההתיישבותי -> גישה מלאה ל-Drive, למייל וליומן, בלי API חיצוני.
 *
 * בכל מסירה (action = 'deliverPlan'):
 *   1. תת-תיקייה "שם ביה"ס - סמל מוסד" בתוך התיקייה הראשית ששיתפת -> שומר PDF + קלנדר.
 *   2. רושם חריגות (מול הסטטוס / מול שעות משרד החינוך) לגיליון אחד בתיקיית האם.
 *   3. שולח למורה מייל עם הגאנט (PDF) + קובץ היומן (.ics), עם ציון הכיתה ומועד העדכון.
 *   4. שולח לרכז/ת עותק במייל (PDF + ics), עם ציון הכיתה ומועד העדכון.
 *   5. יוצר/מעדכן יומן אישי למורה (אחרון - כי זה הצעד הארוך), ממלא אותו באירועי
 *      התוכנית, ומשתף עם המורה. היומן מזוהה לפי מפתח כיתה שנשמר בתיאור היומן
 *      (סמל+כיתה+מייל) - עדכון חוזר מעדכן את אותו יומן, לא יוצר חדש; כפילויות נמחקות.
 *
 * תצוגת רכז/ת (action = 'listPlans'): מחזיר את רשימת התוצרים של בית הספר לפי סמל מוסד.
 *
 * דורש להפעיל שירות מתקדם: בעורך Apps Script -> Services (+) -> "Google Calendar API" -> Add.
 * הרשאות: הקוד ניגש גם ל-Google Sheets. לפני פרסום גרסה חדשה יש להריץ פעם אחת את
 *   authorizeNow() בעורך, לאשר את מסך ההרשאות (כולל גיליונות), ורק אז לפרסם.
 * פריסה: Deploy -> New deployment -> Web app -> Execute as: Me ; Who has access: Anyone.
 */

var DELIVERY_PARENT_ID = '1r0I5ZDkI5VzBgfhKB91VOI71VzMkTQOI';
var SHARED_TOKEN = '';
var FROM_NAME = 'תומכת הוראה אישית - הדרכת מדע וטכנולוגיה';

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (SHARED_TOKEN && String(payload.token || '') !== SHARED_TOKEN) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (String(payload.action || '') === 'deliverPlan') {
      return json_(deliverPlan_(payload));
    }
    if (String(payload.action || '') === 'listPlans') {
      return json_(listPlans_(String(payload.semel || '')));
    }
    return json_({ ok: false, error: 'פעולה לא מוכרת' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'delivery', parent: DELIVERY_PARENT_ID });
}

function deliverPlan_(p) {
  var schoolName = String(p.schoolName || '').trim();
  var schoolId = String(p.schoolId || '').replace(/\D/g, '');
  var teacher = String(p.teacherName || '').trim();
  if (!schoolName || !schoolId) throw new Error('חסר שם בית ספר או סמל מוסד');
  if (!teacher) throw new Error('חסר שם המורה');

  var folder = getOrCreateSchoolFolder_(schoolName, schoolId);
  var gradeLabel = String(p.gradeLabel || '').trim();
  // כל שכבה נשמרת בקובץ נפרד - מורה שמלמדת ז+ח+ט מקבלת 3 זוגות קבצים.
  var base = sanitize_(teacher + (gradeLabel ? ' - ' + gradeLabel : ''));
  var out = { ok: true, folderUrl: folder.getUrl(), files: {} };

  // דיווח חריגות (פנימי) לגיליון בתיקיית האם - קודם כול, כדי שיירשם מיד. לא חוסם.
  try {
    if (logDeviation_(p, schoolName, schoolId, teacher)) out.deviationLogged = true;
  } catch (devErr) {
    out.deviationError = String(devErr.message || devErr);
  }

  // גיליון משתמשי האתר: שורה לכל מורה עם הכיתות שיצרה - מתעדכן בכל מסירה. לא חוסם.
  try {
    if (logUser_(p, schoolName, schoolId, teacher)) out.userLogged = true;
  } catch (userErr) {
    out.userLogError = String(userErr.message || userErr);
  }

  // גאנט אישי (PDF). שומרים גם את ה-blob כדי לצרף אותו למייל למורה.
  var pdfBlob = null;
  if (p.pdfBase64) {
    var pdfName = base + ' - גאנט אישי.pdf';
    pdfBlob = Utilities.newBlob(Utilities.base64Decode(p.pdfBase64), 'application/pdf', pdfName);
    replaceByName_(folder, pdfName);
    out.files.pdf = folder.createFile(pdfBlob).getUrl();
  }

  // קלנדר (.ics) - נשמר בתיקייה וישמש לעותק לרכז.
  var icsBlob = null;
  if (p.icsContent) {
    var icsName = base + ' - קלנדר.ics';
    replaceByName_(folder, icsName);
    icsBlob = Utilities.newBlob(p.icsContent, 'text/calendar; charset=utf-8', icsName);
    var ics = folder.createFile(icsBlob);
    out.files.ics = ics.getUrl();
  }

  // תיאור התוכנית למיילים: איזו כיתה + מתי עודכנה (כדי שהרכזת והמורה יידעו על מה מדובר).
  var planLabel = gradeLabel || 'תוכנית העבודה';
  var when = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm');

  // המיילים נשלחים לפני בניית היומן (שאורכת דקות ועלולה להיעצר במגבלת זמן הריצה
  // בעדכון חוזר) - כך המורה והרכז/ת מקבלים את המייל בכל מסירה, גם בעדכון.

  // מייל למורה: הגאנט (PDF) + קובץ היומן (.ics) לצירוף אישי ליומן שלה. תקלה כאן לא חוסמת.
  if (p.teacherEmail && (pdfBlob || icsBlob)) {
    try {
      var teacherAtts = [];
      if (pdfBlob) teacherAtts.push(pdfBlob.copyBlob());
      if (icsBlob) teacherAtts.push(icsBlob.copyBlob());
      var calNote = p.calendarName ? ('היומן "' + String(p.calendarName) + '"') : 'היומן שלך';
      MailApp.sendEmail({
        to: String(p.teacherEmail).trim(),
        subject: 'תוכנית העבודה השנתית שלך במדע וטכנולוגיה - ' + planLabel + ' - עודכן ' + when,
        htmlBody:
          '<div dir="rtl" style="text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
          'שלום ' + teacher + ',<br><br>' +
          'תוכנית העבודה השנתית שלך במדע וטכנולוגיה עבור <b>' + planLabel + '</b> מוכנה (עודכנה ב-' + when + ').<br><br>' +
          '<b>אין צורך להוריד או לייבא כלום:</b> ' + calNote + ' משותף איתך ויופיע ביומן Google שלך (תחת "יומנים אחרים") תוך כמה דקות, והוא מתעדכן לבד בכל עדכון של התוכנית.<br><br>' +
          '<b>מצורפים למייל:</b><br>' +
          '• הגאנט האישי שלך (PDF).<br>' +
          '• קובץ יומן (.ics) לגיבוי בלבד - לא חובה, היומן מופיע אצלך לבד.<br><br>' +
          '<b>לא רואה את היומן?</b> אם הוא לא הופיע תוך כמה דקות, חפשי במייל שלך הודעה מ-Google על שיתוף היומן (בנושא שם היומן, או "ההרשאות ביומן השתנו") ולחצי בה על "הוסף". אפשר גם לפתוח את יומן Google שלך כאן ולראות את כל היומנים שלך: <a href="https://calendar.google.com/">calendar.google.com</a>.<br><br>' +
          'בהצלחה,<br>' + FROM_NAME +
          '</div>',
        body: 'שלום ' + teacher + ', תוכנית העבודה שלך עבור ' + planLabel + ' מוכנה (עודכנה ב-' + when + '). היומן משותף איתך ויופיע ביומן Google תוך כמה דקות. מצורפים הגאנט (PDF) וקובץ יומן לגיבוי.',
        name: FROM_NAME,
        attachments: teacherAtts
      });
      out.teacherEmailed = true;
    } catch (tMailErr) {
      out.teacherEmailError = String(tMailErr.message || tMailErr);
    }
  }

  // עותק לרכז/ת במייל: הגאנט (PDF) + קובץ היומן (.ics), עם ציון הכיתה שעבורה הוגשה התוכנית.
  if (p.coordinatorEmail && (icsBlob || pdfBlob)) {
    try {
      var coordAtts = [];
      if (pdfBlob) coordAtts.push(pdfBlob.copyBlob());
      if (icsBlob) coordAtts.push(icsBlob.copyBlob());
      MailApp.sendEmail({
        to: String(p.coordinatorEmail).trim(),
        subject: 'תוכנית עבודה שנתית - ' + teacher + ' - ' + planLabel + ' - ' + schoolName + ' - עודכן ' + when,
        htmlBody:
          '<div dir="rtl" style="text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
          'שלום,<br><br>' +
          'מצורפת תוכנית העבודה השנתית במדע וטכנולוגיה של <b>' + teacher + '</b> עבור <b>' + planLabel + '</b> (' + schoolName + '), עודכנה ב-' + when + ':<br>' +
          '• הגאנט (PDF).<br>' +
          '• קובץ היומן (.ics).<br><br>' +
          'היומן של ' + teacher + ' ל' + planLabel + ' משותף גם ישירות איתך ומופיע ביומן Google שלך.<br>' +
          'אם הוא לא הופיע תוך כמה דקות: חפשי במייל הודעה מ-Google על שיתוף היומן ולחצי בה "הוסף", או פתחי את יומן Google כאן: <a href="https://calendar.google.com/">calendar.google.com</a>.<br><br>' +
          FROM_NAME +
          '</div>',
        body: 'תוכנית העבודה של ' + teacher + ' עבור ' + planLabel + ' (' + schoolName + '), עודכנה ב-' + when + ': הגאנט (PDF) וקובץ יומן (.ics) מצורפים. היומן משותף גם ישירות איתך.',
        name: FROM_NAME,
        attachments: coordAtts
      });
      out.coordinatorEmailed = true;
    } catch (mailErr) {
      out.coordinatorEmailError = String(mailErr.message || mailErr);
    }
  }

  // יומן אישי למורה - נוצר, מתמלא, ומשותף (מופיע לבד). תקלה כאן לא חוסמת את השאר.
  // מזוהה לפי מפתח כיתה קבוע (סמל + כיתה + מייל המורה) - עדכון חוזר מעדכן את אותו
  // יומן ולא יוצר חדש, גם אם שם היומן השתנה.
  if (p.teacherEmail && p.events && p.events.length && p.calendarName) {
    try {
      var calKey = 'plan-key:' + schoolId + '|' + gradeLabel + '|' + String(p.teacherEmail).trim().toLowerCase();
      out.calendar = syncCalendar_(String(p.calendarName), calKey, p.events, String(p.teacherEmail), String(p.coordinatorEmail || ''));
    } catch (calErr) {
      out.calendarError = String(calErr.message || calErr);
    }
  }

  return out;
}

// ===== גיליון משתמשי האתר: שורה לכל מורה, עם כל הכיתות שיצרה =====

var USERS_SHEET_NAME = 'משתמשי האתר - תומכת הוראה אישית';
var USERS_HEADERS = [
  'עדכון אחרון', 'שם בית ספר', 'סמל מוסד',
  'שם המורה', 'אימייל המורה', 'נייד המורה',
  'שם הרכזת', 'אימייל הרכזת',
  'כיתות שנוצרו', 'מספר מסירות'
];

/** מאתר/יוצר את גיליון משתמשי האתר בתוך תיקיית האם. */
function getOrCreateUsersSheet_() {
  var parent = DriveApp.getFolderById(DELIVERY_PARENT_ID);
  var it = parent.getFilesByName(USERS_SHEET_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  var ss = SpreadsheetApp.create(USERS_SHEET_NAME);
  var file = DriveApp.getFileById(ss.getId());
  parent.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}
  return ss;
}

/**
 * רושם/מעדכן את המורה בגיליון המשתמשים בכל מסירה (upsert לפי סמל + אימייל המורה):
 * שורה אחת למורה, עמודת הכיתות צוברת כל כיתה שהמורה יצרה, ומונה המסירות עולה.
 */
function logUser_(p, schoolName, schoolId, teacher) {
  var ss = getOrCreateUsersSheet_();
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.setRightToLeft(true);
    sheet.appendRow(USERS_HEADERS);
    sheet.getRange(1, 1, 1, USERS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var teacherEmail = String(p.teacherEmail || '').trim();
  var gradeLabel = String(p.gradeLabel || '').trim();
  var when = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm');

  // איתור שורה קיימת של המורה (סמל מוסד + אימייל, בלי תלות ברישיות).
  var wantSemel = String(schoolId).replace(/\D/g, '');
  var wantEmail = teacherEmail.toLowerCase();
  var rowIdx = 0; // מספר שורה בגיליון (1-based); 0 = לא נמצא
  var classes = [];
  var deliveries = 0;
  var last = sheet.getLastRow();
  if (last >= 2) {
    var data = sheet.getRange(2, 1, last - 1, USERS_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][2]).replace(/\D/g, '') === wantSemel &&
          String(data[i][4]).trim().toLowerCase() === wantEmail) {
        rowIdx = i + 2;
        classes = String(data[i][8] || '').split(',').map(function (s) { return s.trim(); }).filter(String);
        deliveries = Number(data[i][9]) || 0;
        break;
      }
    }
  }

  // צבירת הכיתה הנוכחית (בלי כפילויות) והעלאת מונה המסירות.
  if (gradeLabel && classes.indexOf(gradeLabel) < 0) classes.push(gradeLabel);
  deliveries++;

  var row = [
    when, schoolName, schoolId,
    teacher, teacherEmail, String(p.teacherPhone || '').trim(),
    String(p.coordinatorName || '').trim(), String(p.coordinatorEmail || '').trim(),
    classes.join(', '), deliveries
  ];
  if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, USERS_HEADERS.length).setValues([row]);
  else sheet.appendRow(row);

  // מיון לפי בית ספר ואז שם המורה - נוח לרכזת אחת לראות את כל הצוות יחד.
  var lastNow = sheet.getLastRow();
  if (lastNow > 2) {
    sheet.getRange(2, 1, lastNow - 1, USERS_HEADERS.length)
      .sort([{ column: 2, ascending: true }, { column: 4, ascending: true }]);
  }
  return true;
}

// ===== דיווח חריגות (item 7): גיליון אחד בתיקיית האם, ממויין לפי בית ספר =====

var DEVIATION_SHEET_NAME = 'דיווח חריגות - תוכנית עבודה מדע וטכנולוגיה';
var DEVIATION_HEADERS = [
  'תאריך ושעה', 'שם בית ספר', 'סמל מוסד', 'שם המורה', 'שכבה',
  'ש"ש בסטטוס', 'ש"ש שהוזנו בפועל', 'חריגה מהסטטוס',
  'שעות תוכן לפי משרד החינוך', 'שעות תוכן בפועל', 'פער שעות מול משרד החינוך',
  'נושאים שצומצמו'
];

/** מאתר/יוצר את גיליון דיווח החריגות בתוך תיקיית האם. */
function getOrCreateDeviationSheet_() {
  var parent = DriveApp.getFolderById(DELIVERY_PARENT_ID);
  var it = parent.getFilesByName(DEVIATION_SHEET_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  var ss = SpreadsheetApp.create(DEVIATION_SHEET_NAME);
  var file = DriveApp.getFileById(ss.getId());
  parent.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}
  return ss;
}

/**
 * רושם שורת חריגה לגיליון (רק כשיש חריגה בפועל), וממיין לפי בית ספר ואז שם המורה.
 * מחזיר true אם נרשמה שורה.
 */
function logDeviation_(p, schoolName, schoolId, teacher) {
  var d = p.deviation;
  if (!d) return false;
  var dropped = (d.droppedTopics && d.droppedTopics.length) ? d.droppedTopics : [];
  var hasDeviation = d.hoursDeviates || Number(d.shortfallHours) > 0 || dropped.length > 0;
  if (!hasDeviation) return false;

  var ss = getOrCreateDeviationSheet_();
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.setRightToLeft(true);
    sheet.appendRow(DEVIATION_HEADERS);
    sheet.getRange(1, 1, 1, DEVIATION_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var gradeLabel = String(d.gradeLabel || '');
  var when = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm');
  var row = [
    when, schoolName, schoolId, teacher, gradeLabel,
    d.statusHours == null ? '' : d.statusHours,
    d.actualHours == null ? '' : d.actualHours,
    d.hoursDeviates ? 'כן' : 'לא',
    d.moeFullHours == null ? '' : d.moeFullHours,
    d.capacityHours == null ? '' : d.capacityHours,
    d.shortfallHours == null ? '' : d.shortfallHours,
    dropped.join(', ')
  ];

  // עדכון-או-הוספה (upsert): שורה אחת לכל בית ספר + מורה + שכבה = התוכנית העדכנית ביותר,
  // בלי כפילויות. אם קיימות כבר כמה שורות תואמות - מעדכנים אחת ומוחקים את השאר.
  var wantSemel = String(schoolId).replace(/\D/g, '');
  var last = sheet.getLastRow();
  var matches = [];
  if (last >= 2) {
    var data = sheet.getRange(2, 1, last - 1, DEVIATION_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (String(r[2]).replace(/\D/g, '') === wantSemel &&
          String(r[3]).trim() === String(teacher).trim() &&
          String(r[4]).trim() === gradeLabel.trim()) {
        matches.push(i + 2); // מספר שורה בגיליון (1-based)
      }
    }
  }

  if (matches.length) {
    sheet.getRange(matches[0], 1, 1, DEVIATION_HEADERS.length).setValues([row]);
    for (var m = matches.length - 1; m >= 1; m--) sheet.deleteRow(matches[m]); // מוחקים כפילויות מלמטה למעלה
  } else {
    sheet.appendRow(row);
  }

  // מיון שורות הנתונים (בלי הכותרת) לפי בית ספר ואז שם המורה.
  var lastNow = sheet.getLastRow();
  if (lastNow > 2) {
    sheet.getRange(2, 1, lastNow - 1, DEVIATION_HEADERS.length)
      .sort([{ column: 2, ascending: true }, { column: 4, ascending: true }]);
  }
  return true;
}

/**
 * הרצה חד-פעמית בעורך לפני פרסום גרסה חדשה: "נוגעת" בכל השירותים כדי לאשר
 * את כל ההרשאות (יומן, גיליונות, דרייב, מייל) במסך אחד. אחרי ההרצה והאישור:
 * Deploy -> Manage deployments -> עריכה -> Version: New version (או New deployment).
 */
function authorizeNow() {
  CalendarApp.getAllCalendars();
  DriveApp.getRootFolder();
  var tmp = SpreadsheetApp.create('__auth_check__');
  try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e) {}
}

/**
 * מאתר את יומן התוכנית של הכיתה: קודם לפי המפתח שבתיאור היומן (סמל+כיתה+מייל -
 * עמיד לשינוי שם), ואם אין - לפי שם מדויק (אימוץ יומנים ישנים שטרם תויגו; יומן
 * שכבר תויג במפתח אחר לא נחטף). מחזיר את כל ההתאמות - הראשון משמש, השאר כפילויות.
 */
function findPlanCalendars_(name, key) {
  var owned = CalendarApp.getAllOwnedCalendars();
  var byKey = [];
  var byName = [];
  for (var i = 0; i < owned.length; i++) {
    var desc = '';
    try { desc = String(owned[i].getDescription() || ''); } catch (e) {}
    if (key && desc.indexOf(key) >= 0) byKey.push(owned[i]);
    else if (desc.indexOf('plan-key:') < 0 && owned[i].getName() === name) byName.push(owned[i]);
  }
  return byKey.length ? byKey.concat(byName) : byName;
}

/** יוצר/מעדכן יומן, ממלא אותו באירועים, ומשתף עם המורה (וגם עם הרכז). */
function syncCalendar_(name, key, events, teacherEmail, coordinatorEmail) {
  var matches = findPlanCalendars_(name, key);
  var cal = matches.length ? matches[0] : CalendarApp.createCalendar(name, { color: CalendarApp.Color.BLUE });
  // כפילויות (אותו מפתח או אותו שם) - נמחקות: לכיתה יש יומן אחד שמתעדכן.
  var deduped = 0;
  for (var dd = 1; dd < matches.length; dd++) {
    try { matches[dd].deleteCalendar(); deduped++; } catch (ddErr) {}
  }
  // תיוג היומן במפתח הכיתה + יישור השם (אם המורה שינתה שם/כיתה - היומן נשאר, השם מתעדכן).
  try { if (key) cal.setDescription(key); } catch (e1) {}
  try { if (cal.getName() !== name) cal.setName(name); } catch (e2) {}

  var calId = cal.getId();

  // מנגנון בטיחות-זמן: Apps Script נהרג קשיח אחרי 6 דקות. המיילים כבר נשלחו לפני
  // שהגענו לכאן, וסנכרון-ההפרש מהיר; אבל כגיבוי אחרון, אם עדכון היומן יתקרב לגבול -
  // נעצור אותו יפה (partial) במקום להיהרג. מה שלא הספיק יושלם במסירה הבאה (הסנכרון
  // משאיר את מה שכבר נוצר ומוסיף רק את החסר). כך הריצה לעולם לא "נתקעת".
  var startTime = new Date().getTime();
  var TIME_BUDGET_MS = 270000; // 4.5 דקות לעבודת היומן (בונוס בטיחות של ~90ש' עד ה-6 דקות)
  var partial = false;

  // שיתוף (קריאה) עם המורה והרכז - קודם, כדי שהשיתוף לא ייפגע גם אם עדכון
  // האירועים ייעצר במגבלת זמן הריצה. אידמפוטנטי (אם כבר משותף, נתפס ב-catch).
  shareCalendar_(calId, teacherEmail);
  if (coordinatorEmail) shareCalendar_(calId, coordinatorEmail);

  // סנכרון-הפרש (במקום "מחק הכול ובנה מחדש"): קוראים את האירועים הקיימים בטווח
  // השנה בקריאה אחת, משאירים אירועים שלא השתנו (כותרת+תאריכים), מוסיפים רק חדשים
  // ומוחקים רק את מה שירד מהתוכנית. עדכון חוזר של אותה כיתה נהיה מהיר בסדר גודל -
  // רחוק ממגבלת 6 הדקות של Apps Script (שגרמה למסירות חוזרות להיקטע באמצע).
  var existing = {}; // חתימה "כותרת|התחלה|סוף" -> רשימת מזהי אירועים קיימים
  var pageToken = null;
  do {
    var resp = Calendar.Events.list(calId, {
      timeMin: '2026-08-01T00:00:00Z',
      timeMax: '2027-08-31T00:00:00Z',
      maxResults: 2500,
      singleEvents: false,
      showDeleted: false,
      pageToken: pageToken
    });
    var items = resp.items || [];
    for (var x = 0; x < items.length; x++) {
      var it = items[x];
      var st = it.start ? (it.start.date || String(it.start.dateTime || '').slice(0, 10)) : '';
      var en = it.end ? (it.end.date || String(it.end.dateTime || '').slice(0, 10)) : '';
      // החתימה כוללת גם את התיאור, כך שעדכון פירוט תתי-הנושא מזוהה כשינוי ומסונכרן.
      var sig = String(it.summary || '') + '|' + st + '|' + en + '|' + String(it.description || '');
      if (!existing[sig]) existing[sig] = [];
      existing[sig].push(it.id);
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);

  // הוספת אירועי התוכנית (יום-שלם; end בלעדי), עם צבע לפי קטגוריה.
  // צובעים דרך ה-API המתקדם (Calendar.Events.insert עם colorId) - זו השיטה שנתפסת אצל
  // גוגל (setColor לא עבד). אם ההוספה נכשלת - נפילה חזרה ל-createAllDayEvent (בלי צבע),
  // כדי שהאירוע עדיין ייווצר. מחזירים ספירות כדי שנוכל לוודא מהתשובה.
  var isoRe = /^\d{4}-\d{2}-\d{2}$/;
  var added = 0, kept = 0, colored = 0, colorErr = 0;
  for (var j = 0; j < events.length; j++) {
    // גיבוי בטיחות: אם התקרבנו לגבול הזמן - עוצרים כאן (מה שנשאר יושלם במסירה הבאה).
    if (new Date().getTime() - startTime > TIME_BUDGET_MS) { partial = true; break; }
    var ev = events[j];
    var title = String(ev.title || '').trim();
    if (!title || !isoRe.test(String(ev.start))) continue;
    var endDate = (isoRe.test(String(ev.end)) && String(ev.end) > String(ev.start)) ? String(ev.end) : nextIso_(ev.start);
    var desc = String(ev.description || '');
    var wantSig = title + '|' + String(ev.start) + '|' + endDate + '|' + desc;
    if (existing[wantSig] && existing[wantSig].length) {
      existing[wantSig].shift(); // האירוע כבר ביומן, בלי שינוי - נשאר
      kept++;
      continue;
    }
    var colorId = colorFor_(ev.category);
    var resource = { summary: title, start: { date: String(ev.start) }, end: { date: endDate } };
    if (desc) resource.description = desc;
    if (colorId) resource.colorId = colorId;
    try {
      Calendar.Events.insert(resource, calId);
      added++;
      if (colorId) colored++;
    } catch (insErr) {
      try {
        var s = parseYmd_(ev.start), e = parseYmd_(endDate);
        var created = (e && e.getTime() > s.getTime()) ? cal.createAllDayEvent(title, s, e) : cal.createAllDayEvent(title, s);
        if (desc && created) { try { created.setDescription(desc); } catch (dErr) {} }
        added++;
        if (colorId) colorErr++;
      } catch (e2) {}
    }
  }

  // מחיקת מה שנשאר ברשימת הקיימים: אירועים שירדו מהתוכנית + כפילויות ישנות.
  // אם נעצרנו על גבול הזמן (partial) - לא מוחקים, כדי לא למחוק אירועים שעדיין לא
  // הספקנו להוסיף מחדש; המחיקה תתבצע במסירה הבאה כשהסנכרון יושלם.
  var removed = 0;
  if (!partial) {
    for (var delSig in existing) {
      var ids = existing[delSig];
      for (var y = 0; y < ids.length; y++) {
        if (new Date().getTime() - startTime > TIME_BUDGET_MS) { partial = true; break; }
        try { Calendar.Events.remove(calId, ids[y]); removed++; } catch (delErr) {}
      }
      if (partial) break;
    }
  }

  return { id: calId, count: added + kept, added: added, kept: kept, removed: removed, colored: colored, colorErrors: colorErr, deduped: deduped, partial: partial };
}

/** משתף יומן עם משתמש בהרשאת קריאה (דורש את שירות Google Calendar API). */
function shareCalendar_(calendarId, email) {
  var target = String(email || '').trim();
  if (!target) return;
  try {
    Calendar.Acl.insert({ role: 'reader', scope: { type: 'user', value: target } }, calendarId);
  } catch (aclErr) {
    // כנראה כבר משותף, או שהשירות לא הופעל - לא חוסם.
  }
}

/**
 * תצוגת רכז/ת: רשימת התוצרים המתויקים של בית הספר (לפי סמל מוסד).
 * פותח שיתוף-בקישור (צפייה) לקבצים כדי שהרכז/ת תוכל לפתוח אותם.
 */
function listPlans_(semel) {
  var s = String(semel).replace(/\D/g, '');
  if (!s) return { ok: false, error: 'חסר סמל מוסד' };
  var parent = DriveApp.getFolderById(DELIVERY_PARENT_ID);
  var folders = parent.getFolders();
  var out = [];
  var schoolName = '';
  while (folders.hasNext()) {
    var f = folders.next();
    if (f.getName().indexOf(s) < 0) continue; // תיקיות בית הספר: "שם - סמל"
    schoolName = schoolName || f.getName().replace(new RegExp('\\s*-\\s*' + s + '\\s*$'), '');
    var files = f.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shErr) {}
      out.push({
        name: file.getName(),
        updated: Utilities.formatDate(file.getLastUpdated(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm'),
        url: file.getUrl()
      });
    }
  }
  return { ok: true, school: schoolName, files: out };
}

function getOrCreateSchoolFolder_(schoolName, schoolId) {
  var parent = DriveApp.getFolderById(DELIVERY_PARENT_ID);
  var folderName = sanitize_(schoolName + ' - ' + schoolId);
  var existing = parent.getFoldersByName(folderName);
  return existing.hasNext() ? existing.next() : parent.createFolder(folderName);
}

function replaceByName_(folder, name) {
  var files = folder.getFilesByName(name);
  while (files.hasNext()) files.next().setTrashed(true);
}

function parseYmd_(s) {
  var m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** YYYY-MM-DD של היום שאחרי (ל-DTEND בלעדי כשחסר). */
function nextIso_(s) {
  var d = parseYmd_(s);
  if (!d) return String(s);
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, 'Asia/Jerusalem', 'yyyy-MM-dd');
}

/**
 * צבע ליומן לפי קטגוריית האירוע (colorId של Google Calendar), תואם למקרא באפליקציה:
 * נושא=טורקיז, משימת מודל=סגול, מבחן=צהוב, חקר/יריד=ירוק, יוזמה=כחול, חופשה=אדום בהיר.
 */
function colorFor_(category) {
  // colorId של ה-API המתקדם של Google Calendar ("1".."11").
  switch (String(category || '')) {
    case 'נושא': return '7';        // Peacock - טורקיז
    case 'משימת מודל': return '3';  // Grape - סגול
    case 'מבחן': return '5';        // Banana - צהוב
    case 'חקר': return '10';        // Basil - ירוק (שיעור חקר)
    case 'יריד': return '10';       // Basil - ירוק
    case 'תזכורת': return '2';      // Sage - ירוק בהיר (תזכורת חקר, נבדל משיעור חקר)
    case 'יוזמה': return '9';       // Blueberry - כחול
    case 'חופשה': return '4';       // Flamingo - אדום בהיר
    default: return '';
  }
}

function sanitize_(s) {
  return String(s).replace(/"/g, '״').replace(/[\/\\:*?<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
