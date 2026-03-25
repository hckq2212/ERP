import { AppDataSource } from "../data-source";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus, PerformerType, PricingStatus } from "../entity/Enums";
import { ILike, Like, Between, IsNull } from "typeorm";
import { Projects } from "../entity/Project.entity";
import { Jobs } from "../entity/Job.entity";
import { Users } from "../entity/User.entity";
import { Vendors } from "../entity/Vendor.entity";
import { VendorJobs } from "../entity/VendorJob.entity";
import { NotificationService } from "./Notification.Service";
import { TaskReviewService } from "./TaskReview.Service";
import { StringHelper } from "../helpers/String.helper";
import { Contracts } from "../entity/Contract.entity";
import { TaskReviews } from "../entity/TaskReview.entity";
import { SecurityService } from "./Security.Service";
import { ContractServices, ContractServiceStatus } from "../entity/ContractService.entity";

export class TaskService {
    private taskRepository = AppDataSource.getRepository(Tasks);
    private projectRepository = AppDataSource.getRepository(Projects);
    private jobRepository = AppDataSource.getRepository(Jobs);
    private userRepository = AppDataSource.getRepository(Users);
    private vendorRepository = AppDataSource.getRepository(Vendors);
    private vendorJobRepository = AppDataSource.getRepository(VendorJobs);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private teamRepository = AppDataSource.getRepository("ProjectTeams");
    private taskIterationRepository = AppDataSource.getRepository("TaskIterations");
    private notificationService = new NotificationService();
    private reviewService = new TaskReviewService();

