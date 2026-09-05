import { AppDataSource } from "../../../data-source";
import { Like, ILike, In, IsNull, Not } from "typeorm";
import { Projects, ProjectStatus } from "../entities/Project.entity";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";
import { ProjectTeams } from "../entities/ProjectTeam.entity";
import { TeamMembers, MemberRole } from "../entities/TeamMember.entity";
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
import { isProjectManagementRole, isStaffRole, UserRole } from "../../account/entities/Account.entity";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../../opportunity/events/OpportunityEmitter";
// Google Sheet integration is temporarily disabled.
// import { GoogleSheetService } from "../../../shared/services/GoogleSheet.Service";

import { ProjectBaseService } from "./Project.BaseService";

export class ProjectLifecycleService extends ProjectBaseService {
    async createGoogleSheet(projectId: string) {
        // Google Sheet integration is temporarily disabled.
        void projectId;
        throw new Error("Google Sheet integration is temporarily disabled");
    }

    async confirm(id: string, userId: string) {
        // userId should be the team leader's ID (from token)
        const project = await this.getOne(id);

        if (project.status !== ProjectStatus.PENDING_CONFIRMATION) {
            throw new Error("Dự án không ở trạng thái chờ xác nhận");
        }

        const userConfirming = await this.userRepository.findOneBy({ id: userId });
        if (!userConfirming) throw new Error("Không tìm thấy thông tin người xác nhận");

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
