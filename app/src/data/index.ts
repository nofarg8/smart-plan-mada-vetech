import type { BreadthTopic, GradeBank, Grade } from './types';
import { grade7 } from './grade7';
import { grade8 } from './grade8';
import { grade9 } from './grade9';
import { modelTasksGrade7, modelTasksGrade8, grade8ModelTaskCount } from './modelTasks';
import { ganttWeeks, teachingWeeks, setLiveGantt } from './gantt';
import { initiatives } from './initiatives';
import { officialHolidays, schoolDayObservances } from './holidays';
import { fetchLiveGantt } from './liveGantt';
import { type SchoolStatus } from './mockStatus';
import { fetchSchool } from './statusApi';
import { coreSubtopics } from './coreSubtopics';

export * from './types';
export { coreSubtopics };
export { grade7, grade8, grade9, modelTasksGrade7, modelTasksGrade8, grade8ModelTaskCount };
export { ganttWeeks, teachingWeeks, setLiveGantt };
export { initiatives };
export { officialHolidays, schoolDayObservances };
export { fetchLiveGantt };
export { fetchSchool };
export type { SchoolStatus };

// כיתה ט' - אין משימות מודל (מקור: נופר). הבנק בכל זאת נכלל.
export const modelTasks: Record<Grade, typeof modelTasksGrade7> = {
  7: modelTasksGrade7,
  8: modelTasksGrade8,
  9: [],
};

export const banks: Record<Grade, GradeBank> = { 7: grade7, 8: grade8, 9: grade9 };

/** קיבוץ נושאי הרוחב לפי תחום תוכן, לשמירת הסדר המקורי. */
export function topicsByDomain(bank: GradeBank): { domain: string; topics: BreadthTopic[] }[] {
  const order: string[] = [];
  const map = new Map<string, BreadthTopic[]>();
  for (const t of bank.topics) {
    if (!map.has(t.domain)) {
      map.set(t.domain, []);
      order.push(t.domain);
    }
    map.get(t.domain)!.push(t);
  }
  return order.map((domain) => ({ domain, topics: map.get(domain)! }));
}
