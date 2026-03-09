import { AppDataSource } from "../data-source";
import { Quotations, QuotationStatus, QuotationType } from "../entity/Quotation.entity";
import { QuotationDetails } from "../entity/QuotationDetail.entity";
import { Opportunities, OpportunityStatus } from "../entity/Opportunity.entity";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { OpportunityPackages } from "../entity/OpportunityPackage.entity";
import { Services } from "../entity/Service.entity";
import { Tasks, PricingStatus, TaskStatus } from "../entity/Task.entity";
import { ContractAddendums, AddendumStatus } from "../entity/ContractAddendum.entity";
import { Users } from "../entity/User.entity";

export class QuotationService {
    private quotationRepository = AppDataSource.getRepository(Quotations);
    private quotationDetailRepository = AppDataSource.getRepository(QuotationDetails);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private opportunityServiceRepository = AppDataSource.getRepository(OpportunityServices);
    private opportunityPackageRepository = AppDataSource.getRepository(OpportunityPackages);
    private taskRepository = AppDataSource.getRepository(Tasks);

    async getAll() {
        return await this.quotationRepository.find({
            relations: ["opportunity", "details", "details.service"]
        });
    }

    async getOne(id: string) {
        const quotation = await this.quotationRepository.findOne({
            where: { id },
            relations: ["opportunity", "opportunity.contracts", "details", "details.service"]
        });
        if (!quotation) throw new Error("Không tìm thấy báo giá");
        return quotation;
    }

    async getByOpportunity(opportunityId: string) {
        return await this.quotationRepository.find({
            where: { opportunity: { id: opportunityId } },
            relations: ["details", "details.service"],
            order: { version: "DESC" }
        });
    }

    // 1. Create Quotation: Copy from Opportunity Service -> Quotation Details
    async create(data: { opportunityId: string, note?: string }, userInfo?: { id: string, userId?: string }) {
        const { opportunityId, note } = data;

        const opportunity = await this.opportunityRepository.findOne({
            where: { id: opportunityId },
            relations: ["services", "services.service", "packages", "packages.services", "packages.services.service"]
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
            totalAmount: 0, // Will calculate
            createdBy: userInfo?.userId ? { id: userInfo.userId } as Users : undefined
        });


        const savedQuotation = await this.quotationRepository.save(quotation);

        let total = 0;

        // 1. Copy standalone services
        const standaloneServices = opportunity.services?.filter(s => !s.opportunityPackageId) || [];
        for (const oppService of standaloneServices) {
            const detail = this.quotationDetailRepository.create({
                quotation: savedQuotation,
                service: oppService.service,
                serviceId: oppService.service?.id,
                quantity: oppService.quantity,
                sellingPrice: oppService.sellingPrice,
                costAtSale: oppService.costAtSale,
                name: oppService.service?.name || 'Standalone Service',
                packageQuantity: 1, // Standalone is always 1 for norm calc
                isPackageService: false
            });
            await this.quotationDetailRepository.save(detail);
            total += Number(detail.sellingPrice) * detail.quantity;
        }

        // 2. Copy packages
        if (opportunity.packages) {
            for (const oppPkg of opportunity.packages) {
                if (oppPkg.services) {
                    for (const s of oppPkg.services) {
                        const detail = this.quotationDetailRepository.create({
                            quotation: savedQuotation,
                            service: s.service,
                            serviceId: s.service?.id,
                            quantity: Number(s.quantity) * Number(oppPkg.quantity || 1),
                            sellingPrice: s.sellingPrice,
                            costAtSale: s.costAtSale,
                            name: s.service?.name || 'Package Item',
                            packageQuantity: oppPkg.quantity || 1,
                            packageName: oppPkg.name,
                            servicePackageId: oppPkg.servicePackageId,
                            isPackageService: true
                        });
                        await this.quotationDetailRepository.save(detail);
                        total += Number(detail.sellingPrice) * detail.quantity;
                    }
                }
            }
        }

        savedQuotation.totalAmount = total;

        // Update Opportunity Status to QUOTATION_DRAFTING if it's new
        if (opportunity.status === OpportunityStatus.PENDING_OPP_APPROVAL) {
            opportunity.status = OpportunityStatus.QUOTATION_DRAFTING;
            await this.opportunityRepository.save(opportunity);
        }

        return await this.quotationRepository.save(savedQuotation);
    }

