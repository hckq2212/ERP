import { AppDataSource } from "../data-source";
import { Tasks, TaskStatus, PricingStatus } from "../entity/Task.entity";
import { ILike, Like } from "typeorm";
import { Projects } from "../entity/Project.entity";
import { Jobs } from "../entity/Job.entity";
import { Users } from "../entity/User.entity";
import { Vendors } from "../entity/Vendor.entity";
import { VendorJobs } from "../entity/VendorJob.entity";
import { NotificationService } from "./Notification.Service";
import { TaskReviewService } from "./TaskReview.Service";


export class TaskService {
    private taskRepository = AppDataSource.getRepository(Tasks);
    private projectRepository = AppDataSource.getRepository(Projects);
    private jobRepository = AppDataSource.getRepository(Jobs);
    private userRepository = AppDataSource.getRepository(Users);
    private vendorRepository = AppDataSource.getRepository(Vendors);
    private vendorJobRepository = AppDataSource.getRepository(VendorJobs);
    private notificationService = new NotificationService();
    private reviewService = new TaskReviewService();


    async getAll(filters: any = {}, userInfo?: { id: number, role: string }) {
        const where: any = {};
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        // 1. Enforce Role-based access
        if (userInfo && userInfo.role !== "BOD" && userInfo.role !== "ADMIN") {
            where.assignee = { id: userInfo.id };
        }

        // 2. Apply dynamic filters
        if (filters.status && filters.status !== 'ALL') {
            where.status = filters.status;
        }

        if (filters.assigneeId) {
            where.assignee = { id: filters.assigneeId };
        }

        if (filters.projectId) {
            where.project = { id: filters.projectId };
        }

        // 3. Fuzzy search for name or code
        if (filters.q || filters.search) {
            const query = filters.q || filters.search;
            where.name = ILike(`%${query}%`);
        }

        const [items, total] = await this.taskRepository.findAndCount({
            where,
            relations: ["project", "project.team", "project.team.teamLead", "job", "assignee"],
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


    async getOne(id: number) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.team", "project.team.teamLead", "job", "assignee", "quotation"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        return task;
    }

    async create(data: {
        projectId?: number,
        jobId: number,
        assigneeId?: number,
        performerType?: "INTERNAL" | "VENDOR",
        vendorId?: number,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date,
        isExtra?: boolean
    }, currentUser?: { id: number }) {
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

            // Naming Logic: ContractCode - JobCode - Sequence
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
            assignerId: currentUser?.id
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


    async submitResult(id: number, data: { result: any }) {
        const task = await this.getOne(id);

        task.result = data.result;
        task.status = TaskStatus.AWAITING_REVIEW;
        task.actualEndDate = new Date(); // Record when the result was submitted

        const savedTask = await this.taskRepository.save(task);

        // Notify Team Lead
        const taskWithInfo = await this.taskRepository.findOne({
            where: { id: task.id },
            relations: ["project", "project.team", "project.team.teamLead"]
        });

        if (taskWithInfo && taskWithInfo.project?.team?.teamLead) {
            // Initialize reviews based on job criteria
            await this.reviewService.initializeReviews(task.id);

            await this.notificationService.createNotification({
                title: "Kết quả công việc đã nộp",
                content: `Nhân viên đã nộp kết quả cho: ${task.code}. Vui lòng đánh giá.`,
                type: "TASK_REVIEW",
                recipient: taskWithInfo.project.team.teamLead,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}` // Link to task detail for review
            });
        }

        return savedTask;
    }

    async update(id: number, data: Partial<Tasks> & { assigneeId?: number }) {
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


        // Prevent name update if it's auto-generated? Or allow? 
        // For now, let's just update other fields.

        if (data.status) task.status = data.status;
        if (data.plannedStartDate) task.plannedStartDate = data.plannedStartDate;
        if (data.plannedEndDate) task.plannedEndDate = data.plannedEndDate;
        if (data.actualStartDate) task.actualStartDate = data.actualStartDate;
        if (data.actualEndDate) task.actualEndDate = data.actualEndDate;
        if (data.result) {
            task.result = data.result;
            // If result files are uploaded, move to awaiting review
            task.status = TaskStatus.AWAITING_REVIEW;

            // Re-fetch task with project and team lead info for notification
            const taskWithInfo = await this.taskRepository.findOne({
                where: { id: task.id },
                relations: ["project", "project.team", "project.team.teamLead"]
            });

            if (taskWithInfo && taskWithInfo.project?.team?.teamLead) {
                // Initialize reviews based on job criteria
                await this.reviewService.initializeReviews(task.id);

                // Notify Team Lead
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

    async assign(id: number, data: {
        assigneeId: number;
        performerType?: "INTERNAL" | "VENDOR";
        plannedEndDate: Date;
        plannedStartDate: Date;
        description?: string;
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[];
    }, currentUser?: { id: number }) {
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

            // Send Notification to internal user
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

        // Auto update status if it is pending
        if (task.status === TaskStatus.PENDING) {
            task.status = TaskStatus.DOING;
        }

        if (currentUser) {
            task.assignerId = currentUser.id;
        }

        return await this.taskRepository.save(task);
    }


    async delete(id: number) {
        const task = await this.getOne(id);
        await this.taskRepository.remove(task);
        return { message: "Xóa công việc thành công" };
    }

    async assessExtraTask(id: number, data: { isBillable: boolean, isRejected?: boolean, sellingPrice?: number, serviceId?: number }) {
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

            // Manual mapping if serviceId is provided
            if (data.serviceId) {
                const service = await AppDataSource.getRepository("Services").findOneBy({ id: data.serviceId }) as any;
                if (service) task.mappedService = service;
            }
        } else {
            task.sellingPrice = 0;
            // Update Contract Cost immediately for non-billable support tasks
            if (task.project?.contract) {
                const contract = task.project.contract;
                contract.cost = Number(contract.cost || 0) + task.cost;
                await AppDataSource.getRepository("Contracts").save(contract);
            }
            // If it's internal cost-only, it can start immediately
            task.status = TaskStatus.PENDING;
        }

        return await this.taskRepository.save(task);
    }
}
