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

export class TaskAssignmentService extends TaskBaseService {
    async updateNickname(
        id: string,
        nickname: string | null | undefined,
        currentUser?: { id: string; userId?: string; role: string }
    ) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.team", "project.team.teamLead"]
        });

        if (!task) throw this.httpError("Không tìm thấy công việc", 404);

        const currentUserId = currentUser?.userId || currentUser?.id;
        const isAdminOrBod = isProjectManagementRole(currentUser?.role);
        const isProjectLead = Boolean(task.project && task.project.team?.teamLead?.id === currentUserId);

        if (!isAdminOrBod && !isProjectLead) {
            throw this.httpError("Bạn không có quyền thay đổi nickname của công việc này", 403);
        }
        if (nickname === undefined) throw this.httpError("Vui lòng cung cấp nickname", 400);
        if (nickname != null && typeof nickname !== "string") throw this.httpError("Nickname không hợp lệ", 400);

        const normalizedNickname = nickname?.trim() || null;
        if (normalizedNickname && normalizedNickname.length > 120) {
            throw this.httpError("Nickname không được vượt quá 120 ký tự", 400);
        }

        task.nickname = normalizedNickname;
        const saved = await this.taskRepository.save(task);
        taskEmitter.emit(TASK_EVENTS.UPDATED, saved);
        return saved;
    }

    async update(id: string, data: Partial<Tasks> & { assigneeId?: string }, currentUser?: { id: string, userId?: string }) {
        const task = await this.getOne(id);

        if (data.assigneeId && (!task.assignee || task.assignee.id !== data.assigneeId)) {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (user) {
                task.assignee = user;
                await this.notificationService.createNotification({
                    title: "Thay đổi người thực hiện",
                    content: `Bạn được giao công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name} (Mã: ${task.code})`,
                    type: "TASK_ASSIGNED",
                    recipient: user,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        if (data.status) task.status = data.status;
        if (data.description !== undefined) task.description = data.description;
        if (data.plannedStartDate) task.plannedStartDate = data.plannedStartDate;
        if (data.plannedEndDate) task.plannedEndDate = data.plannedEndDate;
        if (data.actualStartDate) task.actualStartDate = data.actualStartDate;
        if (data.actualEndDate) task.actualEndDate = data.actualEndDate;
        if (data.result) {
            task.result = data.result;

            // Re-fetch to ensure we have lead info
            const taskWithInfo = await this.taskRepository.findOne({
                where: { id: task.id },
                relations: ["project", "project.team", "project.team.teamLead"]
            });

            const currentId = (currentUser as any)?.userId || currentUser?.id;
            const isTeamLead = taskWithInfo?.project?.team?.teamLead?.id === currentId;

            if (isTeamLead) {
                task.status = TaskStatus.AWAITING_REVIEW;
                task.actualEndDate = new Date();
                await this.taskRepository.save(task);

                await this.reviewService.initializeReviews(task.id, true);
                await this.reviewService.checkAndFinalize(task.id);
                task.status = TaskStatus.INTERNAL_COMPLETED;
            } else {
                task.status = TaskStatus.AWAITING_REVIEW;
                await this.taskRepository.save(task);

                if (taskWithInfo && taskWithInfo.project?.team?.teamLead) {
                    await this.reviewService.initializeReviews(task.id);

                    await this.notificationService.createNotification({
                        title: "Công việc chờ duyệt",
                        content: `Nhân viên đã upload kết quả cho công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name}. Vui lòng đánh giá.`,
                        type: "TASK_REVIEW",
                        recipient: taskWithInfo.project.team.teamLead,
                        relatedEntityId: task.id.toString(),
                        relatedEntityType: "Task",
                        link: `/tasks/${task.id}`
                    });
                }
            }
        }

        const saved = await this.taskRepository.save(task);
        taskEmitter.emit(TASK_EVENTS.UPDATED, saved);
        return saved;
    }

    async bulkAssign(taskIds: string[], data: {
        assigneeId: string;
        performerType?: PerformerType;
        plannedEndDate: Date;
        plannedStartDate: Date;
        description?: string;
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[];
    }, currentUser?: { id: string }) {
        return await AppDataSource.transaction(async (transactionalEntityManager) => {
            const results = [];
            const contractCostUpdates = new Map<string, number>();

            for (const id of taskIds) {
                const task = await transactionalEntityManager.findOne(Tasks, {
                    where: { id },
                    relations: ["project", "project.contract", "job"]
                });
                if (!task) continue;

                const oldCost = Number(task.cost || 0);
                let newCost = 0;

                const isSupportAssign = task.isSupportRequested && task.supportLeadId && task.isSupportAccepted && currentUser &&
                    (task.supportLeadId === currentUser.id || (currentUser as any).userId === task.supportLeadId);

                if (isSupportAssign) {
                    const user = await transactionalEntityManager.findOneBy(Users, { id: data.assigneeId });
                    if (!user) throw new Error("Người hỗ trợ không tồn tại");

                    task.helperId = data.assigneeId;
                    task.status = TaskStatus.DOING;
                    task.isSupportReturnRequested = false;

                    await this.notificationService.createNotification({
                        title: "Bạn được giao hỗ trợ công việc",
                        content: `Bạn được giao hỗ trợ công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name} (Mã: ${task.code})`,
                        type: "TASK_ASSIGNED",
                        recipient: user,
                        relatedEntityId: task.id.toString(),
                        relatedEntityType: "Task",
                        link: `/tasks/${task.id}`
                    }, transactionalEntityManager);
                } else {
                    // Clear support fields when reassigning the main performer
                    task.isSupportRequested = false;
                    task.isSupportAccepted = false;
                    task.supportTeamId = null as any;
                    task.supportLeadId = null as any;
                    task.helperId = null as any;
                    task.isSupportReturnRequested = false;
                    task.supportRequestNote = null as any;
                    task.supportReturnNote = null as any;

                    if (data.performerType === PerformerType.VENDOR) {
                        const vendor = await transactionalEntityManager.findOneBy(Vendors, { id: data.assigneeId });
                        if (!vendor) throw new Error("Vendor không tồn tại");

                        const vendorJob = await transactionalEntityManager.findOneBy(VendorJobs, {
                            vendor: { id: vendor.id },
                            job: { id: task.job.id }
                        });

                        if (!vendorJob) {
                            throw new Error(`Vendor ${vendor.name} chưa được thiết lập giá cho hạng mục ${task.job.name}`);
                        }

                        newCost = Number(vendorJob.price);
                        task.vendor = vendor;
                        task.assignee = null as any;
                        task.performerType = PerformerType.VENDOR;
                        task.cost = newCost;
                    } else {
                        const user = await transactionalEntityManager.findOneBy(Users, { id: data.assigneeId });
                        if (!user) throw new Error("Người thực hiện không tồn tại");
                        task.assignee = user;
                        task.vendor = null as any;
                        task.performerType = PerformerType.INTERNAL;
                        task.cost = 0;

                        await this.notificationService.createNotification({
                            title: "Công việc mới được giao",
                            content: `Bạn được giao công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name} (Mã: ${task.code})`,
                            type: "TASK_ASSIGNED",
                            recipient: user,
                            relatedEntityId: task.id.toString(),
                            relatedEntityType: "Task",
                            link: `/tasks/${task.id}`
                        }, transactionalEntityManager);
                    }

                    if (task.status === TaskStatus.PENDING || task.status === TaskStatus.AWAITING_SUPPORT) {
                        task.status = TaskStatus.DOING;
                    }
                }

                task.plannedEndDate = data.plannedEndDate;
                task.plannedStartDate = data.plannedStartDate;
                if (data.description) task.description = data.description;
                if (data.attachments) task.attachments = data.attachments;

                if (task.project?.contract) {
                    const contractId = task.project.contract.id;
                    const diff = newCost - oldCost;
                    contractCostUpdates.set(contractId, (contractCostUpdates.get(contractId) || 0) + diff);
                }

                if (currentUser) {
                    task.assignerId = (currentUser as any).userId || currentUser.id;
                }

                results.push(await transactionalEntityManager.save(task));
            }

            // Batch update contract costs
            for (const [contractId, diff] of contractCostUpdates.entries()) {
                if (diff !== 0) {
                    const contract = await transactionalEntityManager.findOneBy(Contracts, { id: contractId });
                    if (contract) {
                        contract.cost = Number(contract.cost || 0) + diff;
                        await transactionalEntityManager.save(contract);
                    }
                }
            }

            return results;
        });
    }

    async assign(id: string, data: {
        assigneeId: string;
        performerType?: PerformerType;
        plannedEndDate: Date;
        plannedStartDate: Date;
        description?: string;
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[];
    }, currentUser?: { id: string }) {
        const results = await this.bulkAssign([id], data, currentUser);
        return results[0];
    }

    async bulkUnassign(
        projectId: string,
        taskIds: string[],
        currentUser?: { id: string; userId?: string; role: string }
    ) {
        const result = await AppDataSource.transaction(async (transactionalEntityManager) => {
            const project = await transactionalEntityManager.findOne(Projects, {
                where: { id: projectId },
                relations: ["team", "team.teamLead", "contract"]
            });

            if (!project) {
                throw this.httpError("Không tìm thấy dự án", 404);
            }

            const currentUserId = currentUser?.userId || currentUser?.id;
            const isAdminOrBod = isProjectManagementRole(currentUser?.role);
            const isProjectLead = project.team?.teamLead?.id === currentUserId;

            if (!isAdminOrBod && !isProjectLead) {
                throw this.httpError("Bạn không có quyền xoá phân công trong dự án này", 403);
            }

            if (![ProjectStatus.CONFIRMED, ProjectStatus.IN_PROGRESS].includes(project.status)) {
                throw this.httpError("Dự án không ở trạng thái cho phép xoá phân công", 400);
            }

            const uniqueTaskIds = [...new Set(taskIds)];
            const tasks = await transactionalEntityManager.find(Tasks, {
                where: { id: In(uniqueTaskIds) },
                relations: ["project", "assignee", "vendor", "reviews", "iterations"]
            });
            const taskById = new Map(tasks.map(task => [task.id, task]));
            const unassigned: Tasks[] = [];
            const skipped: { id: string; code?: string; reason: string }[] = [];
            let contractCostReduction = 0;

            for (const id of uniqueTaskIds) {
                const task = taskById.get(id);
                if (!task) {
                    skipped.push({ id, reason: "Không tìm thấy công việc" });
                    continue;
                }

                const skip = (reason: string) => {
                    skipped.push({ id: task.id, code: task.code, reason });
                };

                if (task.project?.id !== projectId) {
                    skipped.push({ id: task.id, reason: "Công việc không thuộc dự án hiện tại" });
                    continue;
                }
                if (task.status !== TaskStatus.DOING) {
                    skip("Công việc không ở trạng thái đang thực hiện");
                    continue;
                }
                if (!task.assigneeId && !task.vendor) {
                    skip("Công việc chưa có người hoặc vendor được phân công");
                    continue;
                }
                if (task.result || task.actualStartDate || task.actualEndDate || task.lastSubmittedById) {
                    skip("Công việc đã phát sinh kết quả thực hiện");
                    continue;
                }
                if ((task.reviews?.length || 0) > 0 || (task.iterations?.length || 0) > 0) {
                    skip("Công việc đã phát sinh review hoặc lần làm lại");
                    continue;
                }

                const hasSupportActivity = task.isSupportRequested || task.isSupportAccepted ||
                    task.isSupportReturnRequested || Boolean(task.supportTeamId) ||
                    Boolean(task.supportLeadId) || Boolean(task.helperId) ||
                    Boolean(task.supportRequestNote) || Boolean(task.supportReturnNote);
                if (hasSupportActivity) {
                    skip("Công việc đã phát sinh luồng hỗ trợ");
                    continue;
                }

                contractCostReduction += Number(task.cost || 0);
                task.status = TaskStatus.PENDING;
                task.assignee = null as any;
                task.assigneeId = null as any;
                task.vendor = null as any;
                task.assigner = null as any;
                task.assignerId = null as any;
                task.performerType = PerformerType.INTERNAL;
                task.plannedStartDate = null as any;
                task.plannedEndDate = null as any;
                task.actualStartDate = null as any;
                task.actualEndDate = null as any;
                task.description = null as any;
                task.attachments = null as any;
                task.result = null as any;
                task.reassignNote = null as any;
                task.reviewNote = null as any;
                task.cost = 0;
                task.lastSubmittedById = null as any;
                task.lastSubmittedBy = null as any;
                task.isSupportRequested = false;
                task.isSupportAccepted = false;
                task.isSupportReturnRequested = false;
                task.supportTeamId = null as any;
                task.supportLeadId = null as any;
                task.helperId = null as any;
                task.helper = null as any;
                task.supportRequestNote = null as any;
                task.supportReturnNote = null as any;

                unassigned.push(await transactionalEntityManager.save(task));
            }

            if (project.contract && contractCostReduction !== 0) {
                await transactionalEntityManager.decrement(
                    Contracts,
                    { id: project.contract.id },
                    "cost",
                    contractCostReduction
                );
            }

            return { unassigned, skipped };
        });

        result.unassigned.forEach(task => taskEmitter.emit(TASK_EVENTS.UPDATED, task));
        return result;
    }

    async reassign(id: string, data: {
        assigneeId: string;
        performerType: PerformerType;
        reason: string;
    }, currentUser: { id: string }) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.contract", "job", "assignee", "vendor"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");

        // Identify old performer info for notification
        let oldPerformerName = "";
        let oldRecipient: Users | null = null;
        if (task.performerType === PerformerType.INTERNAL && task.assignee) {
            oldPerformerName = task.assignee.fullName;
            oldRecipient = task.assignee;
        } else if (task.performerType === PerformerType.VENDOR && task.vendor) {
            oldPerformerName = task.vendor.name;
        }

        const oldCost = Number(task.cost || 0);
        let newCost = 0;
        let newPerformerName = "";
        let newRecipient: Users | null = null;

        const isSupportReassign = task.isSupportRequested && task.isSupportAccepted && currentUser &&
            (task.supportLeadId === currentUser.id || (currentUser as any).userId === task.supportLeadId);

        if (isSupportReassign) {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (!user) throw new Error("Người hỗ trợ không tồn tại");

            task.helperId = data.assigneeId;
            task.isSupportReturnRequested = false;
            newPerformerName = user.fullName;
            newRecipient = user;
        } else {
            // Clear support fields when reassigning the main performer
            task.isSupportRequested = false;
            task.isSupportAccepted = false;
            task.supportTeamId = null as any;
            task.supportLeadId = null as any;
            task.helperId = null as any;
            task.isSupportReturnRequested = false;
            task.supportRequestNote = null as any;
            task.supportReturnNote = null as any;

            if (data.performerType === PerformerType.VENDOR) {
                const vendor = await this.vendorRepository.findOneBy({ id: data.assigneeId });
                if (!vendor) throw new Error("Vendor không tồn tại");

                const vendorJob = await this.vendorJobRepository.findOneBy({
                    vendor: { id: vendor.id },
                    job: { id: task.job.id }
                });

                if (!vendorJob) {
                    throw new Error(`Vendor ${vendor.name} chưa được thiết lập giá cho hạng mục ${task.job.name}`);
                }

                newCost = Number(vendorJob.price);
                newPerformerName = vendor.name;
                task.vendor = vendor;
                task.assignee = null as any;
                task.performerType = PerformerType.VENDOR;
                task.cost = newCost;
            } else {
                const user = await this.userRepository.findOneBy({ id: data.assigneeId });
                if (!user) throw new Error("Người thực hiện không tồn tại");

                newPerformerName = user.fullName;
                newRecipient = user;
                task.assignee = user;
                task.vendor = null as any;
                task.performerType = PerformerType.INTERNAL;
                task.cost = 0;
            }
        }

        // Check for late reassignment (Violation for OLD assignee)
        if (task.plannedEndDate && new Date() > task.plannedEndDate && task.assigneeId) {
            await this.recordViolation({
                taskId: task.id,
                userId: task.assigneeId,
                type: ViolationType.LATE_UNFINISHED,
                description: `Task quá hạn được chuyển giao cho người khác.`
            });
        }

        task.reassignNote = data.reason;
        task.assignerId = (currentUser as any).userId || currentUser.id;

        // Update Contract Cost if changed
        if (oldCost !== newCost && task.project?.contract) {
            const contract = task.project.contract;
            contract.cost = Number(contract.cost || 0) - oldCost + newCost;
            await this.contractRepository.save(contract);
        }

        const savedTask = await this.taskRepository.save(task);

        // Notify OLD performer (if Internal)
        if (oldRecipient) {
            await this.notificationService.createNotification({
                title: "Công việc đã được chuyển giao",
                content: `Công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name} (Mã: ${task.code}) đã được chuyển giao cho ${newPerformerName}`,
                type: "TASK_REASSIGNED",
                recipient: oldRecipient,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
            });
        }

        // Notify NEW performer (if Internal)
        if (newRecipient) {
            await this.notificationService.createNotification({
                title: "Công việc được chuyển giao mới",
                content: `Bạn được giao công việc: ${this.taskDisplayName(task)} của dự án ${task.project?.name} (Mã: ${task.code}).`,
                type: "TASK_ASSIGNED",
                recipient: newRecipient,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        return savedTask;
    }
}
