import { AppDataSource } from "../data-source";
import { JobCriterias } from "../entity/JobCriteria.entity";
import { Jobs } from "../entity/Job.entity";

export class JobCriteriaService {
    private criteriaRepository = AppDataSource.getRepository(JobCriterias);
    private jobRepository = AppDataSource.getRepository(Jobs);

    async getByJob(jobId: number) {
        return await this.criteriaRepository.find({
            where: { job: { id: jobId } }
        });
    }

    async create(data: { jobId: number, name: string }) {
        const job = await this.jobRepository.findOneBy({ id: data.jobId });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        const criteria = this.criteriaRepository.create({
            job,
            name: data.name
        });

        return await this.criteriaRepository.save(criteria);
    }

    async delete(id: number) {
        const criteria = await this.criteriaRepository.findOneBy({ id });
        if (!criteria) throw new Error("Không tìm thấy tiêu chí");
        return await this.criteriaRepository.remove(criteria);
    }
}
