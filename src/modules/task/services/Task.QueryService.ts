import { AppDataSource } from "../../../data-source";
import { Tasks } from "../entities/Task.entity";
import { TaskStatus, PerformerType, PricingStatus, ViolationType } from "../../../shared/entities/Enums";
import { ILike, Like, Between, IsNull, In, Not, MoreThanOrEqual, LessThanOrEqual } from "typeorm";
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
import { isManagementRole, UserRole } from "../../account/entities/Account.entity";
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
        if (isManagementRole(userInfo.role)) return true;

        const userId = userInfo.userId || userInfo.id;
        const project = await this.projectRepository.findOne({
            where: { id: projectId },
            relations: ["team", "team.teamLead", "team.members", "team.members.user"]
        });

        if (!project?.team || !userId) return false;
        return this.isProjectOperatorFromTeam(project.team, userInfo);
    }

    async getAll(filters: any = {}, userInfo?: { id: string, userId?: string, role: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        const where: any = [];
        const projectId = filters.projectId as string | undefined;
        const opportunityId = filters.opportunityId as string | undefined;
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

        // Lọc các task có status không nằm trong danh sách excludeStatus (['PENDING', 'ACCEPTED', 'COMPLETED'])
        if (filters.excludeStatus) {
            const excludeList = Array.isArray(filters.excludeStatus)
                ? filters.excludeStatus
                : String(filters.excludeStatus).split(',').map((s: string) => s.trim()).filter(Boolean);

            if (excludeList.length > 0) {
                if (Array.isArray(baseWhere)) {
                    baseWhere.forEach((w: any) => w.status = Not(In(excludeList)));
                } else {
                    baseWhere.status = Not(In(excludeList));
                }
            }
        }

        // Lọc task theo tên (nameLike) Video Ai
        if (filters.nameLike) {
            const searchTerm = `%${String(filters.nameLike).trim()}%`;
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => w.name = ILike(searchTerm));
            } else {
                baseWhere.name = ILike(searchTerm);
            }
        }

        if (filters.assigneeId) {
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => w.assignee = { id: filters.assigneeId });
            } else {
                baseWhere.assignee = { id: filters.assigneeId };
            }
        }

        if (opportunityId) {
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => w.opportunityId = opportunityId);
            } else {
                baseWhere.opportunityId = opportunityId;
            }
        }

        if (projectId && !canOperateRequestedProject) {
            if (Array.isArray(baseWhere)) {
                baseWhere.forEach((w: any) => this.applyProjectFilter(w, projectId));
            } else {
                this.applyProjectFilter(baseWhere, projectId);
            }
        }

        // Lọc theo mốc thời gian linh hoạt (plannedEndDate, actualEndDate, actualStartDate, plannedRange)
        const dateType = filters.dateType || 'plannedEndDate';
        const deadlineDate = (filters.deadline === 'today' || filters.date === 'today')
            ? new Date().toISOString().split('T')[0]
            : (filters.deadline || filters.date);

        const startStr = filters.deadlineFrom || filters.dateFrom || deadlineDate;
        const endStr = filters.deadlineTo || filters.dateTo || deadlineDate;

        if (startStr || endStr) {
            const startDate = startStr ? new Date(`${startStr}T00:00:00.000`) : null;
            const endDate = endStr ? new Date(`${endStr}T23:59:59.999`) : null;
            const isValidStart = startDate && !isNaN(startDate.getTime());
            const isValidEnd = endDate && !isNaN(endDate.getTime());

            const applyDateCondition = (w: any) => {
                if (dateType === 'plannedRange') {
                    if (isValidEnd) w.plannedStartDate = LessThanOrEqual(endDate);
                    if (isValidStart) w.plannedEndDate = MoreThanOrEqual(startDate);
                } else {
                    const field = ['plannedEndDate', 'actualEndDate', 'actualStartDate', 'plannedStartDate'].includes(dateType)
                        ? dateType
                        : 'plannedEndDate';

                    if (isValidStart && isValidEnd) {
                        w[field] = Between(startDate, endDate);
                    } else if (isValidStart) {
                        w[field] = MoreThanOrEqual(startDate);
                    } else if (isValidEnd) {
                        w[field] = LessThanOrEqual(endDate);
                    }
                }
            };

            if (Array.isArray(baseWhere)) {
                baseWhere.forEach(applyDateCondition);
            } else {
                applyDateCondition(baseWhere);
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
            relations: ["project", "project.team", "project.team.teamLead", "project.team.members", "project.team.members.user", "opportunity", "opportunityServiceJob", "opportunityServiceJob.opportunityService", "job", "assignee", "supervisor", "helper"],
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
