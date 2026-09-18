import { AppDataSource } from "../../../data-source";
import { Like, ILike, In, IsNull, Not } from "typeorm";
import { Projects, ProjectStatus } from "../entities/Project.entity";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";
import { ProjectTeams } from "../entities/ProjectTeam.entity";
import { TeamMembers } from "../entities/TeamMember.entity";
import { Users } from "../../user/entities/User.entity";
import { OpportunityStatus } from "../../opportunity/entities/Opportunity.entity";
import { ContractServices } from "../../contract/entities/ContractService.entity";
import { AddendumStatus, AddendumType, ContractAddendums } from "../../contract-addendum/entities/ContractAddendum.entity";
import { Services } from "../../service/entities/Service.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { TaskStatus } from "../../../shared/entities/Enums";
import { Jobs } from "../../job/entities/Job.entity";
import { PerformerType } from "../../../shared/entities/Enums";
import { NotificationService } from "../../notification/services/Notification.Service";

import { SecurityService } from "../../../shared/services/Security.Service";
import { Accounts, UserRole } from "../../account/entities/Account.entity";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../../opportunity/events/OpportunityEmitter";
// Google Sheet integration is temporarily disabled.
// import { GoogleSheetService } from "../../../shared/services/GoogleSheet.Service";

import { ProjectBaseService } from "./Project.BaseService";

type ActorInfo = { id: string; userId?: string; role: string };

export class ProjectLifecycleService extends ProjectBaseService {
    private httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    async createGoogleSheet(projectId: string) {
        void projectId;
        throw new Error("Google Sheet integration is temporarily disabled");
    }

    private async resolveActorUser(actor: ActorInfo) {
        if (actor.userId) {
            const user = await this.userRepository.findOneBy({ id: actor.userId });
            if (user) return user;
        }

        const account = await AppDataSource.getRepository(Accounts).findOne({
            where: { id: actor.id },
            relations: ["user"]
        });
        if (account?.user) return account.user;
        if (account?.userId) {
            const user = await this.userRepository.findOneBy({ id: account.userId });
            if (user) return user;
        }

        throw this.httpError("Tài khoản chưa được liên kết nhân sự để chấp nhận dự án", 403);
    }

