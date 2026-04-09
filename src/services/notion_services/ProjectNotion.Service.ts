import { Projects } from "../../entity/Project.entity";
import { BaseNotionService } from "./BaseNotion.Service";
import { AppDataSource } from "../../data-source";
import { applyProjectTemplateOnce } from "../notion/ProjectPageTemplate";

export class ProjectNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_PROJECTS || "");
    }

    private async hydrateProject(project: Projects): Promise<Projects> {
        try {
            if (!AppDataSource.isInitialized) return project;
            const repo = AppDataSource.getRepository(Projects);
            const full = await repo.findOne({
                where: { id: project.id },
                relations: ["contract", "contract.customer", "contract.opportunity", "team", "team.teamLead", "tasks"]
            });
            return full || project;
        } catch {
            return project;
        }
    }

    async sync(project: Projects) {
        if (!this.databaseId) return;

        const fullProject = await this.hydrateProject(project);

        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: fullProject.id
                        }
                    }
                ]
            },
            "Name": {
                rich_text: [
                    {
                        text: {
                            content: fullProject.name
                        }
                    }
                ]
            },
            "Status": {
                select: {
                    name: fullProject.status
                }
            }
        };

        // Standard Dates (Timeline)
        const startDate = this.formatDate(fullProject.plannedStartDate || (fullProject as any).createdAt);
        const endDate = this.formatDate(fullProject.plannedEndDate);

        if (startDate) {
            properties["Timeline"] = {
                date: {
                    start: startDate,
                    end: endDate
                }
            };
        }

        // Actual Dates
        const actualStart = this.formatDate(fullProject.actualStartDate);
        if (actualStart) {
            properties["Actual Start"] = {
                date: {
                    start: actualStart
                }
            };
        }
        const actualEnd = this.formatDate(fullProject.actualEndDate);
        if (actualEnd) {
            properties["Actual End"] = {
                date: {
                    start: actualEnd
                }
            };
        }

        // Contract Info
        if (fullProject.contract) {
            properties["Contract Code"] = {
                rich_text: [
                    {
                        text: {
                            content: fullProject.contract.contractCode || ""
                        }
                    }
                ]
            };

            // Relation to contracts.Id == ERP contract.id
            if (fullProject.contract.id) {
                const contractPageId = await this.resolveRelationPageId(
                    process.env.NOTION_DATABASE_ID_CONTRACTS || "",
                    fullProject.contract.id
                );
                if (contractPageId) {
                    properties["Contract"] = { relation: [{ id: contractPageId }] };
                }
            }

            if (fullProject.contract.customer) {
                properties["Client"] = {
                    rich_text: [
                        {
                            text: {
                                content: fullProject.contract.customer.name || ""
                            }
                        }
                    ]
                };
            }
        }

        // Team Info
        if (fullProject.team && fullProject.team.teamLead) {
            properties["Team Lead"] = {
                rich_text: [
                    {
                        text: {
                            content: fullProject.team.teamLead.fullName || ""
                        }
                    }
                ]
            };
        }

        // Optional: link back to ERP (only if ERP_PUBLIC_BASE_URL is configured)
        const baseUrl = process.env.ERP_PUBLIC_BASE_URL;
        if (baseUrl) {
            properties["ERP Project URL"] = {
                url: `${baseUrl.replace(/\/$/, "")}/projects/${fullProject.id}`
            };
        }

        const pageId = await this.upsertPage(fullProject.id, properties, "Project");
        if (!pageId) return;

        await applyProjectTemplateOnce({
            pageId,
            projectSnapshot: {
                id: fullProject.id,
                name: fullProject.name,
                status: fullProject.status,
                plannedStartDate: fullProject.plannedStartDate,
                plannedEndDate: fullProject.plannedEndDate,
                contractCode: fullProject.contract?.contractCode,
                clientName: fullProject.contract?.customer?.name,
                teamLeadName: fullProject.team?.teamLead?.fullName
            }
        });
    }
}
