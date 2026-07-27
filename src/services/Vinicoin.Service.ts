import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { AccountVinicoinBalances } from "../entity/AccountVinicoinBalance.entity";
import { VinicoinTransactions, VinicoinTransactionType } from "../entity/VinicoinTransaction.entity";
import { EntityManager } from "typeorm";
import { ulid } from "ulid";
import { TenantContext } from "../context/TenantContext";

export class VinicoinService {
    private balanceRepository = AppDataSource.getRepository(AccountVinicoinBalances);
    private transactionRepository = AppDataSource.getRepository(VinicoinTransactions);

    private httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    private getCompanyId() {
        const company = TenantContext.getCompany();
        if (!company?.id) throw this.httpError("Thieu thong tin cong ty de xu ly Vinicoin", 403);
        return company.id;
    }

    async getBalance(accountId: string, manager?: EntityManager) {
        const companyId = this.getCompanyId();
        const repo = manager ? manager.getRepository(AccountVinicoinBalances) : this.balanceRepository;
        const balance = await repo.findOne({
            where: { accountId, company: { id: companyId } }
        });

        return {
            vinicoin: Number(balance?.vinicoin || 0),
            vinicoinTotal: Number(balance?.vinicoinTotal || 0),
            vinicoinWithdrawn: Number(balance?.vinicoinWithdrawn || 0)
        };
    }

    async getTransactions(accountId: string, filters: { page?: number, limit?: number } = {}) {
        const companyId = this.getCompanyId();
        const page = Math.max(Number(filters.page) || 1, 1);
        const limit = Math.min(Math.max(Number(filters.limit) || 10, 1), 50);

        const [items, total] = await this.transactionRepository.findAndCount({
            where: { account: { id: accountId }, company: { id: companyId } },
            order: { createdAt: "DESC" },
            skip: (page - 1) * limit,
            take: limit
        });

        return {
            data: items.map(item => ({
                id: item.id,
                amount: Number(item.amount || 0),
                type: item.type,
                description: item.description,
                relatedTaskId: item.relatedTaskId,
                relatedServiceId: item.relatedServiceId,
                balanceBefore: Number(item.balanceBefore || 0),
                balanceAfter: Number(item.balanceAfter || 0),
                createdAt: item.createdAt
            })),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    private async lockBalance(transactionalEntityManager: EntityManager, accountId: string, companyId: string) {
        await transactionalEntityManager
            .createQueryBuilder()
            .insert()
            .into(AccountVinicoinBalances)
            .values({
                id: ulid(),
                accountId,
                company: { id: companyId } as any,
                vinicoin: 0,
                vinicoinTotal: 0,
                vinicoinWithdrawn: 0
            })
            .orIgnore()
            .execute();

        const balance = await transactionalEntityManager
            .createQueryBuilder(AccountVinicoinBalances, "balance")
            .where("balance.accountId = :accountId", { accountId })
            .andWhere("balance.companyId = :companyId", { companyId })
            .setLock("pessimistic_write")
            .getOne();

        if (!balance) throw this.httpError("Khong the khoi tao so du Vinicoin", 500);
        return balance;
    }

    async rewardForTask(
        accountId: string,
        amount: number,
        taskId: string,
        serviceId: string,
        manager?: EntityManager
    ) {
        const rewardAmount = Number(amount);
        if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) return false;

        const companyId = this.getCompanyId();
        const applyReward = async (transactionalEntityManager: EntityManager) => {
            const account = await transactionalEntityManager
                .createQueryBuilder(Accounts, "account")
                .where("account.id = :accountId", { accountId })
                .setLock("pessimistic_write")
                .getOne();
            if (!account) return false;

            const balance = await this.lockBalance(transactionalEntityManager, accountId, companyId);
            const balanceBefore = Number(balance.vinicoin || 0);
            const balanceAfter = balanceBefore + rewardAmount;

            const insertResult = await transactionalEntityManager
                .createQueryBuilder()
                .insert()
                .into(VinicoinTransactions)
                .values({
                    id: ulid(),
                    amount: rewardAmount,
                    account: { id: accountId } as Accounts,
                    company: { id: companyId } as any,
                    balanceBefore,
                    balanceAfter,
                    relatedTaskId: taskId,
                    relatedServiceId: serviceId,
                    type: VinicoinTransactionType.REWARD,
                    idempotencyKey: `REWARD:${companyId}:${accountId}:${taskId}`,
                    description: `Thuong vinicoin cho task: ${taskId}`
                })
                .orIgnore()
                .returning(["id"])
                .execute();

            if (!Array.isArray(insertResult.raw) || insertResult.raw.length === 0) return false;

            balance.vinicoin = balanceAfter;
            balance.vinicoinTotal = Number(balance.vinicoinTotal || 0) + rewardAmount;
            await transactionalEntityManager.save(balance);
            return true;
        };

        return manager ? applyReward(manager) : AppDataSource.transaction(applyReward);
    }
}
