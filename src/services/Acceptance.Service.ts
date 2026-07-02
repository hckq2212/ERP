import { AppDataSource } from "../data-source";
import { AcceptanceRequests, AcceptanceStatus } from "../entity/AcceptanceRequest.entity";
import { Contracts, ContractStatus } from "../entity/Contract.entity";
import { ContractServices, ContractServiceStatus } from "../entity/ContractService.entity";
import { Users } from "../entity/User.entity";
import { Tasks } from "../entity/Task.entity";
import { TaskStatus, PerformerType } from "../entity/Enums";
import { Projects, ProjectStatus } from "../entity/Project.entity";
import { NotificationService } from "./Notification.Service";
import { VinicoinService } from "./Vinicoin.Service";
import { EntityManager, In, Not, ILike } from "typeorm";
import { UserRole } from "../entity/Account.entity";
import { TenantContext } from "../context/TenantContext";

type AcceptanceActor = { userId?: string; role?: string };

export class AcceptanceService {
    private acceptanceRepo = AppDataSource.getRepository(AcceptanceRequests);
    private serviceRepo = AppDataSource.getRepository(ContractServices);
    private contractRepo = AppDataSource.getRepository(Contracts);
    private userRepo = AppDataSource.getRepository(Users);
    private taskRepo = AppDataSource.getRepository(Tasks);
    private projectRepo = AppDataSource.getRepository(Projects);
    private notificationService = new NotificationService();
    private vinicoinService = new VinicoinService();
    private readonly acceptanceRoles = new Set<string>([
        UserRole.BOD, UserRole.ADMIN, UserRole.ADMIN_SALE, UserRole.ACCOUNTANT
    ]);

    private httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    private assertAcceptanceActor(actor?: AcceptanceActor) {
        if (!actor?.userId) throw this.httpError("Bạn cần đăng nhập bằng tài khoản nhân sự để nghiệm thu", 401);
        if (!actor.role || !this.acceptanceRoles.has(actor.role)) {
            throw this.httpError("Bạn không có quyền thực hiện nghiệm thu", 403);
        }
        return actor.userId;
    }

    private async getLockedRequest(manager: EntityManager, requestId: string, relations: string[]) {
        const company = TenantContext.getCompany();
        if (!company) throw this.httpError("Thiếu thông tin công ty", 403);

        const locked = await manager.createQueryBuilder(AcceptanceRequests, "request")
            .select("request.id")
            .where("request.id = :requestId", { requestId })
            .andWhere("request.companyId = :companyId", { companyId: company.id })
            .setLock("pessimistic_write")
            .getOne();
        if (!locked) throw this.httpError("Không tìm thấy yêu cầu nghiệm thu", 404);

        const request = await manager.getRepository(AcceptanceRequests).findOne({
            where: { id: requestId, company: { id: company.id } }, relations
        });
        if (!request) throw this.httpError("Không tìm thấy yêu cầu nghiệm thu", 404);
        if (request.status !== AcceptanceStatus.PENDING) {
            throw this.httpError("Yêu cầu này đã được xử lý", 409);
        }
        return request;
    }

    async createRequest(data: { serviceIds: string[], userId: string, name: string, projectId: string, note?: string }) {
        const { serviceIds, userId, name, projectId, note } = data;

        if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
            throw new Error("Danh sách dịch vụ không hợp lệ hoặc trống");
        }

        const requester = await this.userRepo.findOneBy({ id: userId });
        if (!requester) throw new Error("Người yêu cầu không tồn tại");

        const project = await this.projectRepo.findOneBy({ id: projectId });
        if (!project) throw new Error("Dự án không tồn tại");

        const services = await this.serviceRepo.find({
            where: { id: In(serviceIds) },
            relations: ["contract", "contract.project", "tasks"]
        });

        if (services.length !== serviceIds.length) {
            throw new Error("Một số hạng mục dịch vụ không tồn tại");
        }

