import { AppDataSource } from "../data-source";
import { Tasks, TaskStatus } from "../entity/Task.entity";
import { Projects } from "../entity/Project.entity";
import { Jobs } from "../entity/Job.entity";
import { Users } from "../entity/User.entity";
import { Vendors } from "../entity/Vendor.entity";
import { VendorServices } from "../entity/VendorService.entity";
import { Like } from "typeorm";
import { NotificationService } from "./Notification.Service";


export class TaskService {
    private taskRepository = AppDataSource.getRepository(Tasks);
    private projectRepository = AppDataSource.getRepository(Projects);
    private jobRepository = AppDataSource.getRepository(Jobs);
    private userRepository = AppDataSource.getRepository(Users);
    private vendorRepository = AppDataSource.getRepository(Vendors);
    private vendorServiceRepository = AppDataSource.getRepository(VendorServices);
    private notificationService = new NotificationService();


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
        if (data.resultFiles) task.resultFiles = data.resultFiles;

        return await this.taskRepository.save(task);
    }

    async assign(id: number, data: {
        assigneeId: number;
        plannedEndDate: Date;
        plannedStartDate: Date;
        description?: string;
        attachments?: { type: string, name: string, url: string, size?: number, publicId?: string }[];
    }) {
        const task = await this.getOne(id);

        const user = await this.userRepository.findOneBy({ id: data.assigneeId });
        if (!user) throw new Error("Người được phân công không tồn tại");

        task.assignee = user;
        task.plannedEndDate = data.plannedEndDate;
        task.plannedStartDate = data.plannedStartDate;
        if (data.description) task.description = data.description;
        if (data.attachments) task.attachments = data.attachments;

        // Auto update status if it is pending
        if (task.status === TaskStatus.PENDING) {
            task.status = TaskStatus.DOING; // Or remain PENDING until they accept? 
            // Usually assignment implies it's ready to start. Let's keep it PENDING or make it DOING.
            // Given the context, let's just leave status or maybe set to PENDING (assigned).
            // Let's just update fields for now.
        }

        const savedTask = await this.taskRepository.save(task);

        // Send Notification
        await this.notificationService.createNotification({
            title: "Công việc mới được giao",
            content: `Bạn được giao công việc: ${savedTask.name} (Mã: ${savedTask.code})`,
            type: "TASK_ASSIGNED",
            recipient: user,
            relatedEntityId: savedTask.id.toString(),
            relatedEntityType: "Task",
            link: `/tasks/${savedTask.id}`
        });

        return savedTask;
    }


    async delete(id: number) {
        const task = await this.getOne(id);
        await this.taskRepository.remove(task);
        return { message: "Xóa công việc thành công" };
    }
}
