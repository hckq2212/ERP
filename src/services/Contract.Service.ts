import { AppDataSource } from "../data-source";
import { Contracts } from "../entity/Contract.entity";
import { Customers, CustomerSource } from "../entity/Customer.entity";
import { Opportunities, CustomerType, OpportunityStatus } from "../entity/Opportunity.entity";
import { ReferralPartners } from "../entity/ReferralPartner.entity";
import { Like } from "typeorm";

export class ContractService {
    private contractRepository = AppDataSource.getRepository(Contracts);
    private customerRepository = AppDataSource.getRepository(Customers);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);

    async getAll() {
        return await this.contractRepository.find({
            relations: ["customer", "opportunity", "opportunity.referralPartner"]
        });
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
                relations: ["customer", "referralPartner"]
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

        const contract = this.contractRepository.create({
            ...contractData,
            customer: customer,
            opportunity: opportunity
        });

        const savedContract = await this.contractRepository.save(contract);

        // Update Opportunity Status
        if (opportunity) {
            opportunity.status = OpportunityStatus.CONTRACT_CREATED;
            await this.opportunityRepository.save(opportunity);
        }

        return savedContract;
    }

    // ... Update/Delete methods can be basic for now
    async delete(id: number) {
        const contract = await this.getOne(id);
        await this.contractRepository.remove(contract);
        return { message: "Xóa hợp đồng thành công" };
    }
}
