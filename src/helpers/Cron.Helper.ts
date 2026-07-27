import cron from 'node-cron';
import { AppDataSource } from '../data-source';
import { Tasks } from '../entity/Task.entity';
import { TaskStatus } from '../entity/Enums';
import { Debts, DebtStatus } from '../entity/Debt.entity';
import { Accounts } from '../entity/Account.entity';
import { AccountVinicoinBalances } from '../entity/AccountVinicoinBalance.entity';
import { VinicoinTransactions, VinicoinTransactionType } from '../entity/VinicoinTransaction.entity';
import { LessThan, MoreThan, In } from 'typeorm';
import { ulid } from 'ulid';

export class CronHelper {
    static init() {
        cron.schedule('*/30 * * * *', async () => {
            console.log('[Cron] Checking for overdue tasks at', new Date().toLocaleString());
            try {
                const taskRepository = AppDataSource.getRepository(Tasks);
                const now = new Date();

                const activeStatuses = [
                    TaskStatus.PENDING,
                    TaskStatus.DOING,
                    TaskStatus.REWORKING,
                    TaskStatus.AWAITING_PRICING,
                    TaskStatus.AWAITING_SUPPORT,
                    TaskStatus.SUPPORT_PENDING
                ];

                const result = await taskRepository.update(
                    {
                        status: In(activeStatuses),
                        plannedEndDate: LessThan(now)
                    },
                    {
                        status: TaskStatus.OVERDUE
                    }
                );

                if (result.affected && result.affected > 0) {
                    console.log(`[Cron] Found and updated ${result.affected} tasks to OVERDUE.`);
                }
            } catch (error) {
                console.error('[Cron] Error in overdue tasks check:', error);
            }
        });

        cron.schedule('0 * * * *', async () => {
            console.log('[Cron] Checking for overdue debts at', new Date().toLocaleString());
            try {
                const debtRepository = AppDataSource.getRepository(Debts);
                const now = new Date();

                const activeDebtStatuses = [
                    DebtStatus.UNPAID,
                    DebtStatus.PARTIAL
                ];

                const result = await debtRepository.update(
                    {
                        status: In(activeDebtStatuses),
                        dueDate: LessThan(now)
                    },
                    {
                        status: DebtStatus.OVERDUE
                    }
                );

                if (result.affected && result.affected > 0) {
                    console.log(`[Cron] Found and updated ${result.affected} debts to OVERDUE.`);
                }
            } catch (error) {
                console.error('[Cron] Error in overdue debts check:', error);
            }
        });

        cron.schedule('0 0 1 * *', async () => {
            console.log('[Cron] Monthly Vinicoin reset started at', new Date().toLocaleString());
            try {
                const balanceRepository = AppDataSource.getRepository(AccountVinicoinBalances);
                const periodParts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit'
                }).formatToParts(new Date());
                const year = periodParts.find(part => part.type === 'year')?.value;
                const month = periodParts.find(part => part.type === 'month')?.value;
                const period = `${year}-${month}`;

                const balancesToReset = await balanceRepository.find({
                    select: { id: true },
                    where: { vinicoin: MoreThan(0) }
                });

                if (balancesToReset.length === 0) {
                    console.log('[Cron] No balances with available vinicoin to reset.');
                    return;
                }

                let processedCount = 0;
                for (const candidate of balancesToReset) {
                    const processed = await AppDataSource.transaction(async (manager) => {
                        const balance = await manager.createQueryBuilder(AccountVinicoinBalances, 'balance')
                            .innerJoinAndSelect('balance.company', 'company')
                            .where('balance.id = :balanceId', { balanceId: candidate.id })
                            .setLock('pessimistic_write')
                            .getOne();
                        const amountToWithdraw = Number(balance?.vinicoin || 0);
                        if (!balance || amountToWithdraw <= 0) return false;

                        const companyId = balance.company?.id;
                        if (!companyId) return false;

                        const insertResult = await manager.createQueryBuilder()
                            .insert()
                            .into(VinicoinTransactions)
                            .values({
                                id: ulid(),
                                amount: amountToWithdraw,
                                account: { id: balance.accountId } as Accounts,
                                company: { id: companyId } as any,
                                balanceBefore: amountToWithdraw,
                                balanceAfter: 0,
                                type: VinicoinTransactionType.MONTHLY_WITHDRAWAL,
                                idempotencyKey: `MONTHLY_WITHDRAWAL:${companyId}:${balance.accountId}:${period}`,
                                description: `Tu dong rut Vinicoin dinh ky thang ${period}`
                            })
                            .orIgnore()
                            .returning(['id'])
                            .execute();
                        if (!Array.isArray(insertResult.raw) || insertResult.raw.length === 0) return false;

                        balance.vinicoin = 0;
                        balance.vinicoinWithdrawn = Number(balance.vinicoinWithdrawn || 0) + amountToWithdraw;
                        await manager.save(balance);
                        return true;
                    });
                    if (processed) processedCount += 1;
                }

                console.log(`[Cron] Monthly Vinicoin reset completed for ${processedCount} balances.`);
            } catch (error) {
                console.error('[Cron] Error in monthly Vinicoin reset:', error);
            }
        }, { timezone: 'Asia/Ho_Chi_Minh' });

        console.log('[Cron] Service initialized successfully.');
    }

    static async checkNow() {
        console.log('[Cron] Manual trigger: Checking for overdue tasks...');
        const taskRepository = AppDataSource.getRepository(Tasks);
        const now = new Date();
        const activeStatuses = [
            TaskStatus.PENDING,
            TaskStatus.DOING,
            TaskStatus.REWORKING,
            TaskStatus.AWAITING_PRICING,
            TaskStatus.AWAITING_SUPPORT,
            TaskStatus.SUPPORT_PENDING
        ];

        const result = await taskRepository.update(
            {
                status: In(activeStatuses),
                plannedEndDate: LessThan(now)
            },
            {
                status: TaskStatus.OVERDUE
            }
        );

        const debtRepository = AppDataSource.getRepository(Debts);
        const activeDebtStatuses = [DebtStatus.UNPAID, DebtStatus.PARTIAL];
        const debtResult = await debtRepository.update(
            {
                status: In(activeDebtStatuses),
                dueDate: LessThan(now)
            },
            {
                status: DebtStatus.OVERDUE
            }
        );

        console.log(`[Cron] Manual check: Updated ${result.affected || 0} tasks and ${debtResult.affected || 0} debts.`);
        return { tasks: result.affected || 0, debts: debtResult.affected || 0 };
    }
}
