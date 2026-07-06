/**
 * תומכת הוראה אישית - חיבור חי לסטטוס (Google Apps Script).
 * ------------------------------------------------------------------
 * קורא את גיליון הסטטוס *בזמן אמת* בכל בקשה ומחזיר את פרטי בית הספר לפי
 * סמל מוסד. אין עותק/צילום-מצב - תמיד הנתון העדכני בגיליון.
 *
 * ⚠️ script *עצמאי ונפרד* - כדי לא להתנגש ב-Apps Script אחר שכבר מחובר לגיליון.
 * הוא קורא את הגיליון לפי ID (openById), לא bound אליו. קריאה בלבד -> לא מפריע
 * לשום מערכת אחרת (אפשר אינסוף קוראים במקביל).
 *
 * פריסה (בחשבון Google של נופר - Claude לא נכנס/מפרסם בשמה):
 *   1. להיכנס ל- https://script.google.com  ->  New project (פרויקט *חדש ונפרד*,
 *      לא דרך התפריט של הגיליון!).
 *   2. להדביק את כל הקובץ הזה, לשמור.
 *   3. Deploy -> New deployment -> סוג: Web app.
 *        Execute as: Me ; Who has access: Anyone with the link
 *   4. באישור ההרשאות שיקפוץ - לאשר גישה לגיליון (זה הגיליון שלך).
 *   5. להעתיק את ה-Web app URL ולמסור אותו.
 *
 * בדיקה מהירה בדפדפן:  <WEB_APP_URL>?semel=<סמל אמיתי>
 *
 * פרטיות: מוחזר רק תת-קבוצת השדות הדרושים (כולל מייל רכז לשליחת הקלנדר).
 * טלפון וכל ~90 השדות המנהליים אינם מוחזרים.
 * SHARED_TOKEN (אופציונלי) חוסם גרידה מזדמנת - להפעיל ע"י מילוי מחרוזת.
 */

// מזהה גיליון הסטטוס (מה-URL של הגיליון).
var SHEET_ID = '1x_t0v1w3GGyQqGomuuusm5rE4pS1y2uQq5hH5EWYCOw';
var SHARED_TOKEN = ''; // למשל '8x3k...' ; ריק = ללא טוקן.

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (SHARED_TOKEN && p.token !== SHARED_TOKEN) return json({ error: 'unauthorized' });

  var semel = String(p.semel || '').replace(/\D/g, '');
  if (!semel) return json({ found: false, error: 'missing semel' });

  // קריאה עצמאית לפי ID (לא bound) - בוחר את הטאב שמכיל את כותרת "סמל מוסד".
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheets = ss.getSheets();
  var sheet = sheets[0];
  for (var si = 0; si < sheets.length; si++) {
    var head = sheets[si].getRange(1, 1, 1, sheets[si].getLastColumn()).getValues()[0].join('|');
    if (head.indexOf('סמל מוסד') !== -1) { sheet = sheets[si]; break; }
  }
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return json({ found: false, semel: semel });

  var headers = values[0].map(function (h) { return String(h); });

  // איתור עמודה לפי מילות-מפתח בכותרת (עמיד לשינוי סדר/נוסח, ולגרשיים).
  function col() {
    var kws = Array.prototype.slice.call(arguments);
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      var ok = true;
      for (var k = 0; k < kws.length; k++) { if (h.indexOf(kws[k]) === -1) { ok = false; break; } }
      if (ok) return i;
    }
    return -1;
  }

  var c = {
    school:        col('שם ביה'),               // "שם ביה"ס + סמל מוסד"
    h7:            col('שעות הוראה', 'שכבה ז'),
    h8:            col('שעות הוראה', 'שכבה ח'),
    h9:            col('שעות הוראה', 'שכבה ט'),
    lab:           col('לבורנט'),
    fairSchool:    col('יריד בית ספרי'),
    fairDistrict:  col('יריד החקר המחוזי'),
    initiatives:   col('יוזמות', 'מתוכננות'),
    coEmail:       col('דוא', 'רכז'),
    coFirst:       col('שם פרטי רכז'),
    coLast:        col('שם משפחה רכז')
  };

  // השורה העדכנית ביותר עבור הסמל (הרכז עשוי לעדכן כמה פעמים -> נבחר האחרונה).
  var semelCol = c.school;
  var rowIdx = -1;
  for (var r = values.length - 1; r >= 1; r--) {
    var cell = String(values[r][semelCol] || '').replace(/\D/g, '');
    if (cell.indexOf(semel) !== -1) { rowIdx = r; break; }
  }
  if (rowIdx === -1) return json({ found: false, semel: semel });

  var row = values[rowIdx];
  function val(i) { return i >= 0 ? String(row[i] == null ? '' : row[i]).trim() : ''; }
  function num(i) { var v = val(i).replace(/[^\d.]/g, ''); return v ? Number(v) : null; }
  function yesNo(i) { var v = val(i); return v ? /כן|יש|מתקיים|הצג/.test(v) : null; }

  var coverage = [];
  function field(key, value) { if (value !== null && value !== '') coverage.push(key); return value; }

  var schoolRaw = val(c.school);
  var schoolName = schoolRaw.replace(/\d{5,}/g, '').replace(/[-+|,]\s*$/, '').trim();

  var result = {
    found: true,
    semel: semel,
    schoolName: field('schoolName', schoolName),
    hoursByGrade: {
      7: field('hours7', num(c.h7)),
      8: field('hours8', num(c.h8)),
      9: field('hours9', num(c.h9))
    },
    hasLab: field('hasLab', yesNo(c.lab)),
    schoolFair: field('schoolFair', yesNo(c.fairSchool)),
    districtFair: field('districtFair', yesNo(c.fairDistrict)),
    plannedInitiatives: field('plannedInitiatives', val(c.initiatives)),
    coordinator: {
      name: field('coordinatorName', (val(c.coFirst) + ' ' + val(c.coLast)).trim()),
      email: field('coordinatorEmail', val(c.coEmail))
    },
    coverage: coverage
  };
  return json(result);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
