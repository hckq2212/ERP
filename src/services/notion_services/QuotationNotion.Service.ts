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
            "Opportunity": {
                rich_text: [
                    {
                        text: {
                            content: quotation.opportunity?.name || "N/A"
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

        await this.upsertPage(quotation.id, properties, "Quotation");
    }
}
