import { EntityTarget } from "typeorm";
import { AcceptanceRequests } from "../entity/AcceptanceRequest.entity";
import { Accounts } from "../entity/Account.entity";
import { Companies } from "../entity/Company.entity";
import { CompanyMembers } from "../entity/CompanyMember.entity";
import { ContractAddendums } from "../entity/ContractAddendum.entity";
import { Contracts } from "../entity/Contract.entity";
import { Customers } from "../entity/Customer.entity";
import { Debts } from "../entity/Debt.entity";
import { Jobs } from "../entity/Job.entity";
import { JobCriterias } from "../entity/JobCriteria.entity";
import { Notifications } from "../entity/Notification.entity";
import { Opportunities } from "../entity/Opportunity.entity";
import { PaymentMilestones } from "../entity/PaymentMilestone.entity";
import { Projects } from "../entity/Project.entity";
import { ReferralPartners } from "../entity/ReferralPartner.entity";
import { RefreshSessions } from "../entity/RefreshSession.entity";
import { Services } from "../entity/Service.entity";
import { ServicePackages } from "../entity/ServicePackage.entity";
import { Tasks } from "../entity/Task.entity";
import { Users } from "../entity/User.entity";
import { Vendors } from "../entity/Vendor.entity";

export type AdminEntityKey =
    | "accounts"
    | "users"
    | "company-members"
    | "companies"
    | "customers"
    | "services"
    | "jobs"
    | "job-criterias"
    | "projects"
    | "tasks"
    | "contracts"
    | "contract-addendums"
    | "opportunities"
    | "vendors"
    | "referral-partners"
    | "service-packages"
    | "debts"
    | "payment-milestones"
    | "notifications"
    | "acceptance-requests"
    | "refresh-sessions";

export interface AdminEntityConfig {
    key: AdminEntityKey;
    label: string;
    target: EntityTarget<any>;
    description: string;
    searchFields: string[];
    hiddenFields?: string[];
    readOnlyFields?: string[];
    listFields?: string[];
    detailFields?: string[];
    relationDisplayFields?: Record<string, string[]>;
    readOnly?: boolean;
    softDeleteField?: string;
    tenantScope?: "auto" | "current-company" | "company-memberships";
}