        // 1. Generate automated name: NT-{contractCode}-{DD/MM/YYYY}
        const firstService = services[0];
        const contractCode = firstService.contract?.contractCode || "UNKNOWN";
        const now = new Date();
        const formattedDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
        const autoName = `NT-${contractCode}-${formattedDate}`;

        // Check if all services belong to the project
        const invalidServices = services.filter(s => s.contract?.project?.id !== projectId);
        if (invalidServices.length > 0) {
            throw new Error(`Có ${invalidServices.length} dịch vụ không thuộc dự án đã chọn.`);
        }

        // Check if all services have at least one result AND all tasks are COMPLETED
        // ALSO: Check if any service is already in AWAITING_ACCEPTANCE or COMPLETED
        for (const s of services) {
            if (s.status === ContractServiceStatus.AWAITING_ACCEPTANCE) {
                throw new Error(`Dịch vụ "${s.name || s.id}" đã được gửi nghiệm thu và đang chờ duyệt. Không thể gửi thêm yêu cầu mới.`);
            }
            if (s.status === ContractServiceStatus.COMPLETED) {
                throw new Error(`Dịch vụ "${s.name || s.id}" đã hoàn thành nghiệm thu.`);
            }
            if (s.status === ContractServiceStatus.CANCELLED) {
                throw new Error(`Dịch vụ "${s.name || s.id}" đã bị hủy.`);
            }

            if (!s.results || s.results.length === 0) {
                throw new Error(`Dịch vụ "${s.name || s.id}" chưa có kết quả nghiệm thu nội bộ.`);
            }

            const incompleteTasks = s.tasks?.filter(t => t.status !== TaskStatus.COMPLETED);
            if (incompleteTasks && incompleteTasks.length > 0) {
                throw new Error(`Dịch vụ "${s.name || s.id}" còn ${incompleteTasks.length} công việc chưa hoàn thành. Vui lòng hoàn thành tất cả task trước khi nghiệm thu.`);
            }
        }

        const request = this.acceptanceRepo.create({
            name: autoName,
            requester,
            project,
            note,
            status: AcceptanceStatus.PENDING,
            services,
            projectId // Added this since AcceptanceRequests entity has explicit projectId: string
        });

        const savedRequest = await this.acceptanceRepo.save(request);

        // Update services status
        for (const s of services) {
            s.status = ContractServiceStatus.AWAITING_ACCEPTANCE;
            s.acceptanceRequest = savedRequest;
            await this.serviceRepo.save(s);
        }

        // Notify BOD (Mock: find first admin/bod user for now or common group)
        // In real app, we might notify all users with BOD role
        const bods = await this.userRepo.createQueryBuilder("user")
            .innerJoin("user.account", "account")
            .where("account.role IN (:...roles)", { roles: ["BOD", "ADMIN", "ADMIN_SALE", "ACCOUNTANT"] })
            .getMany();

        for (const bod of bods) {
            await this.notificationService.createNotification({
                title: "Yêu cầu nghiệm thu mới",
                content: `Team Lead ${requester.fullName} yêu cầu nghiệm thu đợt: ${name} của dự án ${request.project?.name}`,
                type: "ACCEPTANCE_REQUESTED",
                recipient: bod,
                relatedEntityId: savedRequest.id,
                relatedEntityType: "AcceptanceRequest",
                link: `/acceptance/${savedRequest.id}`
            });
        }

