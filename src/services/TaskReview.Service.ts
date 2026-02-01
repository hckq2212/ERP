import { AppDataSource } from "../data-source";
import { TaskReviews } from "../entity/TaskReview.entity";
import { Tasks, TaskStatus } from "../entity/Task.entity";
import { JobCriterias } from "../entity/JobCriteria.entity";
import { NotificationService } from "./Notification.Service";

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
            relations: ["job", "job.criteria"]
        });

        if (!task) throw new Error("Không tìm thấy công việc");
        if (!task.job || !task.job.criteria) return [];

        // Delete existing reviews for this task if any
        await this.reviewRepository.delete({ task: { id: taskId } });

        const reviews = task.job.criteria.map(c => this.reviewRepository.create({
            task,
            criteria: c,
            isPassed: false
        }));

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

        // Auto finalize if all passed? Or manual? 
        // User said: "khi các tiêu chí đã check hết thì mới duyệt"
        // Let's implement a check function
        await this.checkAndFinalize(review.task.id);

        return review;
    }

    async checkAndFinalize(taskId: number) {
        const reviews = await this.reviewRepository.find({
            where: { task: { id: taskId } }
        });

        const allPassed = reviews.length > 0 && reviews.every(r => r.isPassed);

        if (allPassed) {
            const task = await this.taskRepository.findOne({
                where: { id: taskId },
                relations: ["assignee"]
            });
            if (task) {
                task.status = TaskStatus.COMPLETED;
                task.actualEndDate = new Date();
                await this.taskRepository.save(task);

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
}
