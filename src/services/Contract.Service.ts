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



export class ContractService {
    private contractRepository = AppDataSource.getRepository(Contracts);
    private customerRepository = AppDataSource.getRepository(Customers);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private oppServiceRepository = AppDataSource.getRepository(OpportunityServices);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private projectService = new ProjectService();
    private debtService = new DebtService();


    async getAll(userInfo?: { id: string | number, role: string }) {
        const query: any = {
            relations: ["customer", "opportunity", "opportunity.referralPartner", "debts"]
        };

        if (userInfo && userInfo.role !== "BOD" && userInfo.role !== "ADMIN") {
            // Filter by the creator of the associated opportunity
            query.where = { opportunity: { createdBy: { account: { id: userInfo.id } } } };
        }

        return await this.contractRepository.find(query);
    }

    async getOne(id: number) {
        const contract = await this.contractRepository.findOne({
            where: { id },
            relations: ["customer", "opportunity", "milestones", "services", "debts"]
        });
        if (!contract) {
            throw new Error("Không tìm thấy hợp đồng");
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

        const sequence = (count + 1).toString().padStart(4, '0'); // Let's keep 4 digits or change to what user wants? "Số thứ tự của hợp đồng trong tháng". 
        // User example "2 số tháng (ví dụ : 01 } – { Số thứ tự của hợp đồng trong tháng}". Doesn't specify digits for seq. 
        // Assuming 2-3 digits is enough but sticking to safe padding. Let's use 3 digits.
        const seq = (count + 1).toString().padStart(3, '0');
        return `${prefix}-${seq}`;
    }

    async create(data: any) {
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
                throw new Error("Cơ hội chưa được duyệt báo giá (Status phải là QUOTE_APPROVED)");
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

                    customer = await this.customerRepository.save(newCustomer);

                    // Update Opportunity to link to this new customer
                    opportunity.customer = customer;
                    // Optional: Clear lead fields? Maybe keep them for history or clear them. 
                    // Let's keep them for record but rely on customer relation now.
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
            attachments: opportunity?.attachments || [] // Copy attachments
        });

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
                        sellingPrice: os.sellingPrice,
                        opportunityService: os
                    });
                    await this.contractServiceRepository.save(cs);
                }
            }
        }

        // Update Opportunity Status
        if (opportunity) {
            opportunity.status = OpportunityStatus.CONTRACT_CREATED;
            await this.opportunityRepository.save(opportunity);
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

        return savedContract;
    }

    async uploadProposal(id: number, fileData: any) {
        const contract = await this.getOne(id);
        contract.proposal_contract = fileData.url;
        contract.status = ContractStatus.PROPOSAL_UPLOADED;

        // Add to attachments if not already there
        if (!contract.attachments) contract.attachments = [];
        const exists = contract.attachments.find(a => a.url === fileData.url);
        if (!exists) {
            contract.attachments.push({
                ...fileData,
                type: "PROPOSAL_CONTRACT"
            });
        }

        return await this.contractRepository.save(contract);
    }

    async approveProposal(id: number) {
        const contract = await this.getOne(id);
        if (contract.status !== ContractStatus.PROPOSAL_UPLOADED) {
            throw new Error("Cần upload dự thảo hợp đồng trước khi duyệt");
        }
        contract.status = ContractStatus.PROPOSAL_APPROVED;
        const savedContract = await this.contractRepository.save(contract);

        // Auto create project
        await this.projectService.createFromContract(savedContract);

        return savedContract;
    }


    async uploadSigned(id: number, fileData: any) {
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

        // Add to attachments
        if (!contract.attachments) contract.attachments = [];
        const exists = contract.attachments.find(a => a.url === fileData.url);
        if (!exists) {
            contract.attachments.push({
                ...fileData,
                type: "SIGNED_CONTRACT"
            });
        }

        const savedContract = await this.contractRepository.save(contract);

        // Auto activate all milestones as debts
        if (contract.milestones && contract.milestones.length > 0) {
            for (const milestone of contract.milestones) {
                try {
                    await this.debtService.createFromMilestone(milestone.id);
                } catch (error) {
                    console.error(`Lỗi kích hoạt nợ cho milestone ${milestone.id}:`, error.message);
                    // Continue to others if one fails (e.g. already activated)
                }
            }
        }

        // Auto start project if it exists
        if (contract.project) {
            await this.projectService.start(contract.project.id);
        }

        return savedContract;
    }


    async addMilestone(contractId: number, data: { name: string, percentage: number, amount?: number, dueDate: Date }) {
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

        return await this.milestoneRepository.save(milestone);
    }

    async updateMilestone(id: number, data: Partial<PaymentMilestones>) {
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
        return await this.milestoneRepository.save(milestone);
    }

    async deleteMilestone(id: number) {
        const milestone = await this.milestoneRepository.findOne({ where: { id } });
        if (!milestone) throw new Error("Không tìm thấy đợt thanh toán");
        return await this.milestoneRepository.remove(milestone);
    }

    // ... Update/Delete methods can be basic for now
    async delete(id: number) {
        const contract = await this.getOne(id);
        await this.contractRepository.remove(contract);
        return { message: "Xóa hợp đồng thành công" };
    }
}
