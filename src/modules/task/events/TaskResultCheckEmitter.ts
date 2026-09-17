import { EventEmitter } from "events";

class TaskResultCheckEmitter extends EventEmitter {}

export const taskResultCheckEmitter = new TaskResultCheckEmitter();

export const TASK_RESULT_CHECK_EVENTS = {
    UPDATED: "task_result_check_updated",
};
