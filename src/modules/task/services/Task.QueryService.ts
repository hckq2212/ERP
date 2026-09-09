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
import { isProjectManagementRole, UserRole } from "../../account/entities/Account.entity";
import { MemberRole } from "../../project/entities/TeamMember.entity";

import { TaskBaseService } from "./Task.BaseService";

export class TaskQueryService extends TaskBaseService {
    private applyProjectFilter(where: any, projectId: string) {
        where.project = {
            ...(where.project || {}),
            id: projectId
        };
    }

    private async canOperateProject(projectId: string, userInfo?: { id: string, userId?: string, role: string }) {
        if (!userInfo) return false;
        if (isProjectManagementRole(userInfo.role)) return true;

        const userId = userInfo.userId || userInfo.id;
        const project = await this.projectRepository.findOne({
            where: { id: projectId },
            relations: ["team", "team.teamLead", "team.members", "team.members.user"]
        });

        if (!project?.team || !userId) return false;
        if (project.team.teamLead?.id === userId) return true;

        return project.team.members?.some(member =>
            member.user?.id === userId &&
            [MemberRole.ACCOUNT, MemberRole.PROJECT_MANAGER].includes(member.role)
        ) || false;
    }

    async getAll(filters: any = {}, userInfo?: { id: string, userId?: string, role: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        const where: any = [];
        const projectId = filters.projectId as string | undefined;
        const canOperateRequestedProject = projectId
            ? await this.canOperateProject(projectId, userInfo)
            : false;
        const baseWhere: any = canOperateRequestedProject
            ? { project: { id: projectId } }
            : SecurityService.getTaskFilters(userInfo as any);

        if (filters.status && filters.status !== 'ALL') {
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => w.status = filters.status);
            } else {
                baseWhere.status = filters.status;
            }
        }

        if (filters.assigneeId) {
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => w.assignee = { id: filters.assigneeId });
            } else {
                baseWhere.assignee = { id: filters.assigneeId };
            }
        }

        if (projectId && !canOperateRequestedProject) {
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => this.applyProjectFilter(w, projectId));
            } else {
                this.applyProjectFilter(baseWhere, projectId);
            }
        }

        if (filters.q || filters.search) {
            const query = filters.q || filters.search;
            const searchTerm = `%${query}%`;
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => {
                    where.push({ ...w, name: ILike(searchTerm) });
                    where.push({ ...w, nickname: ILike(searchTerm) });
                    where.push({ ...w, code: ILike(searchTerm) });
                });
            } else {
                where.push({ ...baseWhere, name: ILike(searchTerm) });
                where.push({ ...baseWhere, nickname: ILike(searchTerm) });
                where.push({ ...baseWhere, code: ILike(searchTerm) });
            }
        } else {
            if (Array.isArray(baseWhere)) {
                where.push(...baseWhere);
            } else {
                where.push(baseWhere);
            }
        }

        const [items, total] = await this.taskRepository.findAndCount({
            where: where.length > 1 ? where : where[0],
            relations: ["project", "project.team", "project.team.teamLead", "project.team.members", "project.team.members.user", "job", "assignee", "supervisor", "helper"],
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
}
