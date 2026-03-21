import { AppDataSource } from "../data-source";
import { Opportunities, CustomerType, OpportunityStatus } from "../entity/Opportunity.entity";
import { Customers } from "../entity/Customer.entity";
import { OpportunityServices } from "../entity/OpportunityService.entity";
import { Services } from "../entity/Service.entity";
import { ReferralPartners } from "../entity/ReferralPartner.entity";
import { Users } from "../entity/User.entity";
import { OpportunityPackages } from "../entity/OpportunityPackage.entity";
import { ServicePackages } from "../entity/ServicePackage.entity";
import { Like, In } from "typeorm";
import { SecurityService } from "./Security.Service";
import { NotificationService } from "./Notification.Service";
import { UserRole } from "../entity/Account.entity";
import { Not } from "typeorm";
import { validateLeadData } from "../validations/Customer.Validation";
import { RedisService } from "./Redis.Service";

export class OpportunityService {
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private customerRepository = AppDataSource.getRepository(Customers);
    private referralPartnerRepository = AppDataSource.getRepository(ReferralPartners);
    private userRepository = AppDataSource.getRepository(Users);
    private opportunityPackageRepository = AppDataSource.getRepository(OpportunityPackages);
    private opportunityServiceRepository = AppDataSource.getRepository(OpportunityServices);
    private serviceRepository = AppDataSource.getRepository(Services);
    private packageRepository = AppDataSource.getRepository(ServicePackages);
    private notificationService = new NotificationService();

    private async checkTaxIdUniqueness(taxId: string, excludeOpportunityId?: string) {
        if (!taxId) return;

        // 1. Check in Customers (taxId)
        const customerExists = await this.customerRepository.findOne({
            where: { taxId }
        });

        if (customerExists) {
            throw new Error("Khách hàng này đã tồn tại trên hệ thống ");
        }

        // 2. Check in Opportunities (leadTaxId)
        const opportunityExists = await this.opportunityRepository.findOne({
            where: {
                leadTaxId: taxId,
                ...(excludeOpportunityId ? { id: Not(excludeOpportunityId) } : {})
            }
        });

        if (opportunityExists) {
            throw new Error("Mã số thuế này đã tồn tại trên hệ thống (Cơ hội)");
        }
    }

    async getAll(filters: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";
        const searchTerm = filters.search ? `%${filters.search}%` : null;

        // Apply RBAC filters
        let rbacWhere: any = {};
        if (userInfo) {
            try {
                rbacWhere = SecurityService.getOpportunityFilters(userInfo);
            } catch (error: any) {
                if (error.message === "FORBIDDEN_ACCESS") {
                    return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
                }
                throw error;
            }
        }

        // Start with common filters
        const commonWhere: any = {};

        if (filters.status && filters.status !== 'ALL') {
            commonWhere.status = filters.status;
        }

        if (filters.customerId) {
            commonWhere.customer = { id: filters.customerId };
        }

        const finalWhereConditions: any[] = [];

        // Helper to combine conditions
        const combineConditions = (base: any, additional: any) => {
            return { ...base, ...additional };
        };

        // If RBAC returns an array (OR conditions for RBAC)
        if (Array.isArray(rbacWhere)) {
            for (const rbacCond of rbacWhere) {
                const currentBase = combineConditions(commonWhere, rbacCond);
                if (searchTerm) {
                    const searchableFields = ["name", "leadName"];
                    const relationSearchFields = [
                        {
                            customer: {
                                ...currentBase.customer,
                                name: Like(searchTerm)
                            }
                        },
                        { opportunityCode: Like(searchTerm) } // Corrected to directly use Like on opportunityCode
                    ];

                    searchableFields.forEach(field => {
                        finalWhereConditions.push({ ...currentBase, [field]: Like(searchTerm) });
                    });
                    relationSearchFields.forEach(relSearch => {
                        finalWhereConditions.push({ ...currentBase, ...relSearch });
                    });
                } else {
                    finalWhereConditions.push(currentBase);
                }
            }
        } else { // RBAC returns a single object (AND conditions for RBAC)
            const currentBase = combineConditions(commonWhere, rbacWhere);
            if (searchTerm) {
                const searchableFields = ["name", "leadName"];
                const relationSearchFields = [
                    {
                        customer: {
                            ...currentBase.customer,
                            name: Like(searchTerm)
                        }
                    },
                    { opportunityCode: Like(searchTerm) } // Corrected
                ];

                searchableFields.forEach(field => {
                    finalWhereConditions.push({ ...currentBase, [field]: Like(searchTerm) });
                });
                relationSearchFields.forEach(relSearch => {
                    finalWhereConditions.push({ ...currentBase, ...relSearch });
                });
            } else {
                finalWhereConditions.push(currentBase);
            }
        }

        const filtersKey = JSON.stringify(filters);
        const userInfoKey = userInfo ? `role_${userInfo.role}:user_${userInfo.id}` : 'no_user';
        const cacheKey = `opportunities:all:${userInfoKey}:${filtersKey}`;

        return await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            const [items, total] = await this.opportunityRepository.findAndCount({
                where: finalWhereConditions.length > 1 ? finalWhereConditions : finalWhereConditions[0],
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
        });
    }

