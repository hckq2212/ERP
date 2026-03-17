import { AppDataSource } from "../data-source";
import { Vendors } from "../entity/Vendor.entity";
import { VendorJobs } from "../entity/VendorJob.entity";
import { Jobs } from "../entity/Job.entity";
import { validatePartnerData } from "../validations/Partner.Validation";
import { RedisService } from "./Redis.Service";

export class VendorService {
    private vendorRepository = AppDataSource.getRepository(Vendors);
    private vendorJobRepository = AppDataSource.getRepository(VendorJobs);

    async getAll() {
        return await RedisService.fetchWithCache('vendors:all', 3600, async () => {
            return await this.vendorRepository.find({
                relations: ["vendorJobs"]
            });
        });
    }

    async getOne(id: string) {
        return await RedisService.fetchWithCache(`vendors:detail:${id}`, 3600, async () => {
            const vendor = await this.vendorRepository.findOne({
                where: { id },
                relations: ["vendorJobs", "vendorJobs.job"]
            });
            if (!vendor) throw new Error("Không tìm thấy nhà cung cấp");
            return vendor;
        });
    }

    async create(data: any) {
        validatePartnerData(data);
        const vendor = this.vendorRepository.create(data);
        const saved = await this.vendorRepository.save(vendor);

        // Invalidate list cache
        await RedisService.deleteCache('vendors:all*');

        return saved;
    }

    async update(id: string, data: any) {
        validatePartnerData(data);
        const vendor = await this.getOne(id);
        Object.assign(vendor, data);
        const saved = await this.vendorRepository.save(vendor);

        // Invalidate caches
        await RedisService.deleteCache('vendors:all*');
        await RedisService.deleteCache(`vendors:detail:${id}*`);

        return saved;
    }

    async delete(id: string) {
        const vendor = await this.getOne(id);
        await this.vendorRepository.remove(vendor);

        // Invalidate caches
        await RedisService.deleteCache('vendors:all*');
        await RedisService.deleteCache(`vendors:detail:${id}*`);

        return { message: "Xóa nhà cung cấp thành công" };
    }

    // VendorJob Management
    async addJob(vendorId: string, jobId: string, priceData: { price: number, note?: string }) {
        const vendor = await this.getOne(vendorId);
        const jobRepository = AppDataSource.getRepository(Jobs);
        const job = await jobRepository.findOneBy({ id: jobId });

        if (!job) throw new Error("Không tìm thấy công việc (Job)");

        let vendorJob = await this.vendorJobRepository.findOne({
            where: { vendor: { id: vendorId }, job: { id: jobId } }
        });

        if (vendorJob) {
            Object.assign(vendorJob, priceData);
        } else {
            vendorJob = this.vendorJobRepository.create({
                vendor,
                job,
                ...priceData
            });
        }

        const saved = await this.vendorJobRepository.save(vendorJob);

        // Invalidate and detail
        await RedisService.deleteCache('vendors:all*');
        await RedisService.deleteCache(`vendors:detail:${vendorId}*`);

        return saved;
    }

    async removeJob(vendorId: string, jobId: string) {
        const vendorJob = await this.vendorJobRepository.findOne({
            where: { vendor: { id: vendorId }, job: { id: jobId } }
        });
        if (!vendorJob) throw new Error("Nhà cung cấp này chưa được gán công việc này");

        await this.vendorJobRepository.remove(vendorJob);

        // Invalidate
        await RedisService.deleteCache('vendors:all*');
        await RedisService.deleteCache(`vendors:detail:${vendorId}*`);

        return { message: "Đã xóa công việc khỏi nhà cung cấp" };
    }

    async getJobs(vendorId: string) {
        return await this.vendorJobRepository.find({
            where: { vendor: { id: vendorId } },
            relations: ["job"]
        });
    }

    async getByJob(jobId: string) {
        const vendorJobs = await this.vendorJobRepository.find({
            where: { job: { id: jobId } },
            relations: ["vendor"]
        });
        // Map to return unique vendors
        return vendorJobs.map(vj => vj.vendor);
    }
}
