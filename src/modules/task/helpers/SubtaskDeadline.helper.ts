import { Tasks } from "../entities/Task.entity";

export const getVietnamCalendarDateKey = (date: Date | string): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(d);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};

export const formatVietnamDisplayDate = (date: Date | string): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(d);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.day}-${values.month}-${values.year}`;
};

/**
 * Checks if dateA is strictly after dateB in Vietnam timezone.
 * Compares calendar date first; if on the same day, compares timestamp.
 */
export const isDateAfter = (dateA: Date | string, dateB: Date | string): boolean => {
    const dA = typeof dateA === "string" ? new Date(dateA) : dateA;
    const dB = typeof dateB === "string" ? new Date(dateB) : dateB;
    const keyA = getVietnamCalendarDateKey(dA);
    const keyB = getVietnamCalendarDateKey(dB);

    if (keyA > keyB) return true;
    if (keyA < keyB) return false;
    return dA.getTime() > dB.getTime();
};

/**
 * Ràng buộc: Deadline task con phải nhỏ hơn hoặc bằng task cha.
 */
export const assertSubtaskDeadlineNotExceedParent = (
    subtaskDeadline: Date | string,
    parentDeadline?: Date | string | null,
    subtaskName?: string,
    parentName?: string
): void => {
    if (!parentDeadline) return;

    if (isDateAfter(subtaskDeadline, parentDeadline)) {
        const parentDisplay = formatVietnamDisplayDate(parentDeadline);
        const subtaskLabel = subtaskName ? ` '${subtaskName}'` : "";
        const parentLabel = parentName ? ` '${parentName}'` : "";

        const error: any = new Error(
            `Deadline của công việc con${subtaskLabel} không được vượt quá deadline của công việc cha${parentLabel} (Hạn chót cha: ${parentDisplay})`
        );
        error.statusCode = 400;
        throw error;
    }
};

/**
 * Ràng buộc: Khi sửa deadline task cha, không được đặt sớm hơn deadline của các task con đã có.
 */
export const assertParentDeadlineNotBeforeSubtasks = (
    newParentDeadline: Date | string,
    subtasks: Tasks[],
    parentName?: string
): void => {
    if (!subtasks || subtasks.length === 0) return;

    const conflictingSubtasks = subtasks.filter(
        subtask => subtask.plannedEndDate && isDateAfter(subtask.plannedEndDate, newParentDeadline)
    );

    if (conflictingSubtasks.length === 0) return;

    // Lấy subtask có deadline muộn nhất
    conflictingSubtasks.sort((a, b) => new Date(b.plannedEndDate).getTime() - new Date(a.plannedEndDate).getTime());
    const latestConflict = conflictingSubtasks[0];
    const subtaskDisplay = formatVietnamDisplayDate(latestConflict.plannedEndDate);
    const parentLabel = parentName ? ` '${parentName}'` : "";

    const error: any = new Error(
        `Không thể đặt deadline của công việc cha${parentLabel} trước deadline của công việc con '${latestConflict.name}' (Hạn chót con: ${subtaskDisplay})`
    );
    error.statusCode = 400;
    throw error;
};
