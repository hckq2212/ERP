import { AppDataSource } from "../../../data-source";
import { Tasks } from "../entities/Task.entity";
import { TaskStatus, PerformerType, PricingStatus, ViolationType } from "../../../shared/entities/Enums";
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

export class TaskDeletionService extends TaskBaseService {
    async delete(id: string) {
        const task = await this.getOne(id);
        if (task.subtasks?.length) {
            throw this.httpError("Không thể xóa task gốc khi vẫn còn subtask", 409);
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
                        { isRewardable: true, vinicoinBudget: null }
                    );
                }
            }
        });
        taskEmitter.emit(TASK_EVENTS.DELETED, { id });
        return { message: "Xóa công việc thành công" };
    }
}
