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
import { Accounts, isManagementRole, isProjectManagementRole, UserRole } from "../../account/entities/Account.entity";
import { ProjectTeams } from "../../project/entities/ProjectTeam.entity";
import { TeamMembers, MemberRole, memberHasRole } from "../../project/entities/TeamMember.entity";
import { assertProjectNotOnHold, assertTaskProjectNotOnHold } from "../../project/helpers/ProjectHold.helper";

type TaskActor = { id?: string; userId?: string; role?: string };

export class TaskBaseService {
    protected taskRepository = AppDataSource.getRepository(Tasks);
    protected projectRepository = AppDataSource.getRepository(Projects);
    protected jobRepository = AppDataSource.getRepository(Jobs);
    protected userRepository = AppDataSource.getRepository(Users);
    protected vendorRepository = AppDataSource.getRepository(Vendors);
    protected vendorJobRepository = AppDataSource.getRepository(VendorJobs);
    protected contractRepository = AppDataSource.getRepository(Contracts);
    protected accountRepository = AppDataSource.getRepository(Accounts);
    protected teamRepository = AppDataSource.getRepository("ProjectTeams");
    protected taskIterationRepository = AppDataSource.getRepository("TaskIterations");
    protected notificationService = new NotificationService();
    protected reviewService = new TaskReviewService();
    protected violationRepository = AppDataSource.getRepository(Violations);

    protected taskDisplayName(task: Pick<Tasks, "name" | "nickname">) {
        return task.nickname?.trim() || task.name;
    }

    protected collectTaskNotificationRecipients(
        task: Pick<Tasks, "assignee" | "helper" | "assigner" | "supervisor" | "project">,
        options: { includePerformers?: boolean; excludeUserId?: string } = {}
    ) {
        const recipients: Users[] = [];
        const addRecipient = (user?: Users | null) => {
            if (!user?.id) return;
            if (options.excludeUserId && user.id === options.excludeUserId) return;
            if (!recipients.some(item => item.id === user.id)) recipients.push(user);
        };

        addRecipient(task.project?.team?.teamLead);
        addRecipient(task.assigner);
        addRecipient(task.supervisor);

        for (const member of task.project?.team?.members || []) {
            if (
                memberHasRole(member, MemberRole.ACCOUNT) ||
                memberHasRole(member, MemberRole.PROJECT_MANAGER)
            ) {
                addRecipient(member.user);
            }
        }

        if (options.includePerformers) {
            addRecipient(task.assignee);
            addRecipient(task.helper);
        }

        return recipients;
    }

    protected async notifyTaskRecipients(
        task: Tasks,
        data: { title: string; content: string; type: string },
        options: { includePerformers?: boolean; excludeUserId?: string; manager?: any } = {}
    ) {
        for (const recipient of this.collectTaskNotificationRecipients(task, options)) {
            await this.notificationService.createNotification({
                title: data.title,
                content: data.content,
                type: data.type,
                recipient,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            }, options.manager);
        }
    }

    protected httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    /**
     * Chặn thao tác ghi lên dự án đang tạm dừng (ON_HOLD).
     * Gọi ở đầu mỗi service method có ghi dữ liệu task; KHÔNG gọi ở luồng resume/close.
     */
    protected async assertProjectNotOnHold(
        projectIds: (string | null | undefined)[],
        manager?: any
    ) {
        return assertProjectNotOnHold(this.projectRepository, projectIds, manager);
    }

    /**
     * Biến thể dùng khi đã có sẵn `task.project` (đã load quan hệ "project").
     */
    protected assertTaskProjectNotOnHold(
        task: { project?: { id: string; name: string; status: ProjectStatus } | null } | null | undefined
    ) {
        return assertTaskProjectNotOnHold(task);
    }