export const adminRegistry: Record<AdminEntityKey, AdminEntityConfig> = {
    "accounts": {
        key: "accounts",
        label: "Accounts",
        target: Accounts,
        description: "Tai khoan dang nhap va vai tro he thong",
        searchFields: ["username", "email", "user.fullName", "user.phoneNumber"],
        hiddenFields: ["password"],
        readOnlyFields: ["vinicoin", "vinicoinTotal", "vinicoinWithdrawn"],
        listFields: ["username", "email", "role", "isActive", "user", "createdAt"],
        detailFields: ["username", "email", "role", "isActive", "user", "createdAt", "updatedAt"],
        relationDisplayFields: { user: ["fullName", "phoneNumber", "id"] },
        softDeleteField: "isActive",
        tenantScope: "company-memberships"
    },
    "users": {
        key: "users",
        label: "Users",
        target: Users,
        description: "Nhan su va thong tin lien he",
        searchFields: ["fullName", "phoneNumber", "account.username", "account.email"],
        hiddenFields: ["laborContract"],
        listFields: ["fullName", "phoneNumber", "account", "createdAt"],
        detailFields: ["fullName", "phoneNumber", "account", "createdAt", "updatedAt", "laborContract"],
        relationDisplayFields: { account: ["username", "email", "role", "id"] },
        tenantScope: "company-memberships"
    },
    "company-members": {
        key: "company-members",
        label: "Company Members",
        target: CompanyMembers,
        description: "Lien ket user voi cong ty va role noi bo",
        searchFields: ["user.fullName", "user.phoneNumber", "company.name", "company.slug"],
        listFields: ["user", "company", "role", "createdAt"],
        detailFields: ["user", "company", "role", "createdAt", "updatedAt"],
        relationDisplayFields: {
            user: ["fullName", "phoneNumber", "id"],
            company: ["name", "slug", "id"]
        },
        tenantScope: "auto"
    },
    "companies": {
        key: "companies",
        label: "Companies",
        target: Companies,
        description: "Thong tin tenant/cong ty",
        searchFields: ["name", "slug", "subdomain"],
        listFields: ["name", "slug", "subdomain", "createdAt"],
        detailFields: ["name", "slug", "subdomain", "createdAt", "updatedAt"],
        tenantScope: "current-company"
    },
    "customers": {
        key: "customers",
        label: "Customers",
        target: Customers,
        description: "Khach hang theo tenant hien tai",
        searchFields: ["name", "email", "phone", "address", "taxId"],
        tenantScope: "auto"
    },
    "services": {
        key: "services",
        label: "Services",
        target: Services,
        description: "Dich vu",
        searchFields: ["name", "description"],
        tenantScope: "auto"
    },
    "jobs": {
        key: "jobs",
        label: "Jobs",
        target: Jobs,
        description: "Cong viec/dau viec",
        searchFields: ["name", "description"],
        tenantScope: "auto"
    },
    "job-criterias": {
        key: "job-criterias",
        label: "Job Criterias",
        target: JobCriterias,
        description: "Tieu chi cong viec",
        searchFields: ["name", "description"],
        tenantScope: "auto"
    },
    "projects": {
        key: "projects",
        label: "Projects",
        target: Projects,
        description: "Du an",
        searchFields: ["name", "code", "description"],
        tenantScope: "auto"
    },
    "tasks": {
        key: "tasks",
        label: "Tasks",
        target: Tasks,
        description: "Task van hanh",
        searchFields: ["name", "nickname", "description"],
        tenantScope: "auto"
    },
    "contracts": {
        key: "contracts",
        label: "Contracts",
        target: Contracts,
        description: "Hop dong",
        searchFields: ["contractCode", "name", "description"],
        tenantScope: "auto"
    },
    "contract-addendums": {
        key: "contract-addendums",
        label: "Contract Addendums",
        target: ContractAddendums,
        description: "Phu luc hop dong",
        searchFields: ["name", "description"],
        tenantScope: "auto"
    },
    "opportunities": {
        key: "opportunities",
        label: "Opportunities",
        target: Opportunities,
        description: "Co hoi kinh doanh",
        searchFields: ["opportunityCode", "name", "description", "leadName", "leadEmail", "leadPhone"],
        tenantScope: "auto"
    },
    "vendors": {
        key: "vendors",
        label: "Vendors",
        target: Vendors,
        description: "Nha cung cap",
        searchFields: ["name", "email", "phone", "taxId"],
        tenantScope: "auto"
    },
    "referral-partners": {
        key: "referral-partners",
        label: "Referral Partners",
        target: ReferralPartners,
        description: "Doi tac gioi thieu",
        searchFields: ["name", "email", "phone", "taxId"],
        tenantScope: "auto"
    },
    "service-packages": {
        key: "service-packages",
        label: "Service Packages",
        target: ServicePackages,
        description: "Goi dich vu",
        searchFields: ["name", "description"],
        tenantScope: "auto"
    },
    "debts": {
        key: "debts",
        label: "Debts",
        target: Debts,
        description: "Cong no",
        searchFields: ["name", "status"],
        tenantScope: "auto"
    },
    "payment-milestones": {
        key: "payment-milestones",
        label: "Payment Milestones",
        target: PaymentMilestones,
        description: "Cot moc thanh toan",
        searchFields: ["name", "status", "description"],
        tenantScope: "auto"
    },
    "notifications": {
        key: "notifications",
        label: "Notifications",
        target: Notifications,
        description: "Thong bao he thong",
        searchFields: ["title", "content", "type", "relatedEntityType"],
        tenantScope: "auto"
    },
    "acceptance-requests": {
        key: "acceptance-requests",
        label: "Acceptance Requests",
        target: AcceptanceRequests,
        description: "Yeu cau nghiem thu",
        searchFields: ["name", "note", "feedback", "status"],
        tenantScope: "auto"
    },
    "refresh-sessions": {
        key: "refresh-sessions",
        label: "Refresh Sessions",
        target: RefreshSessions,
        description: "Phien dang nhap, chi xem",
        searchFields: ["accountId", "companyId", "tokenHash"],
        hiddenFields: ["tokenHash"],
        listFields: ["account", "company", "expiresAt", "revokedAt", "createdAt"],
        detailFields: ["account", "company", "expiresAt", "revokedAt", "createdAt", "updatedAt"],
        relationDisplayFields: {
            account: ["username", "email", "role", "id"],
            company: ["name", "slug", "id"]
        },
        readOnly: true,
        tenantScope: "auto"
    }
};

export const adminRegistryList = Object.values(adminRegistry);
