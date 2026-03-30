import { EventEmitter } from "events";
import { TaskReviews } from "../entity/TaskReview.entity";

class TaskReviewEmitter extends EventEmitter {}

export const taskReviewEmitter = new TaskReviewEmitter();

export const TASK_REVIEW_EVENTS = {
    UPDATED: "task_review_updated",
};
