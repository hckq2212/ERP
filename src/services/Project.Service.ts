import { AppDataSource } from "../data-source";
import { Like, ILike, In, IsNull, Not } from "typeorm";
import { GoogleSheetStatus, Projects, ProjectStatus } from "../entity/Project.entity";
import { Contracts, ContractStatus } from "../entity/Contract.entity";
import { ProjectTeams } from "../entity/ProjectTeam.entity";
import { Users } from "../entity/User.entity";
import { OpportunityStatus } from "../entity/Opportunity.entity";
import { ContractServices } from "../entity/ContractService.entity";
import { AddendumStatus, AddendumType, ContractAddendums } from "../entity/ContractAddendum.entity";
import { Services } from "../entity/Service.entity";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus } from "../entity/Enums";
import { Jobs } from "../entity/Job.entity";
import { PerformerType } from "../entity/Enums";
import { NotificationService } from "./Notification.Service";

import { SecurityService } from "./Security.Service";
import { isProjectManagementRole, isStaffRole, UserRole } from "../entity/Account.entity";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../events/OpportunityEmitter";
import { GoogleSheetService } from "./GoogleSheet.Service";

export class ProjectService {
    private projectRepository = AppDataSource.getRepository(Projects);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private teamRepository = AppDataSource.getRepository(ProjectTeams);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private addendumRepository = AppDataSource.getRepository(ContractAddendums);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private userRepository = AppDataSource.getRepository(Users);
    private notificationService = new NotificationService();
    private googleSheetService = new GoogleSheetService();

