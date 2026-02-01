import { AppDataSource } from "../data-source";
import { Tasks, TaskStatus } from "../entity/Task.entity";
import { Projects } from "../entity/Project.entity";
import { Jobs } from "../entity/Job.entity";
import { Users } from "../entity/User.entity";
import { Vendors } from "../entity/Vendor.entity";
import { VendorJobs } from "../entity/VendorJob.entity";
import { Like } from "typeorm";
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


    async getAll(userInfo?: { id: number, role: string }) {
        const query: any = {
            relations: ["project", "job", "assignee"]
        };

        if (userInfo && userInfo.role !== "BOD" && userInfo.role !== "ADMIN") {
            query.where = { assignee: { id: userInfo.id } };
        }

        return await this.taskRepository.find(query);
    }


    async getOne(id: number) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "job", "assignee"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        return task;
    }

    async create(data: {
        projectId: number,
        jobId: number,
        assigneeId?: number,
        performerType?: "INTERNAL" | "VENDOR",
        vendorId?: number,
        description?: string,
        plannedStartDate?: Date,
        plannedEndDate?: Date
    }) {
        const project = await this.projectRepository.findOne({
            where: { id: data.projectId },
            relations: ["contract"]
        });
        if (!project) throw new Error("Không tìm thấy dự án");
        if (!project.contract) throw new Error("Dự án không có hợp đồng liên kết");

        const job = await this.jobRepository.findOne({ where: { id: data.jobId } });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        // Naming Logic: ContractCode - JobCode - Sequence
        // Example: SMGK-26-01-01 - VID - 01

        // 1. Get Contract Code
        const contractCode = project.contract.contractCode;

        // 2. Get Job Code
        // If job doesn't have code, maybe use ID or a default? User said "VID", so assuming job has code.
        const jobCode = job.code || `JOB${job.id}`;

        // 3. Calculate Sequence
        // Count tasks for this Project AND this Job
        const count = await this.taskRepository.count({
            where: {
                project: { id: data.projectId },
                job: { id: data.jobId }
            }
        });

        const sequence = (count + 1).toString().padStart(2, '0'); // "01", "02"...
        const taskCode = `${contractCode}-${jobCode}-${sequence}`;

        const task = this.taskRepository.create({
            code: taskCode,
            name: job.name,
            project: project,
            job: job,
            status: TaskStatus.PENDING,
            plannedStartDate: data.plannedStartDate,
            plannedEndDate: data.plannedEndDate
        });

        if (data.assigneeId) {
            const user = await this.userRepository.findOneBy({ id: data.assigneeId });
            if (user) {
                task.assignee = user;
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
        }

        return await this.taskRepository.save(task);
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
        if (data.resultFiles) {
            task.resultFiles = data.resultFiles;
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
    }) {
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

        return await this.taskRepository.save(task);
    }


    async delete(id: number) {
        const task = await this.getOne(id);
        await this.taskRepository.remove(task);
        return { message: "Xóa công việc thành công" };
    }
}
