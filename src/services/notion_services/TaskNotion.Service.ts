import { Tasks } from "../../entity/Task.entity";
import { BaseNotionService } from "./BaseNotion.Service";

export class TaskNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_TASKS || "");
    }

    async sync(task: Tasks) {
        if (!this.databaseId) return;

        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: task.id
                        }
                    }
                ]
            },
            "Name": {
                rich_text: [
                    {
                        text: {
                            content: task.name
                        }
                    }
                ]
            },
            "Code": {
                rich_text: [
                    {
                        text: {
                            content: task.code || ""
                        }
                    }
                ]
            },
            "Status": {
                select: {
                    name: task.status
                }
            },
            "Performer Type": {
                select: {
                    name: task.performerType
                }
            }
        };

        // Dates
        const plannedStart = this.formatDate(task.plannedStartDate, true);
        const plannedEnd = this.formatDate(task.plannedEndDate, true);

        if (plannedStart) {
            properties["Planned Dates"] = {
                date: {
                    start: plannedStart,
                    end: plannedEnd
                }
            };
        }

        const actualStart = this.formatDate(task.actualStartDate, true);
        if (actualStart) {
            properties["Actual Start"] = {
                date: {
                    start: actualStart
                }
            };
        }
        const actualEnd = this.formatDate(task.actualEndDate, true);
        if (actualEnd) {
            properties["Actual End"] = {
                date: {
                    start: actualEnd
                }
            };
        }

        // Description
        if (task.description) {
            properties["Description"] = {
                rich_text: [
                    {
                        text: {
                            content: task.description.substring(0, 2000) // Notion limit
                        }
                    }
                ]
            };
        }

        // Assignee/Supervisor/Assigner
        if (task.assignee) {
            properties["Assignee"] = {
                rich_text: [
                    {
                        text: {
                            content: task.assignee.fullName || ""
                        }
                    }
                ]
            };
        }
        if (task.supervisor) {
            properties["Supervisor"] = {
                rich_text: [
                    {
                        text: {
                            content: task.supervisor.fullName || ""
                        }
                    }
                ]
            };
        }
        if (task.assigner) {
            properties["Assigner"] = {
                rich_text: [
                    {
                        text: {
                            content: task.assigner.fullName || ""
                        }
                    }
                ]
            };
        }

        // Financials
        // properties["Selling Price"] = {
        //     number: Number(task.sellingPrice) || 0
        // };
        // properties["Cost"] = {
        //     number: Number(task.cost) || 0
        // };

        // Project Relationship (Text mapping for now)
        if (task.project) {
            properties["Project Name"] = {
                rich_text: [
                    {
                        text: {
                            content: task.project.name || ""
                        }
                    }
                ]
            };
        }

        await this.upsertPage(task.id, properties, "Task");
    }
}