    private assertMonthKey(monthKey?: string) {
        const value = monthKey || new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
            throw new Error("Tháng không hợp lệ, định dạng cần là YYYY-MM");
        }
        return value;
    }

    private formatMonthName(monthKey: string) {
        const [year, month] = monthKey.split("-");
        return `${month}/${year}`;
    }

    private canManageMonthlyWork(project: Projects, userInfo?: { id: string, role: string, userId?: string }) {
        if (!userInfo) return false;
        if (isProjectManagementRole(userInfo.role)) return true;
        return project.team?.teamLead?.id === (userInfo.userId || userInfo.id);
    }

    private mapContractServiceToMonthlyItem(cs: ContractServices) {
        const opportunityPackage = cs.opportunityService?.opportunityPackage;
        const packageQuantity = Number(opportunityPackage?.quantity || 1);
        const serviceQuantity = Number(cs.opportunityService?.quantity || 1);

        return {
            contractServiceId: cs.id,
            contractServiceIds: [cs.id],
            serviceId: cs.service?.id || cs.serviceId,
            serviceName: cs.name || cs.service?.name || "Dịch vụ",
            packageKey: opportunityPackage?.id || cs.packageName || cs.id,
            packageName: cs.packageName,
            packageQuantity,
            quantity: cs.isPackageService && packageQuantity > 0 ? serviceQuantity / packageQuantity : 1,
            isPackageService: cs.isPackageService,
            sellingPrice: Number(cs.sellingPrice || 0),
            cost: Number(cs.service?.costPrice || 0),
            unit: cs.service?.unit || "",
            description: cs.service?.description,
            jobs: (cs.service?.serviceJobs || []).map(sj => ({
                jobId: sj.job?.id,
                jobName: sj.job?.name,
                quantity: Number(sj.quantity || 1),
                isOutput: sj.isOutput
            })).filter(job => !!job.jobId)
        };
    }

    private emptySyncResult() {
        return {
            createdTasks: 0,
            updatedOutputTasks: 0,
            backfilledResults: 0
        };
    }

    private buildContractServiceResult(task: Tasks) {
        return {
            taskId: task.id,
            type: task.result?.type || 'file',
            name: task.result?.name || task.nickname || task.name || task.code,
            url: task.result?.url,
            note: task.result?.note,
            checklist: task.result?.checklist,
            status: 'PENDING' as const
        };
    }

    private shouldBackfillResult(task: Tasks) {
        return task.isOutput &&
            !!task.contractService &&
            !!task.result &&
            [TaskStatus.INTERNAL_COMPLETED, TaskStatus.COMPLETED, TaskStatus.ACCEPTED].includes(task.status);
    }

    private async syncContractServiceJobs(projectId: string, options: { allowCompletedProject?: boolean } = {}) {
        const syncResult = this.emptySyncResult();

        const project = await this.projectRepository.findOne({
            where: { id: projectId },
            relations: ["contract"]
        });
        if (!project) throw new Error("KhÃ´ng tÃ¬m tháº¥y dá»± Ã¡n");
        if (!project.contract) throw new Error("Dá»± Ã¡n chÆ°a liÃªn káº¿t há»£p Ä‘á»“ng");
        if (!options.allowCompletedProject &&
            [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED].includes(project.status)) {
            throw new Error("Dá»± Ã¡n Ä‘Ã£ hoÃ n táº¥t hoáº·c Ä‘Ã£ há»§y, khÃ´ng thá»ƒ Ä‘á»“ng bá»™ cÃ´ng viá»‡c");
        }

        const contract = await this.contractRepository.findOne({
            where: { id: project.contract.id }
        });
        if (!contract) throw new Error("KhÃ´ng tÃ¬m tháº¥y há»£p Ä‘á»“ng");

        const contractServices = await this.contractServiceRepository.find({
            where: { contract: { id: contract.id } },
            relations: ["service", "service.serviceJobs", "service.serviceJobs.job", "tasks", "tasks.job"]
        });

        for (const cs of contractServices) {
            if (!cs.service?.serviceJobs?.length) continue;

            for (const sj of cs.service.serviceJobs) {
                const job = sj.job;
                if (!job) continue;

                const quantity = Number(sj.quantity || 1);
                const existingTasks = (cs.tasks || []).filter(task => task.job?.id === job.id);

                if (sj.isOutput) {
                    for (const task of existingTasks) {
                        if (!task.isOutput) {
                            task.isOutput = true;
                            await this.taskRepository.save(task);
                            syncResult.updatedOutputTasks += 1;
                        }
                    }
                }

                for (let i = existingTasks.length; i < quantity; i++) {
                    const totalCountForProject = await this.taskRepository.count({
                        where: {
                            project: { id: project.id },
                            job: { id: job.id }
                        }
                    });

                    const seq = (totalCountForProject + 1).toString().padStart(2, '0');
                    const jobCode = job.code || `JOB${job.id}`;
                    const taskCode = `${contract.contractCode}-${jobCode}-${seq}`;

                    const task = this.taskRepository.create({
                        code: taskCode,
                        name: job.name,
                        project,
                        job,
                        contractService: cs,
                        status: TaskStatus.PENDING,
                        performerType: job.defaultPerformerType,
                        attachments: contract.attachments || [],
                        isOutput: sj.isOutput
                    });

                    const savedTask = await this.taskRepository.save(task);
                    existingTasks.push(savedTask);
                    syncResult.createdTasks += 1;
                }
            }

            const outputTasks = await this.taskRepository.find({
                where: {
                    project: { id: project.id },
                    contractService: { id: cs.id },
                    isOutput: true
                },
                relations: ["contractService"]
            });

            const results = Array.isArray(cs.results) ? [...cs.results] : [];
            let serviceBackfilledResults = 0;
            for (const task of outputTasks) {
                if (!this.shouldBackfillResult(task)) continue;

                const resultIndex = results.findIndex(result => result.taskId === task.id);
                const result = this.buildContractServiceResult(task);
                if (resultIndex >= 0) {
                    const current = results[resultIndex];
                    if (!current.url && result.url) {
                        results[resultIndex] = { ...current, ...result };
                        syncResult.backfilledResults += 1;
                        serviceBackfilledResults += 1;
                    }
                } else {
                    results.push(result);
                    syncResult.backfilledResults += 1;
                    serviceBackfilledResults += 1;
                }
            }

            if (serviceBackfilledResults > 0) {
                cs.results = results;
                await this.contractServiceRepository.save(cs);
            }
        }

        return syncResult;
    }

    async getAll(filters: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const sortBy = filters.sortBy || "createdAt";
        const sortDir = (filters.sortDir || "DESC").toUpperCase() as "ASC" | "DESC";

        let rbacWhere: any = {};
        if (userInfo) {
            try {
                rbacWhere = SecurityService.getProjectFilters(userInfo);
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

        // Combine search and RBAC
        let where: any = [];
        const combineWithSearch = (rbacCond: any) => {
            if (filters.search) {
                const searchTerm = `%${filters.search}%`;
                return [
                    { ...baseWhere, ...rbacCond, name: ILike(searchTerm) },
                    {
                        ...baseWhere,
                        ...rbacCond,
                        contract: {
                            ...rbacCond.contract,
                            contractCode: ILike(searchTerm)
                        }
                    },
                    {
                        ...baseWhere,
                        ...rbacCond,
                        contract: {
                            ...rbacCond.contract,
                            name: ILike(searchTerm)
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

        const [items, total] = await this.projectRepository.findAndCount({
            where: where.length > 1 ? where : where[0],
            relations: ["contract", "team", "team.teamLead"],
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

    async getOne(id: string, userInfo?: { id: string, role: string, userId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getProjectFilters(userInfo);
            // If rbacWhere is an array (OR conditions), we need to wrap the find with those conditions
            if (Array.isArray(rbacWhere)) {
                rbacWhere = rbacWhere.map(cond => ({ id, ...cond }));
            } else {
                rbacWhere = { id, ...rbacWhere };
            }
        } else {
            rbacWhere = { id };
        }

        const project = await this.projectRepository.findOne({
            where: rbacWhere,
            relations: [
                "contract",
                "team",
                "team.teamLead",
                "team.members",
                "team.members.user"
            ],
            select: {
                id: true,
                name: true,
                status: true,
                plannedStartDate: true,
                plannedEndDate: true,
                googleSheetId: true,
                googleSheetUrl: true,
                googleSheetStatus: true,
                googleSheetError: true,
                googleSheetCreatedAt: true,
                contract: {
                    id: true,
                    name: true,
                    contractCode: true,
                    attachments: true,
                    status: true,
                    description: true
                },
                team: {
                    id: true,
                    name: true,
                    teamLead: {
                        id: true,
                        fullName: true,
                        phoneNumber: true,
                    },
                    members: {
                        user: {
                            id: true
                        }
                    }
                }
            }
        });

        if (!project) throw new Error("Không tìm thấy dự án");

        // Tải các task riêng biệt để tránh tình trạng Cartesian product làm chậm câu truy vấn
        project.tasks = await this.taskRepository.find({
            where: { project: { id: project.id } },
            relations: ["assignee", "job", "quotation"]
        });

        // Tải danh sách dịch vụ của hợp đồng riêng biệt
        if (project.contract) {
            project.contract.services = await this.contractServiceRepository.find({
                where: { contract: { id: project.contract.id } },
                relations: ["service", "tasks", "tasks.job"],
                select: {
                    id: true,
                    sellingPrice: true,
                    status: true,
                    results: true,
                    name: true,
                    packageName: true,
                    isPackageService: true,
                    service: {
                        id: true,
                        name: true
                    },
                    tasks: {
                        id: true,
                        name: true,
                        status: true,
                        result: true,
                        code: true,
                        isOutput: true
                    }
                }
            });
        }

        // Filter out system attachments that handled by separate fields
        if (project.contract && project.contract.attachments) {
            project.contract.attachments = project.contract.attachments.filter(
                att => att.type !== "PROPOSAL_CONTRACT" && att.type !== "SIGNED_CONTRACT"
            );
        }

        // Data Restriction for Support Teams
        if (userInfo && isStaffRole(userInfo.role) && project.team) {
            const isCoreMember = project.team.teamLead?.id === userInfo.userId ||
                project.team.members?.some(m => m.user?.id === userInfo.userId);

            if (!isCoreMember) {
                // Filter tasks: Only show tasks where the user is involved
                project.tasks = project.tasks.filter(t =>
                    t.assigneeId === userInfo.userId ||
                    t.helperId === userInfo.userId ||
                    t.supportLeadId === userInfo.userId
                );

                // Mask sensitive contract info
                if (project.contract) {
                    if (project.contract.services) {
                        project.contract.services.forEach(s => {
                            s.sellingPrice = 0;
                        });
                    }
                }
            }
        }

        return project;
    }

    async getByContractId(contractId: string) {
        const project = await this.projectRepository.findOne({
            where: { contract: { id: contractId } },
            relations: ["contract", "team", "team.teamLead", "tasks", "tasks.assignee", "tasks.job", "tasks.quotation"]
        });

        if (!project) throw new Error("Không tìm thấy dự án liên kết với hợp đồng này");
        return project;
    }


    async assign(data: { contractId: string, teamId: string, name?: string }) {
        const contract = await this.contractRepository.findOne({
            where: { id: data.contractId },
            relations: ["opportunity"]
        });
        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        if (contract.status !== ContractStatus.PROPOSAL_APPROVED && contract.status !== ContractStatus.SIGNED) {
            throw new Error("Hợp đồng chưa được duyệt hoặc ký, không thể phân công dự án");
        }

        const team = await this.teamRepository.findOne({
            where: { id: data.teamId },
            relations: ["teamLead"]
        });
        if (!team) throw new Error("Không tìm thấy team");


        // Check if project already exists for this contract
        let project = await this.projectRepository.findOne({ where: { contract: { id: data.contractId } } });

        let isNewProject = false;
        if (project) {
            // If project already exists (e.g. created automatically), just assign the team
            project.team = team;
            project.name = data.name || project.name;
        } else {
            isNewProject = true;
            project = this.projectRepository.create({
                name: data.name || `Dự án cho HĐ ${contract.contractCode}`,
                contract: contract,
                team: team,
                status: ProjectStatus.PENDING_CONFIRMATION,
                plannedStartDate: new Date()
            });
        }

        let savedProject = await this.projectRepository.save(project);

        if (isNewProject) {
            await this.tryCreateGoogleSheet(savedProject.id);
            savedProject = await this.projectRepository.findOneBy({ id: savedProject.id }) || savedProject;
        }

        // Send Notification to Team Lead
        if (team.teamLead) {
            await this.notificationService.createNotification({
                title: "Dự án mới được phân công",
                content: `Dự án "${savedProject.name}" đã được phân công cho team của bạn.`,
                type: "PROJECT_ASSIGNED",
                recipient: team.teamLead,
                relatedEntityId: savedProject.id,
                relatedEntityType: "Project",
                link: `/projects/${savedProject.id}`
            });
        }

        // Update Opportunity Status

        if (contract.opportunity) {
            const oppRepo = AppDataSource.getRepository(contract.opportunity.constructor);
            contract.opportunity.status = OpportunityStatus.PROJECT_ASSIGNED;
            await oppRepo.save(contract.opportunity);
            opportunityEmitter.emit(OPPORTUNITY_EVENTS.UPDATED, contract.opportunity);
        }

        projectEmitter.emit(PROJECT_EVENTS.CREATED, savedProject);

        return savedProject;
    }

    async createFromContract(contract: Contracts, userInfo?: { id: string, userId?: string }) {
        // 1. Check if project already exists
        let project = await this.projectRepository.findOne({
            where: { contract: { id: contract.id } },
            relations: ["contract"]
        });

        let isNewProject = false;
        if (!project) {
            isNewProject = true;
            project = this.projectRepository.create({
                name: `${contract.name}`,
                contract: contract,
                status: ProjectStatus.PENDING_CONFIRMATION,
                createdBy: userInfo?.userId ? { id: userInfo.userId } as Users : undefined
            });

            project = await this.projectRepository.save(project);
        }

        if (isNewProject) {
            await this.tryCreateGoogleSheet(project.id);
            project = await this.projectRepository.findOne({
                where: { id: project.id },
                relations: ["contract"]
            }) || project;
        }

        await this.syncContractServiceJobs(project.id, { allowCompletedProject: true });

        projectEmitter.emit(PROJECT_EVENTS.CREATED, project);
        return project;
    }

    async syncServiceJobs(id: string) {
        const result = await this.syncContractServiceJobs(id);
        const project = await this.projectRepository.findOneBy({ id });
        if (project) projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);
        return result;
    }

    async getMonthlyWorkTemplate(id: string, monthKey?: string, userInfo?: { id: string, role: string, userId?: string }) {
        const normalizedMonthKey = this.assertMonthKey(monthKey);
        const project = await this.projectRepository.findOne({
            where: { id },
            relations: ["contract", "team", "team.teamLead"]
        });
        if (!project) throw new Error("Không tìm thấy dự án");
        if (!project.contract) throw new Error("Dự án chưa liên kết hợp đồng");
        if (!this.canManageMonthlyWork(project, userInfo)) {
            throw new Error("Bạn không có quyền tạo công việc tháng mới cho dự án này");
        }

        const contractServices = await this.contractServiceRepository.find({
            where: {
                contract: { id: project.contract.id },
                addendum: IsNull()
            },
            relations: [
                "service",
                "service.serviceJobs",
                "service.serviceJobs.job",
                "opportunityService",
                "opportunityService.opportunityPackage"
            ],
            order: { packageName: "ASC", createdAt: "ASC" } as any
        });

        const items = contractServices.map(cs => this.mapContractServiceToMonthlyItem(cs));
        const packageMap = new Map<string, any>();
        const standalone: any[] = [];

        for (const item of items) {
            if (item.isPackageService && item.packageName) {
                if (!packageMap.has(item.packageKey)) {
                    packageMap.set(item.packageKey, {
                        packageKey: item.packageKey,
                        packageName: item.packageName,
                        packageQuantity: item.packageQuantity,
                        items: []
                    });
                }
                const packageGroup = packageMap.get(item.packageKey);
                const existingItem = packageGroup.items.find((groupItem: any) => groupItem.serviceId === item.serviceId);
                if (existingItem) {
                    existingItem.contractServiceIds.push(item.contractServiceId);
                    existingItem.sellingPrice += Number(item.sellingPrice || 0);
                    existingItem.cost += Number(item.cost || 0);
                } else {
                    packageGroup.items.push(item);
                }
            } else {
                const existingItem = standalone.find(groupItem => groupItem.serviceId === item.serviceId);
                if (existingItem) {
                    existingItem.contractServiceIds.push(item.contractServiceId);
                    existingItem.sellingPrice += Number(item.sellingPrice || 0);
                    existingItem.cost += Number(item.cost || 0);
                    existingItem.quantity += 1;
                } else {
                    standalone.push(item);
                }
            }
        }

        return {
            projectId: project.id,
            contractId: project.contract.id,
            monthKey: normalizedMonthKey,
            defaultName: `${project.name} - ${this.formatMonthName(normalizedMonthKey)}`,
            packages: Array.from(packageMap.values()),
            standalone
        };
    }

    async createMonthlyWorkAddendum(
        id: string,
        data: {
            monthKey?: string,
            name?: string,
            description?: string,
            items?: {
                contractServiceId?: string,
                serviceId?: string,
                serviceName?: string,
                packageName?: string,
                isPackageService?: boolean,
                sellingPrice?: number,
                cost?: number
            }[]
        },
        userInfo?: { id: string, role: string, userId?: string }
    ) {
        const monthKey = this.assertMonthKey(data.monthKey);
        const project = await this.projectRepository.findOne({
            where: { id },
            relations: ["contract", "team", "team.teamLead"]
        });
        if (!project) throw new Error("Không tìm thấy dự án");
        if (!project.contract) throw new Error("Dự án chưa liên kết hợp đồng");
        if (!this.canManageMonthlyWork(project, userInfo)) {
            throw new Error("Bạn không có quyền tạo công việc tháng mới cho dự án này");
        }

        const requestedItems = data.items || [];
        if (requestedItems.length === 0) throw new Error("Vui lòng chọn ít nhất một dịch vụ");
        const requestedIds = Array.from(new Set(requestedItems.map(item => item.contractServiceId).filter(Boolean)));

        const existing = await this.addendumRepository.findOne({
            where: {
                contract: { id: project.contract.id },
                project: { id: project.id },
                type: AddendumType.MONTHLY_TASKS,
                monthKey,
                status: Not(In([AddendumStatus.SALE_REJECTED, AddendumStatus.BOD_REJECTED, AddendumStatus.CANCELLED]))
            }
        });
        if (existing) throw new Error(`Đã có phụ lục công việc tháng ${this.formatMonthName(monthKey)} đang chờ duyệt hoặc đã duyệt`);

        const contractServices = requestedIds.length > 0 ? await this.contractServiceRepository.find({
            where: requestedIds.map(contractServiceId => ({
                id: contractServiceId,
                contract: { id: project.contract.id },
                addendum: IsNull()
            })),
            relations: ["service"]
        }) : [];
        if (requestedIds.length > 0 && contractServices.length !== requestedIds.length) {
            throw new Error("Một số dịch vụ không hợp lệ hoặc không thuộc hợp đồng gốc");
        }

        const contractServiceMap = new Map(contractServices.map(cs => [cs.id, cs]));
        const selectedItems: any[] = [];

        for (const item of requestedItems) {
            if (item.contractServiceId) {
                const cs = contractServiceMap.get(item.contractServiceId);
                if (!cs) continue;
                selectedItems.push({
                    sourceContractServiceId: cs.id,
                    serviceId: cs.service?.id || cs.serviceId,
                    serviceName: cs.name || cs.service?.name || "Dịch vụ",
                    packageName: cs.packageName,
                    isPackageService: cs.isPackageService,
                    sellingPrice: Number(cs.sellingPrice || 0),
                    cost: Number(cs.service?.costPrice || 0)
                });
                continue;
            }

            if (!item.serviceId) throw new Error("Dịch vụ thêm mới không hợp lệ");
            const service = await AppDataSource.getRepository(Services).findOneBy({ id: item.serviceId });
            if (!service) throw new Error("Không tìm thấy dịch vụ thêm mới");
            selectedItems.push({
                sourceContractServiceId: null,
                serviceId: service.id,
                serviceName: item.serviceName || service.name,
                packageName: item.packageName,
                isPackageService: !!item.isPackageService,
                sellingPrice: Number(item.sellingPrice || 0),
                cost: Number(item.cost ?? service.costPrice ?? 0)
            });
        }

        if (selectedItems.length === 0) throw new Error("Vui lòng chọn ít nhất một dịch vụ");

        const addendum = this.addendumRepository.create({
            contract: project.contract,
            project,
            name: data.name || `${project.name} - ${this.formatMonthName(monthKey)}`,
            description: data.description,
            type: AddendumType.MONTHLY_TASKS,
            monthKey,
            selectedItems,
            sellingPrice: selectedItems.reduce((sum, item) => sum + Number(item.sellingPrice || 0), 0),
            cost: selectedItems.reduce((sum, item) => sum + Number(item.cost || 0), 0),
            status: AddendumStatus.PENDING_SALE
        });

        const saved = await this.addendumRepository.save(addendum);
        projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);
        return saved;
    }

    async createGoogleSheet(projectId: string) {
        const project = await this.projectRepository.findOne({
            where: { id: projectId },
            relations: ["contract", "contract.customer"]
        });

        if (!project) {
            throw new Error("Không tìm thấy dự án");
        }

        if (project.googleSheetId && project.googleSheetStatus === GoogleSheetStatus.CREATED) {
            return project;
        }

        const lockResult = await this.projectRepository.update(
            {
                id: projectId,
                googleSheetStatus: In([
                    GoogleSheetStatus.NOT_CREATED,
                    GoogleSheetStatus.FAILED
                ])
            },
            {
                googleSheetStatus: GoogleSheetStatus.CREATING,
                googleSheetError: null
            }
        );

        if (!lockResult.affected) {
            throw new Error("Google Sheet đang được tạo hoặc đã được tạo");
        }

        try {
            const sheetName = project.contract?.contractCode
                ? `${project.contract.contractCode} - ${project.name}`
                : project.name;
            const result = await this.googleSheetService.createFromTemplate({
                name: sheetName,
                customerName: project.contract?.customer?.name
            });

            await this.projectRepository.update(projectId, {
                googleSheetId: result.spreadsheetId,
                googleSheetUrl: result.spreadsheetUrl,
                googleSheetStatus: GoogleSheetStatus.CREATED,
                googleSheetError: null,
                googleSheetCreatedAt: new Date()
            });
        } catch (error: any) {
            const message = error?.message || "Không thể tạo Google Sheet";
            await this.projectRepository.update(projectId, {
                googleSheetStatus: GoogleSheetStatus.FAILED,
                googleSheetError: message
            });
            throw new Error(message);
        }

        return await this.projectRepository.findOne({
            where: { id: projectId },
            relations: ["contract", "contract.customer"]
        });
    }

    private async tryCreateGoogleSheet(projectId: string): Promise<void> {
        try {
            await this.createGoogleSheet(projectId);
        } catch (error: any) {
            console.error(`[ProjectService] Google Sheet creation failed for project ${projectId}:`, error.message);
        }
    }


    async confirm(id: string, userId: string) {
        // userId should be the team leader's ID (from token)
        const project = await this.getOne(id);

        if (project.status !== ProjectStatus.PENDING_CONFIRMATION) {
            throw new Error("Dự án không ở trạng thái chờ xác nhận");
        }

        const userConfirming = await this.userRepository.findOneBy({ id: userId });
        if (!userConfirming) throw new Error("Không tìm thấy thông tin người xác nhận");

        // Check if contract is already signed
        const contract = await this.contractRepository.findOneBy({ id: project.contract.id });
        if (contract?.status === ContractStatus.SIGNED) {
            project.status = ProjectStatus.IN_PROGRESS;
            project.actualStartDate = new Date();

            // Update Opportunity Status
            if (contract.opportunity) {
                const fullContract = await this.contractRepository.findOne({ where: { id: contract.id }, relations: ["opportunity"] });
                if (fullContract?.opportunity) {
                    const oppRepo = AppDataSource.getRepository(fullContract.opportunity.constructor);
                    fullContract.opportunity.status = OpportunityStatus.IMPLEMENTATION;
                    await oppRepo.save(fullContract.opportunity);
                    opportunityEmitter.emit(OPPORTUNITY_EVENTS.UPDATED, fullContract.opportunity);
                }
            }
        } else {
            project.status = ProjectStatus.IN_PROGRESS;
        }

        const savedProject = await this.projectRepository.save(project);
        projectEmitter.emit(PROJECT_EVENTS.UPDATED, savedProject);

        // Notify BOD members
        // ... (rest of notification logic)
        const bodUsers = await this.userRepository.find({
            relations: ["accounts"],
            where: { accounts: { role: "BOD" as any } }
        });

        for (const bod of bodUsers) {
            await this.notificationService.createNotification({
                title: "Dự án đã được tiếp nhận",
                content: `${userConfirming.fullName} đã nhận thông tin dự án ${savedProject.name}${savedProject.status === ProjectStatus.IN_PROGRESS ? " và đã bắt đầu thực hiện" : ""}`,
                type: "PROJECT_CONFIRMED",
                recipient: bod,
                relatedEntityId: savedProject.id,
                relatedEntityType: "Project",
                link: `/projects/${savedProject.id}`
            });
        }

        return savedProject;
    }


    // async start(id: string) {
    //     const project = await this.getOne(id);

    //     // Requirement: Only transition to IN_PROGRESS if Team Lead has already accepted (CONFIRMED)
    //     if (project.status !== ProjectStatus.CONFIRMED) {
    //         console.log(`[ProjectService] Project ${id} is not in CONFIRMED state (current: ${project.status}). Skipping automatic IN_PROGRESS transition.`);
    //         return project;
    //     }

    //     // Check contract signed
    //     const contract = await this.contractRepository.findOneBy({ id: project.contract.id });
    //     if (contract?.status !== ContractStatus.SIGNED) {
    //         throw new Error("Hợp đồng chưa được ký (Signed), không thể bắt đầu dự án");
    //     }

    //     project.status = ProjectStatus.IN_PROGRESS;
    //     project.actualStartDate = new Date();

    //     // Update Opportunity Status
    //     const fullContract = await this.contractRepository.findOne({ where: { id: project.contract.id }, relations: ["opportunity"] });
    //     if (fullContract?.opportunity) {
    //         const oppRepo = AppDataSource.getRepository(fullContract.opportunity.constructor);
    //         fullContract.opportunity.status = OpportunityStatus.IMPLEMENTATION;
    //         await oppRepo.save(fullContract.opportunity);
    //     }

    //     return await this.projectRepository.save(project);
    // }
}
