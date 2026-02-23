import { AppDataSource } from "../data-source";
import { Opportunities, CustomerType } from "../entity/Opportunity.entity";
import { Customers } from "../entity/Customer.entity";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { Services } from "../entity/Service.entity";
import { ReferralPartners } from "../entity/ReferralPartner.entity";
import { Users } from "../entity/User.entity";
import { Like } from "typeorm";

export class OpportunityService {
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private customerRepository = AppDataSource.getRepository(Customers);
    private referralPartnerRepository = AppDataSource.getRepository(ReferralPartners);
    private userRepository = AppDataSource.getRepository(Users);

    async getAll(filters: any = {}, userInfo?: { id: string, role: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        const where: any = [];
        const baseWhere: any = {};
        if (userInfo && userInfo.role !== "BOD" && userInfo.role !== "ADMIN") {
            // Filter by createdBy.account.id since accountId is what we have in userInfo
            baseWhere.createdBy = { account: { id: userInfo.id } };
        }

        if (filters.status && filters.status !== 'ALL') {
            baseWhere.status = filters.status;
        }

        if (filters.search) {
            const searchTerm = `%${filters.search}%`;
            where.push({ ...baseWhere, name: Like(searchTerm) });
            where.push({ ...baseWhere, leadName: Like(searchTerm) });
            where.push({ ...baseWhere, customer: { name: Like(searchTerm) } });
            where.push({ ...baseWhere, opportunityCode: { opportunityCode: Like(searchTerm) } });
        } else {
            where.push(baseWhere);
        }

        const [items, total] = await this.opportunityRepository.findAndCount({
            where: where.length > 1 ? where : where[0],
            relations: ["customer", "referralPartner", "createdBy"],
            order: { [sortBy]: sortDir },
            skip: (page - 1) * limit,
            take: limit
        });

        return {
            data: items,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getOne(id: string) {
        const opportunity = await this.opportunityRepository.findOne({
            where: { id },
            relations: ["customer", "referralPartner", "services", "quotations", "contracts", "createdBy"]
        });
        if (!opportunity) {
            throw new Error("Không tìm thấy cơ hội kinh doanh");
        }
        return opportunity;
    }

    private async generateOpportunityCode(): Promise<string> {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const prefix = `CH-${year}-${month}`;

        // Find the count of opportunities created in this year and month
        const count = await this.opportunityRepository.count({
            where: {
                opportunityCode: Like(`${prefix}%`)
            }
        });

        const sequence = (count + 1).toString().padStart(3, '0');
        return `${prefix}-${sequence}`;
    }

    async create(data: any = {}) {
        const {
            customerId,
            referralPartnerId,
            customerType,
            // Lead fields
            leadName,
            leadPhone,
            leadEmail,
            leadAddress,
            leadTaxId,
            services,
            accountId,
            ...opportunityData
        } = data;

        // Auto-generate code if not provided
        if (!opportunityData.opportunityCode) {
            opportunityData.opportunityCode = await this.generateOpportunityCode();
        } else {
            // Check if opportunity code already exists
            const existing = await this.opportunityRepository.findOne({
                where: { opportunityCode: opportunityData.opportunityCode }
            });
            if (existing) {
                throw new Error("Mã cơ hội đã tồn tại");
            }
        }

        const opportunity = this.opportunityRepository.create({
            ...opportunityData,
            customerType: customerType || CustomerType.DIRECT,
            leadName,
            leadPhone,
            leadEmail,
            leadAddress,
            leadTaxId
        }) as unknown as Opportunities;

        // Handle Customer Logic
        if (customerId) {
            const customer = await this.customerRepository.findOneBy({ id: customerId });
            if (!customer) {
                throw new Error("Không tìm thấy khách hàng");
            }
            opportunity.customer = customer;
            // Clear lead info if customer is selected (optional, but cleaner)
            opportunity.leadName = null;
            opportunity.leadPhone = null;
            opportunity.leadEmail = null;
            opportunity.leadAddress = null;
            opportunity.leadTaxId = null;
        }

        // Handle Referral Logic
        const pId = referralPartnerId || null;
        if (customerType === CustomerType.REFERRAL && pId) {
            const partner = await this.referralPartnerRepository.findOneBy({ id: pId });
            if (!partner) {
                throw new Error("Không tìm thấy đối tác giới thiệu");
            }
            opportunity.referralPartner = partner;
        }

        // Handle CreatedBy Logic
        if (accountId) {
            const user = await this.userRepository.findOne({
                where: { account: { id: accountId } }
            });
            if (user) {
                opportunity.createdBy = user;
            }
        }

        const savedOpportunity = await this.opportunityRepository.save(opportunity);

        // Handle service selection with quantity
        if (services && Array.isArray(services)) {
            await this.updateServices(savedOpportunity, services);
        }

        return await this.getOne(savedOpportunity.id);
    }

    async update(id: string, data: any = {}) {
        const {
            customerId,
            referralPartnerId,
            customerType,
            // Lead fields
            leadName,
            leadPhone,
            leadEmail,
            leadAddress,
            leadTaxId,
            services,
            ...opportunityData
        } = data;

        let opportunity = await this.getOne(id) as Opportunities;

        if (opportunityData.opportunityCode && opportunityData.opportunityCode !== opportunity.opportunityCode) {
            const existing = await this.opportunityRepository.findOne({
                where: { opportunityCode: opportunityData.opportunityCode }
            });
            if (existing) {
                throw new Error("Mã cơ hội đã tồn tại");
            }
        }

        // Handle Customer updates
        if (customerId) {
            const customer = await this.customerRepository.findOneBy({ id: customerId });
            if (!customer) {
                throw new Error("Không tìm thấy khách hàng");
            }
            opportunity.customer = customer;
            // Clear lead fields
            opportunity.leadName = null;
            opportunity.leadPhone = null;
            opportunity.leadEmail = null;
            opportunity.leadAddress = null;
            opportunity.leadTaxId = null;
        } else if (customerId === null) {
            opportunity.customer = null;
        }

        // Handle Referral Logic updates
        if (customerType) {
            opportunity.customerType = customerType;
        }

        const pId = referralPartnerId !== undefined ? referralPartnerId : undefined;

        if (pId) {
            const partner = await this.referralPartnerRepository.findOneBy({ id: pId });
            if (!partner) {
                throw new Error("Không tìm thấy đối tác giới thiệu");
            }
            opportunity.referralPartner = partner;
            // Nếu có đối tác thì tự động chuyển sang loại REFERRAL nếu chưa là REFERRAL
            if (opportunity.customerType !== CustomerType.REFERRAL) {
                opportunity.customerType = CustomerType.REFERRAL;
            }
        } else if (pId === null || (customerType === CustomerType.DIRECT)) {
            opportunity.referralPartner = null;
        }

        // Update Lead fields
        if (leadName !== undefined) opportunity.leadName = leadName;
        if (leadPhone !== undefined) opportunity.leadPhone = leadPhone;
        if (leadEmail !== undefined) opportunity.leadEmail = leadEmail;
        if (leadAddress !== undefined) opportunity.leadAddress = leadAddress;
        if (leadTaxId !== undefined) opportunity.leadTaxId = leadTaxId;

        Object.assign(opportunity, opportunityData);
        const savedOpportunity = await this.opportunityRepository.save(opportunity);

        // Update services if provided
        if (services && Array.isArray(services)) {
            await this.updateServices(savedOpportunity, services);
        }

        return await this.getOne(savedOpportunity.id);
    }

    async delete(id: string) {
        const opportunity = await this.getOne(id);
        await this.opportunityRepository.remove(opportunity);
        return { message: "Xóa cơ hội kinh doanh thành công" };
    }

    private async updateServices(opportunity: Opportunities, services: any[]) {
        const opportunityServiceRepository = AppDataSource.getRepository(OpportunityServices);
        const serviceRepository = AppDataSource.getRepository(Services);

        // Simple approach: remove old and add new (or you can do smart update)
        await opportunityServiceRepository.delete({ opportunity: { id: opportunity.id } });

        for (const item of services) {
            const serviceId = typeof item === 'string' ? item : item.id;
            const quantity = typeof item === 'object' ? (item.quantity || 1) : 1;
            // You might want to pass price overrides too

            const service = await serviceRepository.findOneBy({ id: serviceId });
            if (!service) {
                throw new Error(`Không tìm thấy dịch vụ với ID: ${serviceId}. Vui lòng kiểm tra lại danh sách dịch vụ.`);
            }

            const oppService = opportunityServiceRepository.create({
                opportunity: opportunity,
                service: service,
                sellingPrice: service.costPrice || 0,
                costAtSale: service.costPrice || 0,
                quantity: quantity
            });
            await opportunityServiceRepository.save(oppService);
        }
    }
}
