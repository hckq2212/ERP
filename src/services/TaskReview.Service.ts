import { AppDataSource } from "../data-source";
import { TaskReviews, ReviewerType } from "../entity/TaskReview.entity";
import { Tasks, TaskStatus } from "../entity/Task.entity";
import { JobCriterias } from "../entity/JobCriteria.entity";
import { NotificationService } from "./Notification.Service";
import { ContractServices } from "../entity/ContractService.entity";
import { Users } from "../entity/User.entity";

export class TaskReviewService {
    private reviewRepository = AppDataSource.getRepository(TaskReviews);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private criteriaRepository = AppDataSource.getRepository(JobCriterias);
    private notificationService = new NotificationService();

    async getTaskReviews(taskId: number) {
        return await this.reviewRepository.find({
            where: { task: { id: taskId } },
            relations: ["criteria"]
        });
    }

    async initializeReviews(taskId: number) {
        const task = await this.taskRepository.findOne({
            where: { id: taskId },
            relations: ["job", "job.criteria", "project", "project.team", "project.team.teamLead", "assigner"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        if (!task.job || !task.job.criteria) return [];

        // Delete existing reviews for this task if any
        await this.reviewRepository.delete({ task: { id: taskId } });

        // Determine evaluators and their types
        const definitions: { user: Users, type: ReviewerType }[] = [];

        const lead = task.project?.team?.teamLead;
        const assigner = task.assigner;

        if (lead && assigner && lead.id !== assigner.id) {
            // Different people: both need to review
            definitions.push({ user: lead, type: ReviewerType.TEAM_LEAD });
            definitions.push({ user: assigner, type: ReviewerType.ASSIGNER });
        } else if (assigner) {
            // Same person OR no Team Lead: only assigner reviews (as ASSIGNER type)
            definitions.push({ user: assigner, type: ReviewerType.ASSIGNER });
        } else if (lead) {
            // Case where assigner is missing but lead exists (shouldn't happen often)
            definitions.push({ user: lead, type: ReviewerType.ASSIGNER });
        }

        const reviews: TaskReviews[] = [];
        for (const def of definitions) {
            for (const c of task.job.criteria) {
                reviews.push(this.reviewRepository.create({
                    task,
                    criteria: c,
                    isPassed: false,
                    reviewer: def.user,
                    reviewerType: def.type
                }));
            }
        }

        return await this.reviewRepository.save(reviews);
    }

    async toggleCriteria(reviewId: number, isPassed: boolean, note?: string) {
        const review = await this.reviewRepository.findOne({
            where: { id: reviewId },
            relations: ["task"]
        });

        if (!review) throw new Error("Không tìm thấy mục đánh giá");

        review.isPassed = isPassed;
        if (note !== undefined) review.note = note;

        await this.reviewRepository.save(review);
        return review;
    }

    async checkAndFinalize(taskId: number) {
        const reviews = await this.reviewRepository.find({
            where: { task: { id: taskId } }
        });

        if (reviews.length === 0) return;

        // Group by ReviewerType
        const groups: Record<string, TaskReviews[]> = {};
        for (const r of reviews) {
            if (!groups[r.reviewerType]) groups[r.reviewerType] = [];
            groups[r.reviewerType].push(r);
        }

        // All groups must have 100% isPassed
        const allPassed = Object.values(groups).every(groupItems =>
            groupItems.every(item => item.isPassed)
        );

        if (allPassed) {
            const task = await this.taskRepository.findOne({
                where: { id: taskId },
                relations: ["assignee", "contractService", "job", "contractService.service", "contractService.service.outputJob"]
            });
            if (task) {
                task.status = TaskStatus.COMPLETED;
                task.actualEndDate = new Date();
                await this.taskRepository.save(task);

                // Sync result to ContractService if this is an output job
                if (task.contractService && task.contractService.service?.outputJob?.id === task.job?.id) {
                    const contractServiceRepository = AppDataSource.getRepository(ContractServices);
                    const contractService = task.contractService;
                    contractService.result = {
                        ...task.result,
                        name: task.code || task.name
                    };
                    await contractServiceRepository.save(contractService);
                }

                // Notify assignee
                if (task.assignee) {
                    await this.notificationService.createNotification({
                        title: "Công việc đã được duyệt",
                        content: `Công việc "${task.name}" của bạn đã hoàn thành sau khi được đánh giá.`,
                        type: "TASK_COMPLETED",
                        recipient: task.assignee,
                        relatedEntityId: task.id.toString(),
                        relatedEntityType: "Task",
                        link: `/tasks/${task.id}`
                    });
                }
            }
        }
    }

    async rejectTask(taskId: number, note: string) {
        const task = await this.taskRepository.findOne({
            where: { id: taskId },
            relations: ["assignee"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");

        task.status = TaskStatus.REJECTED;
        await this.taskRepository.save(task);

        // Notify assignee
        if (task.assignee) {
            await this.notificationService.createNotification({
                title: "Công việc cần sửa lại",
                content: `Công việc "${task.name}" bị từ chối/yêu cầu sửa lại. Lý do: ${note}`,
                type: "TASK_REJECTED",
                recipient: task.assignee,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }

        return task;
    }
}