    /**
     * Chặn thay đổi lên công việc đã ở trạng thái cuối (ACCEPTED, COMPLETED, DONE, CANCELLED, ON_HOLD)
     * hoặc dự án đã đóng/tạm dừng (COMPLETED, CANCELLED, ON_HOLD).
     */
    protected assertTaskNotLocked(
        task: {
            status?: TaskStatus;
            project?: { id: string; name: string; status: ProjectStatus } | null;
        } | null | undefined
    ) {
        if (!task) return;
        this.assertTaskProjectNotOnHold(task);

        const lockedStatuses = [
            TaskStatus.ACCEPTED,
            TaskStatus.COMPLETED,
            TaskStatus.CANCELLED,
            TaskStatus.ON_HOLD
        ];
        if (task.status && lockedStatuses.includes(task.status)) {
            throw this.httpError(`Công việc đã ở trạng thái "${task.status}", không thể chỉnh sửa`, 400);
        }
        if (task.project && [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED, ProjectStatus.ON_HOLD].includes(task.project.status)) {
            throw this.httpError(`Dự án đang ở trạng thái "${task.project.status}", không thể chỉnh sửa công việc`, 409);
        }
    }

    /**
     * Chặn theo DANH SÁCH task id (dùng cho bulk assign/unassign, xoá task...).
     * Tra project của từng task rồi chặn nếu BẤT KỲ project nào đang ON_HOLD
     * → đảm bảo không ghi nửa vời.
     */
    protected async assertProjectNotOnHoldForTasks(taskIds: string[], manager?: any) {
        const uniqueIds = [...new Set((taskIds || []).filter(Boolean))];
        if (uniqueIds.length === 0) return;

        const taskRepo = manager ? manager.getRepository(Tasks) : this.taskRepository;
        const tasks = await taskRepo.find({
            where: { id: In(uniqueIds) },
            relations: ["project"]
        });

        await assertProjectNotOnHold(
            this.projectRepository,
            tasks.map(task => task.project?.id),
            manager
        );
    }

    protected getActorUserId(actor?: TaskActor) {
        return actor?.userId || actor?.id;
    }

    protected async resolveActorUserId(actor?: TaskActor, manager?: any) {
        const candidateIds = [actor?.userId, actor?.id].filter(Boolean) as string[];
        if (candidateIds.length === 0) return undefined;

        const userRepo = manager ? manager.getRepository(Users) : this.userRepository;
        const candidateUser = await userRepo.findOne({ where: { id: In(candidateIds) } });
        if (candidateUser) return candidateUser.id;

        const accountRepo = manager ? manager.getRepository(Accounts) : this.accountRepository;
        const account = await accountRepo.findOne({
            where: { id: In(candidateIds) },
            relations: ["user"]
        });
        return account?.user?.id || account?.userId;
    }

    protected isProjectOperatorFromTeam(team?: ProjectTeams | null, actor?: TaskActor) {
        const actorUserId = this.getActorUserId(actor);
        if (!actorUserId || !team) return false;

        if (actor?.role === UserRole.PM) {
            return team.members?.some(member =>
                member.user?.id === actorUserId && memberHasRole(member, MemberRole.PROJECT_MANAGER)
            ) || team.members?.some(member =>
                member.user?.id === actorUserId) || false;
        }

        if (team.teamLead?.id === actorUserId) return true;

        return team.members?.some(member =>
            member.user?.id === actorUserId &&
            [MemberRole.ACCOUNT, MemberRole.PROJECT_MANAGER].some(role => memberHasRole(member, role))
        ) || false;
    }

    /**
     * "Account" trong nghiệp vụ dự án là Lead dự án (MemberRole.ACCOUNT),
     * không phải tài khoản đăng nhập trong bảng Accounts.
     */
    protected isProjectLeadFromTeam(team?: ProjectTeams | null, actor?: TaskActor) {
        const actorUserId = this.getActorUserId(actor);
        if (!actorUserId || !team) return false;

        if (team.teamLead?.id === actorUserId) return true;

        return team.members?.some(member =>
            member.user?.id === actorUserId && memberHasRole(member, MemberRole.ACCOUNT)
        ) || false;
    }

