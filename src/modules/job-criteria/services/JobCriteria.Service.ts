import { AppDataSource } from "../../../data-source";
import { JobCriterias } from "../entities/JobCriteria.entity";
import { Jobs } from "../../job/entities/Job.entity";
import { SecurityService } from "../../../shared/services/Security.Service";
import { RedisService } from "../../../shared/services/Redis.Service";

export class JobCriteriaService {
    private criteriaRepository = AppDataSource.getRepository(JobCriterias);
    private jobRepository = AppDataSource.getRepository(Jobs);

    async getByJob(jobId: string) {
        const cacheKey = `job-criterias:${SecurityService.getTenantCachePart()}:job:${jobId}`;
        return await RedisService.fetchWithCache(cacheKey, 86400, async () => {
            return await this.criteriaRepository.find({
                where: SecurityService.withTenant({ job: { id: jobId } })
            });
        });
    }

    async create(data: { jobId: string, name: string, description?: string }) {
        const job = await this.jobRepository.findOne({ where: SecurityService.withTenant({ id: data.jobId }) });
        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        const criteria = this.criteriaRepository.create({
            job,
            name: data.name,
            description: data.description,
            ...SecurityService.getTenantWhere()
        } as any) as unknown as JobCriterias;

        const saved = await this.criteriaRepository.save(criteria);
        await RedisService.deleteCache(`job-criterias:*:job:${data.jobId}*`);
        await RedisService.deleteCache(`jobs:*:detail:${data.jobId}*`);
        await RedisService.deleteCache('jobs:*all*');
        return saved;
    }

    async delete(id: string) {
        const criteria = await this.criteriaRepository.findOne({ where: SecurityService.withTenant({ id }), relations: ["job"] });
        if (!criteria) throw new Error("Không tìm thấy tiêu chí");
        const jobId = criteria.job?.id;
        const result = await this.criteriaRepository.softRemove(criteria);
        if (jobId) {
            await RedisService.deleteCache(`job-criterias:*:job:${jobId}*`);
            await RedisService.deleteCache(`jobs:*:detail:${jobId}*`);
            await RedisService.deleteCache('jobs:*all*');
        }
        return result;
    }

    async syncCriteria(jobId: string, criteriaData: any[]) {
        const job = await this.jobRepository.findOne({
            where: SecurityService.withTenant({ id: jobId }),
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
                    job: job,
                    ...SecurityService.getTenantWhere()
                } as any) as unknown as JobCriterias;
                finalCriteria.push(nouveau);
            }
        }

        const saved = await this.criteriaRepository.save(finalCriteria);
        await RedisService.deleteCache(`job-criterias:*:job:${jobId}*`);
        await RedisService.deleteCache(`jobs:*:detail:${jobId}*`);
        await RedisService.deleteCache('jobs:*all*');
        return saved;
    }
}
