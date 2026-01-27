import { AppDataSource } from "../data-source";
import { Opportunities } from "../entity/Opportunity.entity";
import { Customers } from "../entity/Customer.entity";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { Services } from "../entity/Service.entity";

export class OpportunityService {
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private customerRepository = AppDataSource.getRepository(Customers);

    async getAll() {
        return await this.opportunityRepository.find({
            relations: ["customer"]
        });
    }

    async getOne(id: number) {
        const opportunity = await this.opportunityRepository.findOne({
            where: { id },
            relations: ["customer", "services", "quotations", "contracts"]
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
        const count = await this.opportunityRepository
            .createQueryBuilder("opportunity")
            .where("opportunity.opportunityCode LIKE :prefix", { prefix: `${prefix}%` })
            .getCount();

        const sequence = (count + 1).toString().padStart(4, '0');
        return `${prefix}-${sequence}`;
    }

    async create(data: any = {}) {
        const { customerId, services, ...opportunityData } = data;

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

        const opportunity = this.opportunityRepository.create(opportunityData) as unknown as Opportunities;

        if (customerId) {
            const customer = await this.customerRepository.findOneBy({ id: customerId });
            if (!customer) {
                throw new Error("Không tìm thấy khách hàng");
            }
            opportunity.customer = customer;
        }

        const savedOpportunity = await this.opportunityRepository.save(opportunity);

        // Handle service selection with quantity
        if (services && Array.isArray(services)) {
            const opportunityServiceRepository = AppDataSource.getRepository(OpportunityServices);
            const serviceRepository = AppDataSource.getRepository(Services);

            for (const item of services) {
                const serviceId = typeof item === 'number' ? item : item.id;
                const quantity = typeof item === 'object' ? (item.quantity || 1) : 1;

                const service = await serviceRepository.findOneBy({ id: serviceId });
                if (service) {
                    const oppService = opportunityServiceRepository.create({
                        opportunity: savedOpportunity,
                        service: service,
                        sellingPrice: service.costPrice || 0,
                        costAtSale: service.costPrice || 0,
                        quantity: quantity
                    });
                    await opportunityServiceRepository.save(oppService);
                }
            }
        }

        return await this.getOne(savedOpportunity.id);
    }

    async update(id: number, data: any = {}) {
        const { customerId, services, ...opportunityData } = data;

        let opportunity = await this.getOne(id) as Opportunities;

        if (opportunityData.opportunityCode && opportunityData.opportunityCode !== opportunity.opportunityCode) {
            const existing = await this.opportunityRepository.findOne({
                where: { opportunityCode: opportunityData.opportunityCode }
            });
            if (existing) {
                throw new Error("Mã cơ hội đã tồn tại");
            }
        }

        if (customerId) {
            const customer = await this.customerRepository.findOneBy({ id: customerId });
            if (!customer) {
                throw new Error("Không tìm thấy khách hàng");
            }
            opportunity.customer = customer;
        }

        Object.assign(opportunity, opportunityData);
        const savedOpportunity = await this.opportunityRepository.save(opportunity);

        // Update services if provided
        if (services && Array.isArray(services)) {
            const opportunityServiceRepository = AppDataSource.getRepository(OpportunityServices);
            const serviceRepository = AppDataSource.getRepository(Services);

            // Simple approach: remove old and add new
            await opportunityServiceRepository.delete({ opportunity: { id: savedOpportunity.id } });

            for (const item of services) {
                const serviceId = typeof item === 'number' ? item : item.id;
                const quantity = typeof item === 'object' ? (item.quantity || 1) : 1;

                const service = await serviceRepository.findOneBy({ id: serviceId });
                if (service) {
                    const oppService = opportunityServiceRepository.create({
                        opportunity: savedOpportunity,
                        service: service,
                        sellingPrice: service.costPrice || 0,
                        costAtSale: service.costPrice || 0,
                        quantity: quantity
                    });
                    await opportunityServiceRepository.save(oppService);
                }
            }
        }

        return await this.getOne(savedOpportunity.id);
    }

    async delete(id: number) {
        const opportunity = await this.getOne(id);
        await this.opportunityRepository.remove(opportunity);
        return { message: "Xóa cơ hội kinh doanh thành công" };
    }
}
