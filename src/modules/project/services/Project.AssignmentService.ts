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

export class ProjectAssignmentService extends ProjectBaseService {
    async assign(data: { contractId: string, pmId: string, name?: string }) {
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

        const existingPmMember = await this.memberRepository.findOne({
            where: SecurityService.withTenant({ team: { id: team.id }, user: { id: pm.id } })
        });
        if (!existingPmMember) {
            const pmMember = this.memberRepository.create({
                team,
                user: pm,
                role: MemberRole.PROJECT_MANAGER,
                ...SecurityService.getTenantWhere()
            } as any);
            await this.memberRepository.save(pmMember);
        } else if (existingPmMember.role !== MemberRole.PROJECT_MANAGER) {
            existingPmMember.role = MemberRole.PROJECT_MANAGER;
            await this.memberRepository.save(existingPmMember);
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
}
