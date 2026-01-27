import { AppDataSource } from "../data-source";
import { Jobs } from "../entity/Job.entity";
import { Services } from "../entity/Service.entity";
import { Partners } from "../entity/Partner.entity";
import { In } from "typeorm";

export class JobService {
    private jobRepository = AppDataSource.getRepository(Jobs);

    async getAll() {
        return await this.jobRepository.find({
            relations: ["partner", "services"]
        });
    }

    async getOne(id: number) {
        const job = await this.jobRepository.findOne({
            where: { id },
            relations: ["partner", "services"]
        });
        if (!job) throw new Error("Không tìm thấy công việc");
        return job;
    }

    async create(data: any = {}) {
        const { serviceIds, partnerId, ...jobData } = data;
        const job = this.jobRepository.create(jobData) as any;

        if (serviceIds && Array.isArray(serviceIds)) {
            const serviceRepository = AppDataSource.getRepository(Services);
            job.services = await serviceRepository.findBy({ id: In(serviceIds) });
        }

        if (partnerId) {
            const partnerRepository = AppDataSource.getRepository(Partners);
            job.partner = await partnerRepository.findOneBy({ id: partnerId });
        }

        return await this.jobRepository.save(job);
    }

    async update(id: number, data: any = {}) {
        const { serviceIds, partnerId, ...jobData } = data;
        const job = await this.getOne(id) as any;

        Object.assign(job, jobData);

        if (serviceIds && Array.isArray(serviceIds)) {
            const serviceRepository = AppDataSource.getRepository(Services);
            job.services = await serviceRepository.findBy({ id: In(serviceIds) });
        }

        if (partnerId) {
            const partnerRepository = AppDataSource.getRepository(Partners);
            job.partner = await partnerRepository.findOneBy({ id: partnerId });
        }

        return await this.jobRepository.save(job);
    }

    async delete(id: number) {
        const job = await this.getOne(id);
        await this.jobRepository.remove(job);
        return { message: "Xóa công việc thành công" };
    }
}
