import { AppDataSource } from "../../../data-source";
import { EntityManager } from "typeorm";
import { PerformerType, SubtaskPlanStatus, TaskStatus } from "../../../shared/entities/Enums";
import { UserRole } from "../../account/entities/Account.entity";
import { MemberRole, memberHasRole } from "../../project/entities/TeamMember.entity";
import { Users } from "../../user/entities/User.entity";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { projectEmitter, PROJECT_EVENTS } from "../../project/events/ProjectEmitter";
import { Tasks } from "../entities/Task.entity";
import { TaskBaseService } from "./Task.BaseService";
import { SUBTASK_PM_APPROVAL_ENABLED } from "../constants/SubtaskPlan.constants";

type TaskActor = { id: string; userId?: string; role?: string };

type CreateSubtaskInput = {
    name: string;
    assigneeId?: string;
    allocationPercent: number;
    description?: string;
};

export class TaskDelegationService extends TaskBaseService {
    private readonly splittableStatuses = [
        TaskStatus.PENDING,
        TaskStatus.NOT_STARTED,
        TaskStatus.DOING,
        TaskStatus.REWORKING,
        TaskStatus.OVERDUE,
        TaskStatus.AWAITING_SUPPORT
    ];

    private async lockTask(manager: EntityManager, taskId: string, notFoundMessage: string) {
        const lockedTask = await manager
            .createQueryBuilder(Tasks, "task")
            .select("task.id")
            .where("task.id = :taskId", { taskId })
            .setLock("pessimistic_write")
            .getOne();

        if (!lockedTask) throw this.httpError(notFoundMessage, 404);
    }

    private isAdminOverride(actor?: TaskActor) {
        return [UserRole.ADMIN, UserRole.BOD].includes(actor?.role as UserRole);
    }

    private isAccountMember(task: Tasks, actorUserId?: string) {
        if (!actorUserId || !task.project?.team) return false;
        if (task.project.team.teamLead?.id === actorUserId) return true;
        return task.project.team.members?.some(member =>
            member.user?.id === actorUserId && memberHasRole(member, MemberRole.ACCOUNT)
        ) || false;
    }

    private assertAccountCanDelegate(task: Tasks, actor: TaskActor, actorUserId?: string) {
        if (this.isAdminOverride(actor)) return;
        if (!this.isAccountMember(task, actorUserId)) {
            throw this.httpError("Chỉ Account phụ trách dự án mới được chia và phân công subtask", 403);
        }
    }

    private assertTaskCanBeSplit(task: Tasks) {
        if (task.performerType !== PerformerType.INTERNAL) {
            throw this.httpError("Chỉ công việc nội bộ mới được chia subtask và phân bổ Vinicoin", 409);
        }
        if (!this.splittableStatuses.includes(task.status)) {
            throw this.httpError(
                `Không thể yêu cầu hoặc chia nhỏ công việc ở trạng thái ${task.status}`,
                409
            );
        }
    }

    private allocationBasisPoints(task: Tasks) {
        const percent = Number(task.allocationPercent || 0);
        if (Number.isFinite(percent) && percent > 0) return Math.round(percent * 100);
        return 0;
    }

    private assertValidSubtaskPlan(parent: Tasks, subtasks: Tasks[], requireComplete: boolean) {
        if (requireComplete && subtasks.length === 0) {
            throw this.httpError("Cần tạo ít nhất một subtask trước khi gửi duyệt", 409);
        }

        const totalBasisPoints = subtasks.reduce(
            (total, subtask) => total + this.allocationBasisPoints(subtask),
            0
        );

        if (totalBasisPoints > 10_000) {
            throw this.httpError("Tổng % phân bổ subtask không được vượt quá 100%", 409);
        }
        if (requireComplete && totalBasisPoints !== 10_000) {
            throw this.httpError(
                `Tổng % phân bổ phải bằng 100% trước khi gửi duyệt (hiện tại ${(totalBasisPoints / 100).toLocaleString("vi-VN")}%)`,
                409
            );
        }
        if (requireComplete && parent.assigneeId && !subtasks.some(subtask => subtask.assigneeId === parent.assigneeId)) {
            throw this.httpError("Người chịu trách nhiệm task cha phải thực hiện ít nhất một subtask", 409);
        }

        return totalBasisPoints;
    }

