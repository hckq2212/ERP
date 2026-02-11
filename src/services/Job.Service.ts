import { AppDataSource } from "../data-source";
import { Jobs } from "../entity/Job.entity";
import { Services } from "../entity/Service.entity";
import { Vendors } from "../entity/Vendor.entity";
import { ServiceService } from "./Service.Service";
import { In } from "typeorm";

export class JobService {
    private jobRepository = AppDataSource.getRepository(Jobs);

    async getAll() {
        return await this.jobRepository.find({
            relations: ["vendorJobs", "vendorJobs.vendor", "services", "criteria"]
        });
    }

    async getOne(id: string) {
        const job = await this.jobRepository.findOne({
            where: { id },
            relations: ["vendorJobs", "vendorJobs.vendor", "services", "criteria"]
        });
        if (!job) throw new Error("Không tìm thấy công việc");
        return job;
    }

    async create(data: any = {}) {
        const { serviceIds, vendorId, ...jobData } = data;
        const job = this.jobRepository.create(jobData) as any;

        if (serviceIds && Array.isArray(serviceIds)) {
            const serviceRepository = AppDataSource.getRepository(Services);
            job.services = await serviceRepository.findBy({ id: In(serviceIds) });
        }

        return await this.jobRepository.save(job);
    }

    async update(id: string, data: any = {}) {
        const { serviceIds, vendorId, ...jobData } = data;
        const job = await this.getOne(id) as any;

        const oldCost = job.costPrice;
        Object.assign(job, jobData);

        if (serviceIds && Array.isArray(serviceIds)) {
            const serviceRepository = AppDataSource.getRepository(Services);
            job.services = await serviceRepository.findBy({ id: In(serviceIds) });
        }

        const savedJob = await this.jobRepository.save(job);

        // If cost changed or services changed, recalculate for all related services
        if (oldCost !== jobData.costPrice || serviceIds) {
            const serviceService = new ServiceService();
            const updatedJob = await this.jobRepository.findOne({
                where: { id: savedJob.id },
                relations: ["services"]
            });
            if (updatedJob?.services) {
                for (const service of updatedJob.services) {
                    await serviceService.recalculateCost(service.id);
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
