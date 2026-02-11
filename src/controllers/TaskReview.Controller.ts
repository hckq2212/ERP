import { Request, Response } from "express";
import { TaskReviewService } from "../services/TaskReview.Service";

export class TaskReviewController {
    private reviewService = new TaskReviewService();

    getTaskReviews = async (req: Request, res: Response) => {
        try {
            const result = await this.reviewService.getTaskReviews(req.params.taskId as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    toggleCriteria = async (req: Request, res: Response) => {
        try {
            const { isPassed, note } = req.body;
            const result = await this.reviewService.toggleCriteria(req.params.id as string, isPassed, note);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    finalize = async (req: Request, res: Response) => {
        try {
            const taskId = req.params.taskId as string;
            await this.reviewService.checkAndFinalize(taskId);
            res.status(200).json({ message: "Đã xử lý duyệt công việc" });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    reject = async (req: Request, res: Response) => {
        try {
            const taskId = req.params.taskId as string;
            const { note } = req.body;
            const result = await this.reviewService.rejectTask(taskId, note);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
