import { AppDataSource } from "../data-source";
import { Customers } from "../entity/Customer.entity";
import { Opportunities } from "../entity/Opportunity.entity";
import { Users } from "../entity/User.entity";
import { SecurityService } from "./Security.Service";
import { Not } from "typeorm";
import { validateCustomerData } from "../validations/Customer.Validation";

export class CustomerService {
    private customerRepository = AppDataSource.getRepository(Customers);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);

    private async checkTaxIdUniqueness(taxId: string, excludeCustomerId?: string) {
        if (!taxId) return;

        // 1. Check in Customers
        const customerExists = await this.customerRepository.findOne({
            where: {
                taxId,
                ...(excludeCustomerId ? { id: Not(excludeCustomerId) } : {})
            }
        });

        if (customerExists) {
            throw new Error("Khách hàng này đã tồn tại trên hệ thống");
        }

        // 2. Check in Opportunities (leadTaxId)
        const opportunityExists = await this.opportunityRepository.findOne({
            where: { leadTaxId: taxId }
        });

        if (opportunityExists) {
            throw new Error("Mã số thuế này đã tồn tại trên hệ thống (Cơ hội)");
        }
    }

    async getAll(userInfo?: { id: string, role: string, userId?: string }) {
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

        return await this.customerRepository.find({
            where: rbacWhere,
            relations: ["referralPartner"]
        });
    }

    async getOne(id: string, userInfo?: { id: string, role: string, userId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getCustomerFilters(userInfo);
        }

        const customer = await this.customerRepository.findOne({
            where: { id, ...rbacWhere },
            relations: ["referralPartner", "contracts", "opportunities"]
        });
        if (!customer) throw new Error("Không tìm thấy khách hàng hoặc bạn không có quyền xem");
        return customer;
    }

    async create(data: any, userInfo?: { id: string, userId?: string }) {
        validateCustomerData(data);
        if (data.taxId) {
            await this.checkTaxIdUniqueness(data.taxId);
        }
        const customer = this.customerRepository.create(data as Partial<Customers>);
        if (userInfo?.userId) {
            customer.createdBy = { id: userInfo.userId } as Users;
        }
        return await this.customerRepository.save(customer);
    }

    async update(id: string, data: any) {
        validateCustomerData(data);
        if (data.taxId) {
            await this.checkTaxIdUniqueness(data.taxId, id);
        }
        const customer = await this.getOne(id);
        Object.assign(customer, data);
        return await this.customerRepository.save(customer);
    }

    async delete(id: string) {
        const customer = await this.getOne(id);
        await this.customerRepository.remove(customer);
        return { message: "Xóa khách hàng thành công" };
    }
}
