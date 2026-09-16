import { Repository } from "typeorm";
import { TaskStatus } from "../../../shared/entities/Enums";
import { Tasks } from "../entities/Task.entity";

export const completedSubtaskStatuses = [
    TaskStatus.INTERNAL_COMPLETED,
    TaskStatus.COMPLETED,
    TaskStatus.ACCEPTED
];

export const assertSubtasksCompleted = async (
    taskRepository: Repository<Tasks>,
    task: Pick<Tasks, "id" | "parentTaskId">,
    action: string
) => {
    if (task.parentTaskId) return;

    const subtasks = await taskRepository.find({
        where: { parentTaskId: task.id },
        select: ["id", "name", "status"]
    });
    const incompleteSubtasks = subtasks.filter(
        subtask => !completedSubtaskStatuses.includes(subtask.status)
    );

    if (incompleteSubtasks.length === 0) return;

    const displayedNames = incompleteSubtasks
        .slice(0, 3)
        .map(subtask => subtask.name)
        .join(", ");
    const remainingCount = incompleteSubtasks.length - 3;
    const suffix = remainingCount > 0 ? ` và ${remainingCount} subtask khác` : "";
    const error: any = new Error(
        `Không thể ${action} task chính khi còn ${incompleteSubtasks.length} subtask chưa hoàn tất: ${displayedNames}${suffix}`
    );
    error.statusCode = 409;
    throw error;
};
