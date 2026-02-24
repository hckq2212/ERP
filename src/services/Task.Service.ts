import { AppDataSource } from "../data-source";
import { Tasks, TaskStatus, PricingStatus } from "../entity/Task.entity";
import { ILike, Like, Between, IsNull } from "typeorm";
import { Projects } from "../entity/Project.entity";
import { Jobs } from "../entity/Job.entity";
import { Users } from "../entity/User.entity";
import { Vendors } from "../entity/Vendor.entity";
import { VendorJobs } from "../entity/VendorJob.entity";
import { NotificationService } from "./Notification.Service";
import { TaskReviewService } from "./TaskReview.Service";
import { StringHelper } from "../helpers/String.helper";

export class TaskService {
    private taskRepository = AppDataSource.getRepository(Tasks);
    private projectRepository = AppDataSource.getRepository(Projects);
    private jobRepository = AppDataSource.getRepository(Jobs);
    private userRepository = AppDataSource.getRepository(Users);
    private vendorRepository = AppDataSource.getRepository(Vendors);
    private vendorJobRepository = AppDataSource.getRepository(VendorJobs);
    private notificationService = new NotificationService();
    private reviewService = new TaskReviewService();

    async createInternalTask(data: {
        name: string,
        assigneeId: string,
        supervisorId: string,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date
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
            content: `Bạn được phân công giám sát công việc: ${task.name} (Mã: ${task.code})`,
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
        const baseWhere: any = {};

        if (userInfo && userInfo.role !== "BOD" && userInfo.role !== "ADMIN") {
            baseWhere.assignee = { id: userInfo.userId || userInfo.id };
        }

        if (filters.status && filters.status !== 'ALL') {
            baseWhere.status = filters.status;
        }

        if (filters.assigneeId) {
            baseWhere.assignee = { id: filters.assigneeId };
        }

        if (filters.projectId) {
            baseWhere.project = { id: filters.projectId };
        }

        if (filters.q || filters.search) {
            const query = filters.q || filters.search;
            const searchTerm = `%${query}%`;
            where.push({ ...baseWhere, name: ILike(searchTerm) });
            where.push({ ...baseWhere, code: ILike(searchTerm) });
        } else {
            where.push(baseWhere);
        }

        const [items, total] = await this.taskRepository.findAndCount({
            where: where.length > 1 ? where : where[0],
            relations: ["project", "project.team", "project.team.teamLead", "job", "assignee", "supervisor"],
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
            relations: ["project", "project.team", "project.team.teamLead", "job", "assignee", "quotation", "supervisor"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        return task;
    }

    async create(data: {
        projectId?: string,
        jobId: string,
        assigneeId?: string,
        performerType?: "INTERNAL" | "VENDOR",
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
                    content: `Bạn được giao công việc: ${task.name}`,
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

    async submitResult(id: string, data: { result: any }) {
        const task = await this.getOne(id);

        task.result = data.result;
        task.status = TaskStatus.AWAITING_REVIEW;
        task.actualEndDate = new Date();

        const savedTask = await this.taskRepository.save(task);

        const taskWithInfo = await this.taskRepository.findOne({
            where: { id: task.id },
            relations: ["project", "project.team", "project.team.teamLead"]
        });

        if (taskWithInfo && taskWithInfo.project?.team?.teamLead) {
            await this.reviewService.initializeReviews(task.id);

            await this.notificationService.createNotification({
                title: "Kết quả công việc đã nộp",
                content: `Nhân viên đã nộp kết quả cho: ${task.code}. Vui lòng đánh giá.`,
                type: "TASK_REVIEW",
                recipient: taskWithInfo.project.team.teamLead,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        return savedTask;
    }

    async update(id: string, data: Partial<Tasks> & { assigneeId?: string }) {
        const task = await this.getOne(id);

        if (data.assigneeId && (!task.assignee || task.assignee.id !== data.assigneeId)) {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (user) {
                task.assignee = user;
                await this.notificationService.createNotification({
                    title: "Thay đổi người thực hiện",
                    content: `Bạn được giao công việc: ${task.name} (Mã: ${task.code})`,
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
                    content: `Nhân viên đã upload kết quả cho công việc: ${task.name}. Vui lòng đánh giá.`,
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
        performerType?: "INTERNAL" | "VENDOR";
        plannedEndDate: Date;
        plannedStartDate: Date;
        description?: string;
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[];
    }, currentUser?: { id: string }) {
        const task = await this.getOne(id);

        if (data.performerType === "VENDOR") {
            const vendor = await this.vendorRepository.findOneBy({ id: data.assigneeId });
            if (!vendor) throw new Error("Vendor không tồn tại");
            task.vendor = vendor;
            task.assignee = null as any;
            task.performerType = "VENDOR";
        } else {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (!user) throw new Error("Người thực hiện không tồn tại");
            task.assignee = user;
            task.vendor = null as any;
            task.performerType = "INTERNAL";

            await this.notificationService.createNotification({
                title: "Công việc mới được giao",
                content: `Bạn được giao công việc: ${task.name} (Mã: ${task.code})`,
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

        if (task.status === TaskStatus.PENDING) {
            task.status = TaskStatus.DOING;
        }

        if (currentUser) {
            task.assignerId = (currentUser as any).userId || currentUser.id;
        }

        return await this.taskRepository.save(task);
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
            task.status = TaskStatus.REJECTED;
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
}