    async confirm(id: string, actor: ActorInfo) {
        const userConfirming = await this.resolveActorUser(actor);
        const project = await this.projectRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["contract", "team", "team.teamLead", "team.members", "team.members.user"]
        });
        if (!project) throw this.httpError("Không tìm thấy dự án", 404);

        if (project.status !== ProjectStatus.PENDING_CONFIRMATION) {
            throw new Error("Dự án không ở trạng thái chờ xác nhận");
        }

        const isTeamLead = project.team?.teamLead?.id === userConfirming.id;
        const isSystemManager = actor.role === UserRole.ADMIN;

        if (!isSystemManager && !isTeamLead) {
            throw this.httpError("Bạn không có quyền chấp nhận dự án này", 403);
        }

        // Check if contract is already signed
        const contract = await this.contractRepository.findOneBy({ id: project.contract.id });
        if (contract?.status === ContractStatus.SIGNED) {
            project.status = ProjectStatus.IN_PROGRESS;
            project.actualStartDate = new Date();

            // Update Opportunity Status
            if (contract.opportunity) {
                const fullContract = await this.contractRepository.findOne({ where: { id: contract.id }, relations: ["opportunity"] });
                if (fullContract?.opportunity) {
                    const oppRepo = AppDataSource.getRepository(fullContract.opportunity.constructor);
                    fullContract.opportunity.status = OpportunityStatus.IMPLEMENTATION;
                    await oppRepo.save(fullContract.opportunity);
                    opportunityEmitter.emit(OPPORTUNITY_EVENTS.UPDATED, fullContract.opportunity);
                }
            }
        } else {
            project.status = ProjectStatus.IN_PROGRESS;
        }

        const savedProject = await this.projectRepository.save(project);
        projectEmitter.emit(PROJECT_EVENTS.UPDATED, savedProject);

        // Notify BOD members
        // ... (rest of notification logic)
        const bodUsers = await this.userRepository.find({
            relations: ["accounts"],
            where: { accounts: { role: "BOD" as any } }
        });

        for (const bod of bodUsers) {
            await this.notificationService.createNotification({
                title: "Dự án đã được tiếp nhận",
                content: `${userConfirming.fullName} đã nhận thông tin dự án ${savedProject.name}${savedProject.status === ProjectStatus.IN_PROGRESS ? " và đã bắt đầu thực hiện" : ""}`,
                type: "PROJECT_CONFIRMED",
                recipient: bod,
                relatedEntityId: savedProject.id,
                relatedEntityType: "Project",
                link: `/projects/${savedProject.id}`
            });
        }

        return savedProject;
    }

    private assertCanPauseOrResumeProject(project: Projects, actor: ActorInfo, actorUser: Users) {
        if ([UserRole.ADMIN, UserRole.BOD].includes(actor.role as UserRole)) {
            return;
        }
        if (actor.role === UserRole.BD) {
            const isContractCreator = project.contract?.createdBy?.id === actorUser.id;
            const isCustomerCreator = (project.contract as any)?.customer?.createdBy?.id === actorUser.id;
            if (isContractCreator || isCustomerCreator) {
                return;
            }
        }
        throw this.httpError("Chỉ BD phụ trách dự án hoặc Ban Giám đốc mới có quyền tạm ngừng/tiếp tục dự án", 403);
    }

    async pauseProject(id: string, reason: string, actor: ActorInfo) {
        if (!reason || !reason.trim()) {
            throw this.httpError("Vui lòng nhập lý do tạm ngừng dự án", 400);
        }
        const userActing = await this.resolveActorUser(actor);
        const project = await this.projectRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["contract", "contract.createdBy", "contract.customer", "team", "team.teamLead", "team.members", "team.members.user"]
        });
        if (!project) throw this.httpError("Không tìm thấy dự án", 404);

        this.assertCanPauseOrResumeProject(project, actor, userActing);

        if (![ProjectStatus.CONFIRMED, ProjectStatus.IN_PROGRESS].includes(project.status)) {
            throw this.httpError(`Dự án đang ở trạng thái ${project.status}, không thể tạm ngừng`, 400);
        }

        const result = await AppDataSource.transaction(async manager => {
            const pRepo = manager.getRepository(Projects);
            const tRepo = manager.getRepository(Tasks);

            project.status = ProjectStatus.ON_HOLD;
            project.pausedAt = new Date();
            project.pauseReason = reason.trim();
            project.pausedById = userActing.id;

            const savedProject = await pRepo.save(project);

            // Find all uncompleted tasks of this project
            const uncompletedTasks = await tRepo.find({
                where: {
                    project: { id: project.id },
                    status: Not(In([TaskStatus.COMPLETED, TaskStatus.ACCEPTED, TaskStatus.ON_HOLD]))
                }
            });

            for (const task of uncompletedTasks) {
                task.previousStatus = task.status;
                task.status = TaskStatus.ON_HOLD;
                await tRepo.save(task);
            }

            return { savedProject, uncompletedTasks };
        });

        // Notify teamLead and projectManager (if any)
        const recipientSet = new Set<string>();
        if (project.team?.teamLead && project.team.teamLead.id !== userActing.id) {
            recipientSet.add(project.team.teamLead.id);
            await this.notificationService.createNotification({
                title: "Dự án đã tạm ngừng",
                content: `BD ${userActing.fullName} đã tạm ngừng dự án ${project.name}. Lý do: ${reason.trim()}. Các công việc dở dang đã được chuyển sang tạm dừng.`,
                type: "PROJECT_CONFIRMED",
                recipient: project.team.teamLead,
                relatedEntityId: project.id,
                relatedEntityType: "Project",
                link: `/projects/${project.id}`
            });
        }

        const pmMember = project.team?.members?.find(m => m.role === "PROJECT_MANAGER" && m.user?.id);
        if (pmMember?.user && !recipientSet.has(pmMember.user.id) && pmMember.user.id !== userActing.id) {
            await this.notificationService.createNotification({
                title: "Dự án đã tạm ngừng",
                content: `BD ${userActing.fullName} đã tạm ngừng dự án ${project.name}. Lý do: ${reason.trim()}. Các công việc dở dang đã được chuyển sang tạm dừng.`,
                type: "PROJECT_CONFIRMED",
                recipient: pmMember.user,
                relatedEntityId: project.id,
                relatedEntityType: "Project",
                link: `/projects/${project.id}`
            });
        }

        projectEmitter.emit(PROJECT_EVENTS.UPDATED, result.savedProject);
        return result.savedProject;
    }

    async resumeProject(id: string, actor: ActorInfo) {
        const userActing = await this.resolveActorUser(actor);
        const project = await this.projectRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["contract", "contract.createdBy", "contract.customer", "team", "team.teamLead", "team.members", "team.members.user"]
        });
        if (!project) throw this.httpError("Không tìm thấy dự án", 404);

        this.assertCanPauseOrResumeProject(project, actor, userActing);

        if (project.status !== ProjectStatus.ON_HOLD) {
            throw this.httpError(`Dự án không ở trạng thái tạm ngừng (hiện tại: ${project.status})`, 400);
        }

        const result = await AppDataSource.transaction(async manager => {
            const pRepo = manager.getRepository(Projects);
            const tRepo = manager.getRepository(Tasks);

            project.status = ProjectStatus.IN_PROGRESS;
            project.pausedAt = null as any;
            project.pauseReason = null as any;
            project.pausedById = null as any;

            const savedProject = await pRepo.save(project);

            // Find all ON_HOLD tasks of this project to restore
            const onHoldTasks = await tRepo.find({
                where: {
                    project: { id: project.id },
                    status: TaskStatus.ON_HOLD
                }
            });

            for (const task of onHoldTasks) {
                if (task.previousStatus) {
                    if (task.previousStatus === TaskStatus.OVERDUE) {
                        task.status = TaskStatus.DOING;
                    } else {
                        task.status = task.previousStatus as TaskStatus;
                    }
                } else {
                    task.status = task.assigneeId ? TaskStatus.DOING : TaskStatus.PENDING;
                }
                // Clear previousStatus and clear old plannedEndDate so task won't be overdue immediately
                task.previousStatus = null as any;
                task.plannedEndDate = null as any;
                await tRepo.save(task);
            }

            return { savedProject, onHoldTasks };
        });

        // Notify teamLead and projectManager (if any)
        const recipientSet = new Set<string>();
        if (project.team?.teamLead && project.team.teamLead.id !== userActing.id) {
            recipientSet.add(project.team.teamLead.id);
            await this.notificationService.createNotification({
                title: "Dự án tiếp tục hoạt động",
                content: `Dự án ${project.name} đã được tiếp tục thực hiện. Vui lòng kiểm tra và cập nhật lại deadline cho các công việc dở dang.`,
                type: "PROJECT_CONFIRMED",
                recipient: project.team.teamLead,
                relatedEntityId: project.id,
                relatedEntityType: "Project",
                link: `/projects/${project.id}`
            });
        }

        const pmMember = project.team?.members?.find(m => m.role === "PROJECT_MANAGER" && m.user?.id);
        if (pmMember?.user && !recipientSet.has(pmMember.user.id) && pmMember.user.id !== userActing.id) {
            await this.notificationService.createNotification({
                title: "Dự án tiếp tục hoạt động",
                content: `Dự án ${project.name} đã được tiếp tục thực hiện. Vui lòng kiểm tra và cập nhật lại deadline cho các công việc dở dang.`,
                type: "PROJECT_CONFIRMED",
                recipient: pmMember.user,
                relatedEntityId: project.id,
                relatedEntityType: "Project",
                link: `/projects/${project.id}`
            });
        }

        projectEmitter.emit(PROJECT_EVENTS.UPDATED, result.savedProject);
        return result.savedProject;
    }
}
