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

export class ProjectJobSyncService extends ProjectBaseService {
    async syncServiceJobs(id: string, actor?: { id: string; role: string; userId?: string }) {
        const project = await this.projectRepository.findOne({
            where: { id },
            relations: ["team", "team.teamLead", "team.members", "team.members.user"]
        });
        if (!project) throw new Error("Không tìm thấy dự án");
        if (!this.canManageMonthlyWork(project, actor)) {
            const error: any = new Error("Bạn không có quyền đồng bộ công việc của dự án này");
            error.statusCode = 403;
            throw error;
        }

        const result = await this.syncContractServiceJobs(id);
        projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);
        return result;
    }
}
