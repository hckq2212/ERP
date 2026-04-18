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
            const { passedCriteriaIds, reviewNote } = req.body;
            const result = await this.reviewService.checkAndFinalize(taskId, passedCriteriaIds, reviewNote);
            
            // If not all criteria were passed, we still returned 200 but with a specific state
            // Or we could return 202 Accepted if it's partial? 
            // Let's stick with 200 but use the message from service.
            res.status(200).json(result);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    reject = async (req: Request, res: Response) => {
        try {
            const taskId = req.params.taskId as string;
            const { passedCriteriaIds, reviewNote } = req.body;
            
            if (!reviewNote) {
                return res.status(400).json({ message: "Vui lòng nhập lý do từ chối" });
            }

            const result = await this.reviewService.rejectTask(taskId, passedCriteriaIds, reviewNote);
            res.status(200).json(result);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }
}