    async getOne(id: string, userInfo?: { id: string, role: string, userId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getOpportunityFilters(userInfo);
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
        const cacheKey = `opportunities:detail:${id}${userInfoKey}`;

        const result = await RedisService.fetchWithCache(cacheKey, 3600, async () => {
            const opportunity = await this.opportunityRepository.findOne({
                where: rbacWhere,
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
            return opportunity;
        });
        if (!result) {
            throw new Error("Không tìm thấy cơ hội kinh doanh hoặc bạn không có quyền xem");
        }
        return result;
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

    async create(data: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
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

        validateLeadData(data);

        if (leadTaxId) {
            await this.checkTaxIdUniqueness(leadTaxId);
        }

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
        if (userInfo?.userId) {
            const user = await this.userRepository.findOne({
                where: { id: userInfo.userId },
                relations: ["account"]
            });
            if (user) {
                opportunity.createdBy = user;
                const role = user.account?.role || userInfo.role;
                // Auto-skip approval for BOD/ADMIN
                if (role === "BOD" || role === "ADMIN") {
                    opportunity.status = OpportunityStatus.QUOTATION_DRAFTING;
                }
            }
        }

        const savedOpportunity = await this.opportunityRepository.save(opportunity);

        // Handle service and package selection
        await this.syncServicesAndPackages(savedOpportunity, services, packages);

        // --- Notifications ---
        if (opportunity.createdBy) {
            const creatorRole = opportunity.createdBy.account?.role;
            // Notify BOD and ADMIN if creator is NOT one of them
            if (creatorRole !== UserRole.BOD && creatorRole !== UserRole.ADMIN) {
                const managementUsers = await this.userRepository.find({
                    where: { account: { role: In([UserRole.BOD, UserRole.ADMIN]) } },
                    relations: ["account"]
                });

                for (const user of managementUsers) {
                    await this.notificationService.createNotification({
                        title: "Cơ hội kinh doanh mới",
                        content: `Cơ hội "${savedOpportunity.name}" (${savedOpportunity.opportunityCode}) đã được tạo bởi ${opportunity.createdBy.fullName}.`,
                        type: "OPPORTUNITY_CREATED",
                        recipient: user,
                        sender: opportunity.createdBy,
                        relatedEntityId: savedOpportunity.id,
                        relatedEntityType: "Opportunities"
                    });
                }
            }
        }

        // Invalidate list caches
        await RedisService.deleteCache('opportunities:all*');

        return await this.getOne(savedOpportunity.id);
    }

    async update(id: string, data: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
        const {
            customerId,
            referralPartnerId,
            customerType,
            source,
            // Lead fields
            leadName,
            leadPhone,
            leadEmail,
            leadAddress,
            leadTaxId,
            services,
            packages,
            ...rest
        } = data;

        validateLeadData(data);

        // Prepare the updated object
        const updateObj: any = { id };

        // 1. Manually update simple fields
        if (leadName !== undefined) updateObj.leadName = leadName;
        if (leadPhone !== undefined) updateObj.leadPhone = leadPhone;
        if (leadEmail !== undefined) updateObj.leadEmail = leadEmail;
        if (leadAddress !== undefined) updateObj.leadAddress = leadAddress;
        if (leadTaxId !== undefined) {
            if (leadTaxId) {
                await this.checkTaxIdUniqueness(leadTaxId, id);
            }
            updateObj.leadTaxId = leadTaxId;
        }

        if (customerType) updateObj.customerType = customerType;

        // Apply remaining simple fields
        const allowedFields = ['name', 'description', 'field', 'expectedRevenue', 'budget', 'startDate', 'endDate', 'priority', 'successChance', 'region', 'durationMonths', 'status', 'partnerCommissionRate', 'expectedPartnerCommission', 'attachments'];
        for (const key of allowedFields) {
            if (rest[key] !== undefined) {
                updateObj[key] = rest[key];
            }
        }

        // 2. Handle Customer relationship
        if (customerId) {
            const customer = await this.customerRepository.findOneBy({ id: customerId });
            if (!customer) throw new Error("Không tìm thấy khách hàng");
            updateObj.customer = customer;
            // Clear lead fields when linking a customer
            updateObj.leadName = null;
            updateObj.leadPhone = null;
            updateObj.leadEmail = null;
            updateObj.leadAddress = null;
            updateObj.leadTaxId = null;
        } else if (customerId === null || customerId === "") {
            updateObj.customer = null;
        }

        // 3. Handle Referral relationship
        const pId = referralPartnerId !== undefined ? referralPartnerId : undefined;
        if (pId) {
            const partner = await this.referralPartnerRepository.findOneBy({ id: pId });
            if (!partner) throw new Error("Không tìm thấy đối tác giới thiệu");
            updateObj.referralPartner = partner;
            if (updateObj.customerType !== CustomerType.REFERRAL) {
                updateObj.customerType = CustomerType.REFERRAL;
            }
        } else if (pId === null || pId === "" || (customerType === CustomerType.DIRECT)) {
            updateObj.referralPartner = null;
        }

        // 4. Save main entity using the update object
        const savedOpportunity = await this.opportunityRepository.save(updateObj);

        // 5. Update services and packages if provided
        if ((services && Array.isArray(services)) || (packages && Array.isArray(packages))) {
            const fullEntity = await this.opportunityRepository.findOneBy({ id });
            if (fullEntity) {
                await this.syncServicesAndPackages(fullEntity, services, packages);
            }
        }

        // 6. Invalidate caches
        await RedisService.deleteCache('opportunities:all*');
        await RedisService.deleteCache(`opportunities:detail:${id}*`);

        // 7. Return FRESH data from DB (bypassing the getOne cache)
        return await this.opportunityRepository.findOne({
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
    }

    async delete(id: string) {
        const opportunity = await this.getOne(id);
        await this.opportunityRepository.remove(opportunity);

        // Invalidate list and detail caches
        await RedisService.deleteCache('opportunities:all*');
        await RedisService.deleteCache(`opportunities:detail:${id}*`);

        return { message: "Xóa cơ hội kinh doanh thành công" };
    }

    async approve(id: string) {
        const opportunity = await this.getOne(id);

        if (opportunity.status !== OpportunityStatus.PENDING_OPP_APPROVAL) {
            throw new Error("Chỉ có thể duyệt cơ hội đang ở trạng thái chờ duyệt");
        }

        opportunity.status = OpportunityStatus.QUOTATION_DRAFTING;
        const result = await this.opportunityRepository.save(opportunity);

        // --- Notifications ---
        // Fetch full record to get createdBy
        const doc = await this.getOne(id);
        if (doc.createdBy) {
            const creatorRole = doc.createdBy.account?.role;
            // Notify creator if they are NOT BOD/ADMIN
            if (creatorRole !== UserRole.BOD && creatorRole !== UserRole.ADMIN) {
                await this.notificationService.createNotification({
                    title: "Cơ hội đã được duyệt",
                    content: `Cơ hội "${doc.name}" (${doc.opportunityCode}) của bạn đã được duyệt.`,
                    type: "OPPORTUNITY_APPROVED",
                    recipient: doc.createdBy,
                    relatedEntityId: doc.id,
                    relatedEntityType: "Opportunities"
                });
            }
        }

        // Invalidate list and detail caches
        await RedisService.deleteCache('opportunities:all*');
        await RedisService.deleteCache(`opportunities:detail:${id}*`);

        return { message: "Duyệt cơ hội thành công", opportunity: result };
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
