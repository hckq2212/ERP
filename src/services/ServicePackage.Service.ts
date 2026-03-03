import { AppDataSource } from "../data-source";
import { ServicePackages } from "../entity/ServicePackage.entity";
import { ServicePackageItems } from "../entity/ServicePackageItem.entity";
import { Services } from "../entity/Service.entity";

export class ServicePackageService {
    private packageRepository = AppDataSource.getRepository(ServicePackages);
    private itemRepository = AppDataSource.getRepository(ServicePackageItems);
    private serviceRepository = AppDataSource.getRepository(Services);

    async getAll() {
        return await this.packageRepository.find({
            relations: ["items", "items.service"],
            where: { isActive: true }
        });
    }

    async getOne(id: string) {
        const pkg = await this.packageRepository.findOne({
            where: { id },
            relations: ["items", "items.service"]
        });
        if (!pkg) throw new Error("Không tìm thấy gói dịch vụ");
        return pkg;
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

        return await this.getOne(id);
    }

    async delete(id: string) {
        const pkg = await this.getOne(id);
        pkg.isActive = false;
        await this.packageRepository.save(pkg);
        return { message: "Xóa gói dịch vụ thành công" };
    }
}
