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

export class TaskResultService extends TaskBaseService {
    private parseNullableInt(value: number | string | null | undefined): number | null {
        if (value === undefined || value === null || value === "") return null;
        const parsed = typeof value === "number" ? value : parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    async submitResult(id: string, data: { result: any, spellCheckErrorCount?: number | string | null, qcMismatchCount?: number | string | null }, currentUser?: { id: string, userId?: string; role?: string }) {
        const task = await this.getOne(id);
        const currentId = await this.resolveActorUserId(currentUser);
        if (!currentId) throw this.httpError("Tài khoản chưa được liên kết nhân sự để nộp kết quả", 401);
        const isTeamLead = this.isProjectOperatorFromTeam(task.project?.team, currentUser);

        const resultType = data.result?.type;
        if (!data.result || ((resultType === "FILE" || resultType === "LINK") && !data.result.url)) {
            throw this.httpError("Kết quả công việc không hợp lệ", 400);
        }

        task.result = data.result;
        task.actualEndDate = new Date();
        task.lastSubmittedById = currentId;
        task.lastSpellCheckErrorCount = this.parseNullableInt(data.spellCheckErrorCount);
        task.lastQcMismatchCount = this.parseNullableInt(data.qcMismatchCount);

        task.status = TaskStatus.AWAITING_REVIEW;

        const savedTask = await this.taskRepository.save(task);

        // Check for late submission
        if (task.plannedEndDate && new Date() > task.plannedEndDate) {
            await this.recordViolation({
                taskId: task.id,
                userId: currentId,
                type: ViolationType.LATE_SUBMISSION,
                description: `Nộp task trễ deadline. Deadline: ${task.plannedEndDate.toLocaleString()}`
            });
        }

        if (isTeamLead) {
            // Auto-pass reviews and finalize (syncs to contract service, etc.)
            await this.reviewService.initializeReviews(task.id, true);
            await this.reviewService.checkAndFinalize(task.id, undefined, undefined, currentUser);
        } else {
            // Standard review flow
            await this.reviewService.initializeReviews(task.id);

            // Notify Lead/Supervisor/Assigner
            const recipients = new Set<string>();
            if (task.project?.team?.teamLead?.id) recipients.add(task.project.team.teamLead.id);
            if (task.supervisor?.id) recipients.add(task.supervisor.id);
            if (task.assigner?.id) recipients.add(task.assigner.id);

            for (const recipientId of recipients) {
                const recipient = await this.userRepository.findOneBy({ id: recipientId });
                if (recipient) {
                    await this.notificationService.createNotification({
                        title: "Kết quả công việc đã nộp",
                        content: `${task.assignee?.fullName || 'Nhân viên'} đã nộp 1 task ${task.job?.name || ''}`,
                        type: "TASK_REVIEW",
                        recipient: recipient,
                        relatedEntityId: task.id.toString(),
                        relatedEntityType: "Task",
                        link: `/tasks/${task.id}`
                    });
                }
            }
        }

        const responseTask = isTeamLead
            ? await this.taskRepository.findOne({ where: { id: task.id } }) || savedTask
            : savedTask;
        taskEmitter.emit(TASK_EVENTS.STATUS_CHANGED, responseTask);
        return responseTask;
    }

    async requestRework(id: string, data: {
        feedback: string,
        deadlineAt: Date,
        attachments?: any[]
    }, currentUser?: { id: string, userId?: string; role?: string }) {
        return await AppDataSource.transaction(async (transactionalEntityManager) => {
            const task = await transactionalEntityManager.findOne(Tasks, {
                where: { id },
                relations: ["assignee", "contractService", "project", "project.team", "project.team.teamLead", "project.team.members", "project.team.members.user"]
            });

            if (!task) throw new Error("Không tìm thấy công việc");
            const currentUserId = await this.resolveActorUserId(currentUser, transactionalEntityManager);
            const canRequestRework = isProjectManagementRole(currentUser?.role) ||
                this.isProjectOperatorFromTeam(task.project?.team, currentUser) ||
                task.assignerId === currentUserId;
            if (!canRequestRework) {
                throw this.httpError("Bạn không có quyền yêu cầu làm lại công việc này", 403);
            }

            // Status Guard: Only allow rework from review or completed states
            const allowedStatuses = [TaskStatus.AWAITING_REVIEW, TaskStatus.INTERNAL_COMPLETED, TaskStatus.COMPLETED];
            if (!allowedStatuses.includes(task.status)) {
                throw new Error(`Không thể yêu cầu làm lại cho công việc đang ở trạng thái hiện tại`);
            }

            // 1. Create Iteration Record (Snapshot current state)
            const iterationCount = await transactionalEntityManager.count(Tasks.name === "TaskIterations" ? "TaskIterations" : "task_iterations", {
                where: { taskId: task.id }
            } as any);

            const iterationRepository = transactionalEntityManager.getRepository("TaskIterations");
            const iteration = iterationRepository.create({
                task: task,
                version: iterationCount + 1,
                submittedResult: task.result,
                leadFeedback: data.feedback,
                feedbackAttachments: data.attachments,
                deadlineAt: data.deadlineAt,
                submittedById: task.lastSubmittedById,
                spellCheckErrorCount: task.lastSpellCheckErrorCount,
                qcMismatchCount: task.lastQcMismatchCount
            });
            await iterationRepository.save(iteration);

            // Record violations for rework
            const currentIterationVersion = iterationCount + 1;

            // Case 2: Excessive Rework (3rd submission onwards by same person)
            if (currentIterationVersion >= 2) { // currentIterationVersion is count of PREVIOUS iterative submissions
                if (iterationCount >= 2 && task.lastSubmittedById) {
                    await this.recordViolation({
                        taskId: task.id,
                        userId: task.lastSubmittedById,
                        type: ViolationType.EXCESSIVE_REWORK,
                        description: `Nộp lại task lần thứ ${iterationCount + 1}.`,
                        iterationVersion: iterationCount + 1,
                        manager: transactionalEntityManager
                    });
                }
            }

            // Case 1: Late Unfinished (Overdue at point of rework request)
            if (task.plannedEndDate && new Date() > task.plannedEndDate && task.assigneeId) {
                await this.recordViolation({
                    taskId: task.id,
                    userId: task.assigneeId,
                    type: ViolationType.LATE_UNFINISHED,
                    description: `Yêu cầu làm lại khi task đã quá hạn.`,
                    manager: transactionalEntityManager
                });
            }

            // 1.5. Clean up old reviews (as requested by user)
            await transactionalEntityManager.delete(TaskReviews, { task: { id } });

            // 1.6. Reset ContractService if linked
            if (task.contractService) {
                const contractServiceRepository = transactionalEntityManager.getRepository(ContractServices);
                const cs = await contractServiceRepository.findOneBy({ id: task.contractService.id });
                if (cs && cs.results) {
                    // Remove or update the result for this specific task
                    cs.results = cs.results.filter(r => r.taskId !== task.id);
                    cs.status = ContractServiceStatus.ACTIVE;
                    await contractServiceRepository.save(cs);
                }
            }

            // 2. Update Task
            task.status = TaskStatus.REWORKING;
            task.plannedEndDate = data.deadlineAt;
            task.result = null as any;
            task.lastSpellCheckErrorCount = null;
            task.lastQcMismatchCount = null;

            const savedTask = await transactionalEntityManager.save(task);

            // 3. Notify Assignee
            if (task.assignee) {
                await this.notificationService.createNotification({
                    title: "Yêu cầu làm lại công việc",
                    content: `Bạn có yêu cầu làm lại cho: ${this.taskDisplayName(task)} của dự án ${task.project?.name} (Mã: ${task.code}). Feedback: ${data.feedback}`,
                    type: "TASK_ASSIGNED",
                    recipient: task.assignee,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                }, transactionalEntityManager);
            }

            taskEmitter.emit(TASK_EVENTS.STATUS_CHANGED, savedTask);

            return savedTask;
        });
    }

    async approveByCustomer(
        id: string,
        currentUser?: { id: string; userId?: string; role: string }
    ) {
        const currentUserId = currentUser?.userId || currentUser?.id;
        if (!currentUserId) throw this.httpError("Bạn cần đăng nhập để duyệt công việc", 401);

        const savedTask = await AppDataSource.transaction(async (manager) => {
            const lockedTask = await manager.createQueryBuilder(Tasks, "task")
                .select("task.id")
                .where("task.id = :id", { id })
                .setLock("pessimistic_write")
                .getOne();
            if (!lockedTask) throw this.httpError("Không tìm thấy công việc", 404);

            const task = await manager.getRepository(Tasks).findOne({
                where: { id },
                relations: ["assignee", "project", "project.team", "project.team.teamLead", "project.team.members", "project.team.members.user"]
            });
            if (!task) throw this.httpError("Không tìm thấy công việc", 404);

            const isAdminOrBod = isProjectManagementRole(currentUser.role);
            const isProjectLead = this.isProjectOperatorFromTeam(task.project?.team, currentUser);
            if (!isAdminOrBod && !isProjectLead) {
                throw this.httpError("Bạn không có quyền xác nhận khách hàng duyệt công việc này", 403);
            }
            if (task.status !== TaskStatus.INTERNAL_COMPLETED) {
                throw this.httpError(`Công việc chưa ở trạng thái Hoàn thành nội bộ (Hiện tại: ${task.status})`, 409);
            }

            task.status = TaskStatus.COMPLETED;
            const saved = await manager.save(task);
            if (task.assignee) {
                await this.notificationService.createNotification({
                    title: "Khách hàng đã duyệt",
                    content: `Khách hàng đã duyệt công việc: ${this.taskDisplayName(task)}. Trạng thái: Hoàn thành.`,
                    type: "TASK_COMPLETED",
                    recipient: task.assignee,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                }, manager);
            }
            return saved;
        });

        taskEmitter.emit(TASK_EVENTS.STATUS_CHANGED, savedTask);
        return savedTask;
    }
}