    async requestStaffing(taskId: string, note: string | undefined, actor: TaskActor) {
        const savedTask = await AppDataSource.transaction(async manager => {
            const taskRepo = manager.getRepository(Tasks);
            await this.lockTask(manager, taskId, "Không tìm thấy công việc");
            const task = await taskRepo.findOne({
                where: { id: taskId },
                relations: [
                    "project",
                    "project.team",
                    "project.team.teamLead",
                    "project.team.members",
                    "project.team.members.user"
                ]
            });
            if (!task) throw this.httpError("Không tìm thấy công việc", 404);
            this.assertTaskProjectNotOnHold(task);
            if (!task.project?.team) throw this.httpError("Công việc chưa thuộc đội dự án", 400);
            this.assertTaskCanBeSplit(task);

            const actorUserId = await this.resolveActorUserId(actor, manager);
            this.assertAccountCanDelegate(task, actor, actorUserId);

            const projectManagerMember = task.project.team.members?.find(member =>
                memberHasRole(member, MemberRole.PROJECT_MANAGER) && member.user
            );
            if (!projectManagerMember?.user) {
                throw this.httpError("Dự án chưa có PM phụ trách để nhận yêu cầu", 400);
            }

            if (task.supportRequestType === "STAFFING" && task.isSupportRequested && !task.isSupportAccepted) {
                throw this.httpError("Công việc đang có một yêu cầu bổ sung nhân sự chờ PM xử lý", 409);
            }

            const requester = await manager.getRepository(Users).findOneBy({ id: actorUserId });
            if (!requester) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 401);

            task.isSupportRequested = true;
            task.isSupportAccepted = false;
            task.supportLeadId = projectManagerMember.user.id;
            task.supportRequestNote = note?.trim() || null as any;
            task.supportRequestType = "STAFFING";
            const saved = await taskRepo.save(task);

            await this.notificationService.createNotification({
                title: "Account yêu cầu bổ sung nhân sự",
                content: `${requester.fullName} yêu cầu bổ sung nhân sự cho công việc ${this.taskDisplayName(task)}${note ? `. Ghi chú: ${note.trim()}` : ""}`,
                type: "TASK_STAFFING_REQUEST",
                recipient: projectManagerMember.user,
                sender: requester,
                relatedEntityId: saved.id,
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            }, manager);

            return saved;
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        const projectId = (savedTask as any)?.projectId || savedTask.project?.id;
        if (projectId) {
            projectEmitter.emit(PROJECT_EVENTS.UPDATED, { id: projectId });
        }
        return savedTask;
    }

    async respondStaffingRequest(
        taskId: string,
        action: "RESOLVE" | "REJECT",
        actor: TaskActor
    ) {
        const savedTask = await AppDataSource.transaction(async manager => {
            const taskRepo = manager.getRepository(Tasks);
            await this.lockTask(manager, taskId, "Không tìm thấy công việc");
            const task = await taskRepo.findOne({
                where: { id: taskId },
                relations: [
                    "project",
                    "project.team",
                    "project.team.teamLead",
                    "project.team.members",
                    "project.team.members.user"
                ]
            });
            if (!task) throw this.httpError("Không tìm thấy công việc", 404);
            this.assertTaskProjectNotOnHold(task);
            if (task.supportRequestType !== "STAFFING" || !task.isSupportRequested || task.isSupportAccepted) {
                throw this.httpError("Yêu cầu này đã được xử lý", 409);
            }

            const actorUserId = await this.resolveActorUserId(actor, manager);
            const isPM = task.supportLeadId === actorUserId;
            const isAdmin = this.isAdminOverride(actor);
            const isAccountOrLead = this.isAccountMember(task, actorUserId);

            if (action === "RESOLVE") {
                if (!isAdmin && !isPM) {
                    throw this.httpError("Chỉ PM phụ trách dự án mới được xử lý yêu cầu", 403);
                }
            } else if (action === "REJECT") {
                // PM từ chối HOẶC Team Lead / Account tự hủy yêu cầu của mình
                if (!isAdmin && !isPM && !isAccountOrLead) {
                    throw this.httpError("Chỉ PM phụ trách dự án hoặc người yêu cầu mới được từ chối/hủy yêu cầu", 403);
                }
            }

            const resolver = await manager.getRepository(Users).findOneBy({ id: actorUserId });
            if (!resolver) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 401);

            task.isSupportAccepted = action === "RESOLVE";
            const oldSupportLeadId = task.supportLeadId;
            if (action === "REJECT") {
                task.isSupportRequested = false;
                task.supportLeadId = null as any;
                task.supportRequestType = null;
                task.supportRequestNote = null as any;
            }
            const saved = await taskRepo.save(task);

            if (action === "RESOLVE") {
                const requester = task.project?.team?.teamLead;
                if (requester) {
                    await this.notificationService.createNotification({
                        title: "PM đã bổ sung nhân sự",
                        content: `PM đã xác nhận bổ sung nhân sự cho công việc ${this.taskDisplayName(task)}. Bạn có thể bắt đầu chia subtask.`,
                        type: "TASK_STAFFING_RESOLVED",
                        recipient: requester,
                        sender: resolver,
                        relatedEntityId: task.id,
                        relatedEntityType: "Task",
                        link: `/tasks/${task.id}`
                    }, manager);
                }
            } else if (action === "REJECT") {
                if (isAccountOrLead && !isPM) {
                    // Lead / Account tự hủy yêu cầu -> thông báo cho PM
                    const pmUser = oldSupportLeadId
                        ? await manager.getRepository(Users).findOneBy({ id: oldSupportLeadId })
                        : null;
                    if (pmUser) {
                        await this.notificationService.createNotification({
                            title: "Team Lead đã hủy yêu cầu bổ sung nhân sự",
                            content: `${resolver.fullName} đã hủy yêu cầu bổ sung nhân sự cho công việc ${this.taskDisplayName(task)}.`,
                            type: "TASK_STAFFING_REJECTED",
                            recipient: pmUser,
                            sender: resolver,
                            relatedEntityId: task.id,
                            relatedEntityType: "Task",
                            link: `/tasks/${task.id}`
                        }, manager);
                    }
                } else {
                    // PM từ chối yêu cầu -> thông báo cho Team Lead
                    const requester = task.project?.team?.teamLead;
                    if (requester) {
                        await this.notificationService.createNotification({
                            title: "PM từ chối yêu cầu nhân sự",
                            content: `PM đã từ chối yêu cầu bổ sung nhân sự cho công việc ${this.taskDisplayName(task)}.`,
                            type: "TASK_STAFFING_REJECTED",
                            recipient: requester,
                            sender: resolver,
                            relatedEntityId: task.id,
                            relatedEntityType: "Task",
                            link: `/tasks/${task.id}`
                        }, manager);
                    }
                }
            }

            return saved;
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        const projectId = (savedTask as any)?.projectId || savedTask.project?.id;
        if (projectId) {
            projectEmitter.emit(PROJECT_EVENTS.UPDATED, { id: projectId });
        }
        return savedTask;
    }

    async createSubtask(parentTaskId: string, data: CreateSubtaskInput, actor: TaskActor) {
        const transactionResult = await AppDataSource.transaction(async manager => {
            const taskRepo = manager.getRepository(Tasks);
            await this.lockTask(manager, parentTaskId, "Không tìm thấy công việc gốc");
            const parent = await taskRepo.findOne({
                where: { id: parentTaskId },
                relations: [
                    "project",
                    "project.team",
                    "project.team.teamLead",
                    "project.team.members",
                    "project.team.members.user",
                    "job",
                    "contractService",
                    "quotation",
                    "mappedService"
                ]
            });
            if (!parent) throw this.httpError("Không tìm thấy công việc gốc", 404);
            this.assertTaskProjectNotOnHold(parent);
            if (parent.parentTaskId) throw this.httpError("Không thể chia nhỏ một subtask", 400);
            if (!parent.project?.team) throw this.httpError("Công việc chưa thuộc đội dự án", 400);
            if (!parent.job) throw this.httpError("Công việc chưa có hạng mục để xác định quỹ Vinicoin", 400);
            if (!data.name?.trim()) throw this.httpError("Tên subtask không được để trống", 400);
            this.assertTaskCanBeSplit(parent);
            if (SUBTASK_PM_APPROVAL_ENABLED && [SubtaskPlanStatus.PENDING_APPROVAL, SubtaskPlanStatus.APPROVED].includes(parent.subtaskPlanStatus as SubtaskPlanStatus)) {
                throw this.httpError("Phương án phân bổ đang chờ duyệt hoặc đã được duyệt", 409);
            }

            const actorUserId = await this.resolveActorUserId(actor, manager);
            this.assertAccountCanDelegate(parent, actor, actorUserId);

            let assignee: Users | null = null;
            let assigneeId: string | null = null;
            if (data.assigneeId) {
                const assigneeIsMember = parent.project.team.members?.some(member => member.user?.id === data.assigneeId);
                if (!assigneeIsMember) {
                    throw this.httpError("Người được phân công chưa thuộc đội dự án. PM cần thêm nhân sự trước.", 400);
                }
                assignee = await manager.getRepository(Users).findOneBy({ id: data.assigneeId });
                if (!assignee) throw this.httpError("Không tìm thấy người thực hiện", 404);
                assigneeId = assignee.id;
            }

            const allocationPercent = Number(data.allocationPercent);
            if (!Number.isFinite(allocationPercent) || allocationPercent <= 0 || allocationPercent > 100) {
                throw this.httpError("% phân bổ phải lớn hơn 0 và không vượt quá 100", 400);
            }

            const existingSubtasks = await taskRepo.find({ where: { parentTaskId: parent.id } });
            const allocatedBasisPoints = this.assertValidSubtaskPlan(parent, existingSubtasks, false);
            if (allocatedBasisPoints + Math.round(allocationPercent * 100) > 10_000) {
                throw this.httpError("Tổng % phân bổ subtask không được vượt quá 100%", 400);
            }

            const sequence = existingSubtasks.length + 1;
            const subtask = taskRepo.create({
                code: parent.code ? `${parent.code}-S${String(sequence).padStart(2, "0")}` : null,
                name: data.name.trim(),
                project: parent.project,
                opportunity: parent.opportunity,
                opportunityId: parent.opportunityId,
                opportunityServiceJob: parent.opportunityServiceJob,
                opportunityServiceJobId: parent.opportunityServiceJobId,
                parentTask: parent,
                parentTaskId: parent.id,
                job: parent.job,
                contractService: parent.contractService,
                quotation: parent.quotation,
                mappedService: parent.mappedService,
                assignee: assignee || null,
                assigneeId: assigneeId || null,
                assignerId: actorUserId,
                performerType: PerformerType.INTERNAL,
                status: assigneeId ? TaskStatus.NOT_STARTED : TaskStatus.PENDING,
                description: data.description?.trim() || null,
                plannedStartDate: parent.plannedStartDate,
                plannedEndDate: parent.plannedEndDate,
                isExtra: false,
                isOutput: false,
                allocationPercent,
                rewardVinicoin: null,
                subtaskPlanStatus: SUBTASK_PM_APPROVAL_ENABLED ? SubtaskPlanStatus.DRAFT : null,
                isRewardable: true,
                sellingPrice: 0,
                cost: 0
            } as any) as unknown as Tasks;

            parent.isRewardable = true;
            parent.subtaskPlanStatus = SUBTASK_PM_APPROVAL_ENABLED ? SubtaskPlanStatus.DRAFT : null;
            parent.subtaskPlanReviewerId = null;
            parent.subtaskPlanRequesterId = null;
            parent.subtaskPlanReviewNote = null;
            if (parent.status === TaskStatus.AWAITING_SUPPORT) {
                parent.status = TaskStatus.DOING;
            }
            if (parent.isSupportRequested || (parent.supportRequestType === "STAFFING" && parent.isSupportAccepted)) {
                parent.isSupportRequested = false;
                parent.isSupportAccepted = false;
                parent.supportLeadId = null as any;
                parent.supportRequestType = null;
            }
            const savedParent = await taskRepo.save(parent);
            const saved = await taskRepo.save(subtask);

            if (!SUBTASK_PM_APPROVAL_ENABLED && assignee) {
                await this.notificationService.createNotification({
                    title: "Bạn được phân công công việc con",
                    content: `Bạn được giao công việc ${saved.name} thuộc ${this.taskDisplayName(parent)} với ${allocationPercent.toLocaleString("vi-VN")}% phân bổ.`,
                    type: "TASK_ASSIGNED",
                    recipient: assignee,
                    relatedEntityId: saved.id,
                    relatedEntityType: "Task",
                    link: `/tasks/${saved.id}`
                }, manager);
            }

            return { savedSubtask: saved, savedParent };
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, transactionResult.savedParent);
        taskEmitter.emit(TASK_EVENTS.CREATED, transactionResult.savedSubtask);
        return transactionResult.savedSubtask;
    }

    async updateSubtask(subtaskId: string, data: CreateSubtaskInput, actor: TaskActor) {
        const transactionResult = await AppDataSource.transaction(async manager => {
            const taskRepo = manager.getRepository(Tasks);
            const existing = await taskRepo.findOne({ where: { id: subtaskId } });
            if (!existing?.parentTaskId) throw this.httpError("Không tìm thấy subtask", 404);

            await this.lockTask(manager, existing.parentTaskId, "Không tìm thấy công việc gốc");
            const subtask = await taskRepo.findOne({
                where: { id: subtaskId },
                relations: ["reviews", "iterations"]
            });
            const parent = await taskRepo.findOne({
                where: { id: existing.parentTaskId },
                relations: [
                    "project",
                    "project.team",
                    "project.team.teamLead",
                    "project.team.members",
                    "project.team.members.user",
                    "job"
                ]
            });
            if (!subtask || !parent) throw this.httpError("Không tìm thấy subtask", 404);
            this.assertTaskProjectNotOnHold(parent);
            if (!parent.project?.team) throw this.httpError("Công việc chưa thuộc đội dự án", 400);
            const executionStarted = Boolean(
                subtask.result ||
                subtask.actualStartDate ||
                subtask.actualEndDate ||
                subtask.lastSubmittedById ||
                subtask.rewardVinicoin != null ||
                subtask.reviews?.length ||
                subtask.iterations?.length ||
                [
                    TaskStatus.AWAITING_REVIEW,
                    TaskStatus.INTERNAL_COMPLETED,
                    TaskStatus.COMPLETED,
                    TaskStatus.ACCEPTED,
                    TaskStatus.REWORKING
                ].includes(subtask.status)
            );
            if (executionStarted) {
                throw this.httpError(
                    "Không thể sửa phân bổ vì công việc con đã phát sinh thực hiện",
                    409
                );
            }
            if (SUBTASK_PM_APPROVAL_ENABLED && [SubtaskPlanStatus.PENDING_APPROVAL, SubtaskPlanStatus.APPROVED].includes(parent.subtaskPlanStatus as SubtaskPlanStatus)) {
                throw this.httpError("Không thể sửa khi phương án đang chờ duyệt hoặc đã được duyệt", 409);
            }

            const actorUserId = await this.resolveActorUserId(actor, manager);
            this.assertAccountCanDelegate(parent, actor, actorUserId);
            if (!data.name?.trim()) throw this.httpError("Tên subtask không được để trống", 400);

            const allocationPercent = Number(data.allocationPercent);
            if (!Number.isFinite(allocationPercent) || allocationPercent <= 0 || allocationPercent > 100) {
                throw this.httpError("% phân bổ phải lớn hơn 0 và không vượt quá 100", 400);
            }
            if (data.assigneeId !== undefined) {
                if (data.assigneeId) {
                    const assigneeIsMember = parent.project.team.members?.some(member => member.user?.id === data.assigneeId);
                    if (!assigneeIsMember) {
                        throw this.httpError("Người được phân công chưa thuộc đội dự án", 400);
                    }
                    const assignee = await manager.getRepository(Users).findOneBy({ id: data.assigneeId });
                    if (!assignee) throw this.httpError("Không tìm thấy người thực hiện", 404);
                    subtask.assignee = assignee;
                    subtask.assigneeId = assignee.id;
                    if (subtask.status === TaskStatus.PENDING) {
                        subtask.status = TaskStatus.NOT_STARTED;
                    }
                } else {
                    subtask.assignee = null as any;
                    subtask.assigneeId = null as any;
                    subtask.status = TaskStatus.PENDING;
                }
            }
            const siblingSubtasks = await taskRepo.find({ where: { parentTaskId: parent.id } });
            const otherSubtasks = siblingSubtasks.filter(candidate => candidate.id !== subtask.id);
            const allocatedBasisPoints = this.assertValidSubtaskPlan(parent, otherSubtasks, false);
            if (allocatedBasisPoints + Math.round(allocationPercent * 100) > 10_000) {
                throw this.httpError("Tổng % phân bổ subtask không được vượt quá 100%", 400);
            }

            subtask.name = data.name.trim();
            subtask.description = data.description?.trim() || null as any;
            subtask.allocationPercent = allocationPercent;
            subtask.rewardVinicoin = null;
            subtask.subtaskPlanStatus = SUBTASK_PM_APPROVAL_ENABLED ? SubtaskPlanStatus.DRAFT : null;
            const savedSubtask = await taskRepo.save(subtask);

            parent.subtaskPlanStatus = SUBTASK_PM_APPROVAL_ENABLED ? SubtaskPlanStatus.DRAFT : null;
            parent.subtaskPlanReviewerId = null;
            parent.subtaskPlanRequesterId = null;
            parent.subtaskPlanReviewNote = null;
            const savedParent = await taskRepo.save(parent);
            return { savedSubtask, savedParent };
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, transactionResult.savedParent);
        taskEmitter.emit(TASK_EVENTS.UPDATED, transactionResult.savedSubtask);
        return transactionResult.savedSubtask;
    }

    async submitSubtaskPlan(parentTaskId: string, actor: TaskActor) {
        if (!SUBTASK_PM_APPROVAL_ENABLED) {
            throw this.httpError("Chức năng PM xác nhận phương án công việc con đang tạm tắt", 409);
        }
        const savedParent = await AppDataSource.transaction(async manager => {
            const taskRepo = manager.getRepository(Tasks);
            await this.lockTask(manager, parentTaskId, "Không tìm thấy công việc gốc");
            const parent = await taskRepo.findOne({
                where: { id: parentTaskId },
                relations: [
                    "project",
                    "project.team",
                    "project.team.teamLead",
                    "project.team.members",
                    "project.team.members.user",
                    "job"
                ]
            });
            if (!parent) throw this.httpError("Không tìm thấy công việc gốc", 404);
            this.assertTaskProjectNotOnHold(parent);
            if (parent.parentTaskId) throw this.httpError("Subtask không có phương án chia cấp dưới", 400);
            if (!parent.project?.team) throw this.httpError("Công việc chưa thuộc đội dự án", 400);
            if (parent.subtaskPlanStatus === SubtaskPlanStatus.APPROVED) {
                throw this.httpError("Phương án phân bổ đã được duyệt", 409);
            }
            if (parent.subtaskPlanStatus === SubtaskPlanStatus.PENDING_APPROVAL) {
                throw this.httpError("Phương án phân bổ đang chờ PM duyệt", 409);
            }

            const actorUserId = await this.resolveActorUserId(actor, manager);
            this.assertAccountCanDelegate(parent, actor, actorUserId);
            const subtasks = await taskRepo.find({ where: { parentTaskId: parent.id } });
            this.assertValidSubtaskPlan(parent, subtasks, true);

            const projectManager = parent.project.team.members?.find(member =>
                memberHasRole(member, MemberRole.PROJECT_MANAGER) && member.user?.id
            )?.user;
            if (!projectManager) throw this.httpError("Dự án chưa có PM phụ trách để duyệt phương án", 400);

            parent.subtaskPlanStatus = SubtaskPlanStatus.PENDING_APPROVAL;
            parent.subtaskPlanReviewerId = projectManager.id;
            parent.subtaskPlanRequesterId = actorUserId || null;
            parent.subtaskPlanReviewNote = null;
            const saved = await taskRepo.save(parent);
            for (const subtask of subtasks) {
                subtask.subtaskPlanStatus = SubtaskPlanStatus.PENDING_APPROVAL;
                await taskRepo.save(subtask);
            }

            const requester = await manager.getRepository(Users).findOneBy({ id: actorUserId });
            await this.notificationService.createNotification({
                title: "Phương án chia subtask chờ duyệt",
                content: `${requester?.fullName || "Account"} đã gửi phương án chia 100% công việc ${this.taskDisplayName(parent)} để bạn duyệt.`,
                type: "SUBTASK_PLAN_APPROVAL_REQUESTED",
                recipient: projectManager,
                sender: requester || undefined,
                relatedEntityId: parent.id,
                relatedEntityType: "Task",
                link: `/tasks/${parent.id}`
            }, manager);

            return saved;
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, savedParent);
        return savedParent;
    }

    async respondSubtaskPlan(
        parentTaskId: string,
        action: "APPROVE" | "REJECT",
        note: string | undefined,
        actor: TaskActor
    ) {
        if (!SUBTASK_PM_APPROVAL_ENABLED) {
            throw this.httpError("Chức năng PM xác nhận phương án công việc con đang tạm tắt", 409);
        }
        const result = await AppDataSource.transaction(async manager => {
            const taskRepo = manager.getRepository(Tasks);
            await this.lockTask(manager, parentTaskId, "Không tìm thấy công việc gốc");
            const parent = await taskRepo.findOne({
                where: { id: parentTaskId },
                relations: [
                    "project",
                    "project.team",
                    "project.team.teamLead",
                    "project.team.members",
                    "project.team.members.user",
                    "job"
                ]
            });
            if (!parent) throw this.httpError("Không tìm thấy công việc gốc", 404);
            this.assertTaskProjectNotOnHold(parent);
            if (parent.subtaskPlanStatus !== SubtaskPlanStatus.PENDING_APPROVAL) {
                throw this.httpError("Phương án phân bổ không ở trạng thái chờ duyệt", 409);
            }

            const actorUserId = await this.resolveActorUserId(actor, manager);
            if (!this.isAdminOverride(actor) && parent.subtaskPlanReviewerId !== actorUserId) {
                throw this.httpError("Chỉ PM được chỉ định mới được duyệt phương án", 403);
            }

            const subtasks = await taskRepo.find({
                where: { parentTaskId: parent.id },
                relations: ["assignee"]
            });
            if (action === "APPROVE") {
                if (
                    !this.isAdminOverride(actor) &&
                    subtasks.some(subtask => subtask.assigneeId === actorUserId)
                ) {
                    throw this.httpError(
                        "PM có phần việc trong phương án không được tự duyệt. Cần ADMIN/BOD duyệt thay.",
                        409
                    );
                }
                this.assertValidSubtaskPlan(parent, subtasks, true);
                parent.subtaskPlanStatus = SubtaskPlanStatus.APPROVED;
                parent.subtaskPlanReviewNote = note?.trim() || null;

                for (const subtask of subtasks) {
                    subtask.status = TaskStatus.NOT_STARTED;
                    subtask.subtaskPlanStatus = SubtaskPlanStatus.APPROVED;
                    await taskRepo.save(subtask);
                    if (subtask.assignee) {
                        await this.notificationService.createNotification({
                            title: "Bạn được phân công subtask",
                            content: `Bạn được giao subtask ${subtask.name} thuộc công việc ${this.taskDisplayName(parent)} với ${Number(subtask.allocationPercent).toLocaleString("vi-VN")}% phân bổ.`,
                            type: "TASK_ASSIGNED",
                            recipient: subtask.assignee,
                            relatedEntityId: subtask.id,
                            relatedEntityType: "Task",
                            link: `/tasks/${subtask.id}`
                        }, manager);
                    }
                }
            } else {
                parent.subtaskPlanStatus = SubtaskPlanStatus.DRAFT;
                parent.subtaskPlanReviewerId = null;
                parent.subtaskPlanReviewNote = note?.trim() || "PM yêu cầu điều chỉnh phương án phân bổ";
                for (const subtask of subtasks) {
                    subtask.subtaskPlanStatus = SubtaskPlanStatus.DRAFT;
                    await taskRepo.save(subtask);
                }
            }

            const saved = await taskRepo.save(parent);
            const resolver = await manager.getRepository(Users).findOneBy({ id: actorUserId });
            const requester = parent.subtaskPlanRequesterId
                ? await manager.getRepository(Users).findOneBy({ id: parent.subtaskPlanRequesterId })
                : parent.project?.team?.teamLead;
            if (requester) {
                await this.notificationService.createNotification({
                    title: action === "APPROVE" ? "PM đã duyệt phương án chia subtask" : "PM yêu cầu điều chỉnh phương án chia subtask",
                    content: action === "APPROVE"
                        ? `Phương án chia công việc ${this.taskDisplayName(parent)} đã được duyệt và kích hoạt.`
                        : `Phương án chia công việc ${this.taskDisplayName(parent)} cần điều chỉnh${note?.trim() ? `: ${note.trim()}` : "."}`,
                    type: action === "APPROVE" ? "SUBTASK_PLAN_APPROVED" : "SUBTASK_PLAN_REJECTED",
                    recipient: requester,
                    sender: resolver || undefined,
                    relatedEntityId: parent.id,
                    relatedEntityType: "Task",
                    link: `/tasks/${parent.id}`
                }, manager);
            }

            return { savedParent: saved, subtasks };
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, result.savedParent);
        result.subtasks.forEach(subtask => taskEmitter.emit(TASK_EVENTS.UPDATED, subtask));
        return result.savedParent;
    }
}
