import { AppDataSource } from "../../../data-source";
import { AiProviders } from "../entities/AiProvider.entity";
import { ILike } from "typeorm";

export class AiProviderService {
    private providerRepository = AppDataSource.getRepository(AiProviders);

    async getAll(filters: { code?: string; name?: string; isActive?: boolean } = {}) {
        const query: any = { relations: ["models"] };
        const where: any = {};

        if (filters.code) where.code = ILike(`%${filters.code}%`);
        if (filters.name) where.name = ILike(`%${filters.name}%`);
        if (filters.isActive !== undefined) where.isActive = filters.isActive;

        if (Object.keys(where).length) query.where = where;

        return await this.providerRepository.find(query);
    }

    async getOne(id: string) {
        const provider = await this.providerRepository.findOne({
            where: { id },
            relations: ["models"]
        });
        if (!provider) throw new Error("Không tìm thấy provider");
        return provider;
    }
}