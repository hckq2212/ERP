import { EventEmitter } from "events";
import { Projects } from "../entity/Project.entity";

class ProjectEmitter extends EventEmitter {}

export const projectEmitter = new ProjectEmitter();

export const PROJECT_EVENTS = {
    CREATED: "project_created",
    UPDATED: "project_updated",
    DELETED: "project_deleted",
};
