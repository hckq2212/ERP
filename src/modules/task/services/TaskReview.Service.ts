import { AppDataSource } from "../../../data-source";
import { TaskReviews, ReviewerType } from "../entities/TaskReview.entity";
import { Tasks } from "../entities/Task.entity";
import { TaskStatus } from "../../../shared/entities/Enums";
import { JobCriterias } from "../../job-criteria/entities/JobCriteria.entity";
import { NotificationService } from "../../notification/services/Notification.Service";
import { ContractServices } from "../../contract/entities/ContractService.entity";
import { Users } from "../../user/entities/User.entity";
import { taskReviewEmitter, TASK_REVIEW_EVENTS } from "../events/TaskReviewEmitter";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { isProjectManagementRole } from "../../account/entities/Account.entity";
import { MemberRole } from "../../project/entities/TeamMember.entity";
import { TaskIterations } from "../entities/TaskIteration.entity";
import { assertSubtasksCompleted } from "../helpers/SubtaskCompletion.helper";
import { VideoGenerations } from "../../video-generation/entities/VideoGeneration.entity";
import { MotionGenerations } from "../../video-generation/entities/MotionGeneration.entity";
import { OpportunityServiceJobs } from "../../opportunity-service/entities/OpportunityServiceJob.entity";
import { OpportunityServices } from "../../opportunity-service/entities/OpportunityService.entity";
import { RedisService } from "../../../shared/services/Redis.Service";
import { calculateRecommendedSellingPrice } from "../../../shared/helpers/Pricing.helper";

