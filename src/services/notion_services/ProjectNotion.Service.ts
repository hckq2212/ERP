import { Projects } from "../../entity/Project.entity";
import { BaseNotionService } from "./BaseNotion.Service";

export class ProjectNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_PROJECTS || "");
    }

    async sync(project: Projects) {
        if (!this.databaseId) return;

        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: project.id
                        }
                    }
                ]
            },
            "Name": {
                rich_text: [
                    {
                        text: {
                            content: project.name
                        }
                    }
                ]
            },
            "Status": {
                select: {
                    name: project.status
                }
            }
        };

        // Standard Dates (Timeline)
        const startDate = this.formatDate(project.plannedStartDate || project.createdAt);
        const endDate = this.formatDate(project.plannedEndDate);

        if (startDate) {
            properties["Timeline"] = {
                date: {
                    start: startDate,
                    end: endDate
                }
            };
        }

        // Actual Dates
        const actualStart = this.formatDate(project.actualStartDate);
        if (actualStart) {
            properties["Actual Start"] = {
                date: {
                    start: actualStart
                }
            };
        }
        const actualEnd = this.formatDate(project.actualEndDate);
        if (actualEnd) {
            properties["Actual End"] = {
                date: {
                    start: actualEnd
                }
            };
        }

        // Contract Info
        if (project.contract) {
            properties["Contract Code"] = {
                rich_text: [
                    {
                        text: {
                            content: project.contract.contractCode || ""
                        }
                    }
                ]
            };
            if (project.contract.customer) {
                properties["Client"] = {
                    rich_text: [
                        {
                            text: {
                                content: project.contract.customer.name || ""
                            }
                        }
                    ]
                };
            }
        }

        // Team Info
        if (project.team && project.team.teamLead) {
            properties["Team Lead"] = {
                rich_text: [
                    {
                        text: {
                            content: project.team.teamLead.fullName || ""
                        }
                    }
                ]
            };
        }

        await this.upsertPage(project.id, properties, "Project");
    }
}
