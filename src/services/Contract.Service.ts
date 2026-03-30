import { AppDataSource } from "../data-source";
import { Contracts } from "../entity/Contract.entity";
import { Customers, CustomerSource } from "../entity/Customer.entity";
import { Opportunities, CustomerType, OpportunityStatus } from "../entity/Opportunity.entity";
import { ReferralPartners } from "../entity/ReferralPartner.entity";
import { Like } from "typeorm";
import { PaymentMilestones, MilestoneStatus } from "../entity/PaymentMilestone.entity";
import { ContractStatus } from "../entity/Contract.entity";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { ContractServices } from "../entity/ContractService.entity";
import { QuotationStatus } from "../entity/Quotation.entity";
import { ProjectService } from "./Project.Service";
import { DebtService } from "./Debt.Service";
import { NotificationService } from "./Notification.Service";
import { Users } from "../entity/User.entity";
import { UserRole } from "../entity/Account.entity";
import { RedisService } from "./Redis.Service";
import { contractEmitter, CONTRACT_EVENTS } from "../events/ContractEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../events/OpportunityEmitter";
import { SecurityService } from "./Security.Service";

export class ContractService {
    private contractRepository = AppDataSource.getRepository(Contracts);
    private customerRepository = AppDataSource.getRepository(Customers);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private oppServiceRepository = AppDataSource.getRepository(OpportunityServices);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private userRepository = AppDataSource.getRepository(Users);
    private projectService = new ProjectService();
    private debtService = new DebtService();
    private notificationService = new NotificationService();

    private async getManagementUsers() {
        return await AppDataSource.getRepository(Users).find({
            where: [
                { account: { role: UserRole.BOD } },
                { account: { role: UserRole.ADMIN } }
            ],
            relations: ["account"]
        });
    }

    private async notifyManagement(data: { title: string, content: string, contractId: string }) {
        const managers = await this.getManagementUsers();
        for (const manager of managers) {
            await this.notificationService.createNotification({
                ...data,
                type: "CONTRACT_UPDATE",
                recipient: manager,
                link: `/contracts/${data.contractId}`,
                relatedEntityId: data.contractId,
                relatedEntityType: "CONTRACT"
            });
        }
    }


