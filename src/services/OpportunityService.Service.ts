import { AppDataSource } from "../data-source";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { Opportunities } from "../entity/Opportunity.entity";
import { Services } from "../entity/Service.entity";

export class OpportunityServiceService {
    private oppServiceRepository = AppDataSource.getRepository(OpportunityServices);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private serviceRepository = AppDataSource.getRepository(Services);

    async getAllByOpportunity(opportunityId: string) {
        return await this.oppServiceRepository.find({
            where: { opportunity: { id: opportunityId } },
            relations: ["service"]
        });
    }

    async getOne(id: string) {
        const item = await this.oppServiceRepository.findOne({
            where: { id },
            relations: ["opportunity", "service"]
        });
        if (!item) throw new Error("Không tìm thấy hạng mục dịch vụ");
        return item;
    }

    async create(data: { opportunityId: string, serviceId: string, quantity: number, sellingPrice?: number, costAtSale?: number }) {
        const opportunity = await this.opportunityRepository.findOneBy({ id: data.opportunityId });
        if (!opportunity) throw new Error("Không tìm thấy cơ hội kinh doanh");

        const service = await this.serviceRepository.findOneBy({ id: data.serviceId });
        if (!service) throw new Error("Không tìm thấy dịch vụ gốc");

        const oppService = this.oppServiceRepository.create({
            opportunity,
            service,
            quantity: data.quantity || 1,
            sellingPrice: data.sellingPrice ?? service.costPrice ?? 0,
            costAtSale: data.costAtSale ?? service.costPrice ?? 0
        });

        const saved = await this.oppServiceRepository.save(oppService);
        await this.recalculateRevenue(data.opportunityId);
        return await this.getOne(saved.id);
    }

    async update(id: string, data: { quantity?: number, sellingPrice?: number, costAtSale?: number }) {
        const item = await this.getOne(id);

        if (data.quantity !== undefined) item.quantity = data.quantity;
        if (data.sellingPrice !== undefined) item.sellingPrice = data.sellingPrice;
        if (data.costAtSale !== undefined) item.costAtSale = data.costAtSale;

        await this.oppServiceRepository.save(item);
        await this.recalculateRevenue(item.opportunity.id);
        return await this.getOne(id);
    }

    async delete(id: string) {
        const item = await this.getOne(id);
        const opportunityId = item.opportunity.id;
        await this.oppServiceRepository.remove(item);
        await this.recalculateRevenue(opportunityId);
        return { message: "Xóa hạng mục dịch vụ thành công" };
    }

    private async recalculateRevenue(opportunityId: string) {
        const services = await this.oppServiceRepository.find({
            where: { opportunity: { id: opportunityId } }
        });

        const totalRevenue = services.reduce((sum, s) => sum + (Number(s.sellingPrice) * s.quantity), 0);

        await this.opportunityRepository.update(opportunityId, {
            expectedRevenue: totalRevenue
        });
    }
}
