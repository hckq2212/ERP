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
import { In, Not, ILike } from "typeorm";

export class AcceptanceService {
    private acceptanceRepo = AppDataSource.getRepository(AcceptanceRequests);
    private serviceRepo = AppDataSource.getRepository(ContractServices);
    private contractRepo = AppDataSource.getRepository(Contracts);
    private userRepo = AppDataSource.getRepository(Users);
    private taskRepo = AppDataSource.getRepository(Tasks);
    private projectRepo = AppDataSource.getRepository(Projects);
    private notificationService = new NotificationService();
    private vinicoinService = new VinicoinService();

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
            .where("account.role IN (:...roles)", { roles: ["BOD", "ADMIN"] })
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

    async approveRequest(requestId: string, approverId: string, feedback?: string) {
        const request = await this.acceptanceRepo.findOne({
            where: { id: requestId },
            relations: ["services", "services.tasks", "services.tasks.job", "services.tasks.assignee", "services.tasks.assignee.account", "services.tasks.helper", "services.tasks.helper.account", "requester"]
        });

        if (!request) throw new Error("Không tìm thấy yêu cầu nghiệm thu");
        if (request.status !== AcceptanceStatus.PENDING) throw new Error("Yêu cầu này đã được xử lý");

        const approver = await this.userRepo.findOneBy({ id: approverId });
        if (!approver) throw new Error("Người duyệt không tồn tại");

        request.status = AcceptanceStatus.APPROVED;
        request.approver = approver;
        request.feedback = feedback || "";

        await this.acceptanceRepo.save(request);

        // Update services results status
        for (const s of request.services) {
            if (s.results) {
                s.results = s.results.map(r => ({ ...r, status: 'APPROVED' }));
            }
            s.status = ContractServiceStatus.COMPLETED;
            await this.serviceRepo.save(s);

            // Fetch and complete all tasks for this service
            await this.taskRepo.update(
                { contractService: { id: s.id } },
                { status: TaskStatus.ACCEPTED, actualEndDate: new Date() }
            );

            // Reward Vinicoin
            await this.triggerRewards(s);
        }

        // Auto trigger completion check
        if (request.projectId) {
            await this.syncProjectCompletionStatus(request.projectId);
        }

        // Notify requester
        await this.notificationService.createNotification({
            title: "Yêu cầu nghiệm thu được DUYỆT",
            content: `Đợt nghiệm thu "${request.name}" đã được duyệt.`,
            type: "ACCEPTANCE_APPROVED",
            recipient: request.requester,
            relatedEntityId: request.id,
            relatedEntityType: "AcceptanceRequest",
        });

        return request;
    }

    async rejectRequest(requestId: string, approverId: string, feedback: string) {
        if (!feedback) throw new Error("Vui lòng nhập lý do từ chối");

        const request = await this.acceptanceRepo.findOne({
            where: { id: requestId },
            relations: ["services", "services.tasks", "requester"] // Need tasks relation
        });

        if (!request) throw new Error("Không tìm thấy yêu cầu nghiệm thu");
        if (request.status !== AcceptanceStatus.PENDING) throw new Error("Yêu cầu này đã được xử lý");

        const approver = await this.userRepo.findOneBy({ id: approverId });
        if (!approver) throw new Error("Người duyệt không tồn tại");

        request.status = AcceptanceStatus.REJECTED;
        request.approver = approver;
        request.feedback = feedback;

        await this.acceptanceRepo.save(request);

        // Update services and tasks
        for (const s of request.services) {
            if (s.results) {
                s.results = s.results.map(r => ({ ...r, status: 'REJECTED', feedback }));
            }
            s.status = ContractServiceStatus.ACCEPTANCE_REJECTED;
            s.feedback = feedback;
            await this.serviceRepo.save(s);

            // Fetch tasks for this service to reset them
            const tasks = await this.taskRepo.find({
                where: { contractService: { id: s.id } }
            });

            for (const task of tasks) {
                task.status = TaskStatus.DOING;
                await this.taskRepo.save(task);
            }
        }

        // Notify requester
        await this.notificationService.createNotification({
            title: "Yêu cầu nghiệm thu bị từ chối",
            content: `Đợt nghiệm thu "${request.name}" của dự án ${request.project?.name} bị từ chối. Lý do: ${feedback}`,
            type: "ACCEPTANCE_REJECTED",
            recipient: request.requester,
            relatedEntityId: request.id,
            relatedEntityType: "AcceptanceRequest",
            link: `/acceptance/${request.id}`
        });

        return request;
    }

