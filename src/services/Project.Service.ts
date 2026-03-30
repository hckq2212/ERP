import { AppDataSource } from "../data-source";
import { Like, ILike } from "typeorm";
import { Projects, ProjectStatus } from "../entity/Project.entity";
import { Contracts, ContractStatus } from "../entity/Contract.entity";
import { ProjectTeams } from "../entity/ProjectTeam.entity";
import { Users } from "../entity/User.entity";
import { OpportunityStatus } from "../entity/Opportunity.entity";
import { ContractServices } from "../entity/ContractService.entity";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus } from "../entity/Enums";
import { Jobs } from "../entity/Job.entity";
import { PerformerType } from "../entity/Enums";
import { NotificationService } from "./Notification.Service";

import { SecurityService } from "./Security.Service";
import { UserRole } from "../entity/Account.entity";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../events/OpportunityEmitter";

export class ProjectService {
    private projectRepository = AppDataSource.getRepository(Projects);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private teamRepository = AppDataSource.getRepository(ProjectTeams);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private userRepository = AppDataSource.getRepository(Users);
    private notificationService = new NotificationService();



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
                "team.members.user",
                "tasks",
                "tasks.assignee",
                "tasks.job",
                "tasks.quotation",
                "contract.services",
                "contract.services.service",
                "contract.services.service",
                "contract.services.tasks",
                "contract.services.tasks.job",
            ],

            select: {
                id: true,
                name: true,
                status: true,
                plannedStartDate: true,
                plannedEndDate: true,
                contract: {
                    id: true,
                    name: true,
                    contractCode: true,
                    attachments: true,
                    status: true,
                    description: true,
                    services: {
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

        // Filter out system attachments that handled by separate fields
        if (project.contract && project.contract.attachments) {
            project.contract.attachments = project.contract.attachments.filter(
                att => att.type !== "PROPOSAL_CONTRACT" && att.type !== "SIGNED_CONTRACT"
            );
        }

        // Data Restriction for Support Teams
        if (userInfo && userInfo.role === UserRole.MEMBER && project.team) {
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

        if (project) {
            // If project already exists (e.g. created automatically), just assign the team
            project.team = team;
            project.name = data.name || project.name;
        } else {
            project = this.projectRepository.create({
                name: data.name || `Dự án cho HĐ ${contract.contractCode}`,
                contract: contract,
                team: team,
                status: ProjectStatus.PENDING_CONFIRMATION,
                plannedStartDate: new Date()
            });
        }

        const savedProject = await this.projectRepository.save(project);

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

        if (!project) {
            project = this.projectRepository.create({
                name: `${contract.name}`,
                contract: contract,
                status: ProjectStatus.PENDING_CONFIRMATION,
                createdBy: userInfo?.userId ? { id: userInfo.userId } as Users : undefined
            });

            project = await this.projectRepository.save(project);
        }

        // 2. Fetch Contract Services with their Jobs
        const contractServices = await this.contractServiceRepository.find({
            where: { contract: { id: contract.id } },
            relations: ["service", "service.serviceJobs", "service.serviceJobs.job"]
        });

        // 3. Generate Tasks for each Job in each Service
        for (const cs of contractServices) {
            if (!cs.service || !cs.service.serviceJobs) continue;

            for (const sj of cs.service.serviceJobs) {
                const job = sj.job;
                if (!job) continue;

                const quantity = Number(sj.quantity || 1);

                for (let i = 1; i <= quantity; i++) {
                    // 1. Idempotency check: Have we already created 'quantity' tasks for THIS job in THIS service?
                    const countForService = await this.taskRepository.count({
                        where: {
                            project: { id: project.id },
                            job: { id: job.id },
                            contractService: { id: cs.id }
                        }
                    });

                    if (countForService >= quantity) break;

                    // 2. Sequence generation: Count ALL tasks for this job in the WHOLE PROJECT to ensure unique code
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
                        project: project,
                        job: job,
                        contractService: cs,
                        status: TaskStatus.PENDING,
                        performerType: job.defaultPerformerType,
                        attachments: contract.attachments || [],
                        isOutput: sj.isOutput // Flag as output if service-job is marked as output
                    });

                    await this.taskRepository.save(task);
                }
            }
        }

        projectEmitter.emit(PROJECT_EVENTS.CREATED, project);
        return project;
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
            relations: ["account"],
            where: { account: { role: "BOD" as any } }
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
