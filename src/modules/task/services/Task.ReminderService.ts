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

export class TaskReminderService extends TaskBaseService {
    async sendReminder(id: string) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "assignee", "helper"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");

        const performer = task.helper || task.assignee;
        if (!performer) {
            throw new Error("Công việc chưa có người thực hiện để nhắc nhở");
        }

        await this.notificationService.createNotification({
            title: "Nhắc nhở công việc",
            content: `Bạn có lời nhắc cho công việc: ${this.taskDisplayName(task)} (Mã: ${task.code}) ${task.project ? "thuộc dự án " + task.project.name : ""}. Vui lòng kiểm tra tiến độ.`,
            type: "TASK_ASSIGNED",
            recipient: performer,
            relatedEntityId: task.id.toString(),
            relatedEntityType: "Task",
            link: `/tasks/${task.id}`
        });

        return { message: "Đã gửi thông báo nhắc nhở thành công" };
    }
}
