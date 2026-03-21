import { AppDataSource } from "../data-source";
import { ServicePackages } from "../entity/ServicePackage.entity";
import { ServicePackageItems } from "../entity/ServicePackageItem.entity";
import { Services } from "../entity/Service.entity";
import { RedisService } from "./Redis.Service";

export class ServicePackageService {
    private packageRepository = AppDataSource.getRepository(ServicePackages);
    private itemRepository = AppDataSource.getRepository(ServicePackageItems);
    private serviceRepository = AppDataSource.getRepository(Services);

    async getAll() {
        return await RedisService.fetchWithCache('service-packages:all', 3600, async () => {
            return await this.packageRepository.find({
                relations: ["items", "items.service"],
                where: { isActive: true }
            });
        });
    }

    async getOne(id: string) {
        return await RedisService.fetchWithCache(`service-packages:detail:${id}`, 3600, async () => {
            const pkg = await this.packageRepository.findOne({
                where: { id },
                relations: ["items", "items.service"]
            });
            if (!pkg) throw new Error("Không tìm thấy gói dịch vụ");
            return pkg;
        });
    }

    async create(data: any) {
        const { name, description, items } = data;
        const pkg = this.packageRepository.create({ name, description });
        const savedPkg = await this.packageRepository.save(pkg);

        if (items && Array.isArray(items)) {
            for (const item of items) {
                const serviceItem = this.itemRepository.create({
                    package: savedPkg,
                    serviceId: item.serviceId,
                    defaultQuantity: item.defaultQuantity || 1
                });
                await this.itemRepository.save(serviceItem);
            }
        }
        
        await this.recalculatePackagePrice(savedPkg.id);

        // Invalidate list cache
        await RedisService.deleteCache('service-packages:all*');

        return await this.getOne(savedPkg.id);
    }

    async update(id: string, data: any) {
        const { name, description, items, isActive } = data;
        const pkg = await this.getOne(id);

        if (name !== undefined) pkg.name = name;
        if (description !== undefined) pkg.description = description;
        if (isActive !== undefined) pkg.isActive = isActive;

        await this.packageRepository.save(pkg);

        if (items && Array.isArray(items)) {
            // Re-sync items
            await this.itemRepository.delete({ package: { id } });
            for (const item of items) {
                const serviceItem = this.itemRepository.create({
                    package: pkg,
                    serviceId: item.serviceId,
                    defaultQuantity: item.defaultQuantity || 1
                });
                await this.itemRepository.save(serviceItem);
            }
        }

        await this.recalculatePackagePrice(id);

        // Invalidate caches
        await RedisService.deleteCache('service-packages:all*');
        await RedisService.deleteCache(`service-packages:detail:${id}*`);

        return await this.getOne(id);
    }

    async delete(id: string) {
        const pkg = await this.getOne(id);
        pkg.isActive = false;
        await this.packageRepository.save(pkg);

        // Invalidate caches
        await RedisService.deleteCache('service-packages:all*');
        await RedisService.deleteCache(`service-packages:detail:${id}*`);

        return { message: "Xóa gói dịch vụ thành công" };
    }

    private async recalculatePackagePrice(packageId: string) {
        const pkg = await this.packageRepository.findOne({
            where: { id: packageId },
            relations: ["items", "items.service"]
        });

        if (!pkg) return;

        let totalPrice = 0;
        if (pkg.items) {
            totalPrice = pkg.items.reduce((sum, item) => {
                const servicePrice = Number(item.service?.costPrice || 0);
                return sum + (servicePrice * (item.defaultQuantity || 1));
            }, 0);
        }

        await this.packageRepository.update(packageId, { price: totalPrice });
        
        // Invalidate detail cache after price update
        await RedisService.deleteCache(`service-packages:detail:${packageId}*`);
    }
}