type ReviewActor = { id?: string; userId?: string; role?: string };

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

    private getActorUserId(actor?: ReviewActor) {
        return actor?.userId || actor?.id;
    }

    private isProjectOperator(task?: Tasks | null, actor?: ReviewActor) {
        if (isProjectManagementRole(actor?.role)) return true;
        const actorUserId = this.getActorUserId(actor);
        const team = task?.project?.team;
        if (!actorUserId || !team) return false;
        if (team.teamLead?.id === actorUserId) return true;
        return team.members?.some(member =>
            member.user?.id === actorUserId &&
            [MemberRole.ACCOUNT, MemberRole.PROJECT_MANAGER].includes(member.role)
        ) || false;
    }

    private assertCanReviewTask(task: Tasks, actor?: ReviewActor) {
        const actorUserId = this.getActorUserId(actor);
        const canReview = this.isProjectOperator(task, actor) || task.assignerId === actorUserId;
        if (!canReview) {
            throw this.httpError("Bạn không có quyền duyệt công việc trong dự án này", 403);
        }
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

    async toggleCriteria(reviewId: string, isPassed: boolean, note?: string, currentUser?: ReviewActor) {
        const review = await this.reviewRepository.findOne({
            where: { id: reviewId },
            relations: ["reviewer", "task", "task.project", "task.project.team", "task.project.team.teamLead", "task.project.team.members", "task.project.team.members.user"]
        });

        if (!review) throw new Error("Không tìm thấy mục đánh giá");
        const actorUserId = this.getActorUserId(currentUser);
        const isReviewer = review.reviewer?.id === actorUserId;
        if (review.task && !isReviewer && !this.isProjectOperator(review.task, currentUser)) {
            throw this.httpError("Bạn không có quyền cập nhật đánh giá công việc này", 403);
        }

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

    async checkAndFinalize(taskId: string, passedCriteriaIds?: string[], reviewNote?: string, currentUser?: ReviewActor) {
        const outcome = await AppDataSource.transaction(async (manager) => {
            const lockedTask = await manager.createQueryBuilder(Tasks, "task")
                .select("task.id")
                .where("task.id = :taskId", { taskId })
                .setLock("pessimistic_write")
                .getOne();
            if (!lockedTask) throw this.httpError("Không tìm thấy công việc", 404);

            const task = await manager.getRepository(Tasks).findOne({
                where: { id: taskId },
                relations: ["assignee", "contractService", "job", "project", "project.team", "project.team.teamLead", "project.team.members", "project.team.members.user", "opportunityServiceJob", "opportunityServiceJob.opportunityService", "opportunityServiceJob.opportunityService.opportunity", "opportunityServiceJob.opportunityService.opportunity.createdBy"]
            });
            if (!task) throw this.httpError("Không tìm thấy công việc", 404);
            this.assertCanReviewTask(task, currentUser);
            if (task.status !== TaskStatus.AWAITING_REVIEW) {
                throw this.httpError(`Công việc đang ở trạng thái ${task.status}, không thể thực hiện phê duyệt.`, 409);
            }

            const reviewRepository = manager.getRepository(TaskReviews);
            const reviews = await reviewRepository.find({
                where: { task: { id: taskId } }
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

            await assertSubtasksCompleted(
                manager.getRepository(Tasks),
                task,
                "duyệt hoàn thành"
            );

            task.status = TaskStatus.INTERNAL_COMPLETED;
            task.actualEndDate = new Date();
            if (reviewNote) task.reviewNote = reviewNote;

            if (task.opportunityServiceJobId) {
                const currentTaskVideoCost = await this.sumSucceededGenerationCost(manager, task.id);
                if (currentTaskVideoCost.generationCount > 0) task.cost = currentTaskVideoCost.total;

                const opportunityServiceJobRepository = manager.getRepository(OpportunityServiceJobs);
                const opportunityServiceJob = await opportunityServiceJobRepository.findOne({
                    where: { id: task.opportunityServiceJobId },
                    relations: ["opportunityService", "opportunityService.opportunity", "opportunityService.opportunity.createdBy"]
                });

                if (opportunityServiceJob) {
                    const generatedCost = await this.sumSucceededGenerationCostForOpportunityJob(
                        manager,
                        opportunityServiceJob.id
                    );
                    if (generatedCost.generationCount > 0) {
                        opportunityServiceJob.costAtSale = generatedCost.total;
                        if (opportunityServiceJob.isBriefVideo) opportunityServiceJob.isQuotationItem = false;
                    }
                    await opportunityServiceJobRepository.save(opportunityServiceJob);
                    await this.recalculateOpportunityServicePrices(manager, opportunityServiceJob.opportunityServiceId);

                    const businessDeveloper = opportunityServiceJob.opportunityService?.opportunity?.createdBy;
                    if (businessDeveloper && (task.result?.url || generatedCost.generationCount > 0)) {
                        const resultMessage = task.result?.url
                            ? "Kết quả Video AI demo đã sẵn sàng trên cơ hội. "
                            : "";
                        await this.notificationService.createNotification({
                            title: `${opportunityServiceJob.name} đã hoàn thành`,
                            content: `PM đã xác nhận kết quả. ${resultMessage}Giá vốn từ các lần tạo video thành công là ${Number(opportunityServiceJob.costAtSale).toLocaleString("vi-VN")} VNĐ.`,
                            type: "TASK_COMPLETED",
                            recipient: businessDeveloper,
                            relatedEntityId: task.id,
                            relatedEntityType: "Task",
                            link: `/opportunities/${opportunityServiceJob.opportunityService.opportunity.id}`
                        }, manager);
                    }
                }
            }
            await manager.save(task);

            if (task.isOutput && task.contractService) {
                const contractService = task.contractService;
                if (!contractService.results) contractService.results = [];

                const taskResults = contractService.results.filter(r => r.taskId === task.id);
                const latestResult = taskResults.length > 0 ? taskResults[taskResults.length - 1] : null;

                const currentMaxVersion = taskResults.reduce((max, r) => Math.max(max, Number(r.version || 1)), 0);
                const isNewIteration = latestResult && latestResult.status !== 'PENDING';
                const nextVersion = isNewIteration ? currentMaxVersion + 1 : (currentMaxVersion || 1);

                const newResult = {
                    taskId: task.id,
                    type: task.result?.type || 'file',
                    name: task.result?.name || task.nickname || task.name || task.code,
                    url: task.result?.url,
                    note: task.result?.note,
                    checklist: task.result?.checklist,
                    status: 'PENDING' as const,
                    version: nextVersion,
                    submittedAt: new Date().toISOString()
                };

                if (latestResult && latestResult.status === 'PENDING') {
                    // Update current pending result in place if it hasn't been reviewed by customer/BOD yet
                    const existingIndex = contractService.results.lastIndexOf(latestResult);
                    if (existingIndex >= 0) {
                        contractService.results[existingIndex] = newResult;
                    } else {
                        contractService.results.push(newResult);
                    }
                } else {
                    // Previous result was already REJECTED or APPROVED -> append as a new version, preserving previous history
                    contractService.results.push(newResult);
                }
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
        if (outcome.task?.opportunityServiceJob?.opportunityService?.opportunity?.id) {
            await RedisService.deleteCache(`opportunities:*:detail:${outcome.task.opportunityServiceJob.opportunityService.opportunity.id}*`);
        }
        taskReviewEmitter.emit(TASK_REVIEW_EVENTS.UPDATED, { taskId });
        return outcome.result;
    }

    private async sumSucceededGenerationCost(manager: any, taskId: string): Promise<{ total: number; generationCount: number }> {
        const videoResult = await manager.getRepository(VideoGenerations)
            .createQueryBuilder("generation")
            .select("COALESCE(SUM(CASE WHEN generation.status = 'succeeded' THEN generation.cost ELSE 0 END), 0)", "total")
            .addSelect("COUNT(generation.id)", "count")
            .where("generation.task_id = :taskId", { taskId })
            .getRawOne();
        const motionResult = await manager.getRepository(MotionGenerations)
            .createQueryBuilder("generation")
            .select("COALESCE(SUM(CASE WHEN generation.status = 'succeeded' THEN generation.cost ELSE 0 END), 0)", "total")
            .addSelect("COUNT(generation.id)", "count")
            .where("generation.task_id = :taskId", { taskId })
            .getRawOne();

        return {
            total: Number(videoResult?.total || 0) + Number(motionResult?.total || 0),
            generationCount: Number(videoResult?.count || 0) + Number(motionResult?.count || 0)
        };
    }

    private async sumSucceededGenerationCostForOpportunityJob(
        manager: any,
        opportunityServiceJobId: string
    ): Promise<{ total: number; generationCount: number }> {
        const videoResult = await manager.getRepository(VideoGenerations)
            .createQueryBuilder("generation")
            .innerJoin(Tasks, "task", "task.id = generation.task_id")
            .select("COALESCE(SUM(CASE WHEN generation.status = 'succeeded' THEN generation.cost ELSE 0 END), 0)", "total")
            .addSelect("COUNT(generation.id)", "count")
            .where("task.\"opportunityServiceJobId\" = :opportunityServiceJobId", { opportunityServiceJobId })
            .getRawOne();
        const motionResult = await manager.getRepository(MotionGenerations)
            .createQueryBuilder("generation")
            .innerJoin(Tasks, "task", "task.id = generation.task_id")
            .select("COALESCE(SUM(CASE WHEN generation.status = 'succeeded' THEN generation.cost ELSE 0 END), 0)", "total")
            .addSelect("COUNT(generation.id)", "count")
            .where("task.\"opportunityServiceJobId\" = :opportunityServiceJobId", { opportunityServiceJobId })
            .getRawOne();

        return {
            total: Number(videoResult?.total || 0) + Number(motionResult?.total || 0),
            generationCount: Number(videoResult?.count || 0) + Number(motionResult?.count || 0)
        };
    }

    private async recalculateOpportunityServicePrices(manager: any, opportunityServiceId: string) {
        const jobs = (await manager.getRepository(OpportunityServiceJobs).find({
            where: { opportunityServiceId }
        })).filter((job: OpportunityServiceJobs) => job.isQuotationItem && !job.isBriefVideo);
        const opportunityService = await manager.getRepository(OpportunityServices).findOneBy({
            id: opportunityServiceId
        });
        if (!opportunityService) return;

        opportunityService.costAtSale = jobs.reduce(
            (sum: number, job: OpportunityServiceJobs) => sum + Number(job.costAtSale || 0) * Number(job.quantity || 1),
            0
        );
        opportunityService.sellingPrice = calculateRecommendedSellingPrice(Number(opportunityService.costAtSale || 0));
        await manager.getRepository(OpportunityServices).save(opportunityService);
    }

    async rejectTask(taskId: string, passedCriteriaIds: string[] = [], reviewNote: string, currentUser?: ReviewActor) {
        const task = await this.taskRepository.findOne({
            where: { id: taskId },
            relations: ["assignee", "project", "project.team", "project.team.teamLead", "project.team.members", "project.team.members.user"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        this.assertCanReviewTask(task, currentUser);

        // Allowed statuses for rejection
        const rejectableStatuses = [TaskStatus.AWAITING_REVIEW, TaskStatus.DOING, TaskStatus.AWAITING_ACCEPTANCE];
        if (!rejectableStatuses.includes(task.status)) {
            throw new Error(`Công việc đang ở trạng thái ${task.status}, không thể thực hiện từ chối.`);
        }

        if (!reviewNote || reviewNote.trim() === "") {
            throw new Error("Vui lòng nhập lý do từ chối/yêu cầu sửa lại");
        }

        // Update criteria status even on reject
        const allReviews = await this.reviewRepository.find({
            where: { task: { id: taskId } }
        });

        for (const review of allReviews) {
            review.isPassed = passedCriteriaIds.includes(review.id);
        }
        await this.reviewRepository.save(allReviews);

        const iterationRepository = AppDataSource.getRepository(TaskIterations);
        const iterationCount = await iterationRepository.count({
            where: { taskId: task.id }
        });
        const iteration = iterationRepository.create({
            task,
            version: iterationCount + 1,
            submittedResult: task.result,
            leadFeedback: reviewNote,
            feedbackAttachments: null as any,
            deadlineAt: null as any,
            submittedById: task.lastSubmittedById
        });
        await iterationRepository.save(iteration);

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
