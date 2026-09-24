import { AppDataSource } from "../../data-source";
import { ContractAddendums } from "../../modules/contract-addendum/entities/ContractAddendum.entity";
import { Contracts } from "../../modules/contract/entities/Contract.entity";
import { PaymentMilestones } from "../../modules/payment-milestone/entities/PaymentMilestone.entity";
import { Quotations } from "../../modules/quotation/entities/Quotation.entity";
import { Debts } from "../../modules/debt/entities/Debt.entity";
import { calculatePricingTotals } from "../helpers/PricingTax.helper";

/** Idempotent reconciliation for rows created before VAT totals were stored. */
export class PricingBackfillService {
    static async run() {
        await AppDataSource.transaction(async manager => {
            const contractRepo = manager.getRepository(Contracts);
            const quotationRepo = manager.getRepository(Quotations);
            const addendumRepo = manager.getRepository(ContractAddendums);
            const milestoneRepo = manager.getRepository(PaymentMilestones);
            const debtRepo = manager.getRepository(Debts);

            const contracts = await contractRepo.createQueryBuilder("contract")
                .leftJoinAndSelect("contract.milestones", "milestone")
                .leftJoinAndSelect("milestone.debt", "debt")
                .where("contract.totalWithVat = 0")
                .andWhere("contract.sellingPrice <> 0")
                .getMany();
            for (const contract of contracts) {
                Object.assign(contract, calculatePricingTotals(contract.sellingPrice, 8));
                for (const milestone of contract.milestones || []) {
                    milestone.amount = Number(milestone.amount) * 1.08;
                    if (milestone.debt) {
                        milestone.debt.amount = Number(milestone.debt.amount) * 1.08;
                        await debtRepo.save(milestone.debt);
                    }
                }
                await milestoneRepo.save(contract.milestones || []);
                await contractRepo.save(contract);
            }

            const quotations = await quotationRepo.createQueryBuilder("quotation")
                .where("quotation.totalWithVat = 0")
                .andWhere("quotation.totalAmount <> 0")
                .getMany();
            for (const quotation of quotations) {
                Object.assign(quotation, calculatePricingTotals(quotation.totalAmount, 8));
            }
            await quotationRepo.save(quotations);

            const addendums = await addendumRepo.createQueryBuilder("addendum")
                .where("addendum.totalWithVat = 0")
                .andWhere("addendum.sellingPrice <> 0")
                .getMany();
            for (const addendum of addendums) {
                Object.assign(addendum, calculatePricingTotals(addendum.sellingPrice, 8));
            }
            await addendumRepo.save(addendums);
        });
    }
}
