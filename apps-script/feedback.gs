/**
 * תומכת הוראה אישית - קליטת משוב ודיווח תקלות (Google Apps Script).
 *
 * ⚠️ רץ בחשבון ה-האישי של נופר (gergrood@gmail.com) - לא בחשבון ההתיישבותי!
 * הדיווחים נאספים בגיליון Google Sheets בדרייב האישי, ותקלות שולחות גם מייל התראה.
 *
 * מה הסקריפט עושה בכל שליחה מהאתר (הכפתור הצף "משוב ותקלות"):
 *   1. מאתר/יוצר גיליון בשם "משוב ודיווח תקלות - תומכת הוראה אישית" בדרייב.
 *   2. כותב שורה בלשונית המתאימה ("משוב" או "דיווח תקלות") - הפרטים הכלליים,
 *      התשובות לפי סדר השאלות, ופרטי דפדפן (לאבחון תקלות).
 *   3. על דיווח תקלה - שולח מייל התראה מיידי לנופר עם כל הפרטים.
 *
 * פרסום (בחשבון gergrood@gmail.com): script.google.com -> New project -> להדביק את
 * הקובץ הזה -> Deploy -> New deployment -> Web app -> Execute as: Me ;
 * Who has access: Anyone -> להעתיק את ה-URL ולשלוח ל-Claude (מתעדכן ב-export.ts).
 */

var FEEDBACK_SPREADSHEET_NAME = 'משוב ודיווח תקלות - תומכת הוראה אישית';
var NOTIFY_EMAIL = 'gergrood@gmail.com';

/**
 * ⭐ הרצה חד-פעמית בעורך לפני הפרסום: "נוגעת" בדרייב, בגיליונות ובמייל כדי
 * שגוגל תבקש את כל ההרשאות במסך אחד. אחרי ההרצה והאישור - לפרסם New deployment.
 * (בלי זה הפרסום ננעל בלי הרשאת דרייב, והשליחות מהאתר נכשלות.)
 */
function authorizeNow() {
  DriveApp.getRootFolder();
  MailApp.getRemainingDailyQuota();
  var tmp = SpreadsheetApp.create('__auth_check__');
  try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e) {}
}

var GENERAL_HEADERS = ['תאריך ושעה', 'סוג', 'שם מלא', 'שם בית הספר', 'סמל מוסד', 'תפקיד', 'אימייל', 'נייד'];

function doPost(e) {
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(p.action || '') !== 'feedback') {
      return json_({ ok: false, error: 'פעולה לא מוכרת' });
    }
    var isBug = String(p.type || '') === 'דיווח תקלה';
    var when = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm');
    var general = [
      when, String(p.type || ''), String(p.name || ''), String(p.school || ''),
      String(p.semel || ''), String(p.role || ''), String(p.email || ''), String(p.phone || '')
    ];

    // התשובות מגיעות כ-{שאלה: תשובה} לפי סדר השאלות בטופס.
    var answers = p.answers || {};
    var qs = [];
    var vals = [];
    for (var k in answers) { qs.push(k); vals.push(String(answers[k] || '')); }
    if (isBug) { qs.push('דפדפן (אוטומטי)'); vals.push(String(p.userAgent || '')); }

    var ss = getSpreadsheet_();
    appendRow_(ss, isBug ? 'דיווח תקלות' : 'משוב', GENERAL_HEADERS.concat(qs), general.concat(vals));

    if (isBug) {
      try { notifyBug_(p, when, ss); } catch (mailErr) {}
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'feedback' });
}

/** מאתר/יוצר את קובץ הגיליון, ומוודא ששתי הלשוניות (משוב + דיווח תקלות) קיימות. */
function getSpreadsheet_() {
  var it = DriveApp.getFilesByName(FEEDBACK_SPREADSHEET_NAME);
  var ss = it.hasNext() ? SpreadsheetApp.open(it.next()) : SpreadsheetApp.create(FEEDBACK_SPREADSHEET_NAME);
  // שתי הלשוניות נוצרות מראש - כדי שהלינקים אליהן במייל ההתראה יעבדו תמיד.
  if (!ss.getSheetByName('דיווח תקלות')) ss.insertSheet('דיווח תקלות');
  if (!ss.getSheetByName('משוב')) ss.insertSheet('משוב');
  // מוחקים את לשונית ברירת המחדל הריקה של גיליון חדש.
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) {
    try { ss.deleteSheet(def); } catch (e) {}
  }
  return ss;
}

/** לינק ישיר ללשונית בתוך הגיליון. */
function tabUrl_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  return sheet ? (ss.getUrl() + '#gid=' + sheet.getSheetId()) : ss.getUrl();
}

/** מוודא שורת כותרות בלשונית ומוסיף שורה. */
function appendRow_(ss, sheetName, headers, row) {
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.setRightToLeft(true);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow(row);
}

/** מייל התראה מיידי על דיווח תקלה, כולל לינקים ללשוניות התקלות והמשובים. */
function notifyBug_(p, when, ss) {
  var answers = p.answers || {};
  var lines = '';
  for (var k in answers) {
    lines += '<b>' + k + ':</b> ' + String(answers[k] || '') + '<br>';
  }
  var bugsUrl = tabUrl_(ss, 'דיווח תקלות');
  var feedbackUrl = tabUrl_(ss, 'משוב');
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: 'תקלה חדשה בתומכת ההוראה - ' + String(p.name || '') + ' (' + String(p.school || '') + ')',
    htmlBody:
      '<div dir="rtl" style="text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
      '<b>התקבל דיווח תקלה חדש</b> (' + when + ')<br><br>' +
      '<b>שם:</b> ' + String(p.name || '') + '<br>' +
      '<b>בית ספר:</b> ' + String(p.school || '') + (p.semel ? ' (' + p.semel + ')' : '') + '<br>' +
      '<b>תפקיד:</b> ' + String(p.role || '') + '<br>' +
      '<b>אימייל:</b> ' + String(p.email || '') + '<br>' +
      '<b>נייד:</b> ' + String(p.phone || '') + '<br><br>' +
      lines + '<br>' +
      '<b>דפדפן (אוטומטי):</b> ' + String(p.userAgent || '') + '<br><br>' +
      '<b>כל הדיווחים במקום אחד:</b><br>' +
      '• <a href="' + bugsUrl + '">גיליון דיווחי התקלות</a><br>' +
      '• <a href="' + feedbackUrl + '">גיליון המשובים</a>' +
      '</div>',
    body: 'התקבל דיווח תקלה חדש מ-' + String(p.name || '') + ' (' + String(p.school || '') + '). כל הדיווחים: ' + bugsUrl
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