    /**
     * Một task đã có người thực hiện chỉ được thay đổi phân công bởi Lead đã giao
     * task đó. ADMIN là ngoại lệ duy nhất. Task cũ chưa có assignerId có thể được
     * một Lead nhận quyền sở hữu ở lần thay đổi phân công kế tiếp.
     */
    protected async assertCanManageTaskAssignment(
        task: Pick<Tasks, "assignerId" | "assigneeId" | "vendor" | "project">,
        actor?: TaskActor,
        manager?: any
    ) {
        if (!actor) throw this.httpError("Bạn cần đăng nhập để phân công công việc", 401);

        const actorUserId = await this.resolveActorUserId(actor, manager);
        if (!actorUserId) {
            throw this.httpError("Tài khoản chưa được liên kết nhân sự để phân công công việc", 401);
        }

        if (task.project?.status === ProjectStatus.PENDING_CONFIRMATION) {
            throw this.httpError("Dự án chưa được chấp nhận, chưa thể phân công công việc", 409);
        }

        if (actor.role === UserRole.ADMIN) return actorUserId;

        if (task.project) {
            if (!this.isProjectLeadFromTeam(task.project.team, { ...actor, userId: actorUserId })) {
                throw this.httpError("Chỉ Lead dự án hoặc Admin mới được phân công công việc", 403);
            }
        } else if (!isProjectManagementRole(actor.role)) {
            // Task cơ hội/video demo không thuộc team dự án nên giữ quyền phân
            // công quản lý hiện có, nhưng vẫn áp dụng khóa người giao bên dưới.
            throw this.httpError("Bạn không có quyền phân công công việc này", 403);
        }

        const hasMainPerformer = Boolean(task.assigneeId || task.vendor);
        if (hasMainPerformer && task.assignerId && task.assignerId !== actorUserId) {
            throw this.httpError(
                "Công việc đã được phân công bởi Lead dự án khác. Bạn không có quyền thay đổi phân công này.",
                409
            );
        }

        return actorUserId;
    }

    protected async isProjectOperator(projectId: string | undefined, actor?: TaskActor, manager?: any) {
        if (!projectId) return false;
        if (isManagementRole(actor?.role)) return true;

        const actorUserId = this.getActorUserId(actor);
        if (!actorUserId) return false;

        const projectRepo = manager ? manager.getRepository(Projects) : this.projectRepository;
        const project = await projectRepo.findOne({
            where: { id: projectId },
            relations: ["team", "team.teamLead", "team.members", "team.members.user"]
        });

        return this.isProjectOperatorFromTeam(project?.team, actor);
    }

    protected async recordViolation(data: {
        taskId: string,
        userId: string,
        type: ViolationType,
        description?: string,
        iterationVersion?: number,
        manager?: any
    }) {
        const repo = data.manager ? data.manager.getRepository(Violations) : this.violationRepository;
        const violation = repo.create({
            taskId: data.taskId,
            userId: data.userId,
            type: data.type,
            description: data.description,
            iterationVersion: data.iterationVersion
        });
        await repo.save(violation);
    }


    async getOne(id: string, actor?: TaskActor) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: [
                "project",
                "project.team",
                "project.team.teamLead",
                "project.team.members",
                "project.team.members.user",
                "opportunity", 
                "opportunityServiceJob", 
                "opportunityServiceJob.opportunityService",
                "job",
                "job.criteria",
                "assignee",
                "assigner",
                "helper",
                "quotation",
                "supervisor",
                "iterations",
                "lastSubmittedBy",
                "iterations.submittedBy",
                "parentTask",
                "subtasks",
                "subtasks.assignee"
            ]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        const isOpportunityVideoDemo = Boolean(
            task.opportunityId && task.opportunityServiceJob?.isBriefVideo
        );

        if (actor?.role === UserRole.PM &&
            !isOpportunityVideoDemo &&
            !this.isProjectOperatorFromTeam(task.project?.team, actor)) {
            throw this.httpError("Bạn không có quyền xem công việc ngoài dự án được phân công", 403);
        }
        return task;
    }
}
