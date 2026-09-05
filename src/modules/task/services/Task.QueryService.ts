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

import { TaskBaseService } from "./Task.BaseService";

export class TaskQueryService extends TaskBaseService {
    async getAll(filters: any = {}, userInfo?: { id: string, userId?: string, role: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        const where: any = [];
        const baseWhere: any = SecurityService.getTaskFilters(userInfo as any);

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

        if (filters.projectId) {
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => w.project = { id: filters.projectId });
            } else {
                baseWhere.project = { id: filters.projectId };
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
            relations: ["project", "project.team", "project.team.teamLead", "job", "assignee", "supervisor", "helper"],
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
