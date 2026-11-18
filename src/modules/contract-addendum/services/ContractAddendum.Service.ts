import { publishAddendumEvent } from "../events/publishAddendumEvent";
import { resolveAddendumBudget, calculateServiceAddendumCost } from "../../../shared/helpers/ServiceAddendumBudget.helper";
import { AppDataSource } from "../../../data-source";
import { ContractAddendums, AddendumStatus, AddendumType } from "../entities/ContractAddendum.entity";
import { Contracts } from "../../contract/entities/Contract.entity";
import { ContractServices, ContractServiceStatus } from "../../contract/entities/ContractService.entity";
import { PaymentMilestones, MilestoneStatus } from "../../payment-milestone/entities/PaymentMilestone.entity";
import { Services } from "../../service/entities/Service.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { TaskStatus } from "../../../shared/entities/Enums";
import { Users } from "../../user/entities/User.entity";
import { Projects } from "../../project/entities/Project.entity";
import { MemberRole, memberHasRole } from "../../project/entities/TeamMember.entity";
import { DebtService } from "../../debt/services/Debt.Service";
import { buildDefaultTaskNickname } from "../../../shared/helpers/TaskNickname.helper";
import { NotificationService } from "../../notification/services/Notification.Service";
import { EntityManager, In } from "typeorm";
import { UserRole } from "../../account/entities/Account.entity";
import { calculatePricingTotals, roundUnitSellingPrice } from "../../../shared/helpers/PricingTax.helper";
import { CONTRACT_ADDENDUM_EVENTS } from "../events/ContractAddendumEmitter";

export class ContractAddendumService {
    private addendumRepository = AppDataSource.getRepository(ContractAddendums);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private serviceRepository = AppDataSource.getRepository(Services);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private debtService = new DebtService();
    private notificationService = new NotificationService();

    private async getReviewer(userInfo?: { id?: string, userId?: string }) {
        const userId = userInfo?.userId || userInfo?.id;
        if (!userId) return undefined;
        return await AppDataSource.getRepository(Users).findOneBy({ id: userId });
    }

    private async notifyProjectManagers(
        addendum: ContractAddendums,
        data: { title: string, content: string },
        manager?: EntityManager
    ) {
        const projectId = addendum.project?.id;
        if (!projectId) return;

        const projectRepository = manager
            ? manager.getRepository(Projects)
            : AppDataSource.getRepository(Projects);
        const project = await projectRepository.findOne({
            where: { id: projectId },
            relations: ["team", "team.members", "team.members.user"]
        });

        const recipients = (project?.team?.members || [])
            .filter(member => memberHasRole(member, MemberRole.PROJECT_MANAGER) && member.user)
            .map(member => member.user);
        const uniqueRecipients = Array.from(new Map(recipients.map(user => [user.id, user])).values());

        for (const recipient of uniqueRecipients) {
            await this.notificationService.createNotification({
                title: data.title,
                content: data.content,
                type: "CONTRACT_ADDENDUM_REVIEW",
                recipient,
                relatedEntityId: addendum.id,
                relatedEntityType: "ContractAddendum",
                link: `/projects/${projectId}`
            }, manager);
        }
    }

    private async notifyProjectStakeholders(
        addendum: ContractAddendums,
        data: { title: string, content: string, type: string },
        manager?: EntityManager
    ) {
        const projectId = addendum.project?.id;
        if (!projectId) return;

        const projectRepository = manager
            ? manager.getRepository(Projects)
            : AppDataSource.getRepository(Projects);
        const project = await projectRepository.findOne({
            where: { id: projectId },
            relations: [
                "contract",
                "contract.createdBy",
                "contract.createdBy.accounts",
                "contract.opportunity",
                "contract.opportunity.createdBy",
                "contract.opportunity.createdBy.accounts",
                "contract.customer",
                "contract.customer.createdBy",
                "contract.customer.createdBy.accounts",
                "team",
                "team.members",
                "team.members.roles",
                "team.members.user"
            ]
        });
        if (!project) return;

        const recipients: Users[] = [];
        const addRecipient = (user?: Users | null) => {
            if (user?.id && !recipients.some(item => item.id === user.id)) {
                recipients.push(user);
            }
        };
        const addBdRecipient = (user?: Users | null) => {
            const isBd = user?.accounts?.some(account => account.role === UserRole.BD);
            if (isBd) addRecipient(user);
        };

        addBdRecipient(project.contract?.createdBy);
        addBdRecipient(project.contract?.opportunity?.createdBy);
        addBdRecipient(project.contract?.customer?.createdBy);

        for (const member of project.team?.members || []) {
            if (
                memberHasRole(member, MemberRole.ACCOUNT) ||
                memberHasRole(member, MemberRole.PROJECT_MANAGER)
            ) {
                addRecipient(member.user);
            }
        }

        for (const recipient of recipients) {
            await this.notificationService.createNotification({
                title: data.title,
                content: data.content,
                type: data.type,
                recipient,
                relatedEntityId: addendum.id,
                relatedEntityType: "ContractAddendum",
                link: `/projects/${projectId}`
            }, manager);
        }
    }

