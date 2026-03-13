import { AppDataSource } from "../data-source";
import { AcceptanceRequests, AcceptanceStatus } from "../entity/AcceptanceRequest.entity";
import { ContractServices, ContractServiceStatus } from "../entity/ContractService.entity";
import { Users } from "../entity/User.entity";
import { Tasks, TaskStatus } from "../entity/Task.entity";
import { Projects } from "../entity/Project.entity";
import { NotificationService } from "./Notification.Service";
import { In } from "typeorm";

export class AcceptanceService {
    private acceptanceRepo = AppDataSource.getRepository(AcceptanceRequests);
    private serviceRepo = AppDataSource.getRepository(ContractServices);
    private userRepo = AppDataSource.getRepository(Users);
    private taskRepo = AppDataSource.getRepository(Tasks);
    private projectRepo = AppDataSource.getRepository(Projects);
    private notificationService = new NotificationService();

    async createRequest(data: { serviceIds: string[], userId: string, name: string, projectId: string, note?: string }) {
        const { serviceIds, userId, name, projectId, note } = data;

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
        for (const s of services) {
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
                content: `Team Lead ${requester.fullName} yêu cầu nghiệm thu đợt: ${name}`,
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
            relations: ["services", "requester"]
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
                { status: TaskStatus.COMPLETED, actualEndDate: new Date() }
            );
        }

        // Notify requester
        await this.notificationService.createNotification({
            title: "Yêu cầu nghiệm thu được DUYỆT",
            content: `Đợt nghiệm thu "${request.name}" đã được phê duyệt.`,
            type: "ACCEPTANCE_APPROVED",
            recipient: request.requester,
            relatedEntityId: request.id,
            relatedEntityType: "AcceptanceRequest",
            link: `/acceptance/${request.id}`
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
            title: "Yêu cầu nghiệm thu bị TỪ CHỐI",
            content: `Đợt nghiệm thu "${request.name}" bị từ chối. Lý do: ${feedback}`,
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
            relations: ["services", "services.tasks", "requester"]
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
                        const result = service.results.find(r => r.taskId === rd.taskId);
                        if (result) {
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
                                                content: `Công việc "${task.name}" bị khách hàng từ chối nghiệm thu. Lý do: ${task.reviewNote}`,
                                                type: "TASK_REJECTED",
                                                recipient: assignee,
                                                relatedEntityId: task.id.toString(),
                                                relatedEntityType: "Task",
                                                link: `/tasks/${task.id}`
                                            });
                                        }
                                    }
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

            // Check if ALL output tasks (those in service.results) are APPROVED
            const allApproved = service.results && service.results.length > 0 && 
                               service.results.every(r => r.status === 'APPROVED');
            
            const anyRejected = service.results && service.results.some(r => r.status === 'REJECTED');

            if (allApproved) {
                service.status = ContractServiceStatus.COMPLETED;
                service.feedback = null;
                anyApproved = true;

                // Complete all remaining tasks just in case
                await this.taskRepo.update(
                    { contractService: { id: service.id } },
                    { status: TaskStatus.COMPLETED, actualEndDate: new Date() }
                );
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

        // Update request status to PROCESSED as the batch has been handled
        request.status = AcceptanceStatus.PROCESSED;
        request.approver = approver;
        await this.acceptanceRepo.save(request);

        // Notify requester
        await this.notificationService.createNotification({
            title: "Kết quả nghiệm thu",
            content: `Đợt nghiệm thu "${request.name}" đã được xử lý.`,
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
            relations: ["services", "services.tasks", "requester", "approver", "project"]
        });
    }

    async getAllRequests() {
        return await this.acceptanceRepo.find({
            relations: ["requester", "approver", "project", "services", "services.tasks"]
        });
    }
}
