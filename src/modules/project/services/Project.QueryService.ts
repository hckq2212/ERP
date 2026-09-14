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

export class ProjectQueryService extends ProjectBaseService {
    async getAll(filters: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        let rbacWhere: any = {};
        if (userInfo) {
            try {
                rbacWhere = SecurityService.getProjectFilters(userInfo);
            } catch (error: any) {
                if (error.message === "FORBIDDEN_ACCESS") {
                    return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
                }
                throw error;
            }
        }

        const baseWhere: any = {};
        if (filters.status && filters.status !== 'ALL') {
            baseWhere.status = filters.status;
        }

        // Combine search and RBAC
        let where: any = [];
        const combineWithSearch = (rbacCond: any) => {
            if (filters.search) {
                const searchTerm = `%${filters.search}%`;
                return [
                    { ...baseWhere, ...rbacCond, name: ILike(searchTerm) },
                    {
                        ...baseWhere,
                        ...rbacCond,
                        contract: {
                            ...rbacCond.contract,
                            contractCode: ILike(searchTerm)
                        }
                    },
                    {
                        ...baseWhere,
                        ...rbacCond,
                        contract: {
                            ...rbacCond.contract,
                            name: ILike(searchTerm)
                        }
                    }
                ];
            }
            return { ...baseWhere, ...rbacCond };
        };

        if (Array.isArray(rbacWhere)) {
            rbacWhere.forEach(cond => {
                const combined = combineWithSearch(cond);
                if (Array.isArray(combined)) {
                    where.push(...combined);
                } else {
                    where.push(combined);
                }
            });
        } else {
            const combined = combineWithSearch(rbacWhere);
            if (Array.isArray(combined)) {
                where.push(...combined);
            } else {
                where.push(combined);
            }
        }

        const [items, total] = await this.projectRepository.findAndCount({
            where: where.length > 1 ? where : where[0],
            relations: ["contract", "team", "team.teamLead", "team.members", "team.members.user", "team.members.user.accounts"],
            order: { [sortBy]: sortDir },
            skip: (page - 1) * limit,
            take: limit
        });

        return {
            data: items,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getByContractId(contractId: string) {
        const project = await this.projectRepository.findOne({
            where: { contract: { id: contractId } },
            relations: ["contract", "team", "team.teamLead", "team.members", "team.members.user", "team.members.user.accounts", "tasks", "tasks.assignee", "tasks.job", "tasks.quotation"]
        });

        if (!project) throw new Error("Không tìm thấy dự án liên kết với hợp đồng này");
        return project;
    }

    // Gọi dư án của tôi khi tạo chọn dự án khi tạo video
    async getMyProjects(userInfo: { id: string; userId?: string; role: string }) {
        const isUnrestricted = userInfo.role === UserRole.BOD || userInfo.role === UserRole.ADMIN;

        const qb = this.projectRepository
            .createQueryBuilder("project")
            .select(["project.id", "project.name", "project.status", "project.createdAt"])
            .where("project.status = :status", { status: ProjectStatus.IN_PROGRESS })
            .orderBy("project.createdAt", "DESC");

        if (!isUnrestricted) {
            if (!userInfo.userId) return [];

            qb.innerJoin("project.team", "team")
            .innerJoin("team.members", "member")
            .innerJoin("member.user", "teamUser")
            .andWhere("teamUser.id = :userId", { userId: userInfo.userId })
            .distinct(true);
        }

        return qb.getMany();
    }
}
