import { AppDataSource } from "../data-source";
import { Jobs } from "../entity/Job.entity";
import { Services } from "../entity/Service.entity";
import { ServiceService } from "./Service.Service";
import { ServiceJob } from "../entity/ServiceJob.entity";
import { In, ILike } from "typeorm";

export class JobService {
    private jobRepository = AppDataSource.getRepository(Jobs);

    async getAll(filters: { name?: string } = {}) {
        const query: any = {
            relations: ["vendorJobs", "vendorJobs.vendor", "serviceJobs", "serviceJobs.service", "criteria"]
        };

        if (filters.name) {
            query.where = { name: ILike(`%${filters.name}%`) };
        }

        return await this.jobRepository.find(query);
    }

    async getOne(id: string) {
        const job = await this.jobRepository.findOne({
            where: { id },
            relations: ["vendorJobs", "vendorJobs.vendor", "serviceJobs", "serviceJobs.service", "criteria"]
        });
        if (!job) throw new Error("Không tìm thấy công việc");
        return job;
    }

    async create(data: any = {}) {
        const { serviceIds, vendorId, ...jobData } = data;
        const job = this.jobRepository.create(jobData as any) as any;
        const savedJob = (await this.jobRepository.save(job)) as any;

        if (serviceIds && Array.isArray(serviceIds)) {
            const sjRepo = AppDataSource.getRepository(ServiceJob);
            const sjs = serviceIds.map(serviceId => sjRepo.create({
                serviceId,
                jobId: savedJob.id,
                quantity: 1,
                isOutput: false
            }));
            await sjRepo.save(sjs);
        }

        return savedJob;
    }

    async update(id: string, data: any = {}) {
        const { serviceIds, vendorId, ...jobData } = data;
        const job = await this.getOne(id);

        const oldCost = job.costPrice;
        Object.assign(job, jobData);

        const savedJob = (await this.jobRepository.save(job as any)) as any;

        // If cost changed or services changed, recalculate for all related services
        if (oldCost !== jobData.costPrice || serviceIds) {
            const serviceService = new ServiceService();
            const sjRepo = AppDataSource.getRepository(ServiceJob);

            if (serviceIds && Array.isArray(serviceIds)) {
                // Sync service associations
                await sjRepo.delete({ jobId: id });
                const sjs = serviceIds.map(serviceId => sjRepo.create({
                    serviceId,
                    jobId: id,
                    quantity: 1,
                    isOutput: false
                }));
                await sjRepo.save(sjs);
            }

            const updatedJob = (await this.jobRepository.findOne({
                where: { id: savedJob.id },
                relations: ["serviceJobs"]
            })) as any;
            
            if (updatedJob?.serviceJobs) {
                for (const sj of updatedJob.serviceJobs) {
                    await serviceService.recalculateCost(sj.serviceId);
                }
            }
        }

        return savedJob;
    }

    async delete(id: string) {
        const job = await this.getOne(id);
        await this.jobRepository.remove(job);
        return { message: "Xóa công việc thành công" };
    }
}
