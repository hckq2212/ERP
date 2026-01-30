import { AppDataSource } from "../data-source";
import { Services } from "../entity/Service.entity";
import { Jobs } from "../entity/Job.entity";
import { In } from "typeorm";

export class ServiceService {
    private serviceRepository = AppDataSource.getRepository(Services);

    async getAll() {
        return await this.serviceRepository.find({
            relations: ["jobs"]
        });
    }

    async getOne(id: number) {
        const service = await this.serviceRepository.findOne({
            where: { id },
            relations: ["jobs"]
        });
        if (!service) throw new Error("Không tìm thấy dịch vụ");
        return service;
    }

    async recalculateCost(serviceId: number) {
        const service = await this.serviceRepository.findOne({
            where: { id: serviceId },
            relations: ["jobs"]
        });
        if (!service) return;

        const jobsTotal = (service.jobs || []).reduce((sum, job) => sum + Number(job.costPrice || 0), 0);
        service.costPrice = jobsTotal + Number(service.overheadCost || 0);

        return await this.serviceRepository.save(service);
    }

    async create(data: any = {}) {
        const { jobIds, ...serviceData } = data;
        const service = this.serviceRepository.create(serviceData) as any;

        if (jobIds && Array.isArray(jobIds)) {
            const jobRepository = AppDataSource.getRepository(Jobs);
            service.jobs = await jobRepository.findBy({ id: In(jobIds) });
        }

        const savedService = await this.serviceRepository.save(service);
        return await this.recalculateCost(savedService.id);
    }

    async update(id: number, data: any = {}) {
        const { jobIds, ...serviceData } = data;
        const service = await this.getOne(id) as any;

        Object.assign(service, serviceData);

        if (jobIds && Array.isArray(jobIds)) {
            const jobRepository = AppDataSource.getRepository(Jobs);
            service.jobs = await jobRepository.findBy({ id: In(jobIds) });
        }

        await this.serviceRepository.save(service);
        return await this.recalculateCost(id);
    }

    async delete(id: number) {
        const service = await this.getOne(id);
        await this.serviceRepository.remove(service);
        return { message: "Xóa dịch vụ thành công" };
    }

    async addJob(serviceId: number, jobId: number) {
        const service = await this.getOne(serviceId);
        const jobRepository = AppDataSource.getRepository(Jobs);
        const job = await jobRepository.findOneBy({ id: jobId });

        if (!job) throw new Error("Không tìm thấy công việc");

        if (!service.jobs) service.jobs = [];
        if (!service.jobs.find(j => j.id === jobId)) {
            service.jobs.push(job);
            await this.serviceRepository.save(service);
            await this.recalculateCost(serviceId);
        }

        return await this.getOne(serviceId);
    }

    async removeJob(serviceId: number, jobId: number) {
        const service = await this.getOne(serviceId);
        if (service.jobs) {
            service.jobs = service.jobs.filter(j => j.id !== jobId);
            await this.serviceRepository.save(service);
            await this.recalculateCost(serviceId);
        }
        return await this.getOne(serviceId);
    }
}