    async createAddendumQuotation(data: { opportunityId: string, taskIds: string[], note?: string }, userInfo?: { id: string, userId?: string }) {
        const { opportunityId, taskIds, note } = data;

        const opportunity = await this.opportunityRepository.findOne({
            where: { id: opportunityId },
            relations: ["contracts"]
        });
        if (!opportunity) throw new Error("Không tìm thấy cơ hội kinh doanh");
        if (!opportunity.contracts || opportunity.contracts.length === 0) throw new Error("Dự án chưa có hợp đồng để tạo phụ lục");

        const tasks = await this.taskRepository.find({
            where: taskIds.map(id => ({ id, isExtra: true, pricingStatus: PricingStatus.BILLABLE })),
            relations: ["job", "job.services", "mappedService"]
        });

        if (tasks.length !== taskIds.length) {
            throw new Error("Một số công việc không hợp lệ hoặc chưa được BOD định giá phát sinh");
        }

        const count = await this.quotationRepository.count({
            where: { opportunity: { id: opportunityId } }
        });
        const version = count + 1;

        const quotation = this.quotationRepository.create({
            opportunity,
            version,
            note,
            status: QuotationStatus.DRAFT,
            type: QuotationType.ADDENDUM,
            totalAmount: 0,
            createdBy: userInfo?.userId ? { id: userInfo.userId } as Users : undefined
        });


        const savedQuotation = await this.quotationRepository.save(quotation);

        let total = 0;
        const serviceRepo = AppDataSource.getRepository(Services);

        for (const task of tasks) {
            // 1. Ưu tiên lấy mappedService do BOD chọn tay khi định giá
            let service = task.mappedService;

            // 2. Nếu không có, tìm Service có Job đầu ra khớp với Job của Task
            if (!service) {
                service = await serviceRepo.findOne({
                    where: { outputJob: { id: task.job.id } }
                });
            }

            // 3. Fallback cuối cùng: lấy Service đầu tiên mà Job này thuộc về
            if (!service) {
                // FALLBACK: If no service is found, we will quote based on the Job directly.
                const detail = this.quotationDetailRepository.create({
                    quotation: savedQuotation,
                    job: task.job,
                    quantity: 1,
                    sellingPrice: task.sellingPrice,
                    costAtSale: task.cost
                });
                await this.quotationDetailRepository.save(detail);
                total += Number(detail.sellingPrice);
                continue;
            }

            const detail = this.quotationDetailRepository.create({
                quotation: savedQuotation,
                service: service,
                quantity: 1,
                sellingPrice: task.sellingPrice,
                costAtSale: task.cost
            });
            await this.quotationDetailRepository.save(detail);
            total += Number(detail.sellingPrice);
        }

        savedQuotation.totalAmount = total;
        savedQuotation.tasks = tasks; // Link tasks to quotation
        return await this.quotationRepository.save(savedQuotation);
    }

    // 2. Update Quotation Details (Price, Qty)
    async update(id: string, data: { status?: QuotationStatus, note?: string, details?: any[] }) {
        const quotation = await this.getOne(id);

        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Không thể chỉnh sửa báo giá đã được duyệt");
        }

        if (data.note !== undefined) quotation.note = data.note;
        if (data.status && data.status !== QuotationStatus.APPROVED) quotation.status = data.status;

        // If details provided, update them
        if (data.details && Array.isArray(data.details)) {
            let total = 0;

            // 1. Clear old details from database
            await this.quotationDetailRepository.delete({ quotation: { id: quotation.id } });

            // 2. Clear old details from memory object to avoid TypeORM sync issues
            quotation.details = [];

            const serviceRepository = AppDataSource.getRepository(Services);

            for (const item of data.details) {
                const service = await serviceRepository.findOneBy({ id: item.serviceId });
                if (!service) {
                    throw new Error(`Không tìm thấy dịch vụ với ID: ${item.serviceId}`);
                }

                const detail = this.quotationDetailRepository.create({
                    quotation,
                    service,
                    serviceId: item.serviceId,
                    quantity: item.quantity || 1,
                    sellingPrice: item.sellingPrice || 0,
                    costAtSale: item.costAtSale || 0,
                    name: item.name || service.name,
                    packageQuantity: item.packageQuantity || 1,
                    packageName: item.packageName,
                    servicePackageId: item.servicePackageId,
                    isPackageService: item.isPackageService || false
                });

                await this.quotationDetailRepository.save(detail);
                total += Number(detail.sellingPrice) * detail.quantity;

                // Keep in memory for the final return
                quotation.details.push(detail);
            }
            quotation.totalAmount = total;
        }

