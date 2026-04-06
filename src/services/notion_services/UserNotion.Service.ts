import { Users } from "../../entity/User.entity";
import { BaseNotionService } from "./BaseNotion.Service";

export class UserNotionService extends BaseNotionService {
    constructor() {
        super(process.env.NOTION_DATABASE_ID_USERS || "");
    }

    async sync(user: Users) {
        if (!this.databaseId) return;

        const properties: any = {
            "Id": {
                title: [
                    {
                        text: {
                            content: user.id
                        }
                    }
                ]
            },
            "Full Name": {
                rich_text: [
                    {
                        text: {
                            content: user.fullName
                        }
                    }
                ]
            },
            "Phone Number": {
                phone_number: user.phoneNumber || null
            }
        };

        if (user.account) {
            properties["Email"] = {
                email: user.account.email || ""
            };
            properties["Username"] = {
                rich_text: [
                    {
                        text: {
                            content: user.account.username || ""
                        }
                    }
                ]
            };
            properties["Role"] = {
                select: {
                    name: user.account.role || "MEMBER"
                }
            };
            properties["Status"] = {
                checkbox: user.account.isActive !== false
            };
        }

        await this.upsertPage(user.id, properties, "User");
    }
}
