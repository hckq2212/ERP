import { AppDataSource } from "../../../data-source";
import { EntityManager } from "typeorm";
import { PerformerType, TaskStatus } from "../../../shared/entities/Enums";
import { UserRole } from "../../account/entities/Account.entity";
import { MemberRole } from "../../project/entities/TeamMember.entity";
import { Users } from "../../user/entities/User.entity";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { Tasks } from "../entities/Task.entity";
import { TaskBaseService } from "./Task.BaseService";

type TaskActor = { id: string; userId?: string; role?: string };

type CreateSubtaskInput = {
    name: string;
    assigneeId: string;
    vinicoinAllocation: number;
    description?: string;
};

export class TaskDelegationService extends TaskBaseService {
    private readonly splittableStatuses = [
        TaskStatus.PENDING,
        TaskStatus.DOING,
        TaskStatus.REWORKING,
        TaskStatus.OVERDUE
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
            member.user?.id === actorUserId && member.role === MemberRole.ACCOUNT
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
            if (!task.project?.team) throw this.httpError("Công việc chưa thuộc đội dự án", 400);
            this.assertTaskCanBeSplit(task);

            const actorUserId = await this.resolveActorUserId(actor, manager);
            this.assertAccountCanDelegate(task, actor, actorUserId);

            const projectManagerMember = task.project.team.members?.find(member =>
                member.role === MemberRole.PROJECT_MANAGER && member.user
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
                relations: ["project", "project.team", "project.team.teamLead"]
            });
            if (!task) throw this.httpError("Không tìm thấy công việc", 404);
            if (task.supportRequestType !== "STAFFING" || !task.isSupportRequested || task.isSupportAccepted) {
                throw this.httpError("Yêu cầu này đã được xử lý", 409);
            }

            const actorUserId = await this.resolveActorUserId(actor, manager);
            if (!this.isAdminOverride(actor) && task.supportLeadId !== actorUserId) {
                throw this.httpError("Chỉ PM phụ trách dự án mới được xử lý yêu cầu", 403);
            }

            const resolver = await manager.getRepository(Users).findOneBy({ id: actorUserId });
            if (!resolver) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 401);

            task.isSupportAccepted = action === "RESOLVE";
            if (action === "REJECT") {
                task.isSupportRequested = false;
                task.supportLeadId = null as any;
                task.supportRequestType = null;
            }
            const saved = await taskRepo.save(task);

            const requester = task.project?.team?.teamLead;
            if (!requester) return saved;

            await this.notificationService.createNotification({
                title: action === "RESOLVE" ? "PM đã bổ sung nhân sự" : "PM từ chối yêu cầu nhân sự",
                content: action === "RESOLVE"
                    ? `PM đã xác nhận bổ sung nhân sự cho công việc ${this.taskDisplayName(task)}. Bạn có thể bắt đầu chia subtask.`
                    : `PM đã từ chối yêu cầu bổ sung nhân sự cho công việc ${this.taskDisplayName(task)}.`,
                type: action === "RESOLVE" ? "TASK_STAFFING_RESOLVED" : "TASK_STAFFING_REJECTED",
                recipient: requester,
                sender: resolver,
                relatedEntityId: task.id,
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            }, manager);

            return saved;
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
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
            if (parent.parentTaskId) throw this.httpError("Không thể chia nhỏ một subtask", 400);
            if (!parent.project?.team) throw this.httpError("Công việc chưa thuộc đội dự án", 400);
            if (!parent.job) throw this.httpError("Công việc chưa có hạng mục để xác định quỹ Vinicoin", 400);
            if (!parent.assigneeId) {
                throw this.httpError("Cần phân công người thực hiện task chính trước khi chia subtask", 409);
            }
            if (!data.name?.trim()) throw this.httpError("Tên subtask không được để trống", 400);
            this.assertTaskCanBeSplit(parent);

            const actorUserId = await this.resolveActorUserId(actor, manager);
            this.assertAccountCanDelegate(parent, actor, actorUserId);

            const assigneeIsMember = parent.project.team.members?.some(member => member.user?.id === data.assigneeId);
            if (!assigneeIsMember) {
                throw this.httpError("Người được phân công chưa thuộc đội dự án. PM cần thêm nhân sự trước.", 400);
            }
            const assignee = await manager.getRepository(Users).findOneBy({ id: data.assigneeId });
            if (!assignee) throw this.httpError("Không tìm thấy người thực hiện", 404);

            const allocation = Number(data.vinicoinAllocation);
            if (!Number.isFinite(allocation) || allocation < 0) {
                throw this.httpError("Vinicoin phân bổ phải là số không âm", 400);
            }

            const existingSubtasks = await taskRepo.find({ where: { parentTaskId: parent.id } });
            const allocated = existingSubtasks.reduce(
                (total, task) => total + Number(task.vinicoinAllocation || 0),
                0
            );
            const budget = parent.vinicoinBudget === null || parent.vinicoinBudget === undefined
                ? Number(parent.job.vinicoin || 0)
                : Number(parent.vinicoinBudget);
            if (allocated + allocation > budget) {
                throw this.httpError(
                    `Tổng Vinicoin subtask không được vượt quỹ ${budget.toLocaleString("vi-VN")}`,
                    400
                );
            }

            const sequence = existingSubtasks.length + 1;
            const subtask = taskRepo.create({
                code: parent.code ? `${parent.code}-S${String(sequence).padStart(2, "0")}` : null,
                name: data.name.trim(),
                project: parent.project,
                parentTask: parent,
                parentTaskId: parent.id,
                job: parent.job,
                contractService: parent.contractService,
                quotation: parent.quotation,
                mappedService: parent.mappedService,
                assignee,
                assigneeId: assignee.id,
                assignerId: actorUserId,
                performerType: PerformerType.INTERNAL,
                status: TaskStatus.DOING,
                description: data.description?.trim() || null,
                plannedStartDate: parent.plannedStartDate,
                plannedEndDate: parent.plannedEndDate,
                isExtra: false,
                isOutput: false,
                vinicoinAllocation: allocation,
                vinicoinBudget: null,
                isRewardable: true,
                sellingPrice: 0,
                cost: 0
            } as any) as unknown as Tasks;

            parent.vinicoinBudget = budget;
            parent.isRewardable = true;
            if (parent.supportRequestType === "STAFFING" && parent.isSupportAccepted) {
                parent.isSupportRequested = false;
                parent.isSupportAccepted = false;
                parent.supportLeadId = null as any;
                parent.supportRequestType = null;
            }
            const savedParent = await taskRepo.save(parent);
            const saved = await taskRepo.save(subtask);

            await this.notificationService.createNotification({
                title: "Bạn được phân công subtask",
                content: `Bạn được giao subtask ${saved.name} thuộc công việc ${this.taskDisplayName(parent)} với ${allocation.toLocaleString("vi-VN")} Vinicoin.`,
                type: "TASK_ASSIGNED",
                recipient: assignee,
                relatedEntityId: saved.id,
                relatedEntityType: "Task",
                link: `/tasks/${saved.id}`
            }, manager);

            return { savedSubtask: saved, savedParent };
        });

        taskEmitter.emit(TASK_EVENTS.UPDATED, transactionResult.savedParent);
        taskEmitter.emit(TASK_EVENTS.CREATED, transactionResult.savedSubtask);
        return transactionResult.savedSubtask;
    }
}
