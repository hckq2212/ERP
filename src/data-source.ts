import "reflect-metadata"
import { DataSource } from "typeorm"
import { Accounts } from "./modules/account/entities/Account.entity"
import { Users } from "./modules/user/entities/User.entity"
import { ProjectTeams } from "./modules/project/entities/ProjectTeam.entity"
import { TeamMembers } from "./modules/project/entities/TeamMember.entity"
import { Vendors } from "./modules/vendor/entities/Vendor.entity"
import { ReferralPartners } from "./modules/referral-partner/entities/ReferralPartner.entity"
import { Customers } from "./modules/customer/entities/Customer.entity"
import { Opportunities } from "./modules/opportunity/entities/Opportunity.entity"
import { Quotations } from "./modules/quotation/entities/Quotation.entity"
import { QuotationDetails } from "./modules/quotation/entities/QuotationDetail.entity"
import { Services } from "./modules/service/entities/Service.entity"
import { Jobs } from "./modules/job/entities/Job.entity"
import { OpportunityServices } from "./modules/opportunity-service/entities/OpportunityService.entity"
import { Contracts } from "./modules/contract/entities/Contract.entity"
import { ContractServices } from "./modules/contract/entities/ContractService.entity"
import { Projects } from "./modules/project/entities/Project.entity"
import { Tasks } from "./modules/task/entities/Task.entity"
import { PaymentMilestones } from "./modules/payment-milestone/entities/PaymentMilestone.entity"
import { Debts } from "./modules/debt/entities/Debt.entity"
import { DebtPayments } from "./modules/debt/entities/DebtPayment.entity"
import { Notifications } from "./modules/notification/entities/Notification.entity"
import { ContractAddendums } from "./modules/contract-addendum/entities/ContractAddendum.entity"
import { TaskReviews } from "./modules/task/entities/TaskReview.entity"
import { JobCriterias } from "./modules/job-criteria/entities/JobCriteria.entity"
import { AcceptanceRequests } from "./modules/acceptance/entities/AcceptanceRequest.entity"
import { ServicePackages } from "./modules/service-package/entities/ServicePackage.entity"
import { ServicePackageItems } from "./modules/service-package/entities/ServicePackageItem.entity"
import { OpportunityPackages } from "./modules/opportunity/entities/OpportunityPackage.entity"
import { TaskIterations } from "./modules/task/entities/TaskIteration.entity"
import { VinicoinTransactions } from "./modules/vinicoin/entities/VinicoinTransaction.entity"
import { Violations } from "./modules/task/entities/Violation.entity"
import { RefreshSessions } from "./modules/auth/entities/RefreshSession.entity"

import { VendorJobs } from "./modules/vendor/entities/VendorJob.entity"
import { ServiceJob } from "./modules/service/entities/ServiceJob.entity"

import { AiProviders } from "./modules/ai-provider/entities/AiProvider.entity"
import { AiModels } from "./modules/ai-model/entities/AiModel.entity"
import { Assets } from "./modules/asset/entities/Asset.entity"
import { VideoGenerations } from "./modules/video-generation/entities/VideoGeneration.entity"
import { MotionGenerations } from "./modules/video-generation/entities/MotionGeneration.entity"

import * as dotenv from "dotenv"
dotenv.config()

const isProduction = process.env.NODE_ENV === "production";
const useDatabaseUrl = Boolean(process.env.DATABASE_URL);
const useSsl = process.env.DB_SSL === "true";
const sslOptions = useSsl ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" } : false;

export const AppDataSource = new DataSource({
    type: "postgres",
    ...(isProduction
        ? { url: process.env.DATABASE_URL, ssl: sslOptions }
        : {
            host: process.env.DB_HOST || "localhost",
            port: Number(process.env.DB_PORT) || 5432,
            username: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: sslOptions
        }
    ),
    extra: {
        connectionTimeoutMillis: 10000,
    },
    synchronize: true,
    schema: "public",
    logging: isProduction ? false : ["error", "warn"], // Enabled some logging in dev
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
        AcceptanceRequests,
        ServicePackages,
        ServicePackageItems,
        OpportunityPackages,
        TaskIterations,
        VinicoinTransactions,
        ServiceJob,
        Violations,
        RefreshSessions,
        AiProviders,
        AiModels,
        Assets,
        VideoGenerations,
        MotionGenerations,
    ],

    migrations: [],
    subscribers: [],
})