    async processRequest(requestId: string, approverId: string, decisions: { serviceId: string, status: 'APPROVED' | 'REJECTED', feedback?: string }[]) {
        const request = await this.acceptanceRepo.findOne({
            where: { id: requestId },
            relations: ["services", "services.tasks", "services.tasks.job", "services.tasks.assignee", "services.tasks.assignee.account", "services.tasks.helper", "services.tasks.helper.account", "requester"]
        });

        if (!request) throw new Error("Không tìm thấy yêu cầu nghiệm thu");
        if (request.status !== AcceptanceStatus.PENDING) throw new Error("Yêu cầu này đã được xử lý");

        const approver = await this.userRepo.findOneBy({ id: approverId });
        if (!approver) throw new Error("Người duyệt không tồn tại");

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
                                const task = await this.taskRepo.findOneBy({ id: rd.taskId });
                                if (task) {
                                    task.status = TaskStatus.REWORKING;
                                    task.reviewNote = rd.feedback || "Khách hàng yêu cầu sửa lại (Nghiệm thu bị từ chối)";
                                    task.actualEndDate = null; // Clear end date for rework
                                    await this.taskRepo.save(task);

                                    // Notify assignee about rework
                                    if (task.assigneeId) {
                                        const assignee = await this.userRepo.findOneBy({ id: task.assigneeId });
                                        if (assignee) {
                                            await this.notificationService.createNotification({
                                                title: "Yêu cầu sửa lại (Rework)",
                                                content: `Công việc "${task.name}" của dự án ${request.project?.name} bị từ chối nghiệm thu. Lý do: ${task.reviewNote}`,
                                                type: "TASK_REJECTED",
                                                recipient: assignee,
                                                relatedEntityId: task.id.toString(),
                                                relatedEntityType: "Task",
                                                link: `/tasks/${task.id}`
                                            });
                                        }
                                    }
                                }
                            } else if (rd.status === 'APPROVED') {
                                // Transition to ACCEPTED if individual task is approved
                                const task = await this.taskRepo.findOneBy({ id: rd.taskId });
                                if (task) {
                                    task.status = TaskStatus.ACCEPTED;
                                    task.actualEndDate = new Date();
                                    await this.taskRepo.save(task);
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
                await this.taskRepo.update(
                    { contractService: { id: service.id } },
                    { status: TaskStatus.ACCEPTED, actualEndDate: new Date() }
                );

                // Reward Vinicoin
                await this.triggerRewards(service);
            } else if (anyRejected) {
                service.status = ContractServiceStatus.ACCEPTANCE_REJECTED;
                service.feedback = decision.feedback || "Một số kết quả bị từ chối";
                anyRejectedGlobal = true;
            } else {
                // Still waiting for more results or decisions
                service.status = ContractServiceStatus.AWAITING_ACCEPTANCE;
            }

            await this.serviceRepo.save(service);
        }

        // Auto trigger completion check
        if (request.projectId) {
            await this.syncProjectCompletionStatus(request.projectId);
        }

        // Update request status to PROCESSED as the batch has been handled
        request.status = AcceptanceStatus.PROCESSED;
        request.approver = approver;
        await this.acceptanceRepo.save(request);

        // Notify requester
        await this.notificationService.createNotification({
            title: "Kết quả nghiệm thu",
            content: `Yêu cầu nghiệm thu "${request.name}" của dự án ${request.project?.name} đã được xử lý.`,
            type: anyRejectedGlobal ? "ACCEPTANCE_REJECTED" : "ACCEPTANCE_APPROVED",
            recipient: request.requester,
            relatedEntityId: request.id,
            relatedEntityType: "AcceptanceRequest",
            link: `/acceptance/${request.id}`
        });

        return request;
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

    private async triggerRewards(service: ContractServices) {
        if (!service.tasks) return;

        for (const task of service.tasks) {
            const rewardAmount = task.job?.vinicoin;
            if (!rewardAmount || rewardAmount <= 0) continue;

            // Reward Assignee
            if (task.assignee?.account?.id && task.performerType === PerformerType.INTERNAL) {
                await this.vinicoinService.rewardForTask(
                    task.assignee.account.id,
                    rewardAmount,
                    task.id,
                    service.id
                );
            }

            // Reward Helper (if internal)
            if (task.helper?.account?.id && task.performerType === PerformerType.INTERNAL) {
                await this.vinicoinService.rewardForTask(
                    task.helper.account.id,
                    rewardAmount,
                    task.id,
                    service.id
                );
            }
        }
    }

    private async syncProjectCompletionStatus(projectId: string) {
        // 1. Fetch all services of the project
        // Note: Project and Contract are 1-1, so project.contract.services is our set
        const project = await this.projectRepo.findOne({
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
            await this.projectRepo.save(project);

            // Update Contract
            await this.contractRepo.update(
                { id: project.contract.id },
                { status: ContractStatus.COMPLETED }
            );
        }
    }
}
