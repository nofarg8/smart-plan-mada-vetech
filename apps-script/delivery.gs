/**
 * תומכת הוראה אישית - מסירת התוצרים (Google Apps Script).
 * רץ תחת חשבון ההתיישבותי -> גישה מלאה ל-Drive, למייל וליומן, בלי API חיצוני.
 *
 * בכל מסירה (action = 'deliverPlan'):
 *   1. תת-תיקייה "שם ביה"ס - סמל מוסד" בתוך התיקייה הראשית ששיתפת -> שומר PDF + קלנדר.
 *   2. יוצר/מעדכן יומן אישי למורה, ממלא אותו באירועי התוכנית, ומשתף עם המורה
 *      (מופיע לבד בגוגל קלנדר, בלי ייבוא). בעדכון - מנקה ובונה מחדש את אותו יומן.
 *   3. שולח למורה מייל עם הגאנט (PDF) + קובץ היומן (.ics) לצירוף אישי ליומן שלה.
 *   4. שולח לרכז/ת עותק קלנדר במייל.
 *   5. רושם חריגות (מול הסטטוס / מול שעות משרד החינוך) לגיליון אחד בתיקיית האם.
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
  var base = sanitize_(teacher);
  var out = { ok: true, folderUrl: folder.getUrl(), files: {} };

  // דיווח חריגות (פנימי) לגיליון בתיקיית האם - קודם כול, כדי שיירשם מיד. לא חוסם.
  try {
    if (logDeviation_(p, schoolName, schoolId, teacher)) out.deviationLogged = true;
  } catch (devErr) {
    out.deviationError = String(devErr.message || devErr);
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

  // יומן אישי למורה - נוצר, מתמלא, ומשותף (מופיע לבד). תקלה כאן לא חוסמת את השאר.
  if (p.teacherEmail && p.events && p.events.length && p.calendarName) {
    try {
      out.calendar = syncCalendar_(String(p.calendarName), p.events, String(p.teacherEmail), String(p.coordinatorEmail || ''));
    } catch (calErr) {
      out.calendarError = String(calErr.message || calErr);
    }
  }

  // מייל למורה: הגאנט (PDF) + קובץ היומן (.ics) לצירוף אישי ליומן שלה. תקלה כאן לא חוסמת.
  if (p.teacherEmail && (pdfBlob || icsBlob)) {
    try {
      var teacherAtts = [];
      if (pdfBlob) teacherAtts.push(pdfBlob.copyBlob());
      if (icsBlob) teacherAtts.push(icsBlob.copyBlob());
      var calNote = p.calendarName ? ('היומן "' + String(p.calendarName) + '"') : 'היומן שלך';
      MailApp.sendEmail({
        to: String(p.teacherEmail).trim(),
        subject: 'תוכנית העבודה השנתית שלך במדע וטכנולוגיה - ' + teacher,
        htmlBody:
          '<div dir="rtl" style="text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
          'שלום ' + teacher + ',<br><br>' +
          'תוכנית העבודה השנתית שלך במדע וטכנולוגיה מוכנה.<br><br>' +
          '<b>אין צורך להוריד או לייבא כלום:</b> ' + calNote + ' כבר משותף איתך ומופיע אוטומטית ביומן Google שלך (תחת "יומנים אחרים"), ומתעדכן לבד בכל עדכון של התוכנית.<br><br>' +
          '<b>מצורפים למייל:</b><br>' +
          '• הגאנט האישי שלך (PDF).<br>' +
          '• קובץ יומן (.ics) לגיבוי בלבד - לא חובה, היומן כבר מופיע אצלך.<br><br>' +
          '<b>לא רואה את היומן?</b> אם הוא לא הופיע אוטומטית, חפשי במייל שלך הודעה מ-Google על שיתוף היומן (בנושא שם היומן, או "ההרשאות ביומן השתנו") ולחצי בה על "הוסף". אפשר גם לפתוח את יומן Google שלך כאן ולראות את כל היומנים שלך: <a href="https://calendar.google.com/">calendar.google.com</a>.<br><br>' +
          'בהצלחה,<br>' + FROM_NAME +
          '</div>',
        body: 'שלום ' + teacher + ', תוכנית העבודה שלך מוכנה. היומן כבר משותף איתך ומופיע אוטומטית ביומן Google. מצורפים הגאנט (PDF) וקובץ יומן לגיבוי.',
        name: FROM_NAME,
        attachments: teacherAtts
      });
      out.teacherEmailed = true;
    } catch (tMailErr) {
      out.teacherEmailError = String(tMailErr.message || tMailErr);
    }
  }

  // עותק לרכז/ת במייל: הגאנט (PDF) + קובץ היומן (.ics).
  if (p.coordinatorEmail && (icsBlob || pdfBlob)) {
    try {
      var coordAtts = [];
      if (pdfBlob) coordAtts.push(pdfBlob.copyBlob());
      if (icsBlob) coordAtts.push(icsBlob.copyBlob());
      MailApp.sendEmail({
        to: String(p.coordinatorEmail).trim(),
        subject: 'תוכנית עבודה שנתית - ' + teacher + ' - ' + schoolName,
        htmlBody:
          '<div dir="rtl" style="text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
          'שלום,<br><br>' +
          'מצורפת תוכנית העבודה השנתית במדע וטכנולוגיה של ' + teacher + ' (' + schoolName + '):<br>' +
          '• הגאנט (PDF).<br>' +
          '• קובץ היומן (.ics).<br><br>' +
          'היומן של ' + teacher + ' משותף גם ישירות איתך ומופיע ביומן Google שלך.<br>' +
          'אם הוא לא הופיע אוטומטית: חפשי במייל הודעה מ-Google על שיתוף היומן ולחצי בה "הוסף", או פתחי את יומן Google כאן: <a href="https://calendar.google.com/">calendar.google.com</a>.<br><br>' +
          FROM_NAME +
          '</div>',
        body: 'תוכנית העבודה של ' + teacher + ' (' + schoolName + '): הגאנט (PDF) וקובץ יומן (.ics) מצורפים. היומן משותף גם ישירות איתך.',
        name: FROM_NAME,
        attachments: coordAtts
      });
      out.coordinatorEmailed = true;
    } catch (mailErr) {
      out.coordinatorEmailError = String(mailErr.message || mailErr);
    }
  }

  return out;
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

/** יוצר/מעדכן יומן, ממלא אותו באירועים, ומשתף עם המורה (וגם עם הרכז). */
function syncCalendar_(name, events, teacherEmail, coordinatorEmail) {
  var cals = CalendarApp.getCalendarsByName(name);
  var cal = cals.length ? cals[0] : CalendarApp.createCalendar(name, { color: CalendarApp.Color.BLUE });

  // ניקוי אירועים קודמים בטווח שנת הלימודים -> בנייה מחדש, בלי כפילויות.
  var from = new Date(2026, 7, 1); // אוגוסט 2026
  var to = new Date(2027, 7, 31);  // אוגוסט 2027
  var old = cal.getEvents(from, to);
  for (var i = 0; i < old.length; i++) {
    try { old[i].deleteEvent(); } catch (delErr) {}
  }

  // הוספת אירועי התוכנית (יום-שלם; end בלעדי), עם צבע לפי קטגוריה.
  // צובעים דרך ה-API המתקדם (Calendar.Events.insert עם colorId) - זו השיטה שנתפסת אצל
  // גוגל (setColor לא עבד). אם ההוספה נכשלת - נפילה חזרה ל-createAllDayEvent (בלי צבע),
  // כדי שהאירוע עדיין ייווצר. מחזירים ספירה של כמה נצבעו כדי שנוכל לוודא מהתשובה.
  var calId = cal.getId();
  var isoRe = /^\d{4}-\d{2}-\d{2}$/;
  var added = 0, colored = 0, colorErr = 0;
  for (var j = 0; j < events.length; j++) {
    var ev = events[j];
    var title = String(ev.title || '').trim();
    if (!title || !isoRe.test(String(ev.start))) continue;
    var endDate = (isoRe.test(String(ev.end)) && String(ev.end) > String(ev.start)) ? String(ev.end) : nextIso_(ev.start);
    var colorId = colorFor_(ev.category);
    var resource = { summary: title, start: { date: String(ev.start) }, end: { date: endDate } };
    if (colorId) resource.colorId = colorId;
    try {
      Calendar.Events.insert(resource, calId);
      added++;
      if (colorId) colored++;
    } catch (insErr) {
      try {
        var s = parseYmd_(ev.start), e = parseYmd_(endDate);
        if (e && e.getTime() > s.getTime()) cal.createAllDayEvent(title, s, e); else cal.createAllDayEvent(title, s);
        added++;
        if (colorId) colorErr++;
      } catch (e2) {}
    }
  }

  // שיתוף (קריאה) עם המורה והרכז - אידמפוטנטי (אם כבר משותף, נתפס ב-catch).
  shareCalendar_(cal.getId(), teacherEmail);
  if (coordinatorEmail) shareCalendar_(cal.getId(), coordinatorEmail);

  return { id: cal.getId(), count: added, colored: colored, colorErrors: colorErr };
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
    case 'חקר': return '10';        // Basil - ירוק
    case 'יריד': return '10';       // Basil - ירוק
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