    async getAll(filters: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        let rbacWhere: any = {};
        if (userInfo) {
            try {
                rbacWhere = SecurityService.getContractFilters(userInfo);
            } catch (error: any) {
                if (error.message === "FORBIDDEN_ACCESS") {
                    return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
                }
                throw error;
            }
        }

        const baseWhere: any = {};
        if (filters.status && filters.status !== 'ALL') {
            baseWhere.status = filters.status;
        }

        if (filters.customerId) {
            baseWhere.customer = { id: filters.customerId };
        }

        // Combine search and RBAC
        let where: any = [];
        const combineWithSearch = (rbacCond: any) => {
            if (filters.search) {
                const searchTerm = `%${filters.search}%`;
                return [
                    { ...baseWhere, ...rbacCond, contractCode: Like(searchTerm) },
                    {
                        ...baseWhere,
                        ...rbacCond,
                        customer: {
                            ...rbacCond.customer,
                            name: Like(searchTerm)
                        }
                    }
                ];
            }
            return { ...baseWhere, ...rbacCond };
        };

        if (Array.isArray(rbacWhere)) {
            rbacWhere.forEach(cond => {
                const combined = combineWithSearch(cond);
                if (Array.isArray(combined)) {
                    where.push(...combined);
                } else {
                    where.push(combined);
                }
            });
        } else {
            const combined = combineWithSearch(rbacWhere);
            if (Array.isArray(combined)) {
                where.push(...combined);
            } else {
                where.push(combined);
            }
        }

        const filtersKey = JSON.stringify(filters);
        const userInfoKey = userInfo ? `role_${userInfo.role}:user_${userInfo.id}` : 'no_user';
        const cacheKey = `contracts:all:${userInfoKey}:${filtersKey}`;

        return await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            const [items, total] = await this.contractRepository.findAndCount({
                where: where.length > 1 ? where : where[0],
                relations: ["customer", "opportunity", "opportunity.referralPartner", "debts", "addendums"],
                order: { [sortBy]: sortDir },
                skip: (page - 1) * limit,
                take: limit
            });

            return {
                data: items,
                meta: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                }
            };
        });
    }

    async getOne(id: string, userInfo?: { id: string, role: string, userId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getContractFilters(userInfo);
            // If rbacWhere is an array (OR conditions), we need to wrap the find with those conditions
            if (Array.isArray(rbacWhere)) {
                rbacWhere = rbacWhere.map(cond => ({ id, ...cond }));
            } else {
                rbacWhere = { id, ...rbacWhere };
            }
        } else {
            rbacWhere = { id };
        }

        const userInfoKey = userInfo ? `:role_${userInfo.role}:user_${userInfo.id}` : '';
        const cacheKey = `contracts:detail:${id}${userInfoKey}`;

        const contract = await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            return await this.contractRepository.findOne({
                where: rbacWhere,
                relations: ["customer", "opportunity", "milestones", "services", "debts", "addendums"]
            });
        });
        if (!contract) {
            throw new Error("Không tìm thấy hợp đồng hoặc bạn không có quyền xem");
        }
        return contract;
    }

    private async generateContractCode(): Promise<string> {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const prefix = `SMGK-${year}-${month}`;

        const count = await this.contractRepository.count({
            where: {
                contractCode: Like(`${prefix}%`)
            }
        });

        const sequence = (count + 1).toString().padStart(3, '0');
        return `${prefix}-${sequence}`;
    }

    async create(data: any, userInfo?: { id: string, userId: string }) {
        const { opportunityId, ...contractData } = data;

        // Auto-generate code
        if (!contractData.contractCode) {
            contractData.contractCode = await this.generateContractCode();
        } else {
            const existing = await this.contractRepository.findOne({
                where: { contractCode: contractData.contractCode }
            });
            if (existing) {
                throw new Error("Mã hợp đồng đã tồn tại");
            }
        }

        let customer: Customers | null = null;
        let opportunity: Opportunities | null = null;

        if (opportunityId) {
            opportunity = await this.opportunityRepository.findOne({
                where: { id: opportunityId },
                relations: ["customer", "referralPartner", "quotations", "services"]
            });

            if (!opportunity) {
                throw new Error("Không tìm thấy cơ hội kinh doanh");
            }

            // Check Status: Must be QUOTE_APPROVED
            if (opportunity.status !== OpportunityStatus.QUOTE_APPROVED) {
                throw new Error("Cơ hội đã được tạo hợp đồng");
            }

            // PROMOTION LOGIC: Lead -> Customer
            if (opportunity.customer) {
                customer = opportunity.customer;
            } else if (opportunity.leadName) {
                // Check if customer exists by phone or taxId to avoid dupes (basic check)
                let existingCustomer = null;
                if (opportunity.leadPhone) {
                    existingCustomer = await this.customerRepository.findOneBy({ phone: opportunity.leadPhone });
                }

                if (!existingCustomer && opportunity.leadTaxId) {
                    existingCustomer = await this.customerRepository.findOneBy({ taxId: opportunity.leadTaxId });
                }

                if (existingCustomer) {
                    customer = existingCustomer;
                    // Link to opportunity
                    opportunity.customer = customer;
                    await this.opportunityRepository.save(opportunity);
                } else {
                    // Create NEW Customer
                    const newCustomer = new Customers();
                    newCustomer.name = opportunity.leadName;
                    newCustomer.phone = opportunity.leadPhone || "";
                    newCustomer.email = opportunity.leadEmail || "";
                    newCustomer.address = opportunity.leadAddress || "";
                    newCustomer.taxId = opportunity.leadTaxId;

                    if (opportunity.customerType === CustomerType.REFERRAL && opportunity.referralPartner) {
                        newCustomer.source = CustomerSource.REFERRAL_PARTNER;
                        newCustomer.referralPartner = opportunity.referralPartner;
                    } else {
                        newCustomer.source = CustomerSource.INTERNAL;
                    }

                    if (userInfo?.userId) {
                        newCustomer.createdBy = { id: userInfo.userId } as Users;
                    } else {
                        console.warn("[ContractService] No userId in userInfo during customer promotion");
                    }
                    customer = await this.customerRepository.save(newCustomer);

                    // Update Opportunity to link to this new customer
                    opportunity.customer = customer;
                    await this.opportunityRepository.save(opportunity);
                }
            } else {
                throw new Error("Cơ hội chưa có thông tin khách hàng hoặc Lead");
            }
        } else if (data.customerId) {
            // Direct contract without opportunity (if allowed)
            customer = await this.customerRepository.findOneBy({ id: data.customerId });
            if (!customer) throw new Error("Không tìm thấy khách hàng");
        } else {
            throw new Error("Cần chọn Cơ hội kinh doanh hoặc Khách hàng");
        }

        // CALCULATE Selling Price and Cost if not provided or if from opportunity
        let finalSellingPrice = contractData.sellingPrice;
        let finalCost = contractData.cost;

        if (opportunity) {
            // Price Priority 1: Approved Quotation
            const approvedQuote = opportunity.quotations?.find(q => q.status === QuotationStatus.APPROVED);
            if (approvedQuote) {
                finalSellingPrice = approvedQuote.totalAmount;
            } else {
                // Price Priority 2: Sum of Opportunity Services
                const serviceSum = opportunity.services?.reduce((sum, os) => sum + (Number(os.sellingPrice) * (os.quantity || 1)), 0);
                if (serviceSum > 0) {
                    finalSellingPrice = serviceSum;
                }
            }

            // Cost calculation: Always sum of Opportunity Services
            const costSum = opportunity.services?.reduce((sum, os) => sum + (Number(os.costAtSale) * (os.quantity || 1)), 0);
            if (costSum > 0) {
                finalCost = costSum;
            }
        }

        const contract = this.contractRepository.create({
            ...contractData,
            sellingPrice: finalSellingPrice || 0,
            cost: finalCost || 0,
            customer: customer,
            opportunity: opportunity,
            attachments: opportunity?.attachments || [], // Copy attachments
            description: opportunity?.description || contractData.description,
            createdBy: userInfo?.userId ? { id: userInfo.userId } as Users : undefined
        } as Partial<Contracts>);


        if (!contract.createdBy) {
            console.warn("[ContractService] contract.createdBy is undefined after set. userInfo.userId:", userInfo?.userId);
        }


        const savedContract = (await this.contractRepository.save(contract)) as unknown as Contracts;

        // MAP Opportunity Services to Contract Services
        if (opportunity) {
            const oppServices = await this.oppServiceRepository.find({
                where: { opportunity: { id: opportunity.id } },
                relations: ["service", "opportunity"]
            });

            for (const os of oppServices) {
                const qty = os.quantity || 1;
                for (let i = 0; i < qty; i++) {
                    const cs = this.contractServiceRepository.create({
                        contract: savedContract,
                        service: os.service,
                        serviceId: os.service?.id,
                        sellingPrice: os.sellingPrice,
                        opportunityService: os,
                        name: os.name,
                        packageName: os.packageName,
                        isPackageService: os.isPackageService
                    });
                    await this.contractServiceRepository.save(cs);
                }
            }
        }

        // Update Opportunity Status
        if (opportunity) {
            opportunity.status = OpportunityStatus.CONTRACT_CREATED;
            await this.opportunityRepository.save(opportunity);
            opportunityEmitter.emit(OPPORTUNITY_EVENTS.UPDATED, opportunity);
        }

        // Create default milestone (100%)
        const defaultMilestone = this.milestoneRepository.create({
            contract: savedContract,
            name: "Thanh toán đợt 1",
            percentage: 100,
            amount: savedContract.sellingPrice,
            status: MilestoneStatus.PENDING,
            dueDate: new Date(new Date().setDate(new Date().getDate() + 30)) // Default 30 days
        });
        await this.milestoneRepository.save(defaultMilestone);

        // Invalidate list cache
        await RedisService.deleteCache('contracts:all*');

        // Notify management
        await this.notifyManagement({
            title: "Hợp đồng mới",
            content: `Hợp đồng nháp ${savedContract.contractCode}-${savedContract.name} đã được tạo bởi ${userInfo?.userId || 'Hệ thống'}`,
            contractId: savedContract.id
        });

        contractEmitter.emit(CONTRACT_EVENTS.CREATED, savedContract);

        return savedContract;
    }

    async uploadProposal(id: string, fileData: any, userInfo?: { id: string, userId?: string }) {
        const contract = await this.getOne(id);
        contract.proposal_contract = fileData.url;
        contract.status = ContractStatus.PROPOSAL_UPLOADED;
        contract.rejectionReason = null; // Clear rejection reason on re-upload

        const savedResult = await this.contractRepository.save(contract);

        // Notify management
        await this.notifyManagement({
            title: "Hợp đồng đã upload bản thảo",
            content: `Bản thảo hợp đồng ${savedResult.contractCode}-${savedResult.name} đã được upload bởi ${userInfo?.userId || 'Hệ thống'}.`,
            contractId: savedResult.id
        });

        // Invalidate caches
        await RedisService.deleteCache(`contracts:detail:${id}*`);

        contractEmitter.emit(CONTRACT_EVENTS.UPDATED, savedResult);

        return savedResult;
    }

    async approveProposal(id: string, userInfo?: { id: string, userId?: string }) {
        const contract = await this.contractRepository.findOne({
            where: { id },
            relations: ["opportunity"]
        });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        contract.status = ContractStatus.PROPOSAL_APPROVED;
        const savedContract = (await this.contractRepository.save(contract)) as unknown as Contracts;

        // Auto Create Project (Draft)
        await this.projectService.createFromContract(savedContract, userInfo);

        // Notify management
        await this.notifyManagement({
            title: "Hợp đồng đã duyệt bản thảo",
            content: `Bản thảo hợp đồng ${savedContract.contractCode}-${savedContract.name} đã được duyệt. Dự án tương ứng đã được khởi tạo nháp.`,
            contractId: savedContract.id
        });

        // Invalidate caches
        await RedisService.deleteCache(`contracts:detail:${id}*`);

        contractEmitter.emit(CONTRACT_EVENTS.UPDATED, savedContract);

        return savedContract;
    }


    async uploadSigned(id: string, fileData: any, userInfo?: { id: string, userId?: string }) {
        const contract = await this.contractRepository.findOne({
            where: { id },
            relations: ["project", "customer", "opportunity", "milestones", "services", "debts"]
        });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        if (contract.status !== ContractStatus.PROPOSAL_APPROVED) {
            throw new Error("Hợp đồng cần được duyệt trước khi upload bản ký");
        }

        contract.signed_contract = fileData.url;
        contract.status = ContractStatus.SIGNED;


        const savedContract = await this.contractRepository.save(contract);

        // Notify management
        await this.notifyManagement({
            title: "Hợp đồng đã upload bản ký",
            content: `Bản ký hợp đồng ${savedContract.contractCode}-${savedContract.name} đã được upload bởi ${userInfo?.userId || 'Hệ thống'}.`,
            contractId: savedContract.id
        });

        // Invalidate caches
        await RedisService.deleteCache(`contracts:detail:${id}*`);

        contractEmitter.emit(CONTRACT_EVENTS.SIGNED, savedContract);

        return savedContract;
    }


    async addMilestone(contractId: string, data: { name: string, percentage: number, amount?: number, dueDate: Date }) {
        const contract = await this.getOne(contractId);

        // Validate percentage
        const currentMilestones = await this.milestoneRepository.find({ where: { contract: { id: contractId } } });
        const totalPercentage = currentMilestones.reduce((sum, m) => sum + Number(m.percentage), 0);

        if (totalPercentage + Number(data.percentage) > 100) {
            throw new Error(`Tổng phần trăm thanh toán không được vượt quá 100%. Hiện tại: ${totalPercentage}%`);
        }

        const amount = data.amount || (contract.sellingPrice * data.percentage / 100);

        const milestone = this.milestoneRepository.create({
            ...data,
            contract: contract,
            amount: amount,
            status: MilestoneStatus.PENDING
        });

        const savedMilestone = await this.milestoneRepository.save(milestone);

        // Invalidate detail cache (milestones are often included in detail)
        await RedisService.deleteCache(`contracts:detail:${contractId}*`);

        return savedMilestone;
    }

    async updateMilestone(id: string, data: Partial<PaymentMilestones>) {
        const milestone = await this.milestoneRepository.findOne({ where: { id }, relations: ["contract"] });
        if (!milestone) throw new Error("Không tìm thấy đợt thanh toán");

        if (data.percentage) {
            const currentMilestones = await this.milestoneRepository.find({ where: { contract: { id: milestone.contract.id } } });
            const otherMilestonesTotal = currentMilestones
                .filter(m => m.id !== id)
                .reduce((sum, m) => sum + Number(m.percentage), 0);

            if (otherMilestonesTotal + Number(data.percentage) > 100) {
                throw new Error(`Tổng phần trăm thanh toán không được vượt quá 100%. Hiện tại: ${otherMilestonesTotal}%`);
            }
            // Recalculate amount if percentage changes
            milestone.amount = milestone.contract.sellingPrice * Number(data.percentage) / 100;
        }

        Object.assign(milestone, data);
        const savedMilestone = await this.milestoneRepository.save(milestone);

        // Invalidate detail cache
        await RedisService.deleteCache(`contracts:detail:${milestone.contract.id}*`);

        return savedMilestone;
    }

    async deleteMilestone(id: string) {
        const milestone = await this.milestoneRepository.findOne({ where: { id } });
        if (!milestone) throw new Error("Không tìm thấy đợt thanh toán");
        const result = await this.milestoneRepository.remove(milestone);

        // Invalidate detail cache
        if (milestone.contract?.id) {
            await RedisService.deleteCache(`contracts:detail:${milestone.contract.id}*`);
        } else {
            // Fallback if relation not loaded
            await RedisService.deleteCache('contracts:detail*');
        }

        return result;
    }

    async delete(id: string) {
        const contract = await this.getOne(id);
        await this.contractRepository.remove(contract);

        // Invalidate caches
        await RedisService.deleteCache(`contracts:detail:${id}*`);

        contractEmitter.emit(CONTRACT_EVENTS.DELETED, { id });

        return { message: "Xóa hợp đồng thành công" };
    }

    async rejectProposal(id: string, reason: string, userInfo?: { id: string, userId: string }) {
        const contract = await this.contractRepository.findOne({
            where: { id },
            relations: ["opportunity", "opportunity.createdBy"]
        });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        if (contract.status !== ContractStatus.PROPOSAL_UPLOADED) {
            throw new Error("Chỉ có thể từ chối hợp đồng đang ở trạng thái PROPOSAL_UPLOADED");
        }

        contract.status = ContractStatus.PROPOSAL_REJECTED;
        contract.rejectionReason = reason;

        const savedContract = await this.contractRepository.save(contract);

        // Invalidate caches
        await RedisService.deleteCache('contracts:all*');
        await RedisService.deleteCache(`contracts:detail:${id}*`);

        // Notify management
        await this.notifyManagement({
            title: "Hợp đồng bị từ chối bản thảo",
            content: `Bản thảo hợp đồng ${savedContract.contractCode}-${savedContract.name} bị từ chối. Lý do: ${reason}`,
            contractId: savedContract.id
        });

        // Notify Opportunity Creator
        if (contract.opportunity?.createdBy) {
            const sender = userInfo?.userId ? { id: userInfo.userId } as Users : undefined;
            await this.notificationService.createNotification({
                title: "Hợp đồng bị từ chối",
                content: `Hợp đồng ${contract.contractCode}-${contract.name} đã bị từ chối với lý do: ${reason}`,
                type: "CONTRACT_REJECTION",
                recipient: contract.opportunity.createdBy,
                sender: sender,
                relatedEntityId: contract.id,
                relatedEntityType: "CONTRACT",
                link: `/opportunities/${contract.opportunity.id}`
            });
        }

        return savedContract;
    }
}
