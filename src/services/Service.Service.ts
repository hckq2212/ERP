import { AppDataSource } from "../data-source";
import { Services } from "../entity/Service.entity";
import { Jobs } from "../entity/Job.entity";
import { In } from "typeorm";

export class ServiceService {
    private serviceRepository = AppDataSource.getRepository(Services);

    async getAll() {
        return await this.serviceRepository.find({
            relations: ["jobs", "outputJob"]
        });
    }

    async getOne(id: string) {
        const service = await this.serviceRepository.findOne({
            where: { id },
            relations: ["jobs", "outputJob"]
        });
        if (!service) throw new Error("Không tìm thấy dịch vụ");
        return service;
    }

    async recalculateCost(serviceId: string) {
        const service = await this.serviceRepository.findOne({
            where: { id: serviceId },
            relations: ["jobs"]
        });
        if (!service) return;

        const jobsTotal = (service.jobs || []).reduce((sum, job) => sum + Number(job.costPrice || 0), 0);
        service.costPrice = jobsTotal;

        return await this.serviceRepository.save(service);
    }


    async create(data: any = {}) {
        const { jobIds, outputJobId, ...serviceData } = data;
        const service = this.serviceRepository.create(serviceData) as any;

        const jobRepository = AppDataSource.getRepository(Jobs);
        const allJobIds = new Set(jobIds && Array.isArray(jobIds) ? jobIds : []);
        if (outputJobId) allJobIds.add(outputJobId);

        if (allJobIds.size > 0) {
            const jobs = await jobRepository.findBy({ id: In(Array.from(allJobIds)) });
            service.jobs = jobs;
            if (outputJobId) {
                service.outputJob = jobs.find(j => j.id === outputJobId);
            }
        }

        const savedService = await this.serviceRepository.save(service);
        return await this.recalculateCost(savedService.id);
    }


    async update(id: string, data: any = {}) {
        const { jobIds, outputJobId, ...serviceData } = data;
        const service = await this.getOne(id) as any;

        Object.assign(service, serviceData);

        const jobRepository = AppDataSource.getRepository(Jobs);
        const allJobIds = new Set(jobIds && Array.isArray(jobIds) ? jobIds : []);
        if (outputJobId) allJobIds.add(outputJobId);

        if (allJobIds.size > 0) {
            const jobs = await jobRepository.findBy({ id: In(Array.from(allJobIds)) });
            service.jobs = jobs;
            if (outputJobId) {
                service.outputJob = jobs.find(j => j.id === outputJobId);
            }
        } else if (jobIds) {
            service.jobs = [];
        }

        if (outputJobId === null) {
            service.outputJob = null;
        }

        await this.serviceRepository.save(service);
        return await this.recalculateCost(id);
    }


    async delete(id: string) {
        const service = await this.getOne(id);
        await this.serviceRepository.remove(service);
        return { message: "Xóa dịch vụ thành công" };
    }

    async addJob(serviceId: string, jobId: string) {
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

    async removeJob(serviceId: string, jobId: string) {
        const service = await this.getOne(serviceId);
        if (service.jobs) {
            service.jobs = service.jobs.filter(j => j.id !== jobId);
            await this.serviceRepository.save(service);
            await this.recalculateCost(serviceId);
        }
        return await this.getOne(serviceId);
    }
}
