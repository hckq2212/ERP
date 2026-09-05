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

export class TaskBaseService {
    protected taskRepository = AppDataSource.getRepository(Tasks);
    protected projectRepository = AppDataSource.getRepository(Projects);
    protected jobRepository = AppDataSource.getRepository(Jobs);
    protected userRepository = AppDataSource.getRepository(Users);
    protected vendorRepository = AppDataSource.getRepository(Vendors);
    protected vendorJobRepository = AppDataSource.getRepository(VendorJobs);
    protected contractRepository = AppDataSource.getRepository(Contracts);
    protected teamRepository = AppDataSource.getRepository("ProjectTeams");
    protected taskIterationRepository = AppDataSource.getRepository("TaskIterations");
    protected notificationService = new NotificationService();
    protected reviewService = new TaskReviewService();
    protected violationRepository = AppDataSource.getRepository(Violations);

    protected taskDisplayName(task: Pick<Tasks, "name" | "nickname">) {
        return task.nickname?.trim() || task.name;
    }

    protected httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    protected async recordViolation(data: {
        taskId: string,
        userId: string,
        type: ViolationType,
        description?: string,
        iterationVersion?: number,
        manager?: any
    }) {
        const repo = data.manager ? data.manager.getRepository(Violations) : this.violationRepository;
        const violation = repo.create({
            taskId: data.taskId,
            userId: data.userId,
            type: data.type,
            description: data.description,
            iterationVersion: data.iterationVersion
        });
        await repo.save(violation);
    }


    async getOne(id: string) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.team", "project.team.teamLead", "job", "job.criteria", "assignee", "quotation", "supervisor", "iterations", "lastSubmittedBy", "iterations.submittedBy"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        return task;
    }
}
