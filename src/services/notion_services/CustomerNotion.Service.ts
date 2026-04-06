import { BaseNotionService } from "./BaseNotion.Service";
import { Customers } from "../../entity/Customer.entity";

export class CustomerNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_CUSTOMERS || "");
    }

    async sync(customer: Customers) {
        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: customer.id
                        }
                    }
                ]
            },
            "Name": {
                rich_text: [
                    {
                        text: {
                            content: customer.name || ""
                        }
                    }
                ]
            },
            "Phone": {
                phone_number: customer.phone || null
            },
            "Email": {
                email: customer.email || null
            },
            "Address": {
                rich_text: [
                    {
                        text: {
                            content: customer.address || ""
                        }
                    }
                ]
            },
            "Tax ID": {
                rich_text: [
                    {
                        text: {
                            content: customer.taxId || ""
                        }
                    }
                ]
            },
            "Source": {
                select: {
                    name: customer.source || "INTERNAL"
                }
            }
        };

        return this.upsertPage(customer.id, properties, "Customer");
    }
}
