import { Opportunities } from "../../entity/Opportunity.entity";
import { BaseNotionService } from "./BaseNotion.Service";

export class OpportunityNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_OPPORTUNITIES || "");
    }

    async sync(opportunity: Opportunities) {
        if (!this.databaseId) return;

        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: opportunity.id
                        }
                    }
                ]
            },
            "Code": {
                rich_text: [
                    {
                        text: {
                            content: opportunity.opportunityCode
                        }
                    }
                ]
            },
            "Name": {
                rich_text: [
                    {
                        text: {
                            content: opportunity.name || ""
                        }
                    }
                ]
            },
            "Status": {
                select: {
                    name: opportunity.status
                }
            },
            "Expected Revenue": {
                number: Number(opportunity.expectedRevenue) || 0
            },
            "Success Chance": {
                number: Number(opportunity.successChance) || 0
            }
        };

        // Dates (Timeline)
        const startDate = this.formatDate(opportunity.startDate || opportunity.createdAt);
        const endDate = this.formatDate(opportunity.endDate);

        if (startDate) {
            properties["Timeline"] = {
                date: {
                    start: startDate,
                    end: endDate
                }
            };
        }

        // Customer Info
        if (opportunity.customer) {
            properties["Customer"] = {
                rich_text: [
                    {
                        text: {
                            content: opportunity.customer.name || ""
                        }
                    }
                ]
            };
        } else if (opportunity.leadName) {
            properties["Customer"] = {
                rich_text: [
                    {
                        text: {
                            content: `(Lead) ${opportunity.leadName}`
                        }
                    }
                ]
            };
        }

        await this.upsertPage(opportunity.id, properties, "Opportunity");
    }
}