        return savedRequest;
    }

    async approveRequest(requestId: string, actor: AcceptanceActor, feedback?: string) {
        const approverId = this.assertAcceptanceActor(actor);
        return AppDataSource.transaction(async (manager) => {
            const request = await this.getLockedRequest(manager, requestId, [
                "services", "services.tasks", "services.tasks.job",
                "services.tasks.assignee", "services.tasks.assignee.account",
                "services.tasks.helper", "services.tasks.helper.account", "requester", "project"
            ]);
            const approver = await manager.getRepository(Users).findOneBy({ id: approverId });
            if (!approver) throw this.httpError("Người duyệt không tồn tại", 404);

            request.status = AcceptanceStatus.APPROVED;
            request.approver = approver;
            request.feedback = feedback || "";
            await manager.save(request);

            for (const service of request.services) {
                if (service.results) service.results = service.results.map(result => ({ ...result, status: 'APPROVED' }));
                service.status = ContractServiceStatus.COMPLETED;
                await manager.save(service);
                await manager.update(Tasks, { contractService: { id: service.id } }, {
                    status: TaskStatus.ACCEPTED, actualEndDate: new Date()
                });
                await this.triggerRewards(service, manager);
            }

            if (request.projectId) await this.syncProjectCompletionStatus(request.projectId, manager);
            await this.notificationService.createNotification({
                title: "Yêu cầu nghiệm thu được DUYỆT",
                content: `Đợt nghiệm thu "${request.name}" đã được duyệt.`,
                type: "ACCEPTANCE_APPROVED",
                recipient: request.requester,
                relatedEntityId: request.id,
                relatedEntityType: "AcceptanceRequest",
            }, manager);
            return request;
        });
    }

    async rejectRequest(requestId: string, actor: AcceptanceActor, feedback: string) {
        const approverId = this.assertAcceptanceActor(actor);
        if (!feedback) throw this.httpError("Vui lòng nhập lý do từ chối", 400);
        return AppDataSource.transaction(async (manager) => {
            const request = await this.getLockedRequest(manager, requestId, ["services", "services.tasks", "requester", "project"]);
            const approver = await manager.getRepository(Users).findOneBy({ id: approverId });
            if (!approver) throw this.httpError("Người duyệt không tồn tại", 404);

            request.status = AcceptanceStatus.REJECTED;
            request.approver = approver;
            request.feedback = feedback;
            await manager.save(request);
            for (const service of request.services) {
                if (service.results) service.results = service.results.map(result => ({ ...result, status: 'REJECTED', feedback }));
                service.status = ContractServiceStatus.ACCEPTANCE_REJECTED;
                service.feedback = feedback;
                await manager.save(service);
                await manager.update(Tasks, { contractService: { id: service.id } }, { status: TaskStatus.DOING });
            }
            await this.notificationService.createNotification({
                title: "Yêu cầu nghiệm thu bị từ chối",
                content: `Đợt nghiệm thu "${request.name}" của dự án ${request.project?.name} bị từ chối. Lý do: ${feedback}`,
                type: "ACCEPTANCE_REJECTED",
                recipient: request.requester,
                relatedEntityId: request.id,
                relatedEntityType: "AcceptanceRequest",
                link: `/acceptance/${request.id}`
            }, manager);
            return request;
        });
    }

    async processRequest(requestId: string, actor: AcceptanceActor, decisions: { serviceId: string, status: 'APPROVED' | 'REJECTED', feedback?: string }[]) {
        const approverId = this.assertAcceptanceActor(actor);
        return AppDataSource.transaction(async (manager) => {
            const request = await this.getLockedRequest(manager, requestId, [
                "services", "services.tasks", "services.tasks.job",
                "services.tasks.assignee", "services.tasks.assignee.account",
                "services.tasks.helper", "services.tasks.helper.account", "requester", "project"
            ]);
            const approver = await manager.getRepository(Users).findOneBy({ id: approverId });
            if (!approver) throw this.httpError("Người duyệt không tồn tại", 404);

        let anyApproved = false;
        let anyRejectedGlobal = false;

        for (const decision of decisions) {
            const service = request.services.find(s => s.id === decision.serviceId);
            if (!service) continue;

            const resultDecisions = (decision as any).resultDecisions || [];

            if (resultDecisions.length > 0) {
                // Granular approval
                if (service.results) {
                    for (const rd of resultDecisions) {
                        // find the LAST matching result (the newest uploaded file for this task)
                        const resultsArray = [...service.results];
                        resultsArray.reverse();
                        const result = resultsArray.find(r => r.taskId === rd.taskId);

                        if (result) {
                            // Because result is a reference to the object in the original array, mutating it here works.
                            result.status = rd.status;
                            result.feedback = rd.feedback;

                            // If rejected, find the specific task and reset it for rework
                            if (rd.status === 'REJECTED') {
                                const task = await manager.getRepository(Tasks).findOneBy({ id: rd.taskId });
                                if (task) {
                                    task.status = TaskStatus.REWORKING;
                                    task.reviewNote = rd.feedback || "Khách hàng yêu cầu sửa lại (Nghiệm thu bị từ chối)";
                                    task.actualEndDate = null; // Clear end date for rework
                                    await manager.save(task);

                                    // Notify assignee about rework
                                    if (task.assigneeId) {
                                        const assignee = await manager.getRepository(Users).findOneBy({ id: task.assigneeId });
                                        if (assignee) {
                                            await this.notificationService.createNotification({
                                                title: "Yêu cầu sửa lại (Rework)",
                                                content: `Công việc "${task.nickname || task.name}" của dự án ${request.project?.name} bị từ chối nghiệm thu. Lý do: ${task.reviewNote}`,
                                                type: "TASK_REJECTED",
                                                recipient: assignee,
                                                relatedEntityId: task.id.toString(),
                                                relatedEntityType: "Task",
                                                link: `/tasks/${task.id}`
                                            }, manager);
                                        }
                                    }
                                }
                            } else if (rd.status === 'APPROVED') {
                                // Transition to ACCEPTED if individual task is approved
                                const task = await manager.getRepository(Tasks).findOneBy({ id: rd.taskId });
                                if (task) {
                                    task.status = TaskStatus.ACCEPTED;
                                    task.actualEndDate = new Date();
                                    await manager.save(task);
                                }
                            }
                        }
                    }
                }
            } else {
                // Traditional batch approval/rejection for the whole service
                if (decision.status === 'APPROVED') {
                    if (service.results) {
                        service.results = service.results.map(r => ({ ...r, status: 'APPROVED' }));
                    }
                } else {
                    if (service.results) {
                        service.results = service.results.map(r => ({ ...r, status: 'REJECTED', feedback: decision.feedback }));
                    }
                }
            }

            // Extract the latest result for each task to evaluate overall status
            const latestResultsMap = new Map();
            if (service.results) {
                for (const r of service.results) {
                    latestResultsMap.set(r.taskId, r);
                }
            }
            const latestResults = Array.from(latestResultsMap.values());

            // Check if ALL output tasks (those in service.results) are APPROVED based on LATEST files
            const allApproved = latestResults.length > 0 &&
                latestResults.every(r => r.status === 'APPROVED');

            const anyRejected = latestResults.some(r => r.status === 'REJECTED');

            if (allApproved) {
                service.status = ContractServiceStatus.COMPLETED;
                service.feedback = null;
                anyApproved = true;

                // Complete all remaining tasks just in case
                await manager.update(
                    Tasks,
                    { contractService: { id: service.id } },
                    { status: TaskStatus.ACCEPTED, actualEndDate: new Date() }
                );

                // Reward Vinicoin
                await this.triggerRewards(service, manager);
            } else if (anyRejected) {
                service.status = ContractServiceStatus.ACCEPTANCE_REJECTED;
                service.feedback = decision.feedback || "Một số kết quả bị từ chối";
                anyRejectedGlobal = true;
            } else {
                // Still waiting for more results or decisions
                service.status = ContractServiceStatus.AWAITING_ACCEPTANCE;
            }

            await manager.save(service);
        }

        // Auto trigger completion check
        if (request.projectId) {
            await this.syncProjectCompletionStatus(request.projectId, manager);
        }

        // Update request status to PROCESSED as the batch has been handled
        request.status = AcceptanceStatus.PROCESSED;
        request.approver = approver;
        await manager.save(request);

        // Notify requester
        await this.notificationService.createNotification({
            title: "Kết quả nghiệm thu",
            content: `Yêu cầu nghiệm thu "${request.name}" của dự án ${request.project?.name} đã được xử lý.`,
            type: anyRejectedGlobal ? "ACCEPTANCE_REJECTED" : "ACCEPTANCE_APPROVED",
            recipient: request.requester,
            relatedEntityId: request.id,
            relatedEntityType: "AcceptanceRequest",
            link: `/acceptance/${request.id}`
        }, manager);

            return request;
        });
    }

    async getRequest(id: string) {
        return await this.acceptanceRepo.findOne({
            where: { id },
            order: { createdAt: "DESC" },
            relations: ["services", "services.tasks", "requester", "approver", "project"]
        });
    }

    async getAllRequests(filters: { search?: string, status?: string, page?: number, limit?: number } = {}) {
        const page = Number(filters.page) || 1;
        const limit = Number(filters.limit) || 10;
        const skip = (page - 1) * limit;

        const where: any = {};
        if (filters.status && filters.status !== 'ALL') {
            where.status = filters.status;
        }

        let findOptions: any = {
            where: where,
            order: { createdAt: "DESC" },
            relations: ["requester", "approver", "project", "services", "services.tasks"],
            take: limit,
            skip: skip
        };

        if (filters.search) {
            const searchTerm = `%${filters.search}%`;
            findOptions.where = [
                { ...where, name: ILike(searchTerm) },
                { ...where, project: { name: ILike(searchTerm) } }
            ];
        }

        const [items, total] = await this.acceptanceRepo.findAndCount(findOptions);

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

    private async triggerRewards(service: ContractServices, manager: EntityManager) {
        if (!service.tasks) return;

        for (const task of service.tasks) {
            const rewardAmount = task.job?.vinicoin;
            if (!rewardAmount || rewardAmount <= 0) continue;

            const rewardedAccountIds = new Set<string>();
            if (task.assignee?.account?.id && task.performerType === PerformerType.INTERNAL) {
                rewardedAccountIds.add(task.assignee.account.id);
            }
            if (task.helper?.account?.id && task.performerType === PerformerType.INTERNAL) {
                rewardedAccountIds.add(task.helper.account.id);
            }
            for (const accountId of rewardedAccountIds) {
                await this.vinicoinService.rewardForTask(
                    accountId,
                    rewardAmount,
                    task.id,
                    service.id,
                    manager
                );
            }
        }
    }

    private async syncProjectCompletionStatus(projectId: string, manager?: EntityManager) {
        const projectRepo = manager ? manager.getRepository(Projects) : this.projectRepo;
        const contractRepo = manager ? manager.getRepository(Contracts) : this.contractRepo;
        // 1. Fetch all services of the project
        // Note: Project and Contract are 1-1, so project.contract.services is our set
        const project = await projectRepo.findOne({
            where: { id: projectId },
            relations: ["contract", "contract.services"]
        });

        if (!project || !project.contract) return;

        const services = project.contract.services || [];
        if (services.length === 0) return;

        // 2. Check if all services are COMPLETED or CANCELLED
        const allCompleted = services.every(s =>
            s.status === ContractServiceStatus.COMPLETED ||
            s.status === ContractServiceStatus.CANCELLED
        );

        // We only move to COMPLETED if at least one service is actually COMPLETED (not just all cancelled)
        const hasCompletedService = services.some(s => s.status === ContractServiceStatus.COMPLETED);

        if (allCompleted && hasCompletedService) {
            // Update Project
            project.status = ProjectStatus.COMPLETED;
            project.actualEndDate = new Date();
            await projectRepo.save(project);

            // Update Contract
            await contractRepo.update(
                { id: project.contract.id },
                { status: ContractStatus.COMPLETED }
            );
        }
    }
}
