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

    async createRequest(data: { serviceIds: number[], userId: number, name: string, projectId: number, note?: string }) {
        const { serviceIds, userId, name, projectId, note } = data;

        const requester = await this.userRepo.findOneBy({ id: userId });
        if (!requester) throw new Error("Người yêu cầu không tồn tại");

        const project = await this.projectRepo.findOneBy({ id: projectId });
        if (!project) throw new Error("Dự án không tồn tại");

        const services = await this.serviceRepo.find({
            where: { id: In(serviceIds) },
            relations: ["contract", "contract.project"]
        });

        if (services.length !== serviceIds.length) {
            throw new Error("Một số hạng mục dịch vụ không tồn tại");
        }

        // Check if all services belong to the project
        const invalidServices = services.filter(s => s.contract?.project?.id !== projectId);
        if (invalidServices.length > 0) {
            throw new Error(`Có ${invalidServices.length} dịch vụ không thuộc dự án đã chọn.`);
        }

        // Check if all services have results
        for (const s of services) {
            if (!s.result) {
                throw new Error(`Dịch vụ ID ${s.id} chưa có kết quả nghiệm thu nội bộ.`);
            }
        }

        const request = this.acceptanceRepo.create({
            name,
            requester,
            project,
            note,
            status: AcceptanceStatus.PENDING,
            services
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
                relatedEntityId: savedRequest.id.toString(),
                relatedEntityType: "AcceptanceRequest",
                link: `/acceptance/${savedRequest.id}`
            });
        }

        return savedRequest;
    }

    async approveRequest(requestId: number, approverId: number, feedback?: string) {
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

        // Update services to COMPLETED
        for (const s of request.services) {
            s.status = ContractServiceStatus.COMPLETED;
            await this.serviceRepo.save(s);
        }

        // Notify requester
        await this.notificationService.createNotification({
            title: "Yêu cầu nghiệm thu được DUYỆT",
            content: `Đợt nghiệm thu "${request.name}" đã được phê duyệt.`,
            type: "ACCEPTANCE_APPROVED",
            recipient: request.requester,
            relatedEntityId: request.id.toString(),
            relatedEntityType: "AcceptanceRequest",
            link: `/acceptance/${request.id}`
        });

        return request;
    }

    async rejectRequest(requestId: number, approverId: number, feedback: string) {
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
            relatedEntityId: request.id.toString(),
            relatedEntityType: "AcceptanceRequest",
            link: `/acceptance/${request.id}`
        });

        return request;
    }

    async processRequest(requestId: number, approverId: number, decisions: { serviceId: number, status: 'APPROVED' | 'REJECTED', feedback?: string }[]) {
        const request = await this.acceptanceRepo.findOne({
            where: { id: requestId },
            relations: ["services", "services.tasks", "requester"]
        });

        if (!request) throw new Error("Không tìm thấy yêu cầu nghiệm thu");
        if (request.status !== AcceptanceStatus.PENDING) throw new Error("Yêu cầu này đã được xử lý");

        const approver = await this.userRepo.findOneBy({ id: approverId });
        if (!approver) throw new Error("Người duyệt không tồn tại");

        let anyApproved = false;
        let anyRejected = false;

        for (const decision of decisions) {
            const service = request.services.find(s => s.id === decision.serviceId);
            if (!service) continue;

            if (decision.status === 'APPROVED') {
                service.status = ContractServiceStatus.COMPLETED;
                service.feedback = null;
                anyApproved = true;
            } else {
                service.status = ContractServiceStatus.ACCEPTANCE_REJECTED;
                service.feedback = decision.feedback || "Từ chối nghiệm thu";
                anyRejected = true;

                // Reset tasks to DOING
                const tasks = await this.taskRepo.find({
                    where: { contractService: { id: service.id } }
                });
                for (const task of tasks) {
                    task.status = TaskStatus.DOING;
                    await this.taskRepo.save(task);
                }
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
            type: anyRejected ? "ACCEPTANCE_REJECTED" : "ACCEPTANCE_APPROVED",
            recipient: request.requester,
            relatedEntityId: request.id.toString(),
            relatedEntityType: "AcceptanceRequest",
            link: `/acceptance/${request.id}`
        });

        return request;
    }

    async getRequest(id: number) {
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