    async create(data: { contractId: string, name: string, description?: string }) {
        const contract = await this.contractRepository.findOne({
            where: { id: data.contractId },
            relations: ["project"]
        });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        const addendum = this.addendumRepository.create({
            contract,
            project: contract.project,
            name: data.name,
            description: data.description,
            status: AddendumStatus.DRAFT
        });

        const saved = await this.addendumRepository.save(addendum);
        await this.notifyProjectStakeholders(saved, {
            title: "Có phụ lục hợp đồng mới",
            content: `Phụ lục "${saved.name}" vừa được tạo ở trạng thái nháp.`,
            type: "CONTRACT_ADDENDUM_CREATED"
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.CREATED, saved);
        return saved;
    }

    async addItems(addendumId: string, data: { services: any[], milestones: any[] }) {
        const addendum = await this.addendumRepository.findOne({
            where: { id: addendumId },
            relations: ["contract", "quotation"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (addendum.status !== AddendumStatus.DRAFT) {
            throw new Error("Chỉ có thể thêm hạng mục vào phụ lục ở trạng thái nháp");
        }

        let totalSellingPrice = 0;
        let totalCost = 0;

        // 1. Process Items from Quotation (if linked)
        if (addendum.quotation) {
            const quotation = await AppDataSource.getRepository("Quotations").findOne({
                where: { id: addendum.quotation.id },
                relations: ["details", "details.service", "details.job"]
            }) as any;

            if (quotation && Array.isArray(quotation.details)) {
                const quotationServices = quotation.details.map((d: any) => {
                    const price = roundUnitSellingPrice(d.sellingPrice);
                    totalSellingPrice += price;
                    totalCost += Number(d.costAtSale || 0);
                    return this.contractServiceRepository.create({
                        contract: addendum.contract,
                        addendum: addendum,
                        service: d.service,
                        job: d.job,
                        serviceId: d.service?.id,
                        sellingPrice: price,
                        budget: Number(d.budget || 0),
                        name: d.name || d.service?.name,
                        code: d.service?.code,
                        status: ContractServiceStatus.ACTIVE
                    });
                });
                if (quotationServices.length > 0) {
                    await this.contractServiceRepository.save(quotationServices);
                }
            }
        }

        // 2. Process Manual Services (If provided directly) - Batched
        if (data.services && data.services.length > 0) {
            const serviceIds = [...new Set(data.services.map((s: any) => s.serviceId).filter(Boolean))];
            const serviceDefs = serviceIds.length > 0
                ? await this.serviceRepository.findBy({ id: In(serviceIds) })
                : [];
            const serviceMap = new Map(serviceDefs.map(s => [s.id, s]));

            const manualServices = data.services.map((s: any) => {
                const serviceDef = serviceMap.get(s.serviceId);
                const price = roundUnitSellingPrice(s.sellingPrice);
                totalSellingPrice += price;
                return this.contractServiceRepository.create({
                    contract: addendum.contract,
                    addendum: addendum,
                    service: serviceDef,
                    serviceId: serviceDef?.id,
                    sellingPrice: price,
                    budget: Number(s.budget || 0),
                    name: s.serviceName || serviceDef?.name,
                    code: serviceDef?.code,
                    status: ContractServiceStatus.ACTIVE
                });
            });
            await this.contractServiceRepository.save(manualServices);
        }

        // 3. Process Milestones - Batched
        if (data.milestones && data.milestones.length > 0) {
            const milestones = data.milestones.map((m: any) => this.milestoneRepository.create({
                contract: addendum.contract,
                addendum: addendum,
                name: m.name,
                percentage: m.percentage,
                amount: m.amount,
                status: MilestoneStatus.PENDING,
                dueDate: m.dueDate
            }));
            await this.milestoneRepository.save(milestones);
        }

        Object.assign(addendum, calculatePricingTotals(totalSellingPrice));
        addendum.cost = totalCost; // Update addendum cost estimate
        const saved = await this.addendumRepository.save(addendum);
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.UPDATED, saved);
        return saved;
    }

    async uploadSigned(id: string, fileData: any) {
        const addendum = await this.addendumRepository.findOne({
            where: { id },
            relations: ["contract", "project", "milestones", "services"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        if (addendum.status === AddendumStatus.SIGNED) {
            throw new Error("Phụ lục hợp đồng này đã được upload bản ký trước đó");
        }

        const signedUrl = typeof fileData?.url === "string" ? fileData.url.trim() : "";
        if (!signedUrl || !/^https?:\/\//i.test(signedUrl)) {
            throw new Error("Đường dẫn file hợp đồng đã ký không hợp lệ hoặc thiếu giao thức http/https");
        }

        addendum.signed_contract = signedUrl;
        addendum.status = AddendumStatus.SIGNED;

        // Update Contract Totals (Revenue and Cost)
        const contract = addendum.contract;
        Object.assign(contract, calculatePricingTotals(
            Number(contract.sellingPrice) + Number(addendum.sellingPrice),
            contract.vatRate || 8
        ));
        contract.cost = Number(contract.cost || 0) + Number(addendum.cost || 0);
        await this.contractRepository.save(contract);

        // Activate Debts for addendum milestones
        for (const milestone of addendum.milestones) {
            await this.debtService.createFromMilestone(milestone.id);
        }

        const saved = await this.addendumRepository.save(addendum);
        await this.notifyProjectStakeholders(saved, {
            title: "Phụ lục hợp đồng đã ký",
            content: `Phụ lục "${saved.name}" đã được upload bản ký và kích hoạt các mốc thanh toán liên quan.`,
            type: "CONTRACT_ADDENDUM_SIGNED"
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.SIGNED, saved);
        return saved;
    }

    async scaleDown(addendumId: string, data: { cancelServiceIds: string[], refundAmount: number }) {
        const addendum = await this.addendumRepository.findOne({
            where: { id: addendumId },
            relations: ["contract", "project"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        // 1. Cancel services (Batched)
        if (data.cancelServiceIds && data.cancelServiceIds.length > 0) {
            const contractServices = await this.contractServiceRepository.findBy({
                id: In(data.cancelServiceIds)
            });
            for (const cs of contractServices) {
                cs.status = ContractServiceStatus.CANCELLED;
            }
            if (contractServices.length > 0) {
                await this.contractServiceRepository.save(contractServices);
            }
        }

        // 2. Record the scale down amount (negative)
        Object.assign(addendum, calculatePricingTotals(-Math.abs(data.refundAmount)));
        addendum.name += " (Cắt giảm hạng mục)";

        const saved = await this.addendumRepository.save(addendum);
        await this.notifyProjectStakeholders(saved, {
            title: "Phụ lục cắt giảm hạng mục",
            content: `Phụ lục "${saved.name}" đã được cập nhật cắt giảm hạng mục với giá trị hoàn/giảm ${Math.abs(Number(data.refundAmount || 0)).toLocaleString("vi-VN")}đ.`,
            type: "CONTRACT_ADDENDUM_SCALE_DOWN"
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.UPDATED, saved);
        return saved;
    }

    private async applySaleSelectedItems(addendum: ContractAddendums, selectedItems?: any[]) {
        if (!selectedItems) return;
        const currentItems = Array.isArray(addendum.selectedItems) ? addendum.selectedItems : [];
        if (selectedItems.length !== currentItems.length) {
            throw new Error("Danh sách dịch vụ cập nhật không hợp lệ");
        }

        const updatedItems = await Promise.all(selectedItems.map(async (item, index) => {
            const currentItem = currentItems[index];
            if (String(item.serviceId || "") !== String(currentItem.serviceId || "")) {
                throw new Error("Danh sách dịch vụ cập nhật không hợp lệ");
            }

            const sellingPrice = roundUnitSellingPrice(item.sellingPrice || 0);
            if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
                throw new Error("Đơn giá dịch vụ không hợp lệ");
            }

            const budget = addendum.type === AddendumType.ADD_SERVICES
                ? resolveAddendumBudget(
                    await this.serviceRepository.findOneBy({ id: currentItem.serviceId }),
                    item.budget, currentItem.budget ?? 0
                ) : currentItem.budget;
            return {
                ...currentItem,
                sellingPrice,
                ...(addendum.type === AddendumType.ADD_SERVICES ? { budget } : {})
            };
        }));
        addendum.selectedItems = updatedItems;
        if (addendum.type === AddendumType.ADD_SERVICES) {
            addendum.cost = calculateServiceAddendumCost(updatedItems);
        }
        Object.assign(addendum, calculatePricingTotals(addendum.selectedItems.reduce((sum, item) =>
            sum + Number(item.sellingPrice || 0) * Number(item.quantity || 1), 0)));
    }

    private assertCanResubmit(userInfo?: { role?: string }) {
        if (![UserRole.PM, UserRole.ADMIN].includes(userInfo?.role as UserRole)) {
            throw new Error("Bạn không có quyền gửi lại phụ lục");
        }
    }

    async saleApprove(id: string, userInfo?: { id?: string, userId?: string }, note?: string, selectedItems?: any[]) {
        const addendum = await this.addendumRepository.findOne({
            where: { id },
            relations: ["contract", "project"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (![AddendumType.MONTHLY_TASKS, AddendumType.ADD_SERVICES].includes(addendum.type)) throw new Error("Phụ lục này không thuộc luồng cần duyệt");
        if (addendum.status !== AddendumStatus.PENDING_SALE) throw new Error("Phụ lục không ở trạng thái chờ Sale duyệt");

        await this.applySaleSelectedItems(addendum, selectedItems);
        addendum.status = AddendumStatus.PENDING_BOD;
        addendum.saleReviewedBy = await this.getReviewer(userInfo) as any;
        addendum.saleReviewedAt = new Date();
        addendum.saleReviewNote = note;
        const saved = await this.addendumRepository.save(addendum);
        await this.notifyProjectManagers(saved, {
            title: "Phụ lục đã được duyệt bước Sale",
            content: `Phụ lục "${saved.name}" đã được duyệt và chuyển sang bước BOD duyệt.`
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.UPDATED, saved);
        return saved;
    }

    async resubmit(
        id: string,
        userInfo?: { id?: string, userId?: string, role?: string },
        data: { selectedItems?: any[], name?: string, description?: string } = {}
    ) {
        this.assertCanResubmit(userInfo);

        const addendum = await this.addendumRepository.findOne({
            where: { id },
            relations: ["contract", "project"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (![AddendumType.MONTHLY_TASKS, AddendumType.ADD_SERVICES].includes(addendum.type)) throw new Error("Phụ lục này không thuộc luồng gửi lại");
        if (![AddendumStatus.SALE_REJECTED, AddendumStatus.BOD_REJECTED].includes(addendum.status)) {
            throw new Error("Chỉ có thể gửi lại phụ lục đã bị từ chối");
        }

        if (typeof data.name === "string" && data.name.trim()) {
            addendum.name = data.name.trim();
        }
        if (typeof data.description === "string") {
            addendum.description = data.description;
        }

        await this.applySaleSelectedItems(addendum, data.selectedItems);
        addendum.status = AddendumStatus.PENDING_SALE;
        addendum.saleReviewedBy = null as any;
        addendum.saleReviewedAt = null as any;
        addendum.saleReviewNote = null as any;
        addendum.bodReviewedBy = null as any;
        addendum.bodReviewedAt = null as any;
        addendum.bodReviewNote = null as any;

        const saved = await this.addendumRepository.save(addendum);
        await this.notifyProjectStakeholders(saved, {
            title: "Phụ lục đã được gửi lại",
            content: `Phụ lục "${saved.name}" đã được gửi lại và đang chờ Sale duyệt.`,
            type: "CONTRACT_ADDENDUM_RESUBMITTED"
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.UPDATED, saved);
        return saved;
    }

    async saleReject(id: string, userInfo?: { id?: string, userId?: string }, note?: string) {
        const addendum = await this.addendumRepository.findOne({
            where: { id },
            relations: ["contract", "project"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (![AddendumType.MONTHLY_TASKS, AddendumType.ADD_SERVICES].includes(addendum.type)) throw new Error("Phụ lục này không thuộc luồng cần duyệt");
        if (addendum.status !== AddendumStatus.PENDING_SALE) throw new Error("Phụ lục không ở trạng thái chờ Sale duyệt");

        addendum.status = AddendumStatus.SALE_REJECTED;
        addendum.saleReviewedBy = await this.getReviewer(userInfo) as any;
        addendum.saleReviewedAt = new Date();
        addendum.saleReviewNote = note;
        const saved = await this.addendumRepository.save(addendum);
        await this.notifyProjectManagers(saved, {
            title: "Phụ lục không được duyệt bước Sale",
            content: `Phụ lục "${saved.name}" đã bị từ chối ở bước Sale${note ? `: ${note}` : "."}`
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.REJECTED, saved);
        return saved;
    }

    async bodApprove(id: string, userInfo?: { id?: string, userId?: string }, note?: string) {
        const result = await AppDataSource.transaction(async (manager) => {
            const addendumRepository = manager.getRepository(ContractAddendums);
            const contractServiceRepository = manager.getRepository(ContractServices);
            const taskRepository = manager.getRepository(Tasks);
            const serviceRepository = manager.getRepository(Services);
            const userRepository = manager.getRepository(Users);

            const addendum = await addendumRepository.findOne({
                where: { id },
                relations: ["contract", "project"]
            });
            if (!addendum) throw new Error("Không tìm thấy phụ lục");
            if (![AddendumType.MONTHLY_TASKS, AddendumType.ADD_SERVICES].includes(addendum.type)) throw new Error("Phụ lục này không thuộc luồng cần duyệt");
            if (addendum.status !== AddendumStatus.PENDING_BOD) throw new Error("Phụ lục không ở trạng thái chờ BOD duyệt");
            if (!addendum.contract || !addendum.project) throw new Error("Phụ lục thiếu thông tin hợp đồng hoặc dự án");

            const selectedItems = Array.isArray(addendum.selectedItems) ? addendum.selectedItems : [];
            if (selectedItems.length === 0) throw new Error("Phụ lục chưa có dịch vụ được chọn");

            // Batch fetch all services and their relations upfront to avoid N+1 queries
            const serviceIds = [...new Set(selectedItems.map((item: any) => item.serviceId).filter(Boolean))];
            const services = serviceIds.length > 0 ? await serviceRepository.find({
                where: { id: In(serviceIds) },
                relations: ["serviceJobs", "serviceJobs.job"]
            }) : [];
            const serviceMap = new Map(services.map(s => [s.id, s]));

            let createdTasks = 0;
            for (const item of selectedItems) {
                const serviceQuantity = Number(item.quantity || 1);
                if (!Number.isInteger(serviceQuantity) || serviceQuantity <= 0) throw new Error("Số lượng dịch vụ không hợp lệ");

                const service = serviceMap.get(item.serviceId);
                if (!service) throw new Error(`Không tìm thấy dịch vụ ${item.serviceName || item.serviceId}`);

                for (let serviceIndex = 0; serviceIndex < serviceQuantity; serviceIndex++) {
                    const contractService = contractServiceRepository.create({
                        contract: addendum.contract,
                        addendum,
                        service,
                        serviceId: service.id,
                        sellingPrice: roundUnitSellingPrice(item.sellingPrice || 0),
                        budget: Number(item.budget || 0),
                        status: ContractServiceStatus.ACTIVE,
                        name: item.serviceName || service.name,
                        code: service.code,
                        packageName: item.packageName,
                        isPackageService: !!item.isPackageService
                    });
                    const savedContractService = await contractServiceRepository.save(contractService);

                    for (const serviceJob of service.serviceJobs || []) {
                        const job = serviceJob.job;
                        if (!job) continue;
                        const quantity = Number(serviceJob.quantity || 1);
                        for (let i = 0; i < quantity; i++) {
                            const totalCountForProject = await taskRepository.count({
                                where: {
                                    project: { id: addendum.project.id },
                                    job: { id: job.id }
                                }
                            });

                            const sequenceNumber = totalCountForProject + 1;
                            const seq = sequenceNumber.toString().padStart(2, "0");
                            const serviceCode = savedContractService.code || service.code;
                            const jobCode = job.code || `JOB${job.id}`;
                            const taskCode = [addendum.contract.contractCode, serviceCode, jobCode, seq].filter(Boolean).join("-");

                            const task = taskRepository.create({
                                code: taskCode,
                                name: job.name,
                                nickname: buildDefaultTaskNickname(job, sequenceNumber),
                                project: addendum.project,
                                job,
                                contractService: savedContractService,
                                status: TaskStatus.PENDING,
                                performerType: job.defaultPerformerType,
                                attachments: addendum.contract.attachments || [],
                                isExtra: addendum.type === AddendumType.ADD_SERVICES,
                                isOutput: serviceJob.isOutput
                            });
                            await taskRepository.save(task);
                            createdTasks += 1;
                        }
                    }
                }
            }

            addendum.status = AddendumStatus.APPROVED;
            const reviewerId = userInfo?.userId || userInfo?.id;
            addendum.bodReviewedBy = reviewerId ? await userRepository.findOneBy({ id: reviewerId }) as any : undefined as any;
            addendum.bodReviewedAt = new Date();
            addendum.bodReviewNote = note;
            const saved = await addendumRepository.save(addendum);
            if (addendum.type === AddendumType.ADD_SERVICES) {
                await this.notifyProjectStakeholders(saved, {
                    title: "Dịch vụ phát sinh đã được duyệt",
                    content: `Phụ lục "${saved.name}" đã được duyệt và đã sinh ${createdTasks} công việc phát sinh.`,
                    type: "SERVICE_ADDENDUM_APPROVED"
                }, manager);
            } else {
                await this.notifyProjectManagers(saved, {
                    title: "Phụ lục đã được duyệt",
                    content: `Phụ lục "${saved.name}" đã được duyệt và đã sinh ${createdTasks} công việc tháng mới.`
                }, manager);
            }
            const message = addendum.type === AddendumType.ADD_SERVICES
                ? "Đã duyệt phụ lục và sinh công việc cho dịch vụ bổ sung"
                : "Đã duyệt phụ lục và sinh công việc tháng mới";
            return { message, addendum: saved, createdTasks };
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.APPROVED, result.addendum);
        return result;
    }

    async bodReject(id: string, userInfo?: { id?: string, userId?: string }, note?: string) {
        const addendum = await this.addendumRepository.findOne({
            where: { id },
            relations: ["contract", "project"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (![AddendumType.MONTHLY_TASKS, AddendumType.ADD_SERVICES].includes(addendum.type)) throw new Error("Phụ lục này không thuộc luồng cần duyệt");
        if (addendum.status !== AddendumStatus.PENDING_BOD) throw new Error("Phụ lục không ở trạng thái chờ BOD duyệt");

        addendum.status = AddendumStatus.BOD_REJECTED;
        addendum.bodReviewedBy = await this.getReviewer(userInfo) as any;
        addendum.bodReviewedAt = new Date();
        addendum.bodReviewNote = note;
        const saved = await this.addendumRepository.save(addendum);
        await this.notifyProjectManagers(saved, {
            title: "Phụ lục không được duyệt bước BOD",
            content: `Phụ lục "${saved.name}" đã bị từ chối ở bước BOD${note ? `: ${note}` : "."}`
        });
        await publishAddendumEvent(CONTRACT_ADDENDUM_EVENTS.REJECTED, saved);
        return saved;
    }
}
