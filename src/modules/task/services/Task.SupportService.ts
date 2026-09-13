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

export class TaskSupportService extends TaskBaseService {
    async requestSupport(id: string, note: string) {
        const task = await this.getOne(id);
        task.isSupportRequested = true;
        task.supportRequestNote = note;
        task.status = TaskStatus.AWAITING_SUPPORT;

        const savedTask = await this.taskRepository.save(task);

        const taskWithInfo = await this.taskRepository.findOne({
            where: { id: task.id },
            relations: ["project", "project.team", "project.team.teamLead"]
        });

        if (taskWithInfo?.project?.team?.teamLead) {
            await this.notificationService.createNotification({
                title: "Yêu cầu hỗ trợ công việc",
                content: `Nhân viên yêu cầu hỗ trợ cho công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name}. Lý do: ${note}`,
                type: "TASK_REVIEW",
                recipient: taskWithInfo.project.team.teamLead,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        return savedTask;
    }

    async assignSupportTeam(id: string, teamId: string) {
        const task = await this.getOne(id);
        const team = await this.teamRepository.findOne({
            where: { id: teamId },
            relations: ["teamLead"]
        }) as any;

        if (!team) throw new Error("Không tìm thấy team hỗ trợ");
        if (!team.teamLead) throw new Error("Team hỗ trợ chưa có Lead");

        task.supportTeamId = teamId;
        task.supportLeadId = team.teamLead.id;
        task.isSupportRequested = true;
        task.isSupportAccepted = false;
        task.status = TaskStatus.SUPPORT_PENDING;

        const savedTask = await this.taskRepository.save(task);

        await this.notificationService.createNotification({
            title: "Yêu cầu hỗ trợ chéo team",
            content: `Team của bạn được nhờ hỗ trợ công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name}. Vui lòng phân công người thực hiện.`,
            type: "TASK_ASSIGNED",
            recipient: team.teamLead,
            relatedEntityId: task.id.toString(),
            relatedEntityType: "Task",
            link: `/projects/${task.project?.id}`
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        return savedTask;
    }

    async respondToSupport(id: string, action: 'ACCEPT' | 'REJECT', currentUser: { id: string }) {
        const task = await this.getOne(id);

        // Security check: Only the designated support lead can respond
        if (task.supportLeadId !== (currentUser as any).userId && task.supportLeadId !== currentUser.id) {
            throw new Error("Chỉ Lead của team được nhờ mới có quyền phản hồi");
        }

        if (action === 'ACCEPT') {
            task.isSupportAccepted = true;
            task.status = TaskStatus.PENDING;

            // Notify original lead
            const originalLead = task.project?.team?.teamLead;
            if (originalLead) {
                await this.notificationService.createNotification({
                    title: "Yêu cầu hỗ trợ được chấp nhận",
                    content: `Team hỗ trợ đã đồng ý giúp đỡ cho công việc: ${this.taskDisplayName(task)}. Đang chờ phân công nhân sự.`,
                    type: "TASK_ASSIGNED",
                    recipient: originalLead,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task"
                });
            }
        } else {
            // REJECT
            task.supportTeamId = null as any;
            task.supportLeadId = null as any;
            task.isSupportRequested = true; // Still needs support
            task.isSupportAccepted = false;
            task.status = TaskStatus.AWAITING_SUPPORT; // Back to original lead to pick another team

            // Notify original lead
            const originalLead = task.project?.team?.teamLead;
            if (originalLead) {
                await this.notificationService.createNotification({
                    title: "Yêu cầu hỗ trợ bị từ chối",
                    content: `Team hỗ trợ đã từ chối yêu cầu cho công việc: ${this.taskDisplayName(task)}. Vui lòng thực hiện phương án khác.`,
                    type: "TASK_REJECTED",
                    recipient: originalLead,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        const savedTask = await this.taskRepository.save(task);
        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        return savedTask;
    }

    async returnSupport(id: string) {
        const task = await this.getOne(id);

        if (!task.isSupportReturnRequested) {
            throw new Error("Người hỗ trợ chưa yêu cầu hoàn thành (bấm nút Hỗ trợ). Chỉ có thể trả lại sau khi có yêu cầu.");
        }

        task.supportTeamId = null as any;
        task.supportLeadId = null as any;
        task.helperId = null as any;
        task.isSupportRequested = true; // Still needs support
        task.isSupportAccepted = false;
        task.isSupportReturnRequested = false; // Reset flag
        task.status = TaskStatus.AWAITING_SUPPORT;

        const savedTask = await this.taskRepository.save(task);
        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        return savedTask;
    }

    async requestReturnSupport(id: string, note: string) {
        const task = await this.getOne(id);

        if (!task.helperId) {
            throw new Error("Chỉ người được giao hỗ trợ mới có quyền yêu cầu hoàn thành.");
        }

        task.isSupportReturnRequested = true;
        task.status = TaskStatus.SUPPORT_AWAITING_RETURN;
        if (note) task.supportReturnNote = note;

        const savedTask = await this.taskRepository.save(task);

        // Notify Support Lead
        if (task.supportLeadId) {
            const supportLead = await this.userRepository.findOneBy({ id: task.supportLeadId });
            if (supportLead) {
                await this.notificationService.createNotification({
                    title: "Yêu cầu hoàn thành hỗ trợ",
                    content: `Nhân viên hỗ trợ yêu cầu hoàn thành cho công việc: ${this.taskDisplayName(task)}. Vui lòng kiểm tra và xác nhận trả lại.`,
                    type: "TASK_REVIEW",
                    recipient: supportLead,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        return savedTask;
    }
}
