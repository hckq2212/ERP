import { UserRole } from "../entity/Account.entity";

export class SecurityService {
    /**
     * Generates TypeORM 'where' filter for Opportunities based on user role and ID.
     * 
     * @param userInfo - User information (ID and role)
     * @returns One or more where clauses (as an object or array)
     * @throws Error if the user role is not allowed to access the resource
     */
    static getOpportunityFilters(userInfo: { id: string, role: string, userId?: string }): any {
        const { id, role } = userInfo;

        // Full access for internal management roles
        if ([UserRole.BOD, UserRole.ADMIN, UserRole.ADMIN_SALE, UserRole.ACCOUNTANT].includes(role as UserRole)) {
            return {};
        }

        // Business Development (BD) can only see:
        // 1. Opportunities created by them
        // 2. Opportunities linked to customers created by them
        if (role === UserRole.BD || role === UserRole.SALE) {
            return [
                { createdBy: { account: { id: id } } },
                { customer: { createdBy: { account: { id: id } } } }
            ];
        }

        // MEMBER has no access to the list
        if (role === UserRole.MEMBER) {
            throw new Error("FORBIDDEN_ACCESS");
        }

        // Default: only see their own (restrictive fallback)
        return { createdBy: { account: { id: id } } };
    }

    /**
     * Generates TypeORM 'where' filter for Customers based on user role and ID.
     */
    static getCustomerFilters(userInfo: { id: string, role: string, userId?: string }): any {
        const { id, role } = userInfo;

        // Full access for internal management roles
        if ([UserRole.BOD, UserRole.ADMIN, UserRole.ADMIN_SALE, UserRole.ACCOUNTANT].includes(role as UserRole)) {
            return {};
        }

        // Business Development (BD) or SALE can only see customers created by them
        if (role === UserRole.BD || role === UserRole.SALE) {
            return { createdBy: { account: { id: id } } };
        }

        // HR and MEMBER have no access to the customer list according to requirements
        if (role === UserRole.HR || role === UserRole.MEMBER) {
            throw new Error("FORBIDDEN_ACCESS");
        }

        // Default: only see their own (restrictive fallback)
        return { createdBy: { account: { id: id } } };
    }

    /**
     * Generates TypeORM 'where' filter for Contracts based on user role and ID.
     */
    static getContractFilters(userInfo: { id: string, role: string, userId?: string }): any {
        const { id, role } = userInfo;

        // Full access for internal management roles
        if ([UserRole.BOD, UserRole.ADMIN, UserRole.ADMIN_SALE, UserRole.ACCOUNTANT].includes(role as UserRole)) {
            return {};
        }

        // Business Development (BD) or SALE can only see contracts created by them OR for customers they created
        if (role === UserRole.BD || role === UserRole.SALE) {
            return [
                { createdBy: { id: userInfo.userId } }, // Created by the user (using userId relation)
                { customer: { createdBy: { id: userInfo.userId } } } // Customer created by the user
            ];
            // return {};
        }

        // HR and MEMBER have no access to the contract list
        if (role === UserRole.HR || role === UserRole.MEMBER) {
            throw new Error("FORBIDDEN_ACCESS");
        }

        // Default fallback (restrictive)
        return { createdBy: { id: userInfo.userId } };
    }

    /**
     * Generates TypeORM 'where' filter for Projects based on user role and ID.
     */
    static getProjectFilters(userInfo: { id: string, role: string, userId?: string }): any {
        const { id, role } = userInfo;

        // Full access for internal management roles
        if ([UserRole.BOD, UserRole.ADMIN].includes(role as UserRole)) {
            return {};
        }

        // Business Development (BD) or SALE can see projects related to their contracts or customers
        if (role === UserRole.BD || role === UserRole.SALE) {
            return [
                { contract: { createdBy: { id: userInfo.userId } } },
                { contract: { customer: { createdBy: { id: userInfo.userId } } } }
            ];
        }

        // MEMBER can see projects where they are in the assigned team
        if (role === UserRole.MEMBER) {
            return { team: { members: { user: { id: userInfo.userId } } } };
        }

        // HR has no access to projects
        if (role === UserRole.HR) {
            throw new Error("FORBIDDEN_ACCESS");
        }

        // Default: restrictive fallback
        return { team: { members: { user: { id: userInfo.userId } } } };
    }

    /**
     * Generates TypeORM 'where' filter for Payment Milestones based on user role and ID.
     */
    static getPaymentMilestoneFilters(userInfo: { id: string, role: string, userId?: string }): any {
        const { id, role } = userInfo;

        // Full access for management, sales admin, and accounting
        if ([UserRole.BOD, UserRole.ADMIN, UserRole.ADMIN_SALE, UserRole.ACCOUNTANT].includes(role as UserRole)) {
            return {};
        }

        // Business Development (BD) sees milestones for their contracts or customers
        if (role === UserRole.BD || role === UserRole.SALE) {
            return [
                { contract: { createdBy: { id: userInfo.userId } } },
                { contract: { customer: { createdBy: { id: userInfo.userId } } } }
            ];
        }

        // HR and MEMBER have no access to payment milestones
        if (role === UserRole.HR || role === UserRole.MEMBER) {
            throw new Error("FORBIDDEN_ACCESS");
        }

        // Default: restrictive fallback
        return { contract: { createdBy: { id: userInfo.userId } } };
    }

    /**
     * Generates TypeORM 'where' filter for Debts based on user role and ID.
     */
    static getDebtFilters(userInfo: { id: string, role: string, userId?: string }): any {
        const { id, role } = userInfo;

        // Full access for management, sales admin, and accounting
        if ([UserRole.BOD, UserRole.ADMIN, UserRole.ADMIN_SALE, UserRole.ACCOUNTANT].includes(role as UserRole)) {
            return {};
        }

        // Business Development (BD) sees debts for their contracts or customers
        if (role === UserRole.BD || role === UserRole.SALE) {
            return [
                { contract: { createdBy: { id: userInfo.userId } } },
                { contract: { customer: { createdBy: { id: userInfo.userId } } } }
            ];
        }

        // HR and MEMBER have no access to debts
        if (role === UserRole.HR || role === UserRole.MEMBER) {
            throw new Error("FORBIDDEN_ACCESS");
        }

        // Default: restrictive fallback
        return { contract: { createdBy: { id: userInfo.userId } } };
    }
}
