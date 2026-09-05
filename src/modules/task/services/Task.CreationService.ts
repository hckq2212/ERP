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

export class TaskCreationService extends TaskBaseService {
    async createInternalTask(data: {
        name: string,
        assigneeId: string,
        supervisorId: string,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date,
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[]
    }, currentUser?: { id: string }) {
        const assignee = await this.userRepository.findOneBy({ id: data.assigneeId });
        if (!assignee) throw new Error("Không tìm thấy người thực hiện");

        const supervisor = await this.userRepository.findOneBy({ id: data.supervisorId });
        if (!supervisor) throw new Error("Không tìm thấy người giám sát");

        // Logic sinh mã (Code Generation)
        const initials = StringHelper.getInitials(assignee.fullName);
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');

        // Đếm số lượng công việc nội bộ trong tháng để lấy Index
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const internalTaskCount = await this.taskRepository.count({
            where: {
                project: IsNull(),
                createdAt: Between(startOfMonth, endOfMonth)
            }
        });

        const sequence = (internalTaskCount + 1).toString().padStart(2, '0');
        const taskCode = `CVK-${initials}-${year}-${month}-${sequence}`;

        const task = this.taskRepository.create({
            code: taskCode,
            name: data.name,
            project: null,
            job: null,
            assignee: assignee,
            supervisor: supervisor,
            status: TaskStatus.DOING,
            plannedStartDate: data.plannedStartDate,
            plannedEndDate: data.plannedEndDate,
            description: data.description,
            attachments: data.attachments,
            assignerId: (currentUser as any)?.userId || currentUser?.id
        });

        const savedTask = await this.taskRepository.save(task);

        // Notify Assignee
        await this.notificationService.createNotification({
            title: "Công việc nội bộ mới",
            content: `Bạn được giao công việc nội bộ: ${this.taskDisplayName(task)} (Mã: ${task.code})`,
            type: "TASK_ASSIGNED",
            recipient: assignee,
            relatedEntityId: savedTask.id?.toString(),
            relatedEntityType: "Task",
            link: `/tasks/${savedTask.id}`
        });

        // Notify Supervisor
        await this.notificationService.createNotification({
            title: "Giám sát công việc mới",
            content: `Bạn được phân công giám sát ${assignee?.fullName} cho công việc: ${this.taskDisplayName(task)} (Mã: ${task.code})`,
            type: "TASK_REVIEW",
            recipient: supervisor,
            relatedEntityId: savedTask.id?.toString(),
            relatedEntityType: "Task",
            link: `/tasks/${savedTask.id}`
        });

        taskEmitter.emit(TASK_EVENTS.CREATED, savedTask);

        return savedTask;
    }

    async create(data: {
        projectId?: string,
        jobId: string,
        assigneeId?: string,
        performerType?: PerformerType,
        vendorId?: string,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date,
        isExtra?: boolean
    }, currentUser?: { id: string }) {
        let project = null;
        let taskCode = null;

        const job = await this.jobRepository.findOne({ where: { id: data.jobId } });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        if (data.projectId) {
            project = await this.projectRepository.findOne({
                where: { id: data.projectId },
                relations: ["contract"]
            });
            if (!project) throw new Error("Không tìm thấy dự án");
            if (!project.contract) throw new Error("Dự án không có hợp đồng liên kết");

            const contractCode = project.contract.contractCode;
            const jobCode = job.code || `JOB${job.id}`;

            const count = await this.taskRepository.count({
                where: {
                    project: { id: data.projectId },
                    job: { id: data.jobId }
                }
            });

            const sequence = (count + 1).toString().padStart(2, '0');
            taskCode = `${contractCode}-${jobCode}-${sequence}`;
        }

        const task = this.taskRepository.create({
            code: taskCode,
            name: job.name,
            project: project,
            job: job,
            status: data.isExtra ? TaskStatus.AWAITING_PRICING : TaskStatus.PENDING,
            performerType: data.performerType || job.defaultPerformerType,
            description: data.description,
            plannedStartDate: data.plannedStartDate,
            plannedEndDate: data.plannedEndDate,
            isExtra: data.isExtra || false,
            pricingStatus: data.isExtra ? PricingStatus.PENDING : null,
            assignerId: (currentUser as any)?.userId || currentUser?.id
        });

        if (data.assigneeId) {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (user) {
                task.assignee = user;
                await this.notificationService.createNotification({
                    title: "Công việc mới được giao",
                    content: `Bạn được giao công việc: ${this.taskDisplayName(task)} ${task.project !== null ? "thuộc dự án " + task.project.name : ""} `,
                    type: "TASK_ASSIGNED",
                    recipient: user,
                    relatedEntityId: task.id?.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        const saved = await this.taskRepository.save(task);
        taskEmitter.emit(TASK_EVENTS.CREATED, saved);
        return saved;
    }
}
