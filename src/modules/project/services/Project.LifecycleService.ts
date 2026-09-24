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
    // `httpError` nay kế thừa từ ProjectBaseService (protected) — không khai báo lại.

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

    async updateWorkingFiles(
        id: string,
        workingFiles: Array<{
            id?: string;
            name: string;
            url: string;
            type?: "LINK" | "FILE";
            size?: number;
            createdAt?: string;
            createdById?: string;
            createdByName?: string;
        }>,
        actor?: { id?: string; userId?: string; role?: string }
    ) {
        const project = await this.projectRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["team", "team.teamLead", "team.members", "team.members.user"]
        });

        if (!project) {
            throw this.httpError("Không tìm thấy dự án", 404);
        }

        await this.assertProjectNotOnHold([project.id]);

        if ([ProjectStatus.COMPLETED, ProjectStatus.CANCELLED].includes(project.status)) {
            throw this.httpError("Dự án đã hoàn tất hoặc đã đóng, không thể chỉnh sửa tài liệu làm việc", 400);
        }

        let creatorName = "";
        if (actor) {
            try {
                if (actor.id) {
                    const user = await this.resolveActorUser({
                        id: actor.id,
                        userId: actor.userId,
                        role: actor.role || ""
                    });
                    creatorName = user?.fullName || "";
                } else if (actor.userId) {
                    const user = await this.userRepository.findOneBy({ id: actor.userId });
                    creatorName = user?.fullName || "";
                }
            } catch {
                // Actor might be admin/system without user record
            }
        }

        const normalizedFiles = Array.isArray(workingFiles)
            ? workingFiles.map(file => ({
                id: file.id || `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                name: (file.name || "").trim() || "Tài liệu",
                url: (file.url || "").trim(),
                type: (file.type === "FILE" ? "FILE" : "LINK") as "LINK" | "FILE",
                size: typeof file.size === "number" ? file.size : undefined,
                createdAt: file.createdAt || new Date().toISOString(),
                createdById: file.createdById || actor?.userId || actor?.id,
                createdByName: file.createdByName || creatorName || undefined
            })).filter(file => Boolean(file.url))
            : [];

        project.workingFiles = normalizedFiles;
        await this.projectRepository.save(project);

        return {
            message: "Cập nhật tài liệu làm việc thành công",
            workingFiles: normalizedFiles
        };
    }
}

