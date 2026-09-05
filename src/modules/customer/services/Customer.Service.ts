import { AppDataSource } from "../../../data-source";
import { Customers } from "../entities/Customer.entity";
import { Opportunities } from "../../opportunity/entities/Opportunity.entity";
import { Users } from "../../user/entities/User.entity";
import { SecurityService } from "../../../shared/services/Security.Service";
import { Not } from "typeorm";
import { validateCustomerData } from "../validations/Customer.Validation";
import { RedisService } from "../../../shared/services/Redis.Service";

export class CustomerService {
    private customerRepository = AppDataSource.getRepository(Customers);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);

    private async checkTaxIdUniqueness(taxId: string, userInfo?: { companyId?: string }, excludeCustomerId?: string) {
        if (!taxId) return;

        // 1. Check in Customers
        const customerExists = await this.customerRepository.findOne({
            where: SecurityService.withTenant({
                taxId,
                ...(excludeCustomerId ? { id: Not(excludeCustomerId) } : {})
            }, userInfo)
        });

        if (customerExists) {
            throw new Error("Khách hàng này đã tồn tại trên hệ thống");
        }

        // 2. Check in Opportunities (leadTaxId)
        const opportunityExists = await this.opportunityRepository.findOne({
            where: SecurityService.withTenant({ leadTaxId: taxId }, userInfo)
        });

        if (opportunityExists) {
            throw new Error("Mã số thuế này đã tồn tại trên hệ thống (Cơ hội)");
        }
    }

    async getAll(userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            try {
                rbacWhere = SecurityService.getCustomerFilters(userInfo);
            } catch (error: any) {
                if (error.message === "FORBIDDEN_ACCESS") {
                    return [];
                }
                throw error;
            }
        }

        // We prefix with user role and id to avoid RBAC leaking across different caches
        const cacheKey = userInfo ? `customers:${SecurityService.getTenantCachePart(userInfo)}:all:role_${userInfo.role}:user_${userInfo.id}` : `customers:${SecurityService.getTenantCachePart()}:all`;

        return await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            return await this.customerRepository.find({
                where: rbacWhere,
                relations: ["referralPartner"]
            });
        });
    }

    async getOne(id: string, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getCustomerFilters(userInfo);
        }

        const cacheKey = userInfo ? `customers:${SecurityService.getTenantCachePart(userInfo)}:detail:${id}:role_${userInfo.role}:user_${userInfo.id}` : `customers:${SecurityService.getTenantCachePart()}:detail:${id}`;

        const customer = await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            return await this.customerRepository.findOne({
                where: SecurityService.withTenant({ id, ...rbacWhere }, userInfo),
                relations: ["referralPartner", "contracts", "opportunities", "createdBy", "createdBy.accounts"]
            });
        });

        if (!customer) throw new Error("Không tìm thấy khách hàng hoặc bạn không có quyền xem");
        return customer;
    }

    async create(data: any, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        validateCustomerData(data);
        if (data.taxId) {
            await this.checkTaxIdUniqueness(data.taxId, userInfo);
        }

        // Handle phoneNumber from frontend
        if (!data.phone && data.phoneNumber) {
            data.phone = data.phoneNumber;
        }

        const customer = this.customerRepository.create(SecurityService.withTenant(data, userInfo) as Partial<Customers>);
        if (userInfo?.userId) {
            customer.createdBy = { id: userInfo.userId } as Users;
        }
        const savedCustomer = await this.customerRepository.save(customer);

        // Invalidate all customer list caches (all roles and users)
        await RedisService.deleteCache('customers:all*');

        return savedCustomer;
    }

    async update(id: string, data: any, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        validateCustomerData(data);
        if (data.taxId) {
            await this.checkTaxIdUniqueness(data.taxId, userInfo, id);
        }

        console.log(`[CustomerService] Updating customer ${id} with data:`, JSON.stringify(data, null, 2));

        // Handle phoneNumber from frontend
        if (!data.phone && data.phoneNumber) {
            data.phone = data.phoneNumber;
        }

        const customer = await this.getOne(id, userInfo);

        // Filter out empty string values to avoid overwriting existing data
        const updateData = Object.fromEntries(
            Object.entries(data).filter(([_, v]) => v !== '' && v !== undefined)
        );

        Object.assign(customer, updateData);
        const savedCustomer = await this.customerRepository.save(customer);

        // Invalidate all list caches and this specific customer's detail caches
        await RedisService.deleteCache('customers:all*');
        await RedisService.deleteCache(`customers:detail:${id}*`);

        return savedCustomer;
    }

    async delete(id: string, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        const customer = await this.getOne(id, userInfo);
        await this.customerRepository.remove(customer);

        // Invalidate all list caches and this specific customer's detail caches
        await RedisService.deleteCache('customers:all*');
        await RedisService.deleteCache(`customers:detail:${id}*`);

        return { message: "Xóa khách hàng thành công" };
    }
}
