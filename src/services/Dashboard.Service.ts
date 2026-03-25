import { AppDataSource } from "../data-source";
import { Contracts, ContractStatus } from "../entity/Contract.entity";
import { Customers } from "../entity/Customer.entity";
import { Debts, DebtStatus } from "../entity/Debt.entity";
import { Projects, ProjectStatus } from "../entity/Project.entity";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus } from "../entity/Enums";
import { Opportunities, OpportunityStatus } from "../entity/Opportunity.entity";
import { UserRole } from "../entity/Account.entity";
import { Between, In, LessThanOrEqual } from "typeorm";

export class DashboardService {
    private contractRepo = AppDataSource.getRepository(Contracts);
    private customerRepo = AppDataSource.getRepository(Customers);
    private debtRepo = AppDataSource.getRepository(Debts);
    private projectRepo = AppDataSource.getRepository(Projects);
    private taskRepo = AppDataSource.getRepository(Tasks);
    private opportunityRepo = AppDataSource.getRepository(Opportunities);

    async getDashboardData(userId: string, role: UserRole) {
        const data: any = {};

        // 1. BOD/ADMIN Data
        if (role === UserRole.BOD || role === UserRole.ADMIN) {
            data.admin = await this.getAdminMetrics();
        }

        // 2. Team Lead Data (Projects where user is TL)
        const ledProjects = await this.projectRepo.find({
            where: { team: { teamLead: { id: userId } } },
            relations: ["tasks"]
        });

        if (ledProjects.length > 0) {
            data.teamLead = ledProjects.map(p => {
                const totalTasks = p.tasks.length;
                const completedTasks = p.tasks.filter(t => t.status === TaskStatus.COMPLETED).length;
                return {
                    id: p.id,
                    name: p.name,
                    status: p.status,
                    taskCount: totalTasks,
                    completedTaskCount: completedTasks,
                    progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
                };
            });
        }

        // 3. Sale Data (Opportunities created by user)
        const myOpportunities = await this.opportunityRepo.find({
            where: { createdBy: { id: userId } }
        });

        if (myOpportunities.length > 0 || role === UserRole.SALE) {
            const statusCounts = myOpportunities.reduce((acc: any, opp) => {
                acc[opp.status] = (acc[opp.status] || 0) + 1;
                return acc;
            }, {});

            data.sale = {
                totalOpportunities: myOpportunities.length,
                totalExpectedRevenue: myOpportunities.reduce((sum, opp) => sum + parseFloat(opp.expectedRevenue as any), 0),
                statusCounts
            };
        }

        // 4. Member Data (Tasks assigned to user or where user is a helper)
        const myTasks = await this.taskRepo.find({
            where: [
                { assignee: { id: userId } },
                { helper: { id: userId } }
            ],
            relations: ["project", "assignee", "helper"],
            select: {
                id: true,
                name: true,
                status: true,
                plannedStartDate: true,
                plannedEndDate: true,
                project: {
                    id: true,
                    name: true,
                    status: true
                }
            },
            order: { plannedEndDate: "ASC" }
        });

        // Get Account for Vinicoin
        const userWithAccount = await AppDataSource.getRepository("Users").findOne({
            where: { id: userId },
            relations: ["account"]
        }) as any;

        const vinicoin = userWithAccount?.account?.vinicoin || 0;

        // Participating Projects
        const projectMap = new Map();
        myTasks.forEach(t => {
            if (t.project && !projectMap.has(t.project.id)) {
                projectMap.set(t.project.id, {
                    id: t.project.id,
                    name: t.project.name,
                    status: t.project.status
                });
            }
        });
        const participatingProjects = Array.from(projectMap.values()).filter(p =>
            [ProjectStatus.PENDING_CONFIRMATION, ProjectStatus.CONFIRMED, ProjectStatus.IN_PROGRESS].includes(p.status)
        );

        // Monthly Stats (Completed tasks this year)
        const currentYear = new Date().getFullYear();
        const completionStats = Array(12).fill(0);
        myTasks.forEach(t => {
            if (t.status === TaskStatus.COMPLETED && t.actualEndDate) {
                const date = new Date(t.actualEndDate);
                if (date.getFullYear() === currentYear) {
                    completionStats[date.getMonth()]++;
                }
            }
        });

        data.member = {
            vinicoin,
            totalTasks: myTasks.length,
            pendingCount: myTasks.filter(t => t.status === TaskStatus.PENDING).length,
            doingCount: myTasks.filter(t => t.status === TaskStatus.DOING).length,
            completedCount: myTasks.filter(t => t.status === TaskStatus.COMPLETED || t.status === TaskStatus.DONE || t.status === TaskStatus.ACCEPTED).length,
            participatingProjects,
            upcomingDeadlines: myTasks
                .filter(t => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.DONE && t.status !== TaskStatus.ACCEPTED && t.plannedEndDate)
                .slice(0, 10)
                .map(t => ({
                    id: t.id,
                    name: t.name,
                    deadline: t.plannedEndDate,
                    status: t.status,
                    projectName: t.project?.name,
                    code: t.code
                })),
            calendarTasks: myTasks
                .filter(t => t.plannedStartDate || t.plannedEndDate)
                .map(t => ({
                    id: t.id,
                    name: t.name,
                    start: t.plannedStartDate,
                    end: t.plannedEndDate,
                    status: t.status
                })),
            completionStats: completionStats.map((count, index) => ({
                month: index + 1,
                count
            }))
        };

        return data;
    }

    private async getAdminMetrics() {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [totalCustomers, newCustomers] = await Promise.all([
            this.customerRepo.count(),
            this.customerRepo.count({ where: { createdAt: Between(thirtyDaysAgo, new Date()) } as any })
        ]);

        const signedContracts = await this.contractRepo.find({
            where: { status: In([ContractStatus.SIGNED, ContractStatus.COMPLETED]) }
        });

        const totalRevenue = signedContracts.reduce((sum, c) => sum + parseFloat(c.sellingPrice as any), 0);

        const unpaidDebts = await this.debtRepo.find({
            where: { status: In([DebtStatus.UNPAID, DebtStatus.PARTIAL]) }
        });

        const totalDebt = unpaidDebts.reduce((sum, d) => sum + parseFloat(d.amount as any), 0);

        return {
            totalCustomers,
            newCustomers,
            totalRevenue,
            totalDebt
        };
    }
}
