import { AppDataSource } from "../data-source";
import { Opportunities, CustomerType, OpportunityStatus } from "../entity/Opportunity.entity";
import { Customers } from "../entity/Customer.entity";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { Services } from "../entity/Service.entity";
import { ReferralPartners } from "../entity/ReferralPartner.entity";
import { Users } from "../entity/User.entity";
import { OpportunityPackages } from "../entity/OpportunityPackage.entity";
import { ServicePackages } from "../entity/ServicePackage.entity";
import { Like } from "typeorm";

export class OpportunityService {
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private customerRepository = AppDataSource.getRepository(Customers);
    private referralPartnerRepository = AppDataSource.getRepository(ReferralPartners);
    private userRepository = AppDataSource.getRepository(Users);
    private opportunityPackageRepository = AppDataSource.getRepository(OpportunityPackages);
    private opportunityServiceRepository = AppDataSource.getRepository(OpportunityServices);
    private serviceRepository = AppDataSource.getRepository(Services);
    private packageRepository = AppDataSource.getRepository(ServicePackages);

    async getAll(filters: any = {}, userInfo?: { id: string, role: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        const where: any = [];
        const baseWhere: any = {};
        if (userInfo && userInfo.role !== "BOD" && userInfo.role !== "ADMIN") {
            // Filter by createdBy.account.id since accountId is what we have in userInfo
            baseWhere.createdBy = { account: { id: userInfo.id } };
        }

        if (filters.status && filters.status !== 'ALL') {
            baseWhere.status = filters.status;
        }

        if (filters.customerId) {
            baseWhere.customer = { id: filters.customerId };
        }

        if (filters.search) {
            const searchTerm = `%${filters.search}%`;
            where.push({ ...baseWhere, name: Like(searchTerm) });
            where.push({ ...baseWhere, leadName: Like(searchTerm) });
            where.push({ ...baseWhere, customer: { name: Like(searchTerm) } });
            where.push({ ...baseWhere, opportunityCode: { opportunityCode: Like(searchTerm) } });
        } else {
            where.push(baseWhere);
        }

        const [items, total] = await this.opportunityRepository.findAndCount({
            where: where.length > 1 ? where : where[0],
            relations: ["customer", "referralPartner", "createdBy"],
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
    }

    async getOne(id: string) {
        const opportunity = await this.opportunityRepository.findOne({
            where: { id },
            relations: [
                "customer",
                "referralPartner",
                "services",
                "services.service",
                "packages",
                "packages.services",
                "packages.services.service",
                "quotations",
                "contracts",
                "createdBy"
            ]
        });
        if (!opportunity) {
            throw new Error("Không tìm thấy cơ hội kinh doanh");
        }
        return opportunity;
    }

    private async generateOpportunityCode(): Promise<string> {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const prefix = `CH-${year}-${month}`;

        // Find the count of opportunities created in this year and month
        const count = await this.opportunityRepository.count({
            where: {
                opportunityCode: Like(`${prefix}%`)
            }
        });

        const sequence = (count + 1).toString().padStart(3, '0');
        return `${prefix}-${sequence}`;
    }

    async create(data: any = {}) {
        const {
            customerId,
            referralPartnerId,
            customerType,
            // Lead fields
            leadName,
            leadPhone,
            leadEmail,
            leadAddress,
            leadTaxId,
            services,
            packages,
            accountId,
            ...opportunityData
        } = data;

        // Auto-generate code if not provided
        if (!opportunityData.opportunityCode) {
            opportunityData.opportunityCode = await this.generateOpportunityCode();
        } else {
            // Check if opportunity code already exists
            const existing = await this.opportunityRepository.findOne({
                where: { opportunityCode: opportunityData.opportunityCode }
            });
            if (existing) {
                throw new Error("Mã cơ hội đã tồn tại");
            }
        }

        const opportunity = this.opportunityRepository.create({
            ...opportunityData,
            customerType: customerType || CustomerType.DIRECT,
            leadName,
            leadPhone,
            leadEmail,
            leadAddress,
            leadTaxId
        }) as unknown as Opportunities;

        // Handle Customer Logic
        if (customerId) {
            const customer = await this.customerRepository.findOneBy({ id: customerId });
            if (!customer) {
                throw new Error("Không tìm thấy khách hàng");
            }
            opportunity.customer = customer;
            // Clear lead info if customer is selected (optional, but cleaner)
            opportunity.leadName = null;
            opportunity.leadPhone = null;
            opportunity.leadEmail = null;
            opportunity.leadAddress = null;
            opportunity.leadTaxId = null;
        }

        // Handle Referral Logic
        const pId = referralPartnerId || null;
        if (customerType === CustomerType.REFERRAL && pId) {
            const partner = await this.referralPartnerRepository.findOneBy({ id: pId });
            if (!partner) {
                throw new Error("Không tìm thấy đối tác giới thiệu");
            }
            opportunity.referralPartner = partner;
        }

        // Handle CreatedBy Logic
        if (accountId) {
            const user = await this.userRepository.findOne({
                where: { account: { id: accountId } },
                relations: ["account"]
            });
            if (user) {
                opportunity.createdBy = user;

                // Auto-skip approval for BOD/ADMIN
                if (user.account?.role === "BOD" || user.account?.role === "ADMIN") {
                    opportunity.status = OpportunityStatus.QUOTATION_DRAFTING;
                }
            }
        }

        const savedOpportunity = await this.opportunityRepository.save(opportunity);

        // Handle service and package selection
        await this.syncServicesAndPackages(savedOpportunity, services, packages);

        return await this.getOne(savedOpportunity.id);
    }

    async update(id: string, data: any = {}) {
        const {
            customerId,
            referralPartnerId,
            customerType,
            // Lead fields
            leadName,
            leadPhone,
            leadEmail,
            leadAddress,
            leadTaxId,
            services,
            packages,
            ...opportunityData
        } = data;

        let opportunity = await this.getOne(id) as Opportunities;

        if (opportunityData.opportunityCode && opportunityData.opportunityCode !== opportunity.opportunityCode) {
            const existing = await this.opportunityRepository.findOne({
                where: { opportunityCode: opportunityData.opportunityCode }
            });
            if (existing) {
                throw new Error("Mã cơ hội đã tồn tại");
            }
        }

        // Handle Customer updates
        if (customerId) {
            const customer = await this.customerRepository.findOneBy({ id: customerId });
            if (!customer) {
                throw new Error("Không tìm thấy khách hàng");
            }
            opportunity.customer = customer;
            // Clear lead fields
            opportunity.leadName = null;
            opportunity.leadPhone = null;
            opportunity.leadEmail = null;
            opportunity.leadAddress = null;
            opportunity.leadTaxId = null;
        } else if (customerId === null) {
            opportunity.customer = null;
        }

        // Handle Referral Logic updates
        if (customerType) {
            opportunity.customerType = customerType;
        }

        const pId = referralPartnerId !== undefined ? referralPartnerId : undefined;

        if (pId) {
            const partner = await this.referralPartnerRepository.findOneBy({ id: pId });
            if (!partner) {
                throw new Error("Không tìm thấy đối tác giới thiệu");
            }
            opportunity.referralPartner = partner;
            // Nếu có đối tác thì tự động chuyển sang loại REFERRAL nếu chưa là REFERRAL
            if (opportunity.customerType !== CustomerType.REFERRAL) {
                opportunity.customerType = CustomerType.REFERRAL;
            }
        } else if (pId === null || (customerType === CustomerType.DIRECT)) {
            opportunity.referralPartner = null;
        }

        // Update Lead fields
        if (leadName !== undefined) opportunity.leadName = leadName;
        if (leadPhone !== undefined) opportunity.leadPhone = leadPhone;
        if (leadEmail !== undefined) opportunity.leadEmail = leadEmail;
        if (leadAddress !== undefined) opportunity.leadAddress = leadAddress;
        if (leadTaxId !== undefined) opportunity.leadTaxId = leadTaxId;

        Object.assign(opportunity, opportunityData);
        const savedOpportunity = await this.opportunityRepository.save(opportunity);

        // Update services and packages if provided
        if ((services && Array.isArray(services)) || (packages && Array.isArray(packages))) {
            await this.syncServicesAndPackages(savedOpportunity, services, packages);
        }

        return await this.getOne(savedOpportunity.id);
    }

    async delete(id: string) {
        const opportunity = await this.getOne(id);
        await this.opportunityRepository.remove(opportunity);
        return { message: "Xóa cơ hội kinh doanh thành công" };
    }

    async approve(id: string) {
        const opportunity = await this.getOne(id);

        if (opportunity.status !== OpportunityStatus.PENDING_OPP_APPROVAL) {
            throw new Error("Chỉ có thể duyệt cơ hội đang ở trạng thái chờ duyệt");
        }

        opportunity.status = OpportunityStatus.QUOTATION_DRAFTING;
        await this.opportunityRepository.save(opportunity);

        return { message: "Duyệt cơ hội thành công", opportunity };
    }

    private async syncServicesAndPackages(opportunity: Opportunities, services: any[], packages: any[]) {
        // Clear existing services and packages
        await this.opportunityServiceRepository.delete({ opportunity: { id: opportunity.id } });
        await this.opportunityPackageRepository.delete({ opportunity: { id: opportunity.id } });

        // Handle Packages
        if (packages && Array.isArray(packages)) {
            for (const pkgItem of packages) {
                const pkg = this.opportunityPackageRepository.create({
                    opportunity: opportunity,
                    servicePackageId: pkgItem.servicePackageId,
                    name: pkgItem.name,
                    description: pkgItem.description,
                    quantity: pkgItem.quantity || 1
                });
                const savedPkg = await this.opportunityPackageRepository.save(pkg);

                if (pkgItem.services && Array.isArray(pkgItem.services)) {
                    for (const s of pkgItem.services) {
                        // Ensure we use the correct ID property from the frontend payload
                        const serviceId = s.serviceId || s.id;
                        if (!serviceId) {
                            console.warn(`[OpportunityService] Missing serviceId for item in package ${savedPkg.name}`);
                            continue;
                        }

                        const service = await this.serviceRepository.findOneBy({ id: serviceId });
                        if (!service) {
                            console.warn(`[OpportunityService] Service not found for ID: ${serviceId}`);
                            continue;
                        }

                        const oppService = this.opportunityServiceRepository.create({
                            opportunity: opportunity,
                            opportunityPackage: savedPkg,
                            service: service,
                            serviceId: service.id,
                            sellingPrice: s.sellingPrice || service.costPrice || 0,
                            costAtSale: service.costPrice || 0,
                            quantity: (s.quantity || 1) * (savedPkg.quantity || 1),
                            name: s.name || service.name,
                            packageName: savedPkg.name,
                            isPackageService: true
                        });
                        await this.opportunityServiceRepository.save(oppService);
                    }
                }
            }
        }

        // Handle Standalone Services
        if (services && Array.isArray(services)) {
            for (const item of services) {
                const serviceId = typeof item === 'string' ? item : (item.serviceId || item.id);
                const quantity = typeof item === 'object' ? (item.quantity || 1) : 1;
                const sellingPrice = typeof item === 'object' ? item.sellingPrice : undefined;

                const service = await this.serviceRepository.findOneBy({ id: serviceId });
                if (!service) {
                    throw new Error(`Không tìm thấy dịch vụ với ID: ${serviceId}.`);
                }

                const oppService = this.opportunityServiceRepository.create({
                    opportunity: opportunity,
                    service: service,
                    serviceId: service.id,
                    sellingPrice: sellingPrice || service.costPrice || 0,
                    costAtSale: service.costPrice || 0,
                    quantity: quantity,
                    name: (typeof item === 'object' ? item.name : null) || service.name,
                    isPackageService: false
                });
                await this.opportunityServiceRepository.save(oppService);
            }
        }
    }
}
