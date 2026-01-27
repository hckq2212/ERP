import { AppDataSource } from "../data-source";
import { Quotations, QuotationStatus } from "../entity/Quotation.entity";
import { QuotationDetails } from "../entity/QuotationDetail.entity";
import { Opportunities, OpportunityStatus } from "../entity/Opportunity.entity";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { Services } from "../entity/Service.entity";

export class QuotationService {
    private quotationRepository = AppDataSource.getRepository(Quotations);
    private quotationDetailRepository = AppDataSource.getRepository(QuotationDetails);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private opportunityServiceRepository = AppDataSource.getRepository(OpportunityServices);

    async getAll() {
        return await this.quotationRepository.find({
            relations: ["opportunity", "details", "details.service"]
        });
    }

    async getOne(id: number) {
        const quotation = await this.quotationRepository.findOne({
            where: { id },
            relations: ["opportunity", "details", "details.service"]
        });
        if (!quotation) throw new Error("Không tìm thấy báo giá");
        return quotation;
    }

    async getByOpportunity(opportunityId: number) {
        return await this.quotationRepository.find({
            where: { opportunity: { id: opportunityId } },
            relations: ["details", "details.service"],
            order: { version: "DESC" }
        });
    }

    // 1. Create Quotation: Copy from Opportunity Service -> Quotation Details
    async create(data: { opportunityId: number, note?: string }) {
        const { opportunityId, note } = data;

        const opportunity = await this.opportunityRepository.findOne({
            where: { id: opportunityId },
            relations: ["services", "services.service"]
        });

        if (!opportunity) throw new Error("Không tìm thấy cơ hội kinh doanh");

        // Determine version
        const count = await this.quotationRepository.count({
            where: { opportunity: { id: opportunityId } }
        });
        const version = count + 1;

        const quotation = this.quotationRepository.create({
            opportunity,
            version,
            note,
            status: QuotationStatus.DRAFT,
            totalAmount: 0 // Will calculate
        });

        const savedQuotation = await this.quotationRepository.save(quotation);

        // Copy logic
        let total = 0;
        if (opportunity.services) {
            for (const oppService of opportunity.services) {
                const detail = this.quotationDetailRepository.create({
                    quotation: savedQuotation,
                    service: oppService.service,
                    quantity: oppService.quantity,
                    sellingPrice: oppService.sellingPrice,
                    costAtSale: oppService.costAtSale
                });
                await this.quotationDetailRepository.save(detail);

                total += Number(detail.sellingPrice) * detail.quantity;
            }
        }

        savedQuotation.totalAmount = total;

        // Update Opportunity Status to QUOTATION_DRAFTING if it's new
        if (opportunity.status !== OpportunityStatus.QUOTATION_DRAFTING && opportunity.status !== OpportunityStatus.QUOTE_APPROVED) {
            opportunity.status = OpportunityStatus.QUOTATION_DRAFTING;
            await this.opportunityRepository.save(opportunity);
        }

        return await this.quotationRepository.save(savedQuotation);
    }

    // 2. Update Quotation Details (Price, Qty)
    async update(id: number, data: { status?: QuotationStatus, note?: string, details?: any[] }) {
        const quotation = await this.getOne(id);

        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Không thể chỉnh sửa báo giá đã được duyệt");
        }

        if (data.note) quotation.note = data.note;
        if (data.status && data.status !== QuotationStatus.APPROVED) quotation.status = data.status;

        // If details provided, update them
        if (data.details && Array.isArray(data.details)) {
            let total = 0;
            // Clear old details? Or update? Let's assume full replace for simplicity or update by ID
            // For simplicity in this context, let's wipe and recreate details if provided
            await this.quotationDetailRepository.delete({ quotation: { id: quotation.id } });

            const serviceRepository = AppDataSource.getRepository(Services);

            for (const item of data.details) {
                const service = await serviceRepository.findOneBy({ id: item.serviceId });
                if (service) {
                    const detail = this.quotationDetailRepository.create({
                        quotation,
                        service,
                        quantity: item.quantity || 1,
                        sellingPrice: item.sellingPrice || 0,
                        costAtSale: item.costAtSale || 0
                    });
                    await this.quotationDetailRepository.save(detail);
                    total += Number(detail.sellingPrice) * detail.quantity;
                }
            }
            quotation.totalAmount = total;
        }

        return await this.quotationRepository.save(quotation);
    }

    // 3. Approve Quotation: Sync BACK to Opportunity
    async approve(id: number) {
        const quotation = await this.getOne(id);

        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Báo giá này đã được duyệt rồi");
        }

        // 1. Mark this as APPROVED
        quotation.status = QuotationStatus.APPROVED;
        await this.quotationRepository.save(quotation);

        // 3. SYNC LOGIC: Update Opportunity Services
        const opportunity = quotation.opportunity;

        // Wipe old Opp Services
        await this.opportunityServiceRepository.delete({ opportunity: { id: opportunity.id } });

        let totalRevenue = 0;
        let totalCost = 0;

        for (const detail of quotation.details) {
            const oppService = this.opportunityServiceRepository.create({
                opportunity: opportunity,
                service: detail.service,
                quantity: detail.quantity,
                sellingPrice: detail.sellingPrice,
                costAtSale: detail.costAtSale
            });
            await this.opportunityServiceRepository.save(oppService);

            totalRevenue += Number(detail.sellingPrice) * detail.quantity;
            totalCost += Number(detail.costAtSale) * detail.quantity;
        }

        // 4. Update Opportunity Totals & Status
        opportunity.expectedRevenue = totalRevenue;
        opportunity.status = OpportunityStatus.QUOTE_APPROVED;

        await this.opportunityRepository.save(opportunity);

        return { message: "Đã duyệt báo giá và cập nhật cơ hội kinh doanh", quotation };
    }

    // 4. Reject Quotation
    async reject(id: number) {
        const quotation = await this.getOne(id);

        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Không thể từ chối báo giá đã được duyệt");
        }

        quotation.status = QuotationStatus.REJECTED;
        await this.quotationRepository.save(quotation);

        // Optionally revert opportunity status if needed, 
        // but typically it stays in "Quotation Drafting" phase

        return { message: "Đã từ chối báo giá", quotation };
    }

    async delete(id: number) {
        const quotation = await this.getOne(id);
        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Không thể xóa báo giá đã duyệt");
        }
        await this.quotationRepository.remove(quotation);
        return { message: "Xóa báo giá thành công" };
    }
}
