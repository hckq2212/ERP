import { Repository } from "typeorm";
import { SubtaskPlanStatus } from "../../../shared/entities/Enums";
import { Tasks } from "../entities/Task.entity";
import { SUBTASK_PM_APPROVAL_ENABLED } from "../constants/SubtaskPlan.constants";

export const assertSubtaskPlanApproved = async (
    taskRepository: Repository<Tasks>,
    task: Pick<Tasks, "parentTaskId">,
    action: string
) => {
    if (!SUBTASK_PM_APPROVAL_ENABLED) return;
    if (!task.parentTaskId) return;

    const parent = await taskRepository.findOne({
        where: { id: task.parentTaskId },
        select: { id: true, subtaskPlanStatus: true }
    });
    // Legacy subtasks created before the approval flow remain operable.
    if (!parent?.subtaskPlanStatus) return;
    if (parent.subtaskPlanStatus !== SubtaskPlanStatus.APPROVED) {
        const error: any = new Error(`Không thể ${action} trước khi PM duyệt phương án chia subtask`);
        error.statusCode = 409;
        throw error;
    }
};
