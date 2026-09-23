import { AppDataSource } from "../../../data-source";
import { Tasks } from "../entities/Task.entity";
import { TaskStatus, PerformerType, PricingStatus, SubtaskPlanStatus, ViolationType } from "../../../shared/entities/Enums";
import { ILike, Like, Between, IsNull, In } from "typeorm";
import { Projects, ProjectStatus } from "../../project/entities/Project.entity";
import { Jobs } from "../../job/entities/Job.entity";
import { Users } from "../../user/entities/User.entity";
import { Vendors } from "../../vendor/entities/Vendor.entity";
import { VendorJobs } from "../../vendor/entities/VendorJob.entity";
import { NotificationService } from "../../notification/services/Notification.Service";
import { TaskReviewService } from "./TaskReview.Service";
import { StringHelper } from "../../../shared/helpers/String.helper";
import { Contracts } from "../../contract/entities/Contract.entity";
import { TaskReviews } from "../entities/TaskReview.entity";
import { SecurityService } from "../../../shared/services/Security.Service";
import { ContractServices, ContractServiceStatus } from "../../contract/entities/ContractService.entity";
import { Violations } from "../entities/Violation.entity";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { isProjectManagementRole, UserRole } from "../../account/entities/Account.entity";

import { TaskBaseService } from "./Task.BaseService";
import { SUBTASK_PM_APPROVAL_ENABLED } from "../constants/SubtaskPlan.constants";

export class TaskDeletionService extends TaskBaseService {
    async delete(id: string) {
        const task = await this.getOne(id);
        this.assertTaskProjectNotOnHold(task);
        if (task.subtasks?.length) {
            throw this.httpError("Không thể xóa task gốc khi vẫn còn subtask", 409);
        }
        if (task.parentTaskId) {
            const reviewCount = await this.taskRepository.manager.getRepository(TaskReviews).count({
                where: { task: { id: task.id } }
            });
            const executionStarted = Boolean(
                task.result ||
                task.actualStartDate ||
                task.actualEndDate ||
                task.lastSubmittedById ||
                task.rewardVinicoin != null ||
                reviewCount > 0 ||
                task.iterations?.length ||
                [
                    TaskStatus.AWAITING_REVIEW,
                    TaskStatus.INTERNAL_COMPLETED,
                    TaskStatus.COMPLETED,
                    TaskStatus.ACCEPTED,
                    TaskStatus.REWORKING
                ].includes(task.status)
            );
            if (executionStarted) {
                throw this.httpError(
                    "Không thể xóa công việc con đã phát sinh thực hiện",
                    409
                );
            }
        }
        if (
            SUBTASK_PM_APPROVAL_ENABLED &&
            task.parentTaskId &&
            [SubtaskPlanStatus.PENDING_APPROVAL, SubtaskPlanStatus.APPROVED].includes(
                task.parentTask?.subtaskPlanStatus as SubtaskPlanStatus
            )
        ) {
            throw this.httpError("Không thể xóa subtask khi phương án đang chờ duyệt hoặc đã được duyệt", 409);
        }

        await AppDataSource.transaction(async manager => {
            await manager.getRepository(Tasks).remove(task);

            if (task.parentTaskId) {
                const remainingSubtasks = await manager.getRepository(Tasks).count({
                    where: { parentTaskId: task.parentTaskId }
                });
                if (remainingSubtasks === 0) {
                    await manager.getRepository(Tasks).update(
                        { id: task.parentTaskId },
                        {
                            isRewardable: true,
                            subtaskPlanStatus: null,
                            subtaskPlanReviewerId: null,
                            subtaskPlanRequesterId: null,
                            subtaskPlanReviewNote: null
                        }
                    );
                } else {
                    await manager.getRepository(Tasks).update(
                        { id: task.parentTaskId },
                        {
                            subtaskPlanStatus: SUBTASK_PM_APPROVAL_ENABLED ? SubtaskPlanStatus.DRAFT : null,
                            subtaskPlanReviewerId: null,
                            subtaskPlanRequesterId: null,
                            subtaskPlanReviewNote: null
                        }
                    );
                }
            }
        });
        taskEmitter.emit(TASK_EVENTS.DELETED, { id });
        return { message: "Xóa công việc thành công" };
    }
}
