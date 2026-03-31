import { AppDataSource } from "../data-source";
import { Contracts, ContractStatus } from "../entity/Contract.entity";
import { Customers } from "../entity/Customer.entity";
import { Debts, DebtStatus } from "../entity/Debt.entity";
import { Projects, ProjectStatus } from "../entity/Project.entity";
import { ContractServiceStatus } from "../entity/ContractService.entity";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus } from "../entity/Enums";
import { Opportunities, OpportunityStatus } from "../entity/Opportunity.entity";
import { UserRole } from "../entity/Account.entity";
import { Between, In, LessThanOrEqual, Not } from "typeorm";
import { Violations } from "../entity/Violation.entity";

export class DashboardService {
    private contractRepo = AppDataSource.getRepository(Contracts);
    private customerRepo = AppDataSource.getRepository(Customers);
    private debtRepo = AppDataSource.getRepository(Debts);
    private projectRepo = AppDataSource.getRepository(Projects);
    private taskRepo = AppDataSource.getRepository(Tasks);
    private opportunityRepo = AppDataSource.getRepository(Opportunities);

    async getDashboardData(userId: string, role: UserRole, month?: number, year?: number) {
        const data: any = {};
        const dateFilter = this.getDateFilter(month, year);

        // 1. BOD/ADMIN Data
        if (role === UserRole.BOD || role === UserRole.ADMIN) {
            data.admin = await this.getAdminMetrics(dateFilter);
        }

        // 2. Team Lead Data
        const ledProjects = await this.projectRepo.find({
            where: {
                team: { teamLead: { id: userId } },
                status: Not(In([ProjectStatus.CANCELLED, ProjectStatus.COMPLETED])),
                ...(dateFilter && { createdAt: dateFilter })
            },
            relations: ["contract", "contract.services"]
        });

        if (ledProjects.length > 0) {
            data.teamLead = ledProjects.map(p => {
                const services = p.contract?.services || [];
                const totalServices = services.length;
                const completedServices = services.filter(s => s.status === ContractServiceStatus.COMPLETED).length;
                return {
                    id: p.id,
                    name: p.name,
                    status: p.status,
                    serviceCount: totalServices,
                    completedServiceCount: completedServices,
                    progress: totalServices > 0 ? Math.round((completedServices / totalServices) * 100) : 0
                };
            });
        }

        // 3. Sale Data
        if (role === UserRole.BD || role === UserRole.SALE) {
            const [myOpportunities, myCustomers, myContracts] = await Promise.all([
                this.opportunityRepo.find({
                    where: {
                        createdBy: { id: userId },
                        ...(dateFilter && { createdAt: dateFilter })
                    }
                }),
                this.customerRepo.count({
                    where: {
                        createdBy: { id: userId },
                        ...(dateFilter && { createdAt: dateFilter })
                    }
                }),
                this.contractRepo.find({
                    where: [
                        { customer: { createdBy: { id: userId } }, ...(dateFilter && { createdAt: dateFilter }) },
                        { opportunity: { createdBy: { id: userId } }, ...(dateFilter && { createdAt: dateFilter }) }
                    ],
                    relations: ["debts", "debts.payments", "project", "customer"]
                })
            ]);

            const statusCounts = myOpportunities.reduce((acc: any, opp) => {
                acc[opp.status] = (acc[opp.status] || 0) + 1;
                return acc;
            }, {});

            let totalDebt = 0;
            const upcomingDebts: any[] = [];
            const saleProjects: any[] = [];
            const processedProjectIds = new Set();

            myContracts.forEach(contract => {
                contract.debts?.forEach(debt => {
                    const paidAmount = debt.payments?.reduce((sum, p) => sum + parseFloat(p.amount as any), 0) || 0;
                    const remaining = parseFloat(debt.amount as any) - paidAmount;
                    if (remaining > 0 && debt.status !== DebtStatus.PAID) {
                        totalDebt += remaining;
                        upcomingDebts.push({
                            id: debt.id,
                            name: debt.name,
                            amount: debt.amount,
                            remaining: remaining,
                            dueDate: debt.dueDate,
                            customerName: contract.customer?.name,
                            contractCode: contract.contractCode
                        });
                    }
                });

                if (contract.project && !processedProjectIds.has(contract.project.id)) {
                    processedProjectIds.add(contract.project.id);
                    saleProjects.push({
                        id: contract.project.id,
                        name: contract.project.name,
                        status: contract.project.status,
                        customerName: contract.customer?.name
                    });
                }
            });

            const sortedDebts = upcomingDebts
                .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                .slice(0, 5);

            data.sale = {
                totalOpportunities: myOpportunities.length,
                totalExpectedRevenue: myOpportunities.reduce((sum, opp) => sum + parseFloat(opp.expectedRevenue as any), 0),
                statusCounts,
                totalCustomers: myCustomers,
                totalDebt,
                upcomingDebts: sortedDebts,
                projects: saleProjects
            };
        }

        // 4. Member Data
        const myTasks = await this.taskRepo.find({
            where: [
                { assignee: { id: userId }, ...(dateFilter && { plannedEndDate: dateFilter }) },
                { helper: { id: userId }, ...(dateFilter && { plannedEndDate: dateFilter }) }
            ],
            relations: ["project", "assignee", "helper"],
            select: {
                id: true,
                name: true,
                status: true,
                code: true,
                plannedStartDate: true,
                plannedEndDate: true,
                project: {
                    id: true,
                    name: true,
                    status: true
                }
            },
            order: { plannedEndDate: "DESC" }
        });

        const userWithAccount = await AppDataSource.getRepository("Users").findOne({
            where: { id: userId },
            relations: ["account"]
        }) as any;

        const vinicoin = userWithAccount?.account?.vinicoin || 0;
        const vinicoinTotal = userWithAccount?.account?.vinicoinTotal || 0;
        const vinicoinWithdrawn = userWithAccount?.account?.vinicoinWithdrawn || 0;

        const violations = await AppDataSource.getRepository(Violations).find({
            where: {
                userId,
                ...(dateFilter && { createdAt: dateFilter })
            },
            select: { id: true, type: true, createdAt: true }
        });

        const violationStats = violations.reduce((acc: any, v) => {
            acc[v.type] = (acc[v.type] || 0) + 1;
            return acc;
        }, {});

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

        // Chart Stats (Still using yearly context if year provided, otherwise current year)
        const chartYear = year || new Date().getFullYear();
        const completionStats = Array(12).fill(0);

        // We query all tasks for the chart year to show the trend
        const allTasksForChart = await this.taskRepo.find({
            where: [
                { assignee: { id: userId }, plannedEndDate: Between(new Date(`${chartYear}-01-01`), new Date(`${chartYear}-12-31`)) },
                { helper: { id: userId }, plannedEndDate: Between(new Date(`${chartYear}-01-01`), new Date(`${chartYear}-12-31`)) }
            ],
            select: { status: true, actualEndDate: true }
        });

        allTasksForChart.forEach(t => {
            if (t.status === TaskStatus.ACCEPTED && t.actualEndDate) {
                const date = new Date(t.actualEndDate);
                if (date.getFullYear() === chartYear) {
                    completionStats[date.getMonth()]++;
                }
            }
        });

        const statusCounts = myTasks.reduce((acc: any, t) => {
            acc[t.status] = (acc[t.status] || 0) + 1;
            return acc;
        }, {});

        data.member = {
            vinicoin,
            vinicoinTotal,
            vinicoinWithdrawn,
            totalTasks: myTasks.length,
            statusCounts,
            doingCount: (statusCounts[TaskStatus.DOING] || 0) + (statusCounts[TaskStatus.REWORKING] || 0) + (statusCounts[TaskStatus.REJECTED] || 0),
            reworkCount: (statusCounts[TaskStatus.REWORKING] || 0) + (statusCounts[TaskStatus.REJECTED] || 0),
            reworkTasks: myTasks
                .filter(t => t.status === TaskStatus.REWORKING || t.status === TaskStatus.REJECTED)
                .map(t => ({
                    id: t.id,
                    name: t.name,
                    projectName: t.project?.name,
                    code: t.code,
                    deadline: t.plannedEndDate
                })),
            completedCount: (statusCounts[TaskStatus.COMPLETED] || 0) + (statusCounts[TaskStatus.ACCEPTED] || 0),
            participatingProjects,
            upcomingDeadlines: myTasks
                .filter(t => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.INTERNAL_COMPLETED && t.status !== TaskStatus.ACCEPTED && t.plannedEndDate)
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
                    status: t.status,
                    code: t.code,
                    project: t.project
                })),
            completionStats: completionStats.map((count, index) => ({
                month: index + 1,
                count
            })),
            violationCount: violations.length,
            violationStats
        };

        return data;
    }

    private getDateFilter(month?: number, year?: number) {
        if (!year && !month) return null;

        let start: Date;
        let end: Date;

        if (year && month) {
            start = new Date(year, month - 1, 1);
            end = new Date(year, month, 0, 23, 59, 59, 999);
        } else if (year) {
            start = new Date(year, 0, 1);
            end = new Date(year, 11, 31, 23, 59, 59, 999);
        } else {
            // Only month provided (unlikely from UI but for safety)
            const currentYear = new Date().getFullYear();
            start = new Date(currentYear, month! - 1, 1);
            end = new Date(currentYear, month!, 0, 23, 59, 59, 999);
        }

        return Between(start, end);
    }

    private async getAdminMetrics(dateFilter: any | null) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [totalCustomers, newCustomers] = await Promise.all([
            this.customerRepo.count(dateFilter ? { where: { createdAt: dateFilter } as any } : {}),
            this.customerRepo.count({ where: { createdAt: Between(thirtyDaysAgo, new Date()) } as any })
        ]);

        const signedContracts = await this.contractRepo.find({
            where: {
                status: In([ContractStatus.SIGNED, ContractStatus.COMPLETED]),
                ...(dateFilter && { createdAt: dateFilter })
            }
        });

        const totalRevenue = signedContracts.reduce((sum, c) => sum + parseFloat(c.sellingPrice as any), 0);

        const unpaidDebts = await this.debtRepo.find({
            where: {
                status: In([DebtStatus.UNPAID, DebtStatus.PARTIAL]),
                ...(dateFilter && { createdAt: dateFilter })
            }
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
