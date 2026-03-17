import { AppDataSource } from "../data-source";
import { Services } from "../entity/Service.entity";
import { Jobs } from "../entity/Job.entity";
import { ServiceJob } from "../entity/ServiceJob.entity";
import { In, ILike } from "typeorm";
import { RedisService } from "./Redis.Service";

export class ServiceService {
    private serviceRepository = AppDataSource.getRepository(Services);

    async getAll(filters: { name?: string } = {}) {
        const query: any = {
            relations: ["serviceJobs", "serviceJobs.job"]
        };

        if (filters.name) {
            query.where = { name: ILike(`%${filters.name}%`) };
        }

        const filtersKey = JSON.stringify(filters);
        const cacheKey = `services:all:${filtersKey}`;

        return await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            return await this.serviceRepository.find(query);
        });
    }

    async getOne(id: string) {
        const cacheKey = `services:detail:${id}`;
        const service = await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            return await this.serviceRepository.findOne({
                where: { id },
                relations: ["serviceJobs", "serviceJobs.job"]
            });
        });
        if (!service) throw new Error("Không tìm thấy dịch vụ");
        return service;
    }

    async recalculateCost(serviceId: string) {
        const service = await this.serviceRepository.findOne({
            where: { id: serviceId },
            relations: ["serviceJobs", "serviceJobs.job"]
        });
        if (!service) return;

        const jobsTotal = (service.serviceJobs || []).reduce((sum, sj) => {
            const cost = Number(sj.job?.costPrice || 0);
            const qty = Number(sj.quantity || 1);
            return sum + (cost * qty);
        }, 0);
        
        service.costPrice = jobsTotal;

        return await this.serviceRepository.save(service);
    }


    async create(data: any = {}) {
        const { jobIds, outputJobIds, ...serviceData } = data;
        const service = this.serviceRepository.create(serviceData as Partial<Services>);
        const savedService = (await this.serviceRepository.save(service)) as unknown as Services;

        // Invalidate list cache
        await RedisService.deleteCache('services:all*');

        if (jobIds && Array.isArray(jobIds)) {
            const sjRepo = AppDataSource.getRepository(ServiceJob);
            const serviceJobs = jobIds.map(jobId => sjRepo.create({
                serviceId: savedService.id,
                jobId,
                quantity: 1,
                isOutput: (outputJobIds || []).includes(jobId)
            }));
            await sjRepo.save(serviceJobs);
        }

        return await this.recalculateCost(savedService.id);
    }


    async update(id: string, data: any = {}) {
        const { jobConfigs, ...serviceData } = data; // jobConfigs: [{ jobId, quantity, isOutput }]
        const service = await this.getOne(id);

        Object.assign(service, serviceData);
        await this.serviceRepository.save(service);

        // Invalidate caches
        await RedisService.deleteCache('services:all*');
        await RedisService.deleteCache(`services:detail:${id}*`);

        if (jobConfigs && Array.isArray(jobConfigs)) {
            const sjRepo = AppDataSource.getRepository(ServiceJob);
            // Simple approach: clear and recreation or sync
            await sjRepo.delete({ serviceId: id });
            
            const newSjs = jobConfigs.map(config => sjRepo.create({
                serviceId: id,
                jobId: config.jobId,
                quantity: config.quantity || 1,
                isOutput: config.isOutput || false
            }));
            await sjRepo.save(newSjs);
        }

        return await this.recalculateCost(id);
    }


    async delete(id: string) {
        const service = await this.getOne(id);
        await this.serviceRepository.remove(service);

        // Invalidate caches
        await RedisService.deleteCache('services:all*');
        await RedisService.deleteCache(`services:detail:${id}*`);

        return { message: "Xóa dịch vụ thành công" };
    }

    async addJob(serviceId: string, jobId: string) {
        const sjRepo = AppDataSource.getRepository(ServiceJob);
        const existing = await sjRepo.findOneBy({ serviceId, jobId });

        if (!existing) {
            const sj = sjRepo.create({ serviceId, jobId, quantity: 1, isOutput: false });
            await sjRepo.save(sj);
            await this.recalculateCost(serviceId);

            // Invalidate caches
            await RedisService.deleteCache('services:all*');
            await RedisService.deleteCache(`services:detail:${serviceId}*`);
        }

        return await this.getOne(serviceId);
    }

    async removeJob(serviceId: string, jobId: string) {
        const sjRepo = AppDataSource.getRepository(ServiceJob);
        await sjRepo.delete({ serviceId, jobId });
        await this.recalculateCost(serviceId);

        // Invalidate caches
        await RedisService.deleteCache('services:all*');
        await RedisService.deleteCache(`services:detail:${serviceId}*`);

        return await this.getOne(serviceId);
    }
}
