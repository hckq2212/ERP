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
            "Customer": {
                rich_text: [
                    {
                        text: {
                            content: contract.customer?.name || "N/A"
                        }
                    }
                ]
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

        return this.upsertPage(contract.id, properties, "Contract");
    }
}
