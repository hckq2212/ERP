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


    // async start(id: string) {
    //     const project = await this.getOne(id);

    //     // Requirement: Only transition to IN_PROGRESS if Team Lead has already accepted (CONFIRMED)
    //     if (project.status !== ProjectStatus.CONFIRMED) {
    //         console.log(`[ProjectService] Project ${id} is not in CONFIRMED state (current: ${project.status}). Skipping automatic IN_PROGRESS transition.`);
    //         return project;
    //     }

    //     // Check contract signed
    //     const contract = await this.contractRepository.findOneBy({ id: project.contract.id });
    //     if (contract?.status !== ContractStatus.SIGNED) {
    //         throw new Error("Hợp đồng chưa được ký (Signed), không thể bắt đầu dự án");
    //     }

    //     project.status = ProjectStatus.IN_PROGRESS;
    //     project.actualStartDate = new Date();

    //     // Update Opportunity Status
    //     const fullContract = await this.contractRepository.findOne({ where: { id: project.contract.id }, relations: ["opportunity"] });
    //     if (fullContract?.opportunity) {
    //         const oppRepo = AppDataSource.getRepository(fullContract.opportunity.constructor);
    //         fullContract.opportunity.status = OpportunityStatus.IMPLEMENTATION;
    //         await oppRepo.save(fullContract.opportunity);
    //     }

    //     return await this.projectRepository.save(project);
    // }
}