    async createInternalTask(data: {
        name: string,
        assigneeId: string,
        supervisorId: string,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date,
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[]
    }, currentUser?: { id: string }) {
        const assignee = await this.userRepository.findOneBy({ id: data.assigneeId });
        if (!assignee) throw new Error("Không tìm thấy người thực hiện");

        const supervisor = await this.userRepository.findOneBy({ id: data.supervisorId });
        if (!supervisor) throw new Error("Không tìm thấy người giám sát");

        // Logic sinh mã (Code Generation)
        const initials = StringHelper.getInitials(assignee.fullName);
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');

        // Đếm số lượng công việc nội bộ trong tháng để lấy Index
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const internalTaskCount = await this.taskRepository.count({
            where: {
                project: IsNull(),
                createdAt: Between(startOfMonth, endOfMonth)
            }
        });

        const sequence = (internalTaskCount + 1).toString().padStart(2, '0');
        const taskCode = `CVK-${initials}-${year}-${month}-${sequence}`;

        const task = this.taskRepository.create({
            code: taskCode,
            name: data.name,
            project: null,
            job: null,
            assignee: assignee,
            supervisor: supervisor,
            status: TaskStatus.DOING,
            plannedStartDate: data.plannedStartDate,
            plannedEndDate: data.plannedEndDate,
            description: data.description,
            attachments: data.attachments,
            assignerId: (currentUser as any)?.userId || currentUser?.id
        });

        const savedTask = await this.taskRepository.save(task);

        // Notify Assignee
        await this.notificationService.createNotification({
            title: "Công việc nội bộ mới",
            content: `Bạn được giao công việc nội bộ: ${task.name} (Mã: ${task.code})`,
            type: "TASK_ASSIGNED",
            recipient: assignee,
            relatedEntityId: savedTask.id?.toString(),
            relatedEntityType: "Task",
            link: `/tasks/${savedTask.id}`
        });

        // Notify Supervisor
        await this.notificationService.createNotification({
            title: "Giám sát công việc mới",
            content: `Bạn được phân công giám sát ${assignee?.fullName} cho công việc: ${task.name} (Mã: ${task.code})`,
            type: "TASK_REVIEW",
            recipient: supervisor,
            relatedEntityId: savedTask.id?.toString(),
            relatedEntityType: "Task",
            link: `/tasks/${savedTask.id}`
        });

        return savedTask;
    }

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
                    where.push({ ...w, code: ILike(searchTerm) });
                });
            } else {
                where.push({ ...baseWhere, name: ILike(searchTerm) });
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

    async getOne(id: string) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.team", "project.team.teamLead", "job", "assignee", "quotation", "supervisor", "iterations", "lastSubmittedBy", "iterations.submittedBy"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        return task;
    }

    async create(data: {
        projectId?: string,
        jobId: string,
        assigneeId?: string,
        performerType?: PerformerType,
        vendorId?: string,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date,
        isExtra?: boolean
    }, currentUser?: { id: string }) {
        let project = null;
        let taskCode = null;

        const job = await this.jobRepository.findOne({ where: { id: data.jobId } });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        if (data.projectId) {
            project = await this.projectRepository.findOne({
                where: { id: data.projectId },
                relations: ["contract"]
            });
            if (!project) throw new Error("Không tìm thấy dự án");
            if (!project.contract) throw new Error("Dự án không có hợp đồng liên kết");

            const contractCode = project.contract.contractCode;
            const jobCode = job.code || `JOB${job.id}`;

            const count = await this.taskRepository.count({
                where: {
                    project: { id: data.projectId },
                    job: { id: data.jobId }
                }
            });

            const sequence = (count + 1).toString().padStart(2, '0');
            taskCode = `${contractCode}-${jobCode}-${sequence}`;
        }

        const task = this.taskRepository.create({
            code: taskCode,
            name: job.name,
            project: project,
            job: job,
            status: data.isExtra ? TaskStatus.AWAITING_PRICING : TaskStatus.PENDING,
            plannedStartDate: data.plannedStartDate,
            plannedEndDate: data.plannedEndDate,
            isExtra: data.isExtra || false,
            pricingStatus: data.isExtra ? PricingStatus.PENDING : null,
            assignerId: (currentUser as any)?.userId || currentUser?.id
        });

        if (data.assigneeId) {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (user) {
                task.assignee = user;
                await this.notificationService.createNotification({
                    title: "Công việc mới được giao",
                    content: `Bạn được giao công việc: ${task.name} ${task.project !== null ? "thuộc dự án " + task.project.name : ""} `,
                    type: "TASK_ASSIGNED",
                    recipient: user,
                    relatedEntityId: task.id?.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        return await this.taskRepository.save(task);
    }

    async submitResult(id: string, data: { result: any }, currentUser: { id: string, userId?: string }) {
        const task = await this.getOne(id);

        task.result = data.result;
        task.status = TaskStatus.AWAITING_REVIEW;
        task.actualEndDate = new Date();
        task.lastSubmittedById = (currentUser as any).userId || currentUser.id;

        const savedTask = await this.taskRepository.save(task);

        const taskWithInfo = await this.taskRepository.findOne({
            where: { id: task.id },
            relations: ["project", "project.team", "project.team.teamLead", "supervisor", "assigner"]
        });

        // Notify Lead/Supervisor/Assigner
        const recipients = new Set<string>();
        if (taskWithInfo.project?.team?.teamLead?.id) recipients.add(taskWithInfo.project.team.teamLead.id);
        if (taskWithInfo.supervisor?.id) recipients.add(taskWithInfo.supervisor.id);
        if (taskWithInfo.assigner?.id) recipients.add(taskWithInfo.assigner.id);

        await this.reviewService.initializeReviews(task.id);

        for (const recipientId of recipients) {
            const recipient = await this.userRepository.findOneBy({ id: recipientId });
            if (recipient) {
                await this.notificationService.createNotification({
                    title: "Kết quả công việc đã nộp",
                    content: `Nhân viên đã nộp kết quả cho: ${task.code} của dự án ${task.project?.name}. Vui lòng đánh giá.`,
                    type: "TASK_REVIEW",
                    recipient: recipient,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        return savedTask;
    }

    async requestRework(id: string, data: {
        feedback: string,
        deadlineAt: Date,
        attachments?: any[]
    }, currentUser?: { id: string, userId?: string }) {
        return await AppDataSource.transaction(async (transactionalEntityManager) => {
            const task = await transactionalEntityManager.findOne(Tasks, {
                where: { id },
                relations: ["assignee", "contractService"]
            });

            if (!task) throw new Error("Không tìm thấy công việc");

            // Status Guard: Only allow rework from review or completed states
            const allowedStatuses = [TaskStatus.AWAITING_REVIEW, TaskStatus.DONE, TaskStatus.COMPLETED];
            if (!allowedStatuses.includes(task.status)) {
                throw new Error(`Không thể yêu cầu làm lại cho công việc đang ở trạng thái ${task.status}`);
            }

            // 1. Create Iteration Record (Snapshot current state)
            const iterationCount = await transactionalEntityManager.count(Tasks.name === "TaskIterations" ? "TaskIterations" : "task_iterations", {
                where: { taskId: task.id }
            } as any);

            const iterationRepository = transactionalEntityManager.getRepository("TaskIterations");
            const iteration = iterationRepository.create({
                task: task,
                version: iterationCount + 1,
                submittedResult: task.result,
                leadFeedback: data.feedback,
                feedbackAttachments: data.attachments,
                deadlineAt: data.deadlineAt,
                submittedById: task.lastSubmittedById
            });
            await iterationRepository.save(iteration);

            // 1.5. Clean up old reviews (as requested by user)
            await transactionalEntityManager.delete(TaskReviews, { task: { id } });

            // 1.6. Reset ContractService if linked
            if (task.contractService) {
                const contractServiceRepository = transactionalEntityManager.getRepository(ContractServices);
                const cs = await contractServiceRepository.findOneBy({ id: task.contractService.id });
                if (cs && cs.results) {
                    // Remove or update the result for this specific task
                    cs.results = cs.results.filter(r => r.taskId !== task.id);
                    cs.status = ContractServiceStatus.ACTIVE;
                    await contractServiceRepository.save(cs);
                }
            }

            // 2. Update Task
            task.status = TaskStatus.REWORKING;
            task.plannedEndDate = data.deadlineAt;
            task.result = null as any;

            const savedTask = await transactionalEntityManager.save(task);

            // 3. Notify Assignee
            if (task.assignee) {
                await this.notificationService.createNotification({
                    title: "Yêu cầu làm lại công việc",
                    content: `Bạn có yêu cầu làm lại cho: ${task.name} của dự án ${task.project?.name} (Mã: ${task.code}). Feedback: ${data.feedback}`,
                    type: "TASK_ASSIGNED",
                    recipient: task.assignee,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                }, transactionalEntityManager);
            }

            return savedTask;
        });
    }

    async update(id: string, data: Partial<Tasks> & { assigneeId?: string }) {
        const task = await this.getOne(id);

        if (data.assigneeId && (!task.assignee || task.assignee.id !== data.assigneeId)) {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (user) {
                task.assignee = user;
                await this.notificationService.createNotification({
                    title: "Thay đổi người thực hiện",
                    content: `Bạn được giao công việc: ${task.name} của dự án ${task.project?.name} (Mã: ${task.code})`,
                    type: "TASK_ASSIGNED",
                    recipient: user,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        if (data.status) task.status = data.status;
        if (data.plannedStartDate) task.plannedStartDate = data.plannedStartDate;
        if (data.plannedEndDate) task.plannedEndDate = data.plannedEndDate;
        if (data.actualStartDate) task.actualStartDate = data.actualStartDate;
        if (data.actualEndDate) task.actualEndDate = data.actualEndDate;
        if (data.result) {
            task.result = data.result;
            task.status = TaskStatus.AWAITING_REVIEW;

            const taskWithInfo = await this.taskRepository.findOne({
                where: { id: task.id },
                relations: ["project", "project.team", "project.team.teamLead"]
            });

            if (taskWithInfo && taskWithInfo.project?.team?.teamLead) {
                await this.reviewService.initializeReviews(task.id);

                await this.notificationService.createNotification({
                    title: "Công việc chờ duyệt",
                    content: `Nhân viên đã upload kết quả cho công việc: ${task.name} của dự án ${task.project?.name}. Vui lòng đánh giá.`,
                    type: "TASK_REVIEW",
                    recipient: taskWithInfo.project.team.teamLead,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        return await this.taskRepository.save(task);
    }

    async assign(id: string, data: {
        assigneeId: string;
        performerType?: PerformerType;
        plannedEndDate: Date;
        plannedStartDate: Date;
        description?: string;
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[];
    }, currentUser?: { id: string }) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.contract", "job"]
        });
        if (!task) throw new Error("Không tìm thấy công việc");

        const oldCost = Number(task.cost || 0);
        let newCost = 0;

        if (data.performerType === PerformerType.VENDOR) {
            const vendor = await this.vendorRepository.findOneBy({ id: data.assigneeId });
            if (!vendor) throw new Error("Vendor không tồn tại");

            // Fetch Vendor Price for this Job
            const vendorJob = await this.vendorJobRepository.findOneBy({
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
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (!user) throw new Error("Người thực hiện không tồn tại");
            task.assignee = user;
            task.vendor = null as any;
            task.performerType = PerformerType.INTERNAL;
            task.cost = 0; // Internal tasks have 0 cost in this context

            await this.notificationService.createNotification({
                title: "Công việc mới được giao",
                content: `Bạn được giao công việc: ${task.name} của dự án ${task.project?.name} (Mã: ${task.code})`,
                type: "TASK_ASSIGNED",
                recipient: user,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        task.plannedEndDate = data.plannedEndDate;
        task.plannedStartDate = data.plannedStartDate;
        if (data.description) task.description = data.description;
        if (data.attachments) task.attachments = data.attachments;

        // Update Contract Cost if changed
        if (oldCost !== newCost && task.project?.contract) {
            const contract = task.project.contract;
            contract.cost = Number(contract.cost || 0) - oldCost + newCost;
            await this.contractRepository.save(contract);
        }

        if (task.status === TaskStatus.PENDING) {
            task.status = TaskStatus.DOING;
        }

        if (currentUser) {
            task.assignerId = (currentUser as any).userId || currentUser.id;
        }

        // Logic check for support mode
        if (task.isSupportRequested && task.supportLeadId && task.isSupportAccepted) {
            // If task is in support mode and accepted, the helperId should be assigned
            task.helperId = data.assigneeId;
            task.status = TaskStatus.DOING;
            // Note: Keep isSupportRequested=true or false? 
            // The plan-v2 says clear isSupportRequested when returning, 
            // but for now let's keep it true to indicate it's a supported task.
            // Or use isSupportAccepted = true as the continuous flag.
        }

        return await this.taskRepository.save(task);
    }

    async requestSupport(id: string, note: string) {
        const task = await this.getOne(id);
        task.isSupportRequested = true;
        task.supportRequestNote = note;
        task.status = TaskStatus.AWAITING_SUPPORT;

        const savedTask = await this.taskRepository.save(task);

        const taskWithInfo = await this.taskRepository.findOne({
            where: { id: task.id },
            relations: ["project", "project.team", "project.team.teamLead"]
        });

        if (taskWithInfo?.project?.team?.teamLead) {
            await this.notificationService.createNotification({
                title: "Yêu cầu hỗ trợ công việc",
                content: `Nhân viên yêu cầu hỗ trợ cho công việc: ${task.name} của dự án ${task.project?.name}. Lý do: ${note}`,
                type: "TASK_REVIEW",
                recipient: taskWithInfo.project.team.teamLead,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        return savedTask;
    }

    async assignSupportTeam(id: string, teamId: string) {
        const task = await this.getOne(id);
        const team = await this.teamRepository.findOne({
            where: { id: teamId },
            relations: ["teamLead"]
        }) as any;

        if (!team) throw new Error("Không tìm thấy team hỗ trợ");
        if (!team.teamLead) throw new Error("Team hỗ trợ chưa có Lead");

        task.supportTeamId = teamId;
        task.supportLeadId = team.teamLead.id;
        task.isSupportRequested = true;
        task.isSupportAccepted = false;
        task.status = TaskStatus.SUPPORT_PENDING;

        const savedTask = await this.taskRepository.save(task);

        await this.notificationService.createNotification({
            title: "Yêu cầu hỗ trợ chéo team",
            content: `Team của bạn được nhờ hỗ trợ công việc: ${task.name} của dự án ${task.project?.name}. Vui lòng phân công người thực hiện.`,
            type: "TASK_ASSIGNED",
            recipient: team.teamLead,
            relatedEntityId: task.id.toString(),
            relatedEntityType: "Task"
        });

        return savedTask;
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
            // For vendors, we might not have a direct User recipient object unless they have accounts.
            // Based on existing logic, notifications go to Users.
        }

        const oldCost = Number(task.cost || 0);
        let newCost = 0;
        let newPerformerName = "";
        let newRecipient: Users | null = null;

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
                content: `Công việc: ${task.name} của dự án ${task.project?.name} (Mã: ${task.code}) đã được chuyển giao cho ${newPerformerName}`,
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
                content: `Bạn được giao công việc: ${task.name} của dự án ${task.project?.name} (Mã: ${task.code}).`,
                type: "TASK_ASSIGNED",
                recipient: newRecipient,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        return savedTask;
    }

    async delete(id: string) {
        const task = await this.getOne(id);
        await this.taskRepository.remove(task);
        return { message: "Xóa công việc thành công" };
    }

    async assessExtraTask(id: string, data: { isBillable: boolean, isRejected?: boolean, sellingPrice?: number, serviceId?: string }) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.contract", "job"]
        });
        if (!task) throw new Error("Không tìm thấy công việc");
        if (!task.isExtra) throw new Error("Đây không phải là công việc phát sinh");

        if (data.isRejected) {
            task.status = data.isBillable ? TaskStatus.REJECTED_BILLABLE : TaskStatus.REJECTED_SUPPORT;
            return await this.taskRepository.save(task);
        }

        task.pricingStatus = data.isBillable ? PricingStatus.BILLABLE : PricingStatus.NON_BILLABLE;
        task.cost = Number(task.job.costPrice || 0);

        if (data.isBillable) {
            task.sellingPrice = Number(data.sellingPrice || 0);

            if (data.serviceId) {
                const service = await AppDataSource.getRepository("Services").findOneBy({ id: data.serviceId }) as any;
                if (service) task.mappedService = service;
            }
        } else {
            task.sellingPrice = 0;
            if (task.project?.contract) {
                const contract = task.project.contract;
                contract.cost = Number(contract.cost || 0) + task.cost;
                await AppDataSource.getRepository("Contracts").save(contract);
            }
            task.status = TaskStatus.PENDING;
        }

        return await this.taskRepository.save(task);
    }

    async approveByCustomer(id: string) {
        const task = await this.getOne(id);

        if (task.status !== TaskStatus.INTERNAL_COMPLETED) {
            throw new Error(`Công việc chưa ở trạng thái Hoàn thành nội bộ (Hiện tại: ${task.status})`);
        }

        task.status = TaskStatus.COMPLETED;
        const savedTask = await this.taskRepository.save(task);

        if (task.assignee) {
            await this.notificationService.createNotification({
                title: "Khách hàng đã duyệt",
                content: `Khách hàng đã duyệt công việc: ${task.name}. Trạng thái: Hoàn thành.`,
                type: "TASK_COMPLETED",
                recipient: task.assignee,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
            });
        }

        return savedTask;
    }

    async respondToSupport(id: string, action: 'ACCEPT' | 'REJECT', currentUser: { id: string }) {
        const task = await this.getOne(id);

        // Security check: Only the designated support lead can respond
        if (task.supportLeadId !== (currentUser as any).userId && task.supportLeadId !== currentUser.id) {
            throw new Error("Chỉ Lead của team được nhờ mới có quyền phản hồi");
        }

        if (action === 'ACCEPT') {
            task.isSupportAccepted = true;
            task.status = TaskStatus.PENDING;

            // Notify original lead
            const originalLead = task.project?.team?.teamLead;
            if (originalLead) {
                await this.notificationService.createNotification({
                    title: "Yêu cầu hỗ trợ được chấp nhận",
                    content: `Team hỗ trợ đã đồng ý giúp đỡ cho công việc: ${task.name}. Đang chờ phân công nhân sự.`,
                    type: "TASK_ASSIGNED",
                    recipient: originalLead,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task"
                });
            }
        } else {
            // REJECT
            task.supportTeamId = null as any;
            task.supportLeadId = null as any;
            task.isSupportRequested = true; // Still needs support
            task.isSupportAccepted = false;
            task.status = TaskStatus.AWAITING_SUPPORT; // Back to original lead to pick another team

            // Notify original lead
            const originalLead = task.project?.team?.teamLead;
            if (originalLead) {
                await this.notificationService.createNotification({
                    title: "Yêu cầu hỗ trợ bị từ chối",
                    content: `Team hỗ trợ đã từ chối yêu cầu cho công việc: ${task.name}. Vui lòng thực hiện phương án khác.`,
                    type: "TASK_REJECTED",
                    recipient: originalLead,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                    link: `/tasks/${task.id}`
                });
            }
        }

        return await this.taskRepository.save(task);
    }

    async returnSupport(id: string) {
        const task = await this.getOne(id);

        task.supportTeamId = null as any;
        task.supportLeadId = null as any;
        task.helperId = null as any;
        task.isSupportRequested = true; // Still needs support
        task.isSupportAccepted = false;
        task.status = TaskStatus.AWAITING_SUPPORT;

        return await this.taskRepository.save(task);
    }
}
