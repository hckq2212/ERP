import { Router } from "express";
import { TaskReviewController } from "../controllers/TaskReview.Controller";

const router = Router();
const controller = new TaskReviewController();

router.get("/task/:taskId", controller.getTaskReviews);
router.put("/:id/toggle", controller.toggleCriteria);

export default router;
