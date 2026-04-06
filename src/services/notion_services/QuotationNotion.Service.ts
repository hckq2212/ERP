import { Quotations } from "../../entity/Quotation.entity";
import { BaseNotionService } from "./BaseNotion.Service";

export class QuotationNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_QUOTATIONS || "");
    }

    async sync(quotation: Quotations) {
        if (!this.databaseId) return;

        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: quotation.id
                        }
                    }
                ]
            },
            "Total Amount": {
                number: Number(quotation.totalAmount) || 0
            },
            "Status": {
                select: {
                    name: quotation.status
                }
            },
            "Type": {
                select: {
                    name: quotation.type
                }
            },
            "Version": {
                number: Number(quotation.version) || 1
            },
            "Description": {
                rich_text: [
                    {
                        text: {
                            content: quotation.description || quotation.note || ""
                        }
                    }
                ]
            }
        };

        if (quotation.opportunity?.id) {
            const opportunityPageId = await this.resolveRelationPageId(
                process.env.NOTION_DATABASE_ID_OPPORTUNITIES || "",
                quotation.opportunity.id
            );
            if (opportunityPageId) {
                properties["Opportunity"] = { relation: [{ id: opportunityPageId }] };
            }
        }

        await this.upsertPage(quotation.id, properties, "Quotation");
    }
}
