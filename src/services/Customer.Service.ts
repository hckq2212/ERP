import { AppDataSource } from "../data-source";
import { Customers } from "../entity/Customer.entity";

export class CustomerService {
    private customerRepository = AppDataSource.getRepository(Customers);

    async getAll() {
        return await this.customerRepository.find({
            relations: ["referralPartner"]
        });
    }

    async getOne(id: string) {
        const customer = await this.customerRepository.findOne({
            where: { id },
            relations: ["referralPartner", "contracts", "opportunities"]
        });
        if (!customer) throw new Error("Không tìm thấy khách hàng");
        return customer;
    }

    async create(data: any) {
        const customer = this.customerRepository.create(data);
        return await this.customerRepository.save(customer);
    }

    async update(id: string, data: any) {
        const customer = await this.getOne(id);
        Object.assign(customer, data);
        return await this.customerRepository.save(customer);
    }

    async delete(id: string) {
        const customer = await this.getOne(id);
        await this.customerRepository.remove(customer);
        return { message: "Xóa khách hàng thành công" };
    }
}
