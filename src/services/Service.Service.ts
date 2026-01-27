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

    async create(data: any = {}) {
        const { jobIds, ...serviceData } = data;
        const service = this.serviceRepository.create(serviceData) as any;

        if (jobIds && Array.isArray(jobIds)) {
            const jobRepository = AppDataSource.getRepository(Jobs);
            service.jobs = await jobRepository.findBy({ id: In(jobIds) });
        }

        return await this.serviceRepository.save(service);
    }

    async update(id: number, data: any = {}) {
        const { jobIds, ...serviceData } = data;
        const service = await this.getOne(id) as any;

        Object.assign(service, serviceData);

        if (jobIds && Array.isArray(jobIds)) {
            const jobRepository = AppDataSource.getRepository(Jobs);
            service.jobs = await jobRepository.findBy({ id: In(jobIds) });
        }

        return await this.serviceRepository.save(service);
    }

    async delete(id: number) {
        const service = await this.getOne(id);
        await this.serviceRepository.remove(service);
        return { message: "Xóa dịch vụ thành công" };
    }
}
