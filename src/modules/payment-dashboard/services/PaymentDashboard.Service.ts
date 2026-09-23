import { AppDataSource } from "../../../data-source";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";
import { QuotationStatus } from "../../quotation/entities/Quotation.entity";
import { SecurityService } from "../../../shared/services/Security.Service";

const money = (value: unknown) => Number(value || 0);
const dateYear = (value?: Date | string | null) => value ? new Date(value).getFullYear() : null;

export type PaymentDashboardQuery = {
    year?: number;
    search?: string;
    contractStatus?: string;
    quotationStatus?: string;
    projectStatus?: string;
    paymentStatus?: string;
    confirmationStatus?: string;
    salesOwnerId?: string;
    customerId?: string;
    projectManagerId?: string;
    paymentMonth?: number;
    page?: number;
    limit?: number;
};

export class PaymentDashboardService {
    private contractRepository = AppDataSource.getRepository(Contracts);

    async getDashboard(query: PaymentDashboardQuery, actor: any) {
        const year = Number(query.year) || new Date().getFullYear();
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

        let where: any;
        try {
            where = SecurityService.getContractFilters(actor);
        } catch (error: any) {
            if (error.message === "FORBIDDEN_ACCESS") throw Object.assign(error, { statusCode: 403 });
            throw error;
        }

        const contracts = await this.contractRepository.find({
            where,
            relations: [
                "customer",
                "opportunity",
                "opportunity.createdBy",
                "opportunity.quotations",
                "project",
                "project.team",
                "project.team.teamLead",
                "project.team.members",
                "project.team.members.user",
                "project.team.members.roles",
                "milestones",
                "milestones.debt",
                "milestones.debt.payments",
                "acceptanceMinutes",
                "vatInvoices"
            ],
            order: { createdAt: "DESC" }
        });

        const normalized = contracts.map(contract => this.toRow(contract, year));
        const search = (query.search || "").trim().toLocaleLowerCase("vi");
        const filtered = normalized.filter(row => {
            if (search && ![row.contractCode, row.contractName, row.customerName, row.projectName]
                .some(value => String(value || "").toLocaleLowerCase("vi").includes(search))) return false;
            if (query.contractStatus && row.contractStatus !== query.contractStatus) return false;
            if (query.quotationStatus && row.quotationStatus !== query.quotationStatus) return false;
            if (query.projectStatus && row.projectStatus !== query.projectStatus) return false;
            if (query.paymentStatus === "WAITING" && row.paymentStatus === "PAID") return false;
            if (query.paymentStatus && query.paymentStatus !== "WAITING" && row.paymentStatus !== query.paymentStatus) return false;
            if (query.confirmationStatus === "UNCONFIRMED" && row.isConfirmed) return false;
            if (query.salesOwnerId && row.salesOwner?.id !== query.salesOwnerId) return false;
            if (query.customerId && row.customerId !== query.customerId) return false;
            if (query.projectManagerId && row.projectManagerId !== query.projectManagerId) return false;
            if (query.paymentMonth && (!row.collectionMonth || new Date(row.collectionMonth).getMonth() + 1 !== Number(query.paymentMonth))) return false;
            return true;
        });

        const active = filtered.filter(row => row.contractStatus !== ContractStatus.CANCELLED);
        const totalContractValue = active.reduce((sum, row) => sum + row.totalWithVat, 0);
        const totalPaid = active.reduce((sum, row) => sum + row.paidAmount, 0);
        const totalUnpaid = active.reduce((sum, row) => sum + row.unpaidAmount, 0);
        const monthly = Array.from({ length: 12 }, (_, index) => ({
            month: index + 1,
            planned: active.reduce((sum, row) => sum + row.milestones
                .filter((item: any) => item.dueDate && new Date(item.dueDate).getMonth() === index)
                .reduce((itemSum: number, item: any) => itemSum + item.amount, 0), 0),
            paid: active.reduce((sum, row) => sum + row.milestones
                .flatMap((item: any) => item.payments || [])
                .filter((payment: any) => payment.paymentDate && new Date(payment.paymentDate).getMonth() === index)
                .reduce((paymentSum: number, payment: any) => paymentSum + payment.amount, 0), 0)
        }));

        const start = (page - 1) * limit;
        return {
            year,
            summary: {
                totalContractValue,
                totalPaid,
                totalUnpaid,
                collectionRate: totalContractValue > 0 ? totalPaid / totalContractValue * 100 : 0,
                trackingContracts: active.filter(row => row.unpaidAmount > 0).length,
                totalContracts: filtered.length,
                cancelledContracts: filtered.length - active.length
            },
            monthly,
            tabCounts: {
                all: normalized.length,
                waiting: normalized.filter(row => row.paymentStatus !== "PAID" && row.contractStatus !== ContractStatus.CANCELLED).length,
                paid: normalized.filter(row => row.paymentStatus === "PAID").length,
                unconfirmed: normalized.filter(row => !row.isConfirmed).length
            },
            rows: filtered.slice(start, start + limit),
            meta: { page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) },
            filterOptions: {
                salesOwners: Array.from(new Map(normalized.filter(row => row.salesOwner).map(row => [row.salesOwner!.id, row.salesOwner])).values()),
                customers: Array.from(new Map(normalized.filter(row => row.customerId).map(row => [row.customerId, { id: row.customerId, name: row.customerName }])).values()),
                projectManagers: Array.from(new Map(normalized.filter(row => row.projectManagerId).map(row => [row.projectManagerId, { id: row.projectManagerId, name: row.projectManager }])).values())
            }
        };
    }

    private toRow(contract: Contracts, year: number) {
        const quotations = [...(contract.opportunity?.quotations || [])]
            .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
        const quotation = quotations.find(item => item.status === QuotationStatus.APPROVED) || quotations[0];
        const milestones = (contract.milestones || [])
            .filter(item => !item.dueDate || dateYear(item.dueDate) === year)
            .map(item => {
                const payments = (item.debt?.payments || [])
                    .filter(payment => dateYear(payment.paymentDate) === year)
                    .map(payment => ({
                        id: payment.id,
                        amount: money(payment.amount),
                        paymentDate: payment.paymentDate,
                        note: payment.note || null,
                        attachments: payment.attachments || []
                    }));
                const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
                return {
                    id: item.id,
                    name: item.name,
                    percentage: money(item.percentage),
                    amount: money(item.amount),
                    dueDate: item.dueDate,
                    status: item.status,
                    debtStatus: item.debt?.status || null,
                    debtId: item.debt?.id || null,
                    paidAmount,
                    unpaidAmount: Math.max(0, money(item.amount) - paidAmount),
                    payments
                };
            });
        const paidAmount = milestones.reduce((sum, item) => sum + item.paidAmount, 0);
        const scheduledAmount = milestones.reduce((sum, item) => sum + item.amount, 0);
        const totalWithVat = money(contract.totalWithVat) || money(contract.sellingPrice) * (1 + money(contract.vatRate || 8) / 100);
        const unpaidAmount = Math.max(0, scheduledAmount - paidAmount);
        const paymentStatus = scheduledAmount > 0 && unpaidAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";
        const isConfirmed = quotation?.status === QuotationStatus.APPROVED
            && [ContractStatus.PROPOSAL_APPROVED, ContractStatus.SIGNED, ContractStatus.COMPLETED].includes(contract.status);
        const teamMembers = contract.project?.team?.members || [];
        const memberByRole = (role: string) => teamMembers.find(member => member.roles?.some(item => item.role === role))?.user;
        const paymentDates = milestones.flatMap(item => item.payments.map(payment => payment.paymentDate)).filter(Boolean);
        const latestPaymentDate = paymentDates.length
            ? paymentDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
            : null;

        return {
            id: contract.id,
            contractCode: contract.contractCode,
            contractName: contract.name,
            contractStatus: contract.status,
            customerName: contract.customer?.name || "",
            customerId: contract.customer?.id || null,
            projectName: contract.project?.name || contract.opportunity?.name || "",
            quotationStatus: quotation?.status || null,
            quotationVersion: quotation?.version || null,
            projectStatus: contract.project?.status || null,
            salesOwner: contract.opportunity?.createdBy ? { id: contract.opportunity.createdBy.id, name: contract.opportunity.createdBy.fullName } : null,
            projectManager: memberByRole("PROJECT_MANAGER")?.fullName || contract.project?.team?.teamLead?.fullName || null,
            projectManagerId: memberByRole("PROJECT_MANAGER")?.id || contract.project?.team?.teamLead?.id || null,
            account: memberByRole("ACCOUNT")?.fullName || null,
            sellingPrice: money(contract.sellingPrice),
            vatRate: money(contract.vatRate || 8),
            vatAmount: money(contract.vatAmount) || money(contract.sellingPrice) * money(contract.vatRate || 8) / 100,
            totalWithVat,
            paidAmount,
            unpaidAmount,
            paymentStatus,
            isConfirmed,
            collectionMonth: milestones.find(item => item.unpaidAmount > 0)?.dueDate || null,
            latestPaymentDate,
            contractFileUrl: contract.signed_contract || contract.proposal_contract || null,
            note: contract.description || "",
            milestones,
            acceptanceMinutes: contract.acceptanceMinutes || [],
            vatInvoices: contract.vatInvoices || []
        };
    }
}
