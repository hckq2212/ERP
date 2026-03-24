import cron from 'node-cron';
import { AppDataSource } from '../data-source';
import { Tasks } from '../entity/Task.entity';
import { TaskStatus } from '../entity/Enums';
import { Debts, DebtStatus } from '../entity/Debt.entity';
import { LessThan, Not, In } from 'typeorm';

export class CronHelper {
    /**
     * Initializes all cron jobs for the application.
     */
    static init() {
        /**
         * Task Status Expiry Job
         * Runs every 30 minutes to check for tasks that have passed their deadline.
         */
        cron.schedule('*/30 * * * *', async () => {
            console.log('[Cron] Checking for overdue tasks at', new Date().toLocaleString());
            try {
                const taskRepository = AppDataSource.getRepository(Tasks);
                const now = new Date();

                // Statuses that represent "Work in Progress" or "Pending" 
                // and should be marked as OVERDUE if the deadline passes.
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

        /**
         * Debt Status Expiry Job
         * Runs every hour to check for unpaid debts that have passed their due date.
         */
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

        console.log('[Cron] Service initialized successfully.');
    }

    /**
     * Manual trigger for testing or one-off cleanup
     */
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
        
        // Debt check
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
