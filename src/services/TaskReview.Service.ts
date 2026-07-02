import { AppDataSource } from "../data-source";
import { TaskReviews, ReviewerType } from "../entity/TaskReview.entity";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus } from "../entity/Enums";
import { JobCriterias } from "../entity/JobCriteria.entity";
import { NotificationService } from "./Notification.Service";
import { ContractServices } from "../entity/ContractService.entity";
import { Users } from "../entity/User.entity";
import { taskReviewEmitter, TASK_REVIEW_EVENTS } from "../events/TaskReviewEmitter";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { TenantContext } from "../context/TenantContext";

export class TaskReviewService {
    private reviewRepository = AppDataSource.getRepository(TaskReviews);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private criteriaRepository = AppDataSource.getRepository(JobCriterias);
    private notificationService = new NotificationService();

    private httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    async getTaskReviews(taskId: string) {
        return await this.reviewRepository.find({
            where: { task: { id: taskId } },
            relations: ["criteria"]
        });
    }

    async initializeReviews(taskId: string, forcePass: boolean = false) {
        const task = await this.taskRepository.findOne({
            where: { id: taskId },
            relations: ["job", "job.criteria", "project", "project.team", "project.team.teamLead", "assigner"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        if (!task.job || !task.job.criteria) return [];

        // Delete existing reviews for this task if any
        await this.reviewRepository.delete({ task: { id: taskId } });

        // Reset review note on new submission
        task.reviewNote = null;
        await this.taskRepository.save(task);

        // Only one reviewer: Team Lead of the project team
        const lead = task.project?.team?.teamLead;
        const assigner = task.assigner;

        const definitions: { user: Users, type: ReviewerType }[] = [];

        if (lead) {
            definitions.push({ user: lead, type: ReviewerType.TEAM_LEAD });
        } else if (assigner) {
            // Fallback to assigner if no project team exists
            definitions.push({ user: assigner, type: ReviewerType.ASSIGNER });
        }

        const reviews: TaskReviews[] = [];
        for (const def of definitions) {
            for (const c of task.job.criteria) {
                reviews.push(this.reviewRepository.create({
                    task,
                    criteria: c,
                    isPassed: forcePass, // Set isPassed based on forcePass parameter
                    reviewer: def.user,
                    reviewerType: def.type
                }));
            }
        }

        return await this.reviewRepository.save(reviews);
    }

    async toggleCriteria(reviewId: string, isPassed: boolean, note?: string) {
        const review = await this.reviewRepository.findOne({
            where: { id: reviewId },
            relations: ["task"]
        });

        if (!review) throw new Error("Không tìm thấy mục đánh giá");

        // Status validation
        if (review.task) {
            const reviewableStatuses = [TaskStatus.AWAITING_REVIEW, TaskStatus.DOING, TaskStatus.AWAITING_ACCEPTANCE];
            if (!reviewableStatuses.includes(review.task.status)) {
                throw new Error(`Công việc đang ở trạng thái ${review.task.status}, không thể cập nhật đánh giá.`);
            }
        }

        review.isPassed = isPassed;
        if (note !== undefined) review.note = note;

        await this.reviewRepository.save(review);
        taskReviewEmitter.emit(TASK_REVIEW_EVENTS.UPDATED, { taskId: review.task?.id });
        return review;
    }

    async checkAndFinalize(taskId: string, passedCriteriaIds?: string[], reviewNote?: string) {
        const company = TenantContext.getCompany();
        if (!company) throw this.httpError("Thiếu thông tin công ty", 403);

        const outcome = await AppDataSource.transaction(async (manager) => {
            const lockedTask = await manager.createQueryBuilder(Tasks, "task")
                .select("task.id")
                .where("task.id = :taskId", { taskId })
                .andWhere("task.companyId = :companyId", { companyId: company.id })
                .setLock("pessimistic_write")
                .getOne();
            if (!lockedTask) throw this.httpError("Không tìm thấy công việc", 404);

            const task = await manager.getRepository(Tasks).findOne({
                where: { id: taskId, company: { id: company.id } },
                relations: ["assignee", "contractService", "job", "project"]
            });
            if (!task) throw this.httpError("Không tìm thấy công việc", 404);
            if (task.status !== TaskStatus.AWAITING_REVIEW) {
                throw this.httpError(`Công việc đang ở trạng thái ${task.status}, không thể thực hiện phê duyệt.`, 409);
            }

            const reviewRepository = manager.getRepository(TaskReviews);
            const reviews = await reviewRepository.find({
                where: { task: { id: taskId }, company: { id: company.id } }
            });
            if (passedCriteriaIds) {
                for (const review of reviews) {
                    review.isPassed = passedCriteriaIds.includes(review.id);
                }
                await reviewRepository.save(reviews);
            }

            const groups: Record<string, TaskReviews[]> = {};
            for (const review of reviews) {
                if (!groups[review.reviewerType]) groups[review.reviewerType] = [];
                groups[review.reviewerType].push(review);
            }
            const allPassed = reviews.length === 0 || Object.values(groups).every(groupItems =>
                groupItems.every(item => item.isPassed)
            );

            if (!allPassed) {
                if (reviewNote) {
                    task.reviewNote = reviewNote;
                    await manager.save(task);
                }
                return {
                    result: { finalized: false, message: "Đã cập nhật tiêu chí đánh giá nhưng chưa đủ điều kiện hoàn tất" },
                    task: null as Tasks | null
                };
            }

            task.status = TaskStatus.INTERNAL_COMPLETED;
            task.actualEndDate = new Date();
            if (reviewNote) task.reviewNote = reviewNote;
            await manager.save(task);

            if (task.isOutput && task.contractService) {
                const contractService = task.contractService;
                if (!contractService.results) contractService.results = [];
                const newResult = {
                    taskId: task.id,
                    type: task.result?.type || 'file',
                    name: task.nickname || task.name || task.code,
                    url: task.result?.url || '',
                    status: 'PENDING' as const
                };
                const existingResultIndex = contractService.results.findIndex(result => result.taskId === task.id);
                if (existingResultIndex >= 0) contractService.results[existingResultIndex] = newResult;
                else contractService.results.push(newResult);
                await manager.getRepository(ContractServices).save(contractService);
            }

            if (task.assignee) {
                await this.notificationService.createNotification({
                    title: "Công việc đã được duyệt",
                    content: `Công việc "${task.nickname || task.name || task.code}" của dự án ${task.project?.name} đã được duyệt nội bộ.`,
                    type: "TASK_COMPLETED",
                    recipient: task.assignee,
                    relatedEntityId: task.id.toString(),
                    relatedEntityType: "Task",
                }, manager);
            }

            return {
                result: { finalized: true, message: "Đã hoàn tất duyệt nội bộ công việc" },
                task
            };
        });

        if (outcome.task) taskEmitter.emit(TASK_EVENTS.STATUS_CHANGED, outcome.task);
        taskReviewEmitter.emit(TASK_REVIEW_EVENTS.UPDATED, { taskId });
        return outcome.result;
    }

    async rejectTask(taskId: string, passedCriteriaIds: string[], reviewNote: string) {
        // Update criteria status even on reject
        const allReviews = await this.reviewRepository.find({
            where: { task: { id: taskId } }
        });

        for (const review of allReviews) {
            review.isPassed = passedCriteriaIds.includes(review.id);
        }
        await this.reviewRepository.save(allReviews);

        const task = await this.taskRepository.findOne({
            where: { id: taskId },
            relations: ["assignee"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");

        // Allowed statuses for rejection
        const rejectableStatuses = [TaskStatus.AWAITING_REVIEW, TaskStatus.DOING, TaskStatus.AWAITING_ACCEPTANCE];
        if (!rejectableStatuses.includes(task.status)) {
            throw new Error(`Công việc đang ở trạng thái ${task.status}, không thể thực hiện từ chối.`);
        }

        if (!reviewNote || reviewNote.trim() === "") {
            throw new Error("Vui lòng nhập lý do từ chối/yêu cầu sửa lại");
        }

        task.status = TaskStatus.REJECTED;
        task.reviewNote = reviewNote;
        await this.taskRepository.save(task);

        // Notify assignee
        if (task.assignee) {
            await this.notificationService.createNotification({
                title: "Công việc cần sửa lại",
                content: `Công việc "${task.nickname || task.name}" của dự án ${task.project?.name} bị từ chối/yêu cầu sửa lại. Lý do: ${reviewNote}`,
                type: "TASK_REJECTED",
                recipient: task.assignee,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        taskEmitter.emit(TASK_EVENTS.STATUS_CHANGED, task);
        taskReviewEmitter.emit(TASK_REVIEW_EVENTS.UPDATED, { taskId });

        return task;
    }
}
