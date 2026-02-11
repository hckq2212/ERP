import { AppDataSource } from "../data-source";
import { ContractAddendums, AddendumStatus } from "../entity/ContractAddendum.entity";
import { Contracts } from "../entity/Contract.entity";
import { ContractServices, ContractServiceStatus } from "../entity/ContractService.entity";
import { PaymentMilestones, MilestoneStatus } from "../entity/PaymentMilestone.entity";
import { Services } from "../entity/Service.entity";
import { DebtService } from "./Debt.Service";

export class ContractAddendumService {
    private addendumRepository = AppDataSource.getRepository(ContractAddendums);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private serviceRepository = AppDataSource.getRepository(Services);
    private debtService = new DebtService();

    async create(data: { contractId: string, name: string, description?: string }) {
        const contract = await this.contractRepository.findOneBy({ id: data.contractId });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        const addendum = this.addendumRepository.create({
            contract,
            name: data.name,
            description: data.description,
            status: AddendumStatus.DRAFT
        });

        return await this.addendumRepository.save(addendum);
    }

    async addItems(addendumId: string, data: { services: any[], milestones: any[] }) {
        const addendum = await this.addendumRepository.findOne({
            where: { id: addendumId },
            relations: ["contract"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        let totalSellingPrice = 0;
        let totalCost = 0;

        // 1. Process Services
        if (data.services) {
            for (const s of data.services) {
                const serviceDef = await this.serviceRepository.findOneBy({ id: s.serviceId });
                const addendumService = this.contractServiceRepository.create({
                    contract: addendum.contract,
                    addendum: addendum,
                    service: serviceDef,
                    sellingPrice: s.sellingPrice,
                    status: ContractServiceStatus.ACTIVE
                });
                await this.contractServiceRepository.save(addendumService);
                totalSellingPrice += Number(s.sellingPrice);
            }
        }

        // 2. Process Milestones
        if (data.milestones) {
            for (const m of data.milestones) {
                const milestone = this.milestoneRepository.create({
                    contract: addendum.contract,
                    addendum: addendum,
                    name: m.name,
                    percentage: m.percentage, // Percentage relative to addendum or manual amount? 
                    // Let's assume amount is provided directly for addendums for flexibility
                    amount: m.amount,
                    status: MilestoneStatus.PENDING,
                    dueDate: m.dueDate
                });
                await this.milestoneRepository.save(milestone);
            }
        }

        addendum.sellingPrice = totalSellingPrice;
        return await this.addendumRepository.save(addendum);
    }

    async uploadSigned(id: string, fileData: any) {
        const addendum = await this.addendumRepository.findOne({
            where: { id },
            relations: ["contract", "milestones", "services"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        addendum.signed_contract = fileData.url;
        addendum.status = AddendumStatus.SIGNED;

        // Update Contract Totals (Revenue and Cost)
        const contract = addendum.contract;
        contract.sellingPrice = Number(contract.sellingPrice) + Number(addendum.sellingPrice);
        contract.cost = Number(contract.cost || 0) + Number(addendum.cost || 0);
        await this.contractRepository.save(contract);

        // Activate Debts for addendum milestones
        for (const milestone of addendum.milestones) {
            await this.debtService.createFromMilestone(milestone.id);
        }

        return await this.addendumRepository.save(addendum);
    }

    async scaleDown(addendumId: string, data: { cancelServiceIds: string[], refundAmount: number }) {
        const addendum = await this.addendumRepository.findOne({
            where: { id: addendumId },
            relations: ["contract"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        // 1. Cancel services
        for (const sId of data.cancelServiceIds) {
            const contractService = await this.contractServiceRepository.findOneBy({ id: sId });
            if (contractService) {
                contractService.status = ContractServiceStatus.CANCELLED;
                await this.contractServiceRepository.save(contractService);
            }
        }

        // 2. Record the scale down amount (negative)
        addendum.sellingPrice = -Math.abs(data.refundAmount);
        addendum.name += " (Cắt giảm hạng mục)";

        return await this.addendumRepository.save(addendum);
    }
}
