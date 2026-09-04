import { AppDataSource } from "../data-source";
import { ContractAddendums, AddendumStatus, AddendumType } from "../entity/ContractAddendum.entity";
import { Contracts } from "../entity/Contract.entity";
import { ContractServices, ContractServiceStatus } from "../entity/ContractService.entity";
import { PaymentMilestones, MilestoneStatus } from "../entity/PaymentMilestone.entity";
import { Services } from "../entity/Service.entity";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus } from "../entity/Enums";
import { Users } from "../entity/User.entity";
import { DebtService } from "./Debt.Service";

export class ContractAddendumService {
    private addendumRepository = AppDataSource.getRepository(ContractAddendums);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private serviceRepository = AppDataSource.getRepository(Services);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private debtService = new DebtService();

    private async getReviewer(userInfo?: { id?: string, userId?: string }) {
        const userId = userInfo?.userId || userInfo?.id;
        if (!userId) return undefined;
        return await AppDataSource.getRepository(Users).findOneBy({ id: userId });
    }

    async create(data: { contractId: string, name: string, description?: string }) {
        const contract = await this.contractRepository.findOneBy({ id: data.contractId });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        const addendum = this.addendumRepository.create({
            contract,
            name: data.name,
            description: data.description,
            status: AddendumStatus.DRAFT
        });

        return await this.addendumRepository.save(addendum);
    }

