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
import { TaskResultCheckService } from "./TaskResultCheck.Service";
import { assertSubtasksCompleted } from "../helpers/SubtaskCompletion.helper";
import { assertSubtaskPlanApproved } from "../helpers/SubtaskPlanApproval.helper";
import { TaskResultChecks } from "../entities/TaskResultCheck.entity";
import { buildCheckSummary } from "./TaskResultCheck.Service";
import { MemberRole } from "../../project/entities/TeamMember.entity";

import { TaskBaseService } from "./Task.BaseService";

type SubmitResultData = {
    result: any;
    sheetNames?: string[];
    whitelist?: string[];
    scenarioIds?: string[];
    scenarioLabels?: string[];
    fileBuffer?: Buffer;
    checkFileUrl?: string;
    checkFileName?: string;
};

function buildSubmissionDetails(sheetNames?: string[], scenarioLabels?: string[]): string {
    const parts: string[] = [];
    if (sheetNames && sheetNames.length > 0) parts.push(`Sheet: ${sheetNames.join(", ")}`);
    if (scenarioLabels && scenarioLabels.length > 0) parts.push(`Kịch bản: ${scenarioLabels.join(", ")}`);
    return parts.length > 0 ? ` (${parts.join(". ")})` : "";
}

export class TaskResultService extends TaskBaseService {
    private resultCheckService = new TaskResultCheckService();

    async submitResult(id: string, data: SubmitResultData, currentUser?: { id: string, userId?: string; role?: string }) {
        const task = await this.getOne(id);
        if (task.status === TaskStatus.ON_HOLD || task.project?.status === ProjectStatus.ON_HOLD) {
            throw this.httpError("Công việc hoặc dự án đang tạm dừng, không thể nộp kết quả", 400);
        }
        await assertSubtaskPlanApproved(this.taskRepository, task, "nộp kết quả");
        await assertSubtasksCompleted(this.taskRepository, task, "nộp kết quả");
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
        }

        // Notify Lead/Supervisor/Assigner/PM (skip the submitter themself)
        const recipients = new Set<string>();
        if (task.project?.team?.teamLead?.id) recipients.add(task.project.team.teamLead.id);
        if (task.supervisor?.id) recipients.add(task.supervisor.id);
        if (task.assigner?.id) recipients.add(task.assigner.id);
        for (const member of task.project?.team?.members || []) {
            if (member.role === MemberRole.PROJECT_MANAGER && member.user?.id) recipients.add(member.user.id);
        }
        recipients.delete(currentId);

        const submissionDetails = buildSubmissionDetails(data.sheetNames, data.scenarioLabels);
        for (const recipientId of recipients) {
            const recipient = await this.userRepository.findOneBy({ id: recipientId });
            if (recipient) {
                await this.notificationService.createNotification({
                    title: "Kết quả công việc đã nộp",
                    content: `${task.assignee?.fullName || 'Nhân viên'} đã nộp 1 task ${task.job?.name || ''}${submissionDetails}`,
                    type: "TASK_REVIEW",
                    recipient: recipient,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        const responseTask = isTeamLead
            ? await this.taskRepository.findOne({ where: { id: task.id } }) || savedTask
            : savedTask;
        taskEmitter.emit(TASK_EVENTS.STATUS_CHANGED, responseTask);

        if (resultType === "FILE" || resultType === "LINK") {
            void this.resultCheckService.startForSubmission({
                taskId: task.id,
                projectId: task.project?.id,
                fileBuffer: data.fileBuffer,
                fileUrl: data.fileBuffer ? undefined : (data.checkFileUrl || data.result?.url),
                fileName: data.checkFileName || data.result?.name,
                sheetNames: data.sheetNames || [],
                whitelist: data.whitelist || [],
                scenarioIds: data.scenarioIds || [],
                actor: currentUser
            });
        }

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

            const resultCheckRepository = transactionalEntityManager.getRepository(TaskResultChecks);
            const resultCheck = await resultCheckRepository.findOne({ where: { taskId: task.id } });
            const confirmedSpellErrors = resultCheck?.finalizedAt
                ? (resultCheck.reviewedSpellErrors || []).filter(e => e.confirmed)
                : [];
            const confirmedQcMismatches = resultCheck?.finalizedAt
                ? (resultCheck.reviewedQcMismatches || []).filter(m => m.status !== "unresolved" && m.confirmed)
                : [];

            const iterationRepository = transactionalEntityManager.getRepository("TaskIterations");
            const iteration = iterationRepository.create({
                task: task,
                version: iterationCount + 1,
                submittedResult: task.result,
                leadFeedback: data.feedback,
                feedbackAttachments: data.attachments,
                deadlineAt: data.deadlineAt,
                submittedById: task.lastSubmittedById,
                confirmedSpellErrors,
                confirmedQcMismatches
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

            const savedTask = await transactionalEntityManager.save(task);

            // 3. Notify Assignee
            if (task.assignee) {
                const checkSummary = buildCheckSummary(confirmedSpellErrors, confirmedQcMismatches);
                const feedbackContent = `Bạn có yêu cầu làm lại cho: ${this.taskDisplayName(task)} của dự án ${task.project?.name} (Mã: ${task.code}). Feedback: ${data.feedback}`;
                await this.notificationService.createNotification({
                    title: "Yêu cầu làm lại công việc",
                    content: checkSummary ? `${feedbackContent}\nLỗi đã chốt ở bản nộp trước:\n${checkSummary}` : feedbackContent,
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
            await assertSubtasksCompleted(manager.getRepository(Tasks), task, "hoàn thành");

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
