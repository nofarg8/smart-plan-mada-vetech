import type { BreadthTopic, GradeBank } from './types';
import { grade7 } from './grade7';
import { grade8 } from './grade8';
import { modelTasksGrade7, modelTasksGrade8, grade8ModelTaskCount } from './modelTasks';
import { ganttWeeks, teachingWeeks, setLiveGantt } from './gantt';
import { initiatives } from './initiatives';
import { officialHolidays } from './holidays';
import { fetchLiveGantt } from './liveGantt';
import { type SchoolStatus } from './mockStatus';
import { fetchSchool } from './statusApi';

export * from './types';
export { grade7, grade8, modelTasksGrade7, modelTasksGrade8, grade8ModelTaskCount };
export { ganttWeeks, teachingWeeks, setLiveGantt };
export { initiatives };
export { officialHolidays };
export { fetchLiveGantt };
export { fetchSchool };
export type { SchoolStatus };

export const modelTasks: Record<7 | 8, typeof modelTasksGrade7> = {
  7: modelTasksGrade7,
  8: modelTasksGrade8,
};

export const banks: Record<7 | 8, GradeBank> = { 7: grade7, 8: grade8 };

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