    async addItems(addendumId: string, data: { services: any[], milestones: any[] }) {
        const addendum = await this.addendumRepository.findOne({
            where: { id: addendumId },
            relations: ["contract", "quotation"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        let totalSellingPrice = 0;
        let totalCost = 0;

        // 1. Process Items from Quotation (if linked)
        if (addendum.quotation) {
            const quotation = await AppDataSource.getRepository("Quotations").findOne({
                where: { id: addendum.quotation.id },
                relations: ["details", "details.service", "details.job"]
            }) as any;

            if (quotation) {
                for (const d of quotation.details) {
                    const addendumService = this.contractServiceRepository.create({
                        contract: addendum.contract,
                        addendum: addendum,
                        service: d.service,
                        job: d.job,
                        sellingPrice: d.sellingPrice,
                        status: ContractServiceStatus.ACTIVE
                    });
                    await this.contractServiceRepository.save(addendumService);
                    totalSellingPrice += Number(d.sellingPrice);
                    totalCost += Number(d.costAtSale || 0);
                }
            }
        }

        // 2. Process Manual Services (If provided directly)
        if (data.services) {
            for (const s of data.services) {
                const serviceDef = await this.serviceRepository.findOneBy({ id: s.serviceId });
                const addendumService = this.contractServiceRepository.create({
                    contract: addendum.contract,
                    addendum: addendum,
                    service: serviceDef,
                    sellingPrice: s.sellingPrice,
                    status: ContractServiceStatus.ACTIVE
                });
                await this.contractServiceRepository.save(addendumService);
                totalSellingPrice += Number(s.sellingPrice);
            }
        }

        // 3. Process Milestones
        if (data.milestones) {
            for (const m of data.milestones) {
                const milestone = this.milestoneRepository.create({
                    contract: addendum.contract,
                    addendum: addendum,
                    name: m.name,
                    percentage: m.percentage,
                    amount: m.amount,
                    status: MilestoneStatus.PENDING,
                    dueDate: m.dueDate
                });
                await this.milestoneRepository.save(milestone);
            }
        }

        addendum.sellingPrice = totalSellingPrice;
        addendum.cost = totalCost; // Update addendum cost estimate
        return await this.addendumRepository.save(addendum);
    }

    async uploadSigned(id: string, fileData: any) {
        const addendum = await this.addendumRepository.findOne({
            where: { id },
            relations: ["contract", "milestones", "services"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        addendum.signed_contract = fileData.url;
        addendum.status = AddendumStatus.SIGNED;

        // Update Contract Totals (Revenue and Cost)
        const contract = addendum.contract;
        contract.sellingPrice = Number(contract.sellingPrice) + Number(addendum.sellingPrice);
        contract.cost = Number(contract.cost || 0) + Number(addendum.cost || 0);
        await this.contractRepository.save(contract);

        // Activate Debts for addendum milestones
        for (const milestone of addendum.milestones) {
            await this.debtService.createFromMilestone(milestone.id);
        }

        return await this.addendumRepository.save(addendum);
    }

    async scaleDown(addendumId: string, data: { cancelServiceIds: string[], refundAmount: number }) {
        const addendum = await this.addendumRepository.findOne({
            where: { id: addendumId },
            relations: ["contract"]
        });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");

        // 1. Cancel services
        for (const sId of data.cancelServiceIds) {
            const contractService = await this.contractServiceRepository.findOneBy({ id: sId });
            if (contractService) {
                contractService.status = ContractServiceStatus.CANCELLED;
                await this.contractServiceRepository.save(contractService);
            }
        }

        // 2. Record the scale down amount (negative)
        addendum.sellingPrice = -Math.abs(data.refundAmount);
        addendum.name += " (Cắt giảm hạng mục)";

        return await this.addendumRepository.save(addendum);
    }

    async saleApprove(id: string, userInfo?: { id?: string, userId?: string }, note?: string) {
        const addendum = await this.addendumRepository.findOne({ where: { id } });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (addendum.type !== AddendumType.MONTHLY_TASKS) throw new Error("Phụ lục này không thuộc luồng công việc tháng mới");
        if (addendum.status !== AddendumStatus.PENDING_SALE) throw new Error("Phụ lục không ở trạng thái chờ Sale duyệt");

        addendum.status = AddendumStatus.PENDING_BOD;
        addendum.saleReviewedBy = await this.getReviewer(userInfo) as any;
        addendum.saleReviewedAt = new Date();
        addendum.saleReviewNote = note;
        return await this.addendumRepository.save(addendum);
    }

    async saleReject(id: string, userInfo?: { id?: string, userId?: string }, note?: string) {
        const addendum = await this.addendumRepository.findOne({ where: { id } });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (addendum.type !== AddendumType.MONTHLY_TASKS) throw new Error("Phụ lục này không thuộc luồng công việc tháng mới");
        if (addendum.status !== AddendumStatus.PENDING_SALE) throw new Error("Phụ lục không ở trạng thái chờ Sale duyệt");

        addendum.status = AddendumStatus.SALE_REJECTED;
        addendum.saleReviewedBy = await this.getReviewer(userInfo) as any;
        addendum.saleReviewedAt = new Date();
        addendum.saleReviewNote = note;
        return await this.addendumRepository.save(addendum);
    }

    async bodApprove(id: string, userInfo?: { id?: string, userId?: string }, note?: string) {
        return await AppDataSource.transaction(async (manager) => {
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
            if (addendum.type !== AddendumType.MONTHLY_TASKS) throw new Error("Phụ lục này không thuộc luồng công việc tháng mới");
            if (addendum.status !== AddendumStatus.PENDING_BOD) throw new Error("Phụ lục không ở trạng thái chờ BOD duyệt");
            if (!addendum.contract || !addendum.project) throw new Error("Phụ lục thiếu thông tin hợp đồng hoặc dự án");

            const selectedItems = Array.isArray(addendum.selectedItems) ? addendum.selectedItems : [];
            if (selectedItems.length === 0) throw new Error("Phụ lục chưa có dịch vụ được chọn");

            let createdTasks = 0;
            for (const item of selectedItems) {
                const service = await serviceRepository.findOne({
                    where: { id: item.serviceId },
                    relations: ["serviceJobs", "serviceJobs.job"]
                });
                if (!service) throw new Error(`Không tìm thấy dịch vụ ${item.serviceName || item.serviceId}`);

                const contractService = contractServiceRepository.create({
                    contract: addendum.contract,
                    addendum,
                    service,
                    serviceId: service.id,
                    sellingPrice: item.sellingPrice || 0,
                    status: ContractServiceStatus.ACTIVE,
                    name: item.serviceName || service.name,
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

                        const seq = (totalCountForProject + 1).toString().padStart(2, "0");
                        const jobCode = job.code || `JOB${job.id}`;
                        const taskCode = `${addendum.contract.contractCode}-${jobCode}-${seq}`;

                        const task = taskRepository.create({
                            code: taskCode,
                            name: job.name,
                            project: addendum.project,
                            job,
                            contractService: savedContractService,
                            status: TaskStatus.PENDING,
                            performerType: job.defaultPerformerType,
                            attachments: addendum.contract.attachments || [],
                            isOutput: serviceJob.isOutput
                        });
                        await taskRepository.save(task);
                        createdTasks += 1;
                    }
                }
            }

            addendum.status = AddendumStatus.APPROVED;
            const reviewerId = userInfo?.userId || userInfo?.id;
            addendum.bodReviewedBy = reviewerId ? await userRepository.findOneBy({ id: reviewerId }) as any : undefined as any;
            addendum.bodReviewedAt = new Date();
            addendum.bodReviewNote = note;
            const saved = await addendumRepository.save(addendum);
            return { message: "Đã duyệt phụ lục và sinh công việc tháng mới", addendum: saved, createdTasks };
        });
    }

    async bodReject(id: string, userInfo?: { id?: string, userId?: string }, note?: string) {
        const addendum = await this.addendumRepository.findOne({ where: { id } });
        if (!addendum) throw new Error("Không tìm thấy phụ lục");
        if (addendum.type !== AddendumType.MONTHLY_TASKS) throw new Error("Phụ lục này không thuộc luồng công việc tháng mới");
        if (addendum.status !== AddendumStatus.PENDING_BOD) throw new Error("Phụ lục không ở trạng thái chờ BOD duyệt");

        addendum.status = AddendumStatus.BOD_REJECTED;
        addendum.bodReviewedBy = await this.getReviewer(userInfo) as any;
        addendum.bodReviewedAt = new Date();
        addendum.bodReviewNote = note;
        return await this.addendumRepository.save(addendum);
    }
}
