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

        // 3. Sale Data (Opportunities, Customers, Projects, Debts)
        if (role === UserRole.BD) {
            const [myOpportunities, myCustomers, myContracts] = await Promise.all([
                this.opportunityRepo.find({ where: { createdBy: { id: userId } } }),
                this.customerRepo.count({ where: { createdBy: { id: userId } } }),
                this.contractRepo.find({
                    where: [
                        { customer: { createdBy: { id: userId } } },
                        { opportunity: { createdBy: { id: userId } } }
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
                // Calculate debt for this contract
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

                // Add associated project if not already processed
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

            // Sort and take top 5
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
            if (t.status === TaskStatus.ACCEPTED && t.actualEndDate) {
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
