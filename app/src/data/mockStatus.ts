// טיפוס "פרטי בית הספר" - מה שהרכז ממלא בסטטוס, כפי שהקריאה החיה מחזירה לפי סמל מוסד.
// הנתונים נשלפים חי מהסטטוס (statusApi.ts); אין כאן נתוני דמו - קריאה שנכשלת מחזירה null.

export interface SchoolStatus {
  semel: string;
  schoolName: string;
  coordinatorName: string;
  coordinatorEmail: string;
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
