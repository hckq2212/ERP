import { EventEmitter } from "events";
import { Tasks } from "../entity/Task.entity";

class TaskEmitter extends EventEmitter {}

export const taskEmitter = new TaskEmitter();

export const TASK_EVENTS = {
    CREATED: "task_created",
    UPDATED: "task_updated",
    STATUS_CHANGED: "task_status_changed",
    DELETED: "task_deleted",
};
