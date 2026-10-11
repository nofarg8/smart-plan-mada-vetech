// טיפוס "פרטי בית הספר" - מה שהרכז ממלא בסטטוס, כפי שהקריאה החיה מחזירה לפי סמל מוסד.
// הנתונים נשלפים חי מהסטטוס (statusApi.ts); אין כאן נתוני דמו - קריאה שנכשלת מחזירה null.

export interface SchoolStatus {
  semel: string;
  schoolName: string;
  coordinatorName: string;
  coordinatorEmail: string;
  /**
   * כל כתובות המייל שמופיעות בסטטוס לאותו סמל מוסד - הרכז/ת וגם מי שנוסף/ה
   * לאימות בלבד (מנהלת אשכול, רכזת פדגוגית, רכזת נוספת). כל אחת מהן מאפשרת
   * כניסה. `coordinatorEmail` נשאר הרכז/ת הראשי/ת - אליו/ה נשלחים המיילים.
   */
  authorizedEmails: string[];
  /** ש"ש לתלמיד לפי שכבה. */
  hoursByGrade: Record<number, number>;
  hasLab?: boolean;
  /** יריד חקר בית-ספרי (עמודת הסטטוס). */
  schoolFair?: boolean;
  /** הצגה ביריד החקר המחוזי (עמודת הסטטוס). */
  districtFair?: boolean;
  /** טקסט חופשי: יוזמות/תחרויות מדעיות שהרכז ציין (עמודת הסטטוס). */
  initiatives?: string;
}
