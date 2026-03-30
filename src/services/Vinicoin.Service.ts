import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { VinicoinTransactions, VinicoinTransactionType } from "../entity/VinicoinTransaction.entity";
import { EntityManager } from "typeorm";

export class VinicoinService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private transactionRepository = AppDataSource.getRepository(VinicoinTransactions);

    /**
     * Rewards a user with vinicoins for a specific task.
     * Can be called within an existing transaction or use a new one.
     */
    async rewardForTask(
        accountId: string, 
        amount: number, 
        taskId: string, 
        serviceId: string, 
        manager?: EntityManager
    ) {
        if (!amount || amount <= 0) return;

        const repo = manager ? manager.getRepository(Accounts) : this.accountRepository;
        const txRepo = manager ? manager.getRepository(VinicoinTransactions) : this.transactionRepository;

        const account = await repo.findOneBy({ id: accountId });
        if (!account) return;

        // 1. Update account balance
        const rewardAmount = Number(amount);
        account.vinicoin = (account.vinicoin || 0) + rewardAmount;
        account.vinicoinTotal = (account.vinicoinTotal || 0) + rewardAmount;
        
        await (manager ? manager.save(account) : this.accountRepository.save(account));

        // 2. Create transaction record
        const transaction = txRepo.create({
            amount: Number(amount),
            account,
            relatedTaskId: taskId,
            relatedServiceId: serviceId,
            type: VinicoinTransactionType.REWARD,
            description: `Thưởng vinicoin cho task: ${taskId}`
        });
        await txRepo.save(transaction);
    }
}
