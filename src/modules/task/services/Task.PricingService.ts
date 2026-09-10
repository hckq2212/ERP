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

export class TaskPricingService extends TaskBaseService {
    async assessExtraTask(id: string, data: { isBillable: boolean, isRejected?: boolean, sellingPrice?: number, serviceId?: string }) {
        const task = await this.taskRepository.findOne({
            where: { id },
            relations: ["project", "project.contract", "job"]
        });
        if (!task) throw new Error("Không tìm thấy công việc");
        if (!task.isExtra) throw new Error("Đây không phải là công việc phát sinh");

        if (data.isRejected) {
            task.status = data.isBillable ? TaskStatus.REJECTED_BILLABLE : TaskStatus.REJECTED_SUPPORT;
            const savedTask = await this.taskRepository.save(task);
            taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
            return savedTask;
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

        const savedTask = await this.taskRepository.save(task);
        taskEmitter.emit(TASK_EVENTS.UPDATED, savedTask);
        return savedTask;
    }
}
