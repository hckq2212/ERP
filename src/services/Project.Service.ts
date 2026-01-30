import { AppDataSource } from "../data-source";
import { Projects, ProjectStatus } from "../entity/Project.entity";
import { Contracts, ContractStatus } from "../entity/Contract.entity";
import { ProjectTeams } from "../entity/ProjectTeam.entity";
import { Users } from "../entity/User.entity";
import { OpportunityStatus } from "../entity/Opportunity.entity";
import { ContractServices } from "../entity/ContractService.entity";
import { Tasks, TaskStatus } from "../entity/Task.entity";
import { Jobs } from "../entity/Job.entity";
import { NotificationService } from "./Notification.Service";

export class ProjectService {
    private projectRepository = AppDataSource.getRepository(Projects);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private teamRepository = AppDataSource.getRepository(ProjectTeams);
    private contractServiceRepository = AppDataSource.getRepository(ContractServices);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private userRepository = AppDataSource.getRepository(Users);
    private notificationService = new NotificationService();



    async getAll() {
        return await this.projectRepository.find({
            relations: ["contract", "team", "team.teamLead"]
        });
    }

    async getOne(id: number) {
        const project = await this.projectRepository.findOne({
            where: { id },
            relations: ["contract", "team", "team.teamLead", "tasks", "tasks.assignee"]
        });

        if (!project) throw new Error("Không tìm thấy dự án");
        return project;
    }

    async getByContractId(contractId: number) {
        const project = await this.projectRepository.findOne({
            where: { contract: { id: contractId } },
            relations: ["contract", "team", "team.teamLead", "tasks", "tasks.assignee"]
        });

        if (!project) throw new Error("Không tìm thấy dự án liên kết với hợp đồng này");
        return project;
    }


    async assign(data: { contractId: number, teamId: number, name?: string }) {
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
                relatedEntityId: savedProject.id.toString(),
                relatedEntityType: "Project",
                link: `/projects/${savedProject.id}`
            });
        }

        // Update Opportunity Status

        if (contract.opportunity) {
            const oppRepo = AppDataSource.getRepository(contract.opportunity.constructor);
            contract.opportunity.status = OpportunityStatus.PROJECT_ASSIGNED;
            await oppRepo.save(contract.opportunity);
        }

        return savedProject;
    }

    async createFromContract(contract: Contracts) {
        // 1. Check if project already exists
        let project = await this.projectRepository.findOne({
            where: { contract: { id: contract.id } },
            relations: ["contract"]
        });

        if (!project) {
            project = this.projectRepository.create({
                name: `Dự án ${contract.name}`,
                contract: contract,
                status: ProjectStatus.PENDING_CONFIRMATION
            });
            project = await this.projectRepository.save(project);
        }

        // 2. Fetch Contract Services with their Jobs
        const contractServices = await this.contractServiceRepository.find({
            where: { contract: { id: contract.id } },
            relations: ["service", "service.jobs"]
        });

        // 3. Generate Tasks for each Job in each Service
        for (const cs of contractServices) {
            if (!cs.service || !cs.service.jobs) continue;

            for (const job of cs.service.jobs) {
                // Avoid duplicate tasks for the same job and contract service?
                // Usually, one contract service item = a set of tasks.
                const existingTask = await this.taskRepository.findOne({
                    where: {
                        project: { id: project.id },
                        job: { id: job.id },
                        contractService: { id: cs.id }
                    }
                });

                if (existingTask) continue;

                // Calculate Sequence for this specific job in this project
                const count = await this.taskRepository.count({
                    where: {
                        project: { id: project.id },
                        job: { id: job.id }
                    }
                });

                const seq = (count + 1).toString().padStart(2, '0');
                const jobCode = job.code || `JOB${job.id}`;
                const taskCode = `${contract.contractCode} - ${jobCode} - ${seq}`;

                const task = this.taskRepository.create({
                    code: taskCode,
                    name: job.name,
                    project: project,
                    job: job,
                    contractService: cs,
                    status: TaskStatus.PENDING,
                    performerType: job.defaultPerformerType === "INTERNAL" ? "INTERNAL" : "VENDOR",
                    attachments: contract.attachments || [] // Inherit attachments from contract
                });

                await this.taskRepository.save(task);
            }
        }

        return project;
    }


    async confirm(id: number, userId: number) {
        // userId should be the team leader's ID (from token)
        const project = await this.getOne(id);

        if (project.status !== ProjectStatus.PENDING_CONFIRMATION) {
            throw new Error("Dự án không ở trạng thái chờ xác nhận");
        }

        const userConfirming = await this.userRepository.findOneBy({ id: userId });
        if (!userConfirming) throw new Error("Không tìm thấy thông tin người xác nhận");

        project.status = ProjectStatus.CONFIRMED;
        const savedProject = await this.projectRepository.save(project);

        // Notify BOD members
        const bodUsers = await this.userRepository.find({
            relations: ["account"],
            where: { account: { role: "BOD" as any } } // Using 'as any' if enum import is tricky, but let's try to do it right if possible
        });

        for (const bod of bodUsers) {
            await this.notificationService.createNotification({
                title: "Dự án đã được tiếp nhận",
                content: `${userConfirming.fullName} đã nhận thông tin dự án ${savedProject.name}`,
                type: "PROJECT_CONFIRMED",
                recipient: bod,
                relatedEntityId: savedProject.id.toString(),
                relatedEntityType: "Project",
                link: `/projects/${savedProject.id}`
            });
        }

        return savedProject;
    }


    async start(id: number) {
        const project = await this.getOne(id);

        // Check contract signed
        const contract = await this.contractRepository.findOneBy({ id: project.contract.id });
        if (contract?.status !== ContractStatus.SIGNED) {
            throw new Error("Hợp đồng chưa được ký (Signed), không thể bắt đầu dự án");
        }

        project.status = ProjectStatus.IN_PROGRESS;
        project.actualStartDate = new Date();

        // Update Opportunity Status
        if (contract?.opportunity) {
            // Need to fetch opportunity again or update via relation if eager loaded?
            // Relations are loaded in getOne: "contract" but not "contract.opportunity"
            const fullContract = await this.contractRepository.findOne({ where: { id: project.contract.id }, relations: ["opportunity"] });
            if (fullContract?.opportunity) {
                const oppRepo = AppDataSource.getRepository(fullContract.opportunity.constructor);
                fullContract.opportunity.status = OpportunityStatus.IMPLEMENTATION;
                await oppRepo.save(fullContract.opportunity);
            }
        }

        return await this.projectRepository.save(project);
    }
}
