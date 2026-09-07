import { AppDataSource } from "../../../data-source";
import { Like, ILike, In, IsNull, Not } from "typeorm";
import { Projects, ProjectStatus } from "../entities/Project.entity";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";
import { ProjectTeams } from "../entities/ProjectTeam.entity";
import { TeamMembers, MemberRole } from "../entities/TeamMember.entity";
import { Users } from "../../user/entities/User.entity";
import { OpportunityStatus } from "../../opportunity/entities/Opportunity.entity";
import { ContractServices } from "../../contract/entities/ContractService.entity";
import { AddendumStatus, AddendumType, ContractAddendums } from "../../contract-addendum/entities/ContractAddendum.entity";
import { Services } from "../../service/entities/Service.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { TaskStatus } from "../../../shared/entities/Enums";
import { Jobs } from "../../job/entities/Job.entity";
import { PerformerType } from "../../../shared/entities/Enums";
import { NotificationService } from "../../notification/services/Notification.Service";

import { SecurityService } from "../../../shared/services/Security.Service";
import { isProjectManagementRole, isStaffRole, UserRole } from "../../account/entities/Account.entity";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../../opportunity/events/OpportunityEmitter";
// Google Sheet integration is temporarily disabled.
// import { GoogleSheetService } from "../../../shared/services/GoogleSheet.Service";

export class ProjectBaseService {
    protected projectRepository = AppDataSource.getRepository(Projects);
    protected contractRepository = AppDataSource.getRepository(Contracts);
    protected teamRepository = AppDataSource.getRepository(ProjectTeams);
    protected memberRepository = AppDataSource.getRepository(TeamMembers);
    protected contractServiceRepository = AppDataSource.getRepository(ContractServices);
    protected addendumRepository = AppDataSource.getRepository(ContractAddendums);
    protected taskRepository = AppDataSource.getRepository(Tasks);
    protected userRepository = AppDataSource.getRepository(Users);
    protected notificationService = new NotificationService();
    // private googleSheetService = new GoogleSheetService();

    protected assertMonthKey(monthKey?: string) {
        const value = monthKey || new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
            throw new Error("Tháng không hợp lệ, định dạng cần là YYYY-MM");
        }
        return value;
    }

    protected formatMonthName(monthKey: string) {
        const [year, month] = monthKey.split("-");
        return `${month}/${year}`;
    }

    protected canManageMonthlyWork(project: Projects, userInfo?: { id: string, role: string, userId?: string }) {
        if (!userInfo) return false;
        if (isProjectManagementRole(userInfo.role)) return true;
        return project.team?.teamLead?.id === (userInfo.userId || userInfo.id);
    }

    protected mapContractServiceToMonthlyItem(cs: ContractServices) {
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

    protected emptySyncResult() {
        return {
            createdTasks: 0,
            updatedOutputTasks: 0,
            backfilledResults: 0
        };
    }

    protected buildContractServiceResult(task: Tasks) {
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

    protected shouldBackfillResult(task: Tasks) {
        return task.isOutput &&
            !!task.contractService &&
            !!task.result &&
            [TaskStatus.INTERNAL_COMPLETED, TaskStatus.COMPLETED, TaskStatus.ACCEPTED].includes(task.status);
    }

    protected async syncContractServiceJobs(projectId: string, options: { allowCompletedProject?: boolean } = {}) {
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
                "team.members.user.accounts"
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
                        id: true,
                        role: true,
                        user: {
                            id: true,
                            fullName: true,
                            phoneNumber: true,
                            accounts: {
                                id: true,
                                role: true
                            }
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
}