        return await this.quotationRepository.save(quotation);
    }

    // 3. Approve Quotation: Sync BACK to Opportunity
    async approve(id: string) {
        const quotation = await this.getOne(id);

        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Báo giá này đã được duyệt rồi");
        }

        // 1. Mark this as APPROVED
        quotation.status = QuotationStatus.APPROVED;
        quotation.description = quotation.description;
        await this.quotationRepository.save(quotation);

        // 3. IF ADDENDUM: Create Contract Addendum and SYNC
        if (quotation.type === QuotationType.ADDENDUM) {
            const contract = quotation.opportunity.contracts?.[0];
            if (!contract) throw new Error("Không tìm thấy hợp đồng để tạo phụ lục");

            const addendumRepo = AppDataSource.getRepository(ContractAddendums);
            const addendum = addendumRepo.create({
                name: quotation.note || `Phụ lục phát sinh - Ver ${quotation.version}`,
                contract: contract,
                sellingPrice: quotation.totalAmount,
                cost: quotation.details.reduce((sum, d) => sum + Number(d.costAtSale), 0),
                status: AddendumStatus.DRAFT
            });

            await addendumRepo.save(addendum);

            // Activate tasks linked to this quotation
            const tasks = await this.taskRepository.find({
                where: { quotation: { id: quotation.id } }
            });

            for (const task of tasks) {
                task.status = TaskStatus.PENDING;
                task.pricingStatus = PricingStatus.BILLABLE;
                await this.taskRepository.save(task);
            }

            return { message: "Đã duyệt báo giá phụ lục và tạo Phụ lục hợp đồng nháp. Các công việc liên quan đã được kích hoạt.", quotation, addendum };
        }

        // 4. IF INITIAL: SYNC LOGIC: Update Opportunity Services
        const opportunity = quotation.opportunity;
        // ... (existing initial sync logic)

        // Wipe old Opp Services & Packages
        await this.opportunityServiceRepository.delete({ opportunity: { id: opportunity.id } });
        await this.opportunityPackageRepository.delete({ opportunity: { id: opportunity.id } });

        const packageMap = new Map<string, OpportunityPackages>();
        let totalRevenue = 0;
        let totalCost = 0;

        for (const detail of quotation.details) {
            let oppPkg = null;
            if (detail.isPackageService && detail.packageName) {
                const pkgKey = `${detail.packageName}_${detail.packageQuantity}`;
                if (!packageMap.has(pkgKey)) {
                    const newPkg = this.opportunityPackageRepository.create({
                        opportunity,
                        name: detail.packageName,
                        quantity: detail.packageQuantity || 1,
                        servicePackageId: detail.servicePackageId
                    });
                    const savedPkg = await this.opportunityPackageRepository.save(newPkg);
                    packageMap.set(pkgKey, savedPkg);
                }
                oppPkg = packageMap.get(pkgKey);
            }

            const oppService = this.opportunityServiceRepository.create({
                opportunity: opportunity,
                service: detail.service,
                quantity: detail.quantity,
                sellingPrice: detail.sellingPrice,
                costAtSale: detail.costAtSale,
                opportunityPackage: oppPkg,
                name: detail.name,
                packageName: detail.packageName,
                isPackageService: detail.isPackageService
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
    async reject(id: string, description?: string) {
        const quotation = await this.getOne(id);

        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Không thể từ chối báo giá đã được duyệt");
        }

        quotation.status = QuotationStatus.REJECTED;
        quotation.description = description;
        await this.quotationRepository.save(quotation);

        // Optionally revert opportunity status if needed, 
        // but typically it stays in "Quotation Drafting" phase

        return { message: "Đã từ chối báo giá", quotation };
    }

    async delete(id: string) {
        const quotation = await this.getOne(id);
        if (quotation.status === QuotationStatus.APPROVED) {
            throw new Error("Không thể xóa báo giá đã duyệt");
        }
        await this.quotationRepository.remove(quotation);
        return { message: "Xóa báo giá thành công" };
    }
}
