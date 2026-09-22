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
import { isManagementRole, isStaffRole, UserRole } from "../../account/entities/Account.entity";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../../opportunity/events/OpportunityEmitter";
// Google Sheet integration is temporarily disabled.
// import { GoogleSheetService } from "../../../shared/services/GoogleSheet.Service";

import { ProjectBaseService } from "./Project.BaseService";

export class ProjectAssignmentService extends ProjectBaseService {
    async assign(data: { contractId: string, pmId: string, name?: string }, actor?: { id: string; role: string; userId?: string }) {
        if (!actor || !isManagementRole(actor.role)) {
            const error: any = new Error("Chỉ ADMIN/BOD mới được phân công PM cho dự án");
            error.statusCode = 403;
            throw error;
        }
        const contract = await this.contractRepository.findOne({
            where: { id: data.contractId },
            relations: ["opportunity"]
        });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        if (contract.status !== ContractStatus.PROPOSAL_APPROVED && contract.status !== ContractStatus.SIGNED) {
            throw new Error("Hợp đồng chưa được duyệt hoặc ký, không thể phân công dự án");
        }

        const pm = await this.userRepository.findOne({
            where: { id: data.pmId },
            relations: ["accounts"]
        });
        if (!pm) throw new Error("Không tìm thấy PM");
        if (!pm.accounts?.some(account => account.role === UserRole.PM)) {
            throw new Error("Người được chọn không phải PM");
        }


        // Check if project already exists for this contract
        let project = await this.projectRepository.findOne({
            where: { contract: { id: data.contractId } },
            relations: ["team", "team.teamLead", "team.teamLead.accounts"]
        });

        let isNewProject = false;
        if (project) {
            project.name = data.name || project.name;
        } else {
            isNewProject = true;
            project = this.projectRepository.create({
                name: data.name || `Dự án cho HĐ ${contract.contractCode}`,
                contract: contract,
                status: ProjectStatus.PENDING_CONFIRMATION,
                plannedStartDate: new Date()
            });
        }

        let team = project.team;
        if (!team) {
            team = this.teamRepository.create({
                name: `Đội dự án ${project.name}`,
                ...SecurityService.getTenantWhere()
            } as Partial<ProjectTeams>) as ProjectTeams;
        } else {
            team.name = `Đội dự án ${project.name}`;
            const currentLeadIsPm = team.teamLead?.accounts?.some(account => account.role === UserRole.PM);
            if (currentLeadIsPm) {
                team.teamLead = null as any;
            }
        }

        team = await this.teamRepository.save(team);
        project.team = team;

        let savedProject = await this.projectRepository.save(project);

        const existingProjectManagers = await this.memberRepository.find({
            where: SecurityService.withTenant({ team: { id: team.id }, role: MemberRole.PROJECT_MANAGER }),
            relations: ["user"]
        });
        const oldProjectManagers = existingProjectManagers.filter(member => member.user?.id !== pm.id);
        if (oldProjectManagers.length > 0) {
            await this.memberRepository.remove(oldProjectManagers);
        }

        // The assigned PM is a fixed project role: remove every secondary role
        // and keep exactly one PROJECT_MANAGER membership.
        const assignedPmMemberships = await this.memberRepository.find({
            where: SecurityService.withTenant({ team: { id: team.id }, user: { id: pm.id } })
        });
        const assignedPmRoleMemberships = assignedPmMemberships.filter(
            member => member.role === MemberRole.PROJECT_MANAGER
        );
        const secondaryMemberships = assignedPmMemberships.filter(
            member => member.role !== MemberRole.PROJECT_MANAGER
        );
        if (secondaryMemberships.length > 0) {
            await this.memberRepository.remove(secondaryMemberships);
        }
        if (assignedPmRoleMemberships.length === 0) {
            const pmMember = this.memberRepository.create({
                team,
                user: pm,
                role: MemberRole.PROJECT_MANAGER,
                ...SecurityService.getTenantWhere()
            } as any);
            await this.memberRepository.save(pmMember);
        } else if (assignedPmRoleMemberships.length > 1) {
            await this.memberRepository.remove(assignedPmRoleMemberships.slice(1));
        }

        if (isNewProject) {
            // Google Sheet integration is temporarily disabled.
            // await this.tryCreateGoogleSheet(savedProject.id);
            savedProject = await this.projectRepository.findOne({
                where: { id: savedProject.id },
                relations: ["team", "team.teamLead", "team.members", "team.members.user"]
            }) || savedProject;
        }

        await this.notificationService.createNotification({
            title: "Dự án mới được phân công",
            content: `Bạn được phân công quản lý dự án "${savedProject.name}".`,
            type: "PROJECT_ASSIGNED",
            recipient: pm,
            relatedEntityId: savedProject.id,
            relatedEntityType: "Project",
            link: `/projects/${savedProject.id}`
        });

        // Update Opportunity Status

        if (contract.opportunity) {
            const oppRepo = AppDataSource.getRepository(contract.opportunity.constructor);
            contract.opportunity.status = OpportunityStatus.PROJECT_ASSIGNED;
            await oppRepo.save(contract.opportunity);
            opportunityEmitter.emit(OPPORTUNITY_EVENTS.UPDATED, contract.opportunity);
        }

        projectEmitter.emit(PROJECT_EVENTS.CREATED, savedProject);

        return savedProject;
    }

