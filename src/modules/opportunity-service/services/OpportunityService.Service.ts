import { AppDataSource } from "../../../data-source";
import { OpportunityServices } from "../entities/OpportunityService.entity";
import { Opportunities } from "../../opportunity/entities/Opportunity.entity";
import { Services } from "../../service/entities/Service.entity";
import { SecurityService } from "../../../shared/services/Security.Service";
import { OpportunityServiceJobs } from "../entities/OpportunityServiceJob.entity";
import { RedisService } from "../../../shared/services/Redis.Service";

export class OpportunityServiceService {
    private oppServiceRepository = AppDataSource.getRepository(OpportunityServices);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private serviceRepository = AppDataSource.getRepository(Services);
    private oppServiceJobRepository = AppDataSource.getRepository(OpportunityServiceJobs);

    async getAllByOpportunity(opportunityId: string) {
        return await this.oppServiceRepository.find({
            where: SecurityService.withTenant({ opportunity: { id: opportunityId } }),
            relations: ["service", "jobs", "jobs.job"]
        });
    }

    async getOne(id: string) {
        const item = await this.oppServiceRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["opportunity", "service", "jobs", "jobs.job"]
        });
        if (!item) throw new Error("Không tìm thấy hạng mục dịch vụ");
        return item;
    }

    async create(data: { opportunityId: string, serviceId: string, quantity: number, sellingPrice?: number, costAtSale?: number }) {
        const opportunity = await this.opportunityRepository.findOne({ where: SecurityService.withTenant({ id: data.opportunityId }) });
        if (!opportunity) throw new Error("Không tìm thấy cơ hội kinh doanh");

        const service = await this.serviceRepository.findOne({ where: SecurityService.withTenant({ id: data.serviceId }) });
        if (!service) throw new Error("Không tìm thấy dịch vụ gốc");

        const oppService = this.oppServiceRepository.create({
            opportunity,
            service,
            quantity: data.quantity || 1,
            sellingPrice: data.sellingPrice ?? service.costPrice ?? 0,
            costAtSale: data.costAtSale ?? service.costPrice ?? 0,
            ...SecurityService.getTenantWhere()
        } as any) as unknown as OpportunityServices;

        const saved = await this.oppServiceRepository.save(oppService);
        await this.recalculateRevenue(data.opportunityId);
        return await this.getOne(saved.id);
    }

    async update(id: string, data: {
        quantity?: number,
        sellingPrice?: number,
        costAtSale?: number,
        jobs?: { id: string, costAtSale?: number, sellingPrice?: number, briefVideo?: string }[]
    }) {
        const item = await this.getOne(id);

        if (data.quantity !== undefined) item.quantity = data.quantity;
        if (data.sellingPrice !== undefined) item.sellingPrice = data.sellingPrice;
        if (data.costAtSale !== undefined) item.costAtSale = data.costAtSale;

        if (Array.isArray(data.jobs)) {
            for (const input of data.jobs) {
                const job = item.jobs?.find((candidate) => candidate.id === input.id);
                if (!job) throw new Error("Không tìm thấy hạng mục công việc của cơ hội");

                if (input.briefVideo !== undefined) {
                    const briefVideo = input.briefVideo.trim() || null;
                    if (job.isBriefVideo && !briefVideo) {
                        throw new Error(`Vui lòng nhập brief cho hạng mục ${job.name}`);
                    }
                    job.briefVideo = briefVideo;
                }

                if (job.isQuotationItem) {
                    if (input.costAtSale !== undefined) job.costAtSale = input.costAtSale;
                    if (input.sellingPrice !== undefined) job.sellingPrice = input.sellingPrice;
                } else if (input.sellingPrice !== undefined && Number(input.sellingPrice) !== 0) {
                    throw new Error(`Hạng mục ${job.name} không được phép tính giá bán`);
                }

                await this.oppServiceJobRepository.save(job);
            }

            const quotationJobs = await this.oppServiceJobRepository.find({
                where: SecurityService.withTenant({ opportunityServiceId: id, isQuotationItem: true })
            });
            item.costAtSale = quotationJobs.reduce(
                (sum, job) => sum + Number(job.costAtSale || 0) * Number(job.quantity || 1), 0
            );
            item.sellingPrice = quotationJobs.reduce(
                (sum, job) => sum + Number(job.sellingPrice || 0) * Number(job.quantity || 1), 0
            );
        }

        await this.oppServiceRepository.save(item);
        await this.recalculateRevenue(item.opportunity.id);
        await RedisService.deleteCache(`opportunities:detail:${item.opportunity.id}*`);
        await RedisService.deleteCache("opportunities:all*");
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
            where: SecurityService.withTenant({ opportunity: { id: opportunityId } })
        });

        const totalRevenue = services.reduce((sum, s) => sum + (Number(s.sellingPrice) * s.quantity), 0);

        await this.opportunityRepository.update(SecurityService.withTenant({ id: opportunityId }), {
            expectedRevenue: totalRevenue
        });
    }
}
