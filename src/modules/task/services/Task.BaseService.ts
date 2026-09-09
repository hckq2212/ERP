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
import { Accounts, isProjectManagementRole, UserRole } from "../../account/entities/Account.entity";
import { ProjectTeams } from "../../project/entities/ProjectTeam.entity";
import { TeamMembers, MemberRole } from "../../project/entities/TeamMember.entity";

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

    protected httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
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

        if (team.teamLead?.id === actorUserId) return true;

        return team.members?.some(member =>
            member.user?.id === actorUserId &&
            [MemberRole.ACCOUNT, MemberRole.PROJECT_MANAGER].includes(member.role)
        ) || false;
    }

    protected async isProjectOperator(projectId: string | undefined, actor?: TaskActor, manager?: any) {
        if (!projectId) return false;
        if (isProjectManagementRole(actor?.role)) return true;

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


    async getOne(id: string) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.team", "project.team.teamLead", "project.team.members", "project.team.members.user", "job", "job.criteria", "assignee", "quotation", "supervisor", "iterations", "lastSubmittedBy", "iterations.submittedBy"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        return task;
    }
}