    async createFromContract(contract: Contracts, userInfo?: { id: string, userId?: string }) {
        // 1. Check if project already exists
        let project = await this.projectRepository.findOne({
            where: { contract: { id: contract.id } },
            relations: ["contract"]
        });

        let isNewProject = false;
        if (!project) {
            isNewProject = true;
            project = this.projectRepository.create({
                name: `${contract.name}`,
                contract: contract,
                status: ProjectStatus.PENDING_CONFIRMATION,
                createdBy: userInfo?.userId ? { id: userInfo.userId } as Users : undefined
            });

            project = await this.projectRepository.save(project);
        }

        if (isNewProject) {
            // Google Sheet integration is temporarily disabled.
            // await this.tryCreateGoogleSheet(project.id);
            project = await this.projectRepository.findOne({
                where: { id: project.id },
                relations: ["contract"]
            }) || project;
        }

        await this.syncContractServiceJobs(project.id, { allowCompletedProject: true });

        projectEmitter.emit(PROJECT_EVENTS.CREATED, project);
        return project;
    }

    async requestStaffing(projectId: string, note: string | undefined, actor?: { id: string; role: string; userId?: string }) {
        const project = await this.projectRepository.findOne({
            where: { id: projectId },
            relations: [
                "team",
                "team.teamLead",
                "team.members",
                "team.members.user"
            ]
        });

        if (!project) {
            const error: any = new Error("Không tìm thấy dự án");
            error.statusCode = 404;
            throw error;
        }
        if (!project.team) {
            const error: any = new Error("Dự án chưa có đội dự án");
            error.statusCode = 400;
            throw error;
        }

        const actorUserId = actor?.userId || actor?.id;
        const isLead = project.team.teamLead?.id === actorUserId;
        const isAdmin = actor?.role === "ADMIN" || actor?.role === "BOD";

        if (!isLead && !isAdmin) {
            const error: any = new Error("Chỉ Team Lead của dự án mới có quyền yêu cầu thêm nhân sự");
            error.statusCode = 403;
            throw error;
        }

        const projectManagerMember = project.team.members?.find(
            m => m.role === MemberRole.PROJECT_MANAGER && m.user
        );
        const pmUser = projectManagerMember?.user;
        console.log("pmUser: ",pmUser)
        if (!pmUser) {
            const error: any = new Error("Dự án chưa có PM phụ trách để nhận yêu cầu");
            error.statusCode = 400;
            throw error;
        }

        const requester = await AppDataSource.getRepository(Users).findOneBy({ id: actorUserId });
        const requesterName = requester?.fullName || "Team Lead";

        await this.notificationService.createNotification({
            title: "Yêu cầu bổ sung nhân sự cho dự án",
            content: `${requesterName} yêu cầu bổ sung nhân sự cho dự án "${project.name}".${note?.trim() ? ` Ghi chú: ${note.trim()}` : ""}`,
            type: "TASK_STAFFING_REQUEST",
            recipient: pmUser,
            sender: requester || undefined,
            relatedEntityId: project.id,
            relatedEntityType: "Project",
            link: `/projects/${project.id}`
        });

        projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);

        return {
            success: true,
            message: "Đã gửi yêu cầu bổ sung nhân sự cho PM"
        };
    }
}
