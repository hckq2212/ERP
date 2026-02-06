import "reflect-metadata"
import { DataSource } from "typeorm"
import { Accounts } from "./entity/Account.entity"
import { Users } from "./entity/User.entity"
import { ProjectTeams } from "./entity/ProjectTeam.entity"
import { TeamMembers } from "./entity/TeamMember.entity"
import { Vendors } from "./entity/Vendor.entity"
import { ReferralPartners } from "./entity/ReferralPartner.entity"
import { Customers } from "./entity/Customer.entity"
import { Opportunities } from "./entity/Opportunity.entity"
import { Quotations } from "./entity/Quotation.entity"
import { QuotationDetails } from "./entity/QuotationDetail.entity"
import { Services } from "./entity/Service.entity"
import { Jobs } from "./entity/Job.entity"
import { OpportunityServices } from "./entity/OpportunityService.entity"
import { Contracts } from "./entity/Contract.entity"
import { ContractServices } from "./entity/ContractService.entity"
import { Projects } from "./entity/Project.entity"
import { Tasks } from "./entity/Task.entity"
import { PaymentMilestones } from "./entity/PaymentMilestone.entity"
import { Debts } from "./entity/Debt.entity"
import { DebtPayments } from "./entity/DebtPayment.entity"
import { Notifications } from "./entity/Notification.entity"
import { ContractAddendums } from "./entity/ContractAddendum.entity"
import { TaskReviews } from "./entity/TaskReview.entity"
import { JobCriterias } from "./entity/JobCriteria.entity"
import { AcceptanceRequests } from "./entity/AcceptanceRequest.entity"


import { VendorJobs } from "./entity/VendorJob.entity"

import * as dotenv from "dotenv"
dotenv.config()

export const AppDataSource = new DataSource({
    type: "postgres",
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: 5432,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    synchronize: process.env.NODE_ENV !== "production",
    logging: false,
    entities: [
        Accounts,
        Users,
        ProjectTeams,
        TeamMembers,
        Vendors,
        ReferralPartners,
        Customers,
        Opportunities,
        Quotations,
        QuotationDetails,
        Services,
        Jobs,
        OpportunityServices,
        Contracts,
        ContractServices,
        Projects,
        Tasks,
        PaymentMilestones,
        Debts,
        DebtPayments,
        Notifications,
        VendorJobs,
        ContractAddendums,
        TaskReviews,
        JobCriterias,
        AcceptanceRequests
    ],

    migrations: [],
    subscribers: [],
})
