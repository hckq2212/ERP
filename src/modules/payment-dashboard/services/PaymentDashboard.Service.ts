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

        const contractsInYear = contracts.filter(contract => this.contractBelongsToYear(contract, year));
        const normalized = contractsInYear.map(contract => this.toRow(contract, year));
        const search = (query.search || "").trim().toLocaleLowerCase("vi");
        const baseFiltered = normalized.filter(row => {
            if (search && ![row.contractCode, row.contractName, row.customerName, row.projectName]
                .some(value => String(value || "").toLocaleLowerCase("vi").includes(search))) return false;
            if (query.contractStatus && row.contractStatus !== query.contractStatus) return false;
            if (query.quotationStatus && row.quotationStatus !== query.quotationStatus) return false;
            if (query.projectStatus && row.projectStatus !== query.projectStatus) return false;
            if (query.salesOwnerId && row.salesOwner?.id !== query.salesOwnerId) return false;
            if (query.customerId && row.customerId !== query.customerId) return false;
            if (query.projectManagerId && row.projectManagerId !== query.projectManagerId) return false;
            if (query.paymentMonth) {
                const targetMonth = Number(query.paymentMonth);
                const hasMilestoneInMonth = row.milestones.some((m: any) => {
                    if (!m.dueDate) return false;
                    const d = new Date(m.dueDate);
                    return d.getMonth() + 1 === targetMonth && (!year || d.getFullYear() === year);
                });
                if (!hasMilestoneInMonth) return false;
            }
            return true;
        });

        const tabCounts = {
            all: baseFiltered.length,
            waiting: baseFiltered.filter(row => row.paymentStatus !== "PAID" && row.contractStatus !== ContractStatus.CANCELLED).length,
            paid: baseFiltered.filter(row => row.paymentStatus === "PAID").length,
            unconfirmed: baseFiltered.filter(row => !row.isConfirmed).length
        };

        const filtered = baseFiltered.filter(row => {
            if (query.paymentStatus === "WAITING" && row.paymentStatus === "PAID") return false;
            if (query.paymentStatus && query.paymentStatus !== "WAITING" && row.paymentStatus !== query.paymentStatus) return false;
            if (query.confirmationStatus === "UNCONFIRMED" && row.isConfirmed) return false;
            return true;
        });

        const active = filtered.filter(row => row.contractStatus !== ContractStatus.CANCELLED);
        const totalContractValue = active.reduce((sum, row) => sum + row.totalWithVat, 0);
        const totalPaid = active.reduce((sum, row) => sum + row.paidAmount, 0);
        const totalUnpaid = active.reduce((sum, row) => sum + row.unpaidAmount, 0);
        const targetMonth = query.paymentMonth ? Number(query.paymentMonth) : null;

        const monthly = Array.from({ length: 12 }, (_, index) => {
            const milestonesInMonth = active.flatMap(row => row.milestones)
                .filter((item: any) => {
                    if (!item.dueDate) return false;
                    const dueM = new Date(item.dueDate).getMonth();
                    if (targetMonth !== null) {
                        return dueM === targetMonth - 1 && index === targetMonth - 1;
                    }
                    return dueM === index;
                });

            const planned = milestonesInMonth.reduce((itemSum: number, item: any) => itemSum + item.amount, 0);
            const unpaid = milestonesInMonth.reduce((itemSum: number, item: any) => itemSum + item.unpaidAmount, 0);
            const milestonePaid = milestonesInMonth.reduce((itemSum: number, item: any) => itemSum + item.paidAmount, 0);

            // Các khoản tiền thực thu diễn ra trong tháng index này:
            // Khi có targetMonth: CHỈ lấy các payment thanh toán cho các mốc thuộc kỳ targetMonth!
            const paymentsInMonth = active.flatMap(row => row.milestones.flatMap((m: any) => {
                if (targetMonth !== null) {
                    const dueM = m.dueDate ? new Date(m.dueDate).getMonth() : null;
                    if (dueM !== targetMonth - 1) return []; // Không tính payment của mốc tháng khác
                }
                return m.payments || [];
            })).filter((payment: any) => payment.paymentDate && new Date(payment.paymentDate).getMonth() === index);

            const cashPaid = paymentsInMonth.reduce((paymentSum: number, payment: any) => paymentSum + payment.amount, 0);
            const paid = milestonePaid > 0 ? milestonePaid : cashPaid;

            // Phân bổ dòng tiền thu:
            // 1. Đúng kỳ: dueDate thuộc tháng index
            // 2. Nợ cũ: dueDate < tháng index
            // 3. Thu trước: dueDate > tháng index
            const onTimePayments = paymentsInMonth.filter((p: any) => !p.dueDate || new Date(p.dueDate).getMonth() === index);
            const overduePayments = paymentsInMonth.filter((p: any) => p.dueDate && new Date(p.dueDate).getMonth() < index);
            const prepaidPayments = paymentsInMonth.filter((p: any) => p.dueDate && new Date(p.dueDate).getMonth() > index);

            const onTime = onTimePayments.reduce((s: number, p: any) => s + p.amount, 0);
            const overdue = overduePayments.reduce((s: number, p: any) => s + p.amount, 0);
            const prepaid = prepaidPayments.reduce((s: number, p: any) => s + p.amount, 0);

            const details = paymentsInMonth.map((p: any) => {
                const dueMonth = p.dueDate ? new Date(p.dueDate).getMonth() : index;
                const type = dueMonth === index ? 'ON_TIME' : (dueMonth < index ? 'OVERDUE' : 'PREPAID');
                return {
                    id: p.id,
                    amount: p.amount,
                    paymentDate: p.paymentDate,
                    dueDate: p.dueDate,
                    dueMonth: dueMonth + 1,
                    type,
                    projectName: p.projectName,
                    customerName: p.customerName,
                    contractCode: p.contractCode,
                    milestoneName: p.milestoneName
                };
            });

            return {
                month: index + 1,
                planned,
                paid,
                unpaid,
                cashPaid,
                milestonePaid,
                breakdown: {
                    total: cashPaid,
                    onTime,
                    overdue,
                    prepaid,
                    details
                }
            };
        });

        const start = (page - 1) * limit;
        return {
            year,
            summary: {
                totalContractValue,
                totalPaid,
                totalUnpaid,
                collectionRate: totalContractValue > 0 ? totalPaid / totalContractValue * 100 : 0,
                trackingContracts: active.length,
                totalContracts: filtered.length,
                cancelledContracts: filtered.length - active.length
            },
            monthly,
            tabCounts,
            rows: filtered.slice(start, start + limit),
            meta: { page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) },
            filterOptions: {
                salesOwners: Array.from(new Map(normalized.filter(row => row.salesOwner).map(row => [row.salesOwner!.id, row.salesOwner])).values()),
                customers: Array.from(new Map(normalized.filter(row => row.customerId).map(row => [row.customerId, { id: row.customerId, name: row.customerName }])).values()),
                projectManagers: Array.from(new Map(normalized.filter(row => row.projectManagerId).map(row => [row.projectManagerId, { id: row.projectManagerId, name: row.projectManager }])).values())
            }
        };
    }

    private contractBelongsToYear(contract: Contracts, year: number): boolean {
        const milestones = contract.milestones || [];
        // 1. Có mốc thanh toán đến hạn trong năm này
        const hasDueMilestone = milestones.some(m => m.dueDate && dateYear(m.dueDate) === year);
        if (hasDueMilestone) return true;

        // 2. Có khoản thanh toán thực tế phát sinh trong năm này
        const hasPaymentInYear = milestones.some(m =>
            (m.debt?.payments || []).some(p => p.paymentDate && dateYear(p.paymentDate) === year)
        );
        if (hasPaymentInYear) return true;

        // 3. Nếu chưa có mốc có dueDate: kiểm tra ngày tạo hợp đồng hoặc ngày triển khai dự án
        const hasMilestonesWithDueDate = milestones.some(m => Boolean(m.dueDate));
        if (!hasMilestonesWithDueDate) {
            if (dateYear(contract.createdAt) === year) return true;
            if (contract.project?.plannedStartDate && dateYear(contract.project.plannedStartDate) === year) return true;
            if (contract.project?.actualStartDate && dateYear(contract.project.actualStartDate) === year) return true;
        }

        return false;
    }

    private toRow(contract: Contracts, year: number) {
        const quotations = [...(contract.opportunity?.quotations || [])]
            .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
        const quotation = quotations.find(item => item.status === QuotationStatus.APPROVED) || quotations[0];
        const milestones = (contract.milestones || [])
            .filter(item => item.dueDate ? dateYear(item.dueDate) === year : dateYear(contract.createdAt) === year)
            .map(item => {
                const payments = (item.debt?.payments || [])
                    .filter(payment => dateYear(payment.paymentDate) === year)
                    .map(payment => ({
                        id: payment.id,
                        amount: money(payment.amount),
                        paymentDate: payment.paymentDate,
                        note: payment.note || null,
                        attachments: payment.attachments || [],
                        milestoneName: item.name,
                        dueDate: item.dueDate,
                        projectName: contract.project?.name || contract.opportunity?.name || contract.name,
                        customerName: contract.customer?.name || "",
                        contractCode: contract.contractCode
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
            collectionMonth: milestones.find(item => item.unpaidAmount > 0)?.dueDate
                || milestones[milestones.length - 1]?.dueDate
                || null,
            latestPaymentDate,
            contractFileUrl: contract.signed_contract || contract.proposal_contract || null,
            note: contract.description || "",
            milestones,
            acceptanceMinutes: contract.acceptanceMinutes || [],
            vatInvoices: contract.vatInvoices || []
        };
    }
}
