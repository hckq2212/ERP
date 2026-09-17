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
import { buildDefaultTaskNickname } from "../../../shared/helpers/TaskNickname.helper";
import { Opportunities } from "../../opportunity/entities/Opportunity.entity";
import { OpportunityServiceJobs } from "../../opportunity-service/entities/OpportunityServiceJob.entity";

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
    }, currentUser?: { id: string; userId?: string; role?: string }) {
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
        const assignerId = await this.resolveActorUserId(currentUser);

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
            assignerId
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
        opportunityId?: string,
        opportunityServiceJobId?: string,
        jobId: string,
        assigneeId?: string,
        performerType?: PerformerType,
        vendorId?: string,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date,
        isExtra?: boolean
    }, currentUser?: { id: string; userId?: string; role?: string }) {
        let project = null;
        let taskCode = null;
        let taskSequenceNumber: number | null = null;

        if (!data.projectId && !data.opportunityId) {
            throw new Error("Vui lòng chọn dự án hoặc cơ hội");
        }

        const job = await this.jobRepository.findOne({ where: { id: data.jobId } });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        if (data.projectId) {
            project = await this.projectRepository.findOne({
                where: { id: data.projectId },
                relations: ["contract", "team", "team.teamLead", "team.members", "team.members.user"]
            });
            if (!project) throw new Error("Không tìm thấy dự án");
            if (!project.contract) throw new Error("Dự án không có hợp đồng liên kết");
            if (currentUser && !await this.isProjectOperator(project.id, currentUser)) {
                throw this.httpError("Bạn không có quyền tạo công việc trong dự án này", 403);
            }

            const contractCode = project.contract.contractCode;
            const jobCode = job.code || `JOB${job.id}`;

            const count = await this.taskRepository.count({
                where: {
                    project: { id: data.projectId },
                    job: { id: data.jobId }
                }
            });

            taskSequenceNumber = count + 1;
            const sequence = taskSequenceNumber.toString().padStart(2, '0');
            taskCode = `${contractCode}-${jobCode}-${sequence}`;
        }

        let opportunity: Opportunities | null = null;
        let opportunityServiceJob: OpportunityServiceJobs | null = null;
        if (data.opportunityId) {
            opportunity = await AppDataSource.getRepository(Opportunities).findOne({
                where: SecurityService.withTenant({ id: data.opportunityId })
            });
            if (!opportunity) throw new Error("Không tìm thấy cơ hội");

            if (!data.opportunityServiceJobId) {
                throw new Error("Vui lòng chọn hạng mục công việc của cơ hội");
            }
            opportunityServiceJob = await AppDataSource.getRepository(OpportunityServiceJobs).findOne({
                where: { id: data.opportunityServiceJobId },
                relations: ["opportunityService", "opportunityService.opportunity", "job"]
            });
            if (!opportunityServiceJob || opportunityServiceJob.opportunityService?.opportunity?.id !== opportunity.id) {
                throw new Error("Hạng mục công việc không thuộc cơ hội đã chọn");
            }
            if (opportunityServiceJob.jobId !== job.id) {
                throw new Error("Job của task không khớp hạng mục công việc của cơ hội");
            }

            const count = await this.taskRepository.count({
                where: { opportunityServiceJobId: opportunityServiceJob.id }
            });
            taskSequenceNumber = count + 1;
            taskCode = `${opportunity.opportunityCode}-${job.code || `JOB${job.id}`}-${String(taskSequenceNumber).padStart(2, "0")}`;
        }
        const assignerId = await this.resolveActorUserId(currentUser);
        const taskNickname = taskSequenceNumber
            ? buildDefaultTaskNickname(job, taskSequenceNumber)
            : null;

        const task = this.taskRepository.create({
            code: taskCode,
            name: job.name,
            nickname: taskNickname,
            project: project,
            opportunity,
            opportunityId: opportunity?.id || null,
            opportunityServiceJob,
            opportunityServiceJobId: opportunityServiceJob?.id || null,
            job: job,
            status: data.isExtra ? TaskStatus.AWAITING_PRICING : TaskStatus.PENDING,
            performerType: data.performerType || job.defaultPerformerType,
            description: data.description,
            plannedStartDate: data.plannedStartDate,
            plannedEndDate: data.plannedEndDate,
            isExtra: data.isExtra || false,
            pricingStatus: data.isExtra ? PricingStatus.PENDING : null,
            assignerId
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
