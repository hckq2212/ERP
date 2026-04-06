import { BaseNotionService } from "./BaseNotion.Service";
import { Contracts } from "../../entity/Contract.entity";

export class ContractNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_CONTRACTS || "");
    }

    async sync(contract: Contracts) {
        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: contract.id
                        }
                    }
                ]
            },
            "Contract Code": {
                rich_text: [
                    {
                        text: {
                            content: contract.contractCode || ""
                        }
                    }
                ]
            },
            "Name": {
                rich_text: [
                    {
                        text: {
                            content: contract.name || ""
                        }
                    }
                ]
            },
            "Status": {
                select: {
                    name: contract.status || "DRAFT"
                }
            },
            "Cost": {
                number: Number(contract.cost) || 0
            },
            "Selling Price": {
                number: Number(contract.sellingPrice) || 0
            },
            "Description": {
                rich_text: [
                    {
                        text: {
                            content: contract.description || ""
                        }
                    }
                ]
            }
        };

        // Relations
        if (contract.customer?.id) {
            const customerPageId = await this.resolveRelationPageId(
                process.env.NOTION_DATABASE_ID_CUSTOMERS || "",
                contract.customer.id
            );
            if (customerPageId) {
                properties["Customer"] = { relation: [{ id: customerPageId }] };
            }
        }

        if (contract.opportunity?.id) {
            const opportunityPageId = await this.resolveRelationPageId(
                process.env.NOTION_DATABASE_ID_OPPORTUNITIES || "",
                contract.opportunity.id
            );
            if (opportunityPageId) {
                properties["Opportunity"] = { relation: [{ id: opportunityPageId }] };
            }
        }

        return this.upsertPage(contract.id, properties, "Contract");
    }
}
