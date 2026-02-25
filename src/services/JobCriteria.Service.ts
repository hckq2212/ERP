import { AppDataSource } from "../data-source";
import { JobCriterias } from "../entity/JobCriteria.entity";
import { Jobs } from "../entity/Job.entity";

export class JobCriteriaService {
    private criteriaRepository = AppDataSource.getRepository(JobCriterias);
    private jobRepository = AppDataSource.getRepository(Jobs);

    async getByJob(jobId: string) {
        return await this.criteriaRepository.find({
            where: { job: { id: jobId } }
        });
    }

    async create(data: { jobId: string, name: string, description?: string }) {
        const job = await this.jobRepository.findOneBy({ id: data.jobId });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        const criteria = this.criteriaRepository.create({
            job,
            name: data.name,
            description: data.description
        });

        return await this.criteriaRepository.save(criteria);
    }

    async delete(id: string) {
        const criteria = await this.criteriaRepository.findOneBy({ id });
        if (!criteria) throw new Error("Không tìm thấy tiêu chí");
        return await this.criteriaRepository.softRemove(criteria);
    }

    async syncCriteria(jobId: string, criteriaData: any[]) {
        const job = await this.jobRepository.findOne({
            where: { id: jobId },
            relations: ["criteria"]
        });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        // 1. Identify criteria to soft-delete
        const incomingIds = criteriaData.map(c => c.id).filter(id => id);
        const criteriaToDelete = job.criteria.filter(c => !incomingIds.includes(c.id));

        if (criteriaToDelete.length > 0) {
            await this.criteriaRepository.softRemove(criteriaToDelete);
        }

        // 2. Identify criteria to update or create
        const finalCriteria = [];
        for (const data of criteriaData) {
            if (data.id) {
                // Update
                const existing = job.criteria.find(c => c.id === data.id);
                if (existing) {
                    existing.name = data.name;
                    existing.description = data.description;
                    finalCriteria.push(existing);
                }
            } else {
                // Create
                const nouveau = this.criteriaRepository.create({
                    name: data.name,
                    description: data.description,
                    job: job
                });
                finalCriteria.push(nouveau);
            }
        }

        return await this.criteriaRepository.save(finalCriteria);
    }
}
