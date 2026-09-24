import { AppDataSource } from "../../../data-source";
import { EntityManager, In, MoreThan } from "typeorm";
import { Projects, ProjectStatus } from "../entities/Project.entity";
import {
    ProjectPauseRequests,
    PauseRequestStatus,
    PauseMode,
    ClosedByType,
    CloseMode
} from "../entities/ProjectPauseRequest.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { TaskStatus } from "../../../shared/entities/Enums";
import { Users } from "../../user/entities/User.entity";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";
import {
    ContractServices,
    ContractServiceStatus
} from "../../contract/entities/ContractService.entity";
import { Accounts, isManagementRole, UserRole } from "../../account/entities/Account.entity";
import { MemberRole, memberHasRole } from "../entities/TeamMember.entity";
import { Debts, DebtStatus } from "../../debt/entities/Debt.entity";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";

import { ProjectBaseService } from "./Project.BaseService";
import { AcceptanceService } from "../../acceptance/services/Acceptance.Service";
import {
    PAUSE_DURATION_DAYS,
    REMINDER_WINDOW_DAYS,
    HOLD_EXEMPT_TASK_STATUSES,
    DEBT_STATUSES_TO_LOCK,
    FORCE_CLOSE_REASON,
    calcAutoAcceptAt,
    calcReminderStartAt,
    classifyTasksForClose,
    buildRewardWhitelist,
    applyDebtLock
} from "../helpers/ProjectPause.helper";

// Re-export để nơi khác (cron, controller) dùng chung 1 nguồn
export { PAUSE_DURATION_DAYS, REMINDER_WINDOW_DAYS, HOLD_EXEMPT_TASK_STATUSES };

type ActorInfo = { id?: string; userId?: string; role?: string };

export class ProjectPauseService extends ProjectBaseService {
    private pauseRequestRepository = AppDataSource.getRepository(ProjectPauseRequests);
    private debtRepository = AppDataSource.getRepository(Debts);
    private acceptanceService = new AcceptanceService();

    // ─────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────

    private getActorUserId(actor?: ActorInfo) {
        return actor?.userId || actor?.id;
    }

    private assertReason(reason: string | undefined, message: string) {
        if (!reason || !reason.trim()) throw this.httpError(message, 400);
        return reason.trim();
    }

    /** PM của dự án (member role PROJECT_MANAGER) · Team Lead · ACCOUNT. */
    private isProjectOperator(project: Projects, actor?: ActorInfo) {
        const actorUserId = this.getActorUserId(actor);
        if (!actorUserId) return false;
        if (project.team?.teamLead?.id === actorUserId) return true;
        return Boolean(project.team?.members?.some(member =>
            member.user?.id === actorUserId &&
            [MemberRole.PROJECT_MANAGER, MemberRole.ACCOUNT].some(role => memberHasRole(member, role))
        ));
    }

    /**
     * Quyền XIN tạm dừng: PM dự án / BD phụ trách HĐ / BOD / ADMIN.
     *
     * ⚠️ BD KHÔNG nằm trong PROJECT_MANAGEMENT_ROLES nên phải kiểm tra tường minh.
     */
    private async assertCanRequestPause(project: Projects, actor?: ActorInfo) {
        if (!actor?.role) throw this.httpError("Bạn cần đăng nhập để thực hiện", 401);
        if (isManagementRole(actor.role)) return;

        if (actor.role === UserRole.PM) {
            if (!this.isProjectOperator(project, actor)) {
                throw this.httpError("Bạn không phải PM của dự án này", 403);
            }
            return;
        }

        if (actor.role === UserRole.BD) {
            // BD phải là người phụ trách hợp đồng của dự án
            await this.assertBdOwnsProjectContract(actor, project.id);
            return;
        }

        throw this.httpError("Bạn không có quyền yêu cầu tạm dừng dự án", 403);
    }

    /** Quyền LÀM TIẾP: PM dự án / BD phụ trách HĐ / BOD / ADMIN. */
    private async assertCanResume(project: Projects, actor?: ActorInfo) {
        if (!actor?.role) throw this.httpError("Bạn cần đăng nhập để thực hiện", 401);
        if (isManagementRole(actor.role)) return;
        if (this.isProjectOperator(project, actor)) return;

        if (actor.role === UserRole.BD) {
            await this.assertBdOwnsProjectContract(actor, project.id);
            return;
        }

        throw this.httpError("Bạn không có quyền mở lại dự án này", 403);
    }

    /** Quyền DUYỆT tạm dừng: chỉ BOD/ADMIN. */
    private assertPauseApprover(actor?: ActorInfo) {
        if (!actor?.role) throw this.httpError("Bạn cần đăng nhập để thực hiện", 401);
        if (!isManagementRole(actor.role)) {
            throw this.httpError("Chỉ BOD hoặc ADMIN được duyệt yêu cầu tạm dừng", 403);
        }
    }

    private async getLockedProject(manager: EntityManager, projectId: string) {
        const locked = await manager
            .createQueryBuilder(Projects, "project")
            .select("project.id")
            .where("project.id = :projectId", { projectId })
            .setLock("pessimistic_write")
            .getOne();
        if (!locked) throw this.httpError("Không tìm thấy dự án", 404);

        const project = await manager.getRepository(Projects).findOne({
            where: { id: projectId },
            relations: ["team", "team.teamLead", "team.members", "team.members.user", "contract"]
        });
        if (!project) throw this.httpError("Không tìm thấy dự án", 404);
        return project;
    }

    private async resolveUser(manager: EntityManager, actor?: ActorInfo) {
        const actorUserId = this.getActorUserId(actor);
        if (!actorUserId) return null;

        const userRepo = manager.getRepository(Users);
        const byUser = await userRepo.findOneBy({ id: actorUserId });
        if (byUser) return byUser;

        // actor.id có thể là ACCOUNT id
        const account = await manager.getRepository(Accounts).findOne({
            where: { id: actorUserId },
            relations: ["user"]
        });
        if (account?.user) return account.user;
        if (account?.userId) return userRepo.findOneBy({ id: account.userId });
        return null;
    }

    /** Gửi thông báo cho tất cả tài khoản có 1 role nhất định. */
    private async notifyRoles(
        manager: EntityManager,
        roles: string[],
        payload: { title: string; content: string; type: string; link?: string; relatedEntityId?: string },
        excludeUserIds: string[] = []
    ) {
        const users = await manager.getRepository(Users).createQueryBuilder("user")
            .innerJoin("user.accounts", "account")
            .where("account.role IN (:...roles)", { roles })
            .getMany();

        const exclude = new Set(excludeUserIds.filter(Boolean));
        for (const user of users) {
            if (exclude.has(user.id)) continue;
            await this.notificationService.createNotification({
                ...payload,
                recipient: user,
                relatedEntityType: "Project"
            }, manager);
        }
    }

    private async notifyUsers(
        manager: EntityManager,
        userIds: string[],
        payload: { title: string; content: string; type: string; link?: string; relatedEntityId?: string }
    ) {
        const uniqueIds = [...new Set(userIds.filter(Boolean))];
        for (const userId of uniqueIds) {
            const user = await manager.getRepository(Users).findOneBy({ id: userId });
            if (!user) continue;
            await this.notificationService.createNotification({
                ...payload,
                recipient: user,
                relatedEntityType: "Project"
            }, manager);
        }
    }

    /** Người nhận thông báo vận hành: PM + BD phụ trách HĐ + Team Lead + ACCOUNT. */
    private collectProjectStakeholderIds(project: Projects): string[] {
        const ids: string[] = [];
        if (project.team?.teamLead?.id) ids.push(project.team.teamLead.id);
        for (const member of project.team?.members || []) {
            if (member.user?.id) ids.push(member.user.id);
        }
        return ids;
    }

    // ─────────────────────────────────────────────────────────────────────
    // ÁP DỤNG TẠM DỪNG (D0)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Đưa dự án vào `ON_HOLD` — dùng chung cho `approvePause` và `pauseDirect`.
     *
     * Chỉ có 2 nhánh task:
     *  a. 3 trạng thái cuối (COMPLETED / INTERNAL_COMPLETED / ACCEPTED) → GIỮ NGUYÊN
     *  b. còn lại → ON_HOLD + lưu `statusBeforeHold`
     */
    private async applyHold(
        manager: EntityManager,
        project: Projects,
        request: ProjectPauseRequests,
        actor: ActorInfo,
        reason: string
    ) {
        const now = new Date();
        const autoAcceptAt = calcAutoAcceptAt(now);

        project.status = ProjectStatus.ON_HOLD;
        project.pausedAt = now;
        project.autoAcceptAt = autoAcceptAt;
        project.isOnHold = true;
        project.currentPauseRequestId = request.id;
        project.pausedById = (await this.resolveUser(manager, actor))?.id || null;

        await manager.save(project);

        // Task dở dang → ON_HOLD, nhớ status cũ. Task 3 trạng thái cuối giữ nguyên.
        await manager.createQueryBuilder()
            .update(Tasks)
            .set({
                status: TaskStatus.ON_HOLD,
                statusBeforeHold: () => '"status"'
            })
            .where("projectId = :projectId", { projectId: project.id })
            .andWhere("status NOT IN (:...exempt)", { exempt: HOLD_EXEMPT_TASK_STATUSES })
            .execute();

        const taskRepo = manager.getRepository(Tasks);
        const [onHoldCount, exemptCount] = await Promise.all([
            taskRepo.count({ where: { project: { id: project.id }, status: TaskStatus.ON_HOLD } }),
            taskRepo.count({ where: { project: { id: project.id }, status: In(HOLD_EXEMPT_TASK_STATUSES) } })
        ]);

        await this.notifyUsers(manager, this.collectProjectStakeholderIds(project), {
            title: "Dự án đã tạm dừng",
            content: `Dự án ${project.name} đã tạm dừng. Lý do: ${reason}. `
                + `Có ${onHoldCount} công việc bị tạm dừng, ${exemptCount} công việc đã xong được giữ nguyên. `
                + `Dự án sẽ tự động đóng sau ${PAUSE_DURATION_DAYS} ngày nếu không có ai xử lý.`,
            type: "PROJECT_PAUSED",
            link: `/projects/${project.id}`,
            relatedEntityId: project.id
        });
        await this.notifyRoles(manager, [UserRole.BOD, UserRole.ADMIN], {
            title: "Dự án đã tạm dừng",
            content: `Dự án ${project.name} đã vào trạng thái tạm dừng. Lý do: ${reason}`,
            type: "PROJECT_PAUSED",
            link: `/projects/${project.id}`,
            relatedEntityId: project.id
        });

        projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);
        return project;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. XIN TẠM DỪNG (PM hoặc BD)
    // ─────────────────────────────────────────────────────────────────────

    async requestPause(projectId: string, reason: string, actor?: ActorInfo) {
        const cleanReason = this.assertReason(reason, "Vui lòng nhập lý do tạm dừng");

        return AppDataSource.transaction(async (manager) => {
            const project = await this.getLockedProject(manager, projectId);

            if (project.status !== ProjectStatus.IN_PROGRESS) {
                throw this.httpError(
                    `Chỉ có thể tạm dừng dự án đang thực hiện (hiện tại: ${project.status})`,
                    409
                );
            }

            await this.assertCanRequestPause(project, actor);

            // Chặn gửi trùng khi đã có đơn đang chờ
            const existing = await this.pauseRequestRepository.findOne({
                where: { projectId, status: PauseRequestStatus.PENDING }
            });
            if (existing) {
                throw this.httpError("Dự án đang có một yêu cầu tạm dừng chờ duyệt", 409);
            }

            const requester = await this.resolveUser(manager, actor);
            if (!requester) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 403);

            const request = manager.getRepository(ProjectPauseRequests).create({
                project,
                projectId,
                requester,
                requesterId: requester.id,
                requesterRole: actor?.role,
                pauseMode: PauseMode.REQUEST,
                reason: cleanReason,
                status: PauseRequestStatus.PENDING,
                requestedAt: new Date()
            });
            const savedRequest = await manager.save(request);

            project.status = ProjectStatus.PENDING_PAUSE_APPROVAL;
            project.currentPauseRequestId = savedRequest.id;
            await manager.save(project);

            projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);

            await this.notifyRoles(manager, [UserRole.BOD, UserRole.ADMIN], {
                title: "Yêu cầu tạm dừng dự án",
                content: `${requester.fullName} yêu cầu tạm dừng dự án ${project.name}. Lý do: ${cleanReason}`,
                type: "PROJECT_PAUSE_REQUESTED",
                link: `/projects/${project.id}`,
                relatedEntityId: project.id
            }, [requester.id]);

            return savedRequest;
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. DUYỆT / TỪ CHỐI YÊU CẦU TẠM DỪNG
    // ─────────────────────────────────────────────────────────────────────

    async approvePause(requestId: string, actor?: ActorInfo) {
        this.assertPauseApprover(actor);

        return AppDataSource.transaction(async (manager) => {
            const requestRepo = manager.getRepository(ProjectPauseRequests);
            const lockedRequest = await manager
                .createQueryBuilder(ProjectPauseRequests, "request")
                .select("request.id")
                .where("request.id = :requestId", { requestId })
                .setLock("pessimistic_write")
                .getOne();
            if (!lockedRequest) throw this.httpError("Không tìm thấy yêu cầu tạm dừng", 404);

            const request = await requestRepo.findOne({ where: { id: requestId }, relations: ["requester"] });
            if (!request) throw this.httpError("Không tìm thấy yêu cầu tạm dừng", 404);
            if (request.status !== PauseRequestStatus.PENDING) {
                throw this.httpError("Yêu cầu này đã được xử lý", 409);
            }

            const project = await this.getLockedProject(manager, request.projectId);
            if (project.status !== ProjectStatus.PENDING_PAUSE_APPROVAL) {
                throw this.httpError(
                    `Dự án không ở trạng thái chờ duyệt tạm dừng (hiện tại: ${project.status})`,
                    409
                );
            }

            const approver = await this.resolveUser(manager, actor);
            if (!approver) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 403);

            const autoAcceptAt = calcAutoAcceptAt(new Date());
            request.status = PauseRequestStatus.APPROVED;
            request.approver = approver;
            request.approverId = approver.id;
            request.approvedAt = new Date();
            request.autoAcceptAt = autoAcceptAt;
            await manager.save(request);

            await this.applyHold(manager, project, request, actor!, request.reason);

            await this.notifyUsers(manager, [request.requesterId].filter(Boolean), {
                title: "Yêu cầu tạm dừng đã được duyệt",
                content: `Dự án ${project.name} đã được duyệt tạm dừng. Dự án sẽ tự động đóng sau ${PAUSE_DURATION_DAYS} ngày.`,
                type: "PROJECT_PAUSED",
                link: `/projects/${project.id}`,
                relatedEntityId: project.id
            });

            return request;
        });
    }

    async rejectPause(requestId: string, feedback: string, actor?: ActorInfo) {
        this.assertPauseApprover(actor);
        const cleanFeedback = this.assertReason(feedback, "Vui lòng nhập lý do từ chối");

        return AppDataSource.transaction(async (manager) => {
            const requestRepo = manager.getRepository(ProjectPauseRequests);
            const lockedRequest = await manager
                .createQueryBuilder(ProjectPauseRequests, "request")
                .select("request.id")
                .where("request.id = :requestId", { requestId })
                .setLock("pessimistic_write")
                .getOne();
            if (!lockedRequest) throw this.httpError("Không tìm thấy yêu cầu tạm dừng", 404);

            const request = await requestRepo.findOne({ where: { id: requestId }, relations: ["requester"] });
            if (!request) throw this.httpError("Không tìm thấy yêu cầu tạm dừng", 404);
            if (request.status !== PauseRequestStatus.PENDING) {
                throw this.httpError("Yêu cầu này đã được xử lý", 409);
            }

            const approver = await this.resolveUser(manager, actor);
            if (!approver) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 403);

            request.status = PauseRequestStatus.REJECTED;
            request.approver = approver;
            request.approverId = approver.id;
            request.feedback = cleanFeedback;
            request.approvedAt = new Date();
            await manager.save(request);

            const project = await this.getLockedProject(manager, request.projectId);
            if (project.status === ProjectStatus.PENDING_PAUSE_APPROVAL) {
                project.status = ProjectStatus.IN_PROGRESS;
                project.currentPauseRequestId = null;
                await manager.save(project);
                projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);
            }

            await this.notifyUsers(manager, [request.requesterId].filter(Boolean), {
                title: "Yêu cầu tạm dừng bị từ chối",
                content: `Yêu cầu tạm dừng dự án ${project.name} bị từ chối. Lý do: ${cleanFeedback}`,
                type: "PROJECT_PAUSE_REJECTED",
                link: `/projects/${project.id}`,
                relatedEntityId: project.id
            });

            return request;
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. BOD/ADMIN TẠM DỪNG TRỰC TIẾP
    // ─────────────────────────────────────────────────────────────────────

    async pauseDirect(projectId: string, reason: string, actor?: ActorInfo) {
        this.assertPauseApprover(actor);
        const cleanReason = this.assertReason(reason, "Vui lòng nhập lý do tạm dừng");

        return AppDataSource.transaction(async (manager) => {
            const project = await this.getLockedProject(manager, projectId);

            if (project.status !== ProjectStatus.IN_PROGRESS) {
                throw this.httpError(
                    `Chỉ có thể tạm dừng dự án đang thực hiện (hiện tại: ${project.status})`,
                    409
                );
            }

            const actorUser = await this.resolveUser(manager, actor);
            if (!actorUser) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 403);

            const request = manager.getRepository(ProjectPauseRequests).create({
                project,
                projectId,
                requester: actorUser,
                requesterId: actorUser.id,
                requesterRole: actor?.role,
                pauseMode: PauseMode.DIRECT,
                reason: cleanReason,
                status: PauseRequestStatus.APPROVED,
                approver: actorUser,
                approverId: actorUser.id,
                requestedAt: new Date(),
                approvedAt: new Date(),
                autoAcceptAt: calcAutoAcceptAt(new Date())
            });
            const savedRequest = await manager.save(request);

            await this.applyHold(manager, project, savedRequest, actor!, cleanReason);

            return savedRequest;
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. LÀM TIẾP (RESUME)
    // ─────────────────────────────────────────────────────────────────────

    async resume(projectId: string, resumeReason: string | undefined, actor?: ActorInfo) {
        return AppDataSource.transaction(async (manager) => {
            const project = await this.getLockedProject(manager, projectId);

            if (project.status !== ProjectStatus.ON_HOLD) {
                throw this.httpError(
                    `Chỉ có thể làm tiếp dự án đang tạm dừng (hiện tại: ${project.status})`,
                    409
                );
            }

            await this.assertCanResume(project, actor);

            // ⚠️ ĐỌC id đơn TRƯỚC khi xoá field — nếu không sẽ mất dấu vết đơn tạm dừng
            const pauseRequestId = project.currentPauseRequestId;

            // Task ON_HOLD → khôi phục status cũ. Task 3 trạng thái cuối KHÔNG đụng.
            await manager.createQueryBuilder()
                .update(Tasks)
                .set({
                    status: () => `COALESCE("statusBeforeHold", '${TaskStatus.DOING}')::tasks_status_enum`,
                    statusBeforeHold: null as any
                })
                .where("projectId = :projectId", { projectId })
                .andWhere("status = :onHold", { onHold: TaskStatus.ON_HOLD })
                .execute();

            project.status = ProjectStatus.IN_PROGRESS;
            project.pausedAt = null;
            project.autoAcceptAt = null;
            project.isOnHold = false;
            project.currentPauseRequestId = null;
            project.pausedById = null;
            project.lastReminderDate = null;
            await manager.save(project);

            // Ghi vết lên đơn tạm dừng đang hiệu lực
            if (pauseRequestId) {
                const request = await manager.getRepository(ProjectPauseRequests)
                    .findOneBy({ id: pauseRequestId });
                if (request && request.status === PauseRequestStatus.APPROVED) {
                    request.status = PauseRequestStatus.RESUMED;
                    request.resumedAt = new Date();
                    request.resumeReason = resumeReason?.trim() || null;
                    await manager.save(request);
                }
            }

            await this.notifyUsers(manager, this.collectProjectStakeholderIds(project), {
                title: "Dự án đã được làm tiếp",
                content: `Dự án ${project.name} đã được mở lại và tiếp tục thực hiện.`,
                type: "PROJECT_RESUMED",
                link: `/projects/${project.id}`,
                relatedEntityId: project.id
            });

            projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);
            return project;
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. TRA CỨU
    // ─────────────────────────────────────────────────────────────────────

    async getPauseHistory(projectId: string) {
        return this.pauseRequestRepository.find({
            where: { projectId },
            relations: ["requester", "approver", "closedBy"],
            order: { createdAt: "DESC" }
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. XEM TRƯỚC KHI ĐÓNG (hold-summary)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Thống kê để UI hiện modal xác nhận — KHÔNG đổi dữ liệu.
     *
     * Trả về đúng 3 nhóm theo luật chốt task:
     *  - `toAccept`: COMPLETED → ACCEPTED (+Vinicoin)
     *  - `toKeep`:   INTERNAL_COMPLETED / ACCEPTED → giữ nguyên
     *  - `toCancel`: ON_HOLD → CANCELLED
     */
    async getHoldSummary(projectId: string) {
        const project = await this.projectRepository.findOne({
            where: { id: projectId },
            relations: ["contract", "contract.services"]
        });
        if (!project) throw this.httpError("Không tìm thấy dự án", 404);

        const tasks = await this.taskRepository.find({
            where: { project: { id: projectId } },
            relations: ["job"]
        });

        const toAccept = tasks.filter(task => task.status === TaskStatus.COMPLETED);
        const toKeep = tasks.filter(task => [
            TaskStatus.INTERNAL_COMPLETED,
            TaskStatus.ACCEPTED
        ].includes(task.status));
        const toCancel = tasks.filter(task => task.status === TaskStatus.ON_HOLD);

        // Chỉ task gốc COMPLETED mới sinh Vinicoin (khớp whitelist truyền vào triggerRewards)
        const estimatedVinicoin = toAccept
            .filter(task => !task.parentTaskId && task.isRewardable !== false)
            .reduce((sum, task) => sum + Number(task.job?.vinicoin || 0), 0);

        const contractId = project.contract?.id;
        const debtsToLock = contractId
            ? await this.debtRepository.find({
                where: {
                    contract: { id: contractId },
                    status: In(DEBT_STATUSES_TO_LOCK)
                }
            })
            : [];
        const debtsToLockAmount = debtsToLock
            .reduce((sum, debt) => sum + Number(debt.amount || 0), 0);

        return {
            projectId,
            projectName: project.name,
            acceptedCount: toAccept.length,
            unchangedCount: toKeep.length,
            cancelledCount: toCancel.length,
            estimatedVinicoin,
            debtsToLock: {
                count: debtsToLock.length,
                totalAmount: debtsToLockAmount
            },
            autoAcceptAt: project.autoAcceptAt
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. ĐÓNG DỰ ÁN — 1 hàm dùng chung cho cả 3 đường
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Chốt sổ dự án — dùng chung cho:
     *  (a) BD/BOD/ADMIN đóng trực tiếp
     *  (b) PM đề nghị → BOD duyệt
     *  (c) cron force đóng ở D+37
     *
     * ⚠️ CHỈ ĐỤNG 2 NHÓM TASK:
     *   - COMPLETED → ACCEPTED  (+Vinicoin)
     *   - ON_HOLD   → CANCELLED (không Vinicoin)
     *   - INTERNAL_COMPLETED / ACCEPTED → GIỮ NGUYÊN, không thưởng
     */
    private async closeProject(
        manager: EntityManager,
        project: Projects,
        request: ProjectPauseRequests | null,
        opts: {
            closeMode: CloseMode;
            closedByType: ClosedByType;
            actor?: ActorInfo;
            reason: string;
        }
    ) {
        const now = new Date();

        const tasks = await manager.getRepository(Tasks).find({
            where: { project: { id: project.id } },
            relations: ["job", "assignee", "assignee.accounts", "helper", "helper.accounts", "contractService"]
        });

        // Phân loại theo luật đã chốt — logic nằm ở helper để test được độc lập
        const { toAccept, toCancel, toKeep } = classifyTasksForClose(tasks);
        // toKeep = INTERNAL_COMPLETED + ACCEPTED → KHÔNG bị đụng tới
        void toKeep;

        // ── 1. Chuyển trạng thái ──────────────────────────────────────────
        for (const task of toAccept) {
            task.status = TaskStatus.ACCEPTED;
            task.actualEndDate = now;
        }
        if (toAccept.length > 0) await manager.save(toAccept);

        for (const task of toCancel) {
            task.status = TaskStatus.CANCELLED;
            task.isRewardable = false;
        }
        if (toCancel.length > 0) await manager.save(toCancel);

        // ── 2. Cập nhật ContractService theo task ─────────────────────────
        const serviceIds = [...new Set(tasks.map(task => task.contractService?.id).filter(Boolean))] as string[];
        if (serviceIds.length > 0) {
            const serviceRepo = manager.getRepository(ContractServices);
            for (const serviceId of serviceIds) {
                const serviceTasks = tasks.filter(task => task.contractService?.id === serviceId);
                const anyAccepted = serviceTasks.some(task => task.status === TaskStatus.ACCEPTED);
                const allCancelled = serviceTasks.length > 0
                    && serviceTasks.every(task => task.status === TaskStatus.CANCELLED);

                const service = await serviceRepo.findOneBy({ id: serviceId });
                if (!service) continue;
                if (anyAccepted) {
                    service.status = ContractServiceStatus.COMPLETED;
                } else if (allCancelled) {
                    service.status = ContractServiceStatus.CANCELLED;
                }
                await serviceRepo.save(service);
            }
        }

        // ── 3. Vinicoin — CHỈ task gốc COMPLETED ──────────────────────────
        const rewardWhitelist = buildRewardWhitelist(toAccept);
        if (rewardWhitelist.size > 0) {
            const freshServices = await manager.getRepository(ContractServices).find({
                where: { id: In(serviceIds.length > 0 ? serviceIds : ["__NONE__"]) },
                relations: ["tasks"]
            });
            for (const service of freshServices) {
                await this.acceptanceService.triggerRewards(service, manager, rewardWhitelist);
            }
        }

        // ── 4. Khóa công nợ ───────────────────────────────────────────────
        const debtsLockedCount = await this.lockContractDebts(manager, project, opts.reason, opts.actor);

        // ── 5. Đóng dự án ─────────────────────────────────────────────────
        project.status = ProjectStatus.CANCELLED;
        project.actualEndDate = now;
        project.autoAcceptAt = null;
        project.isOnHold = false;
        project.pausedAt = null;
        project.pausedById = null;
        project.lastReminderDate = null;
        await manager.save(project);

        if (project.contract?.id) {
            await manager.getRepository(Contracts).update(
                { id: project.contract.id },
                { status: ContractStatus.CANCELLED }
            );
        }

        // ── 6. Ghi vết lên đơn tạm dừng ───────────────────────────────────
        const targetRequest = request || (project.currentPauseRequestId
            ? await manager.getRepository(ProjectPauseRequests).findOneBy({ id: project.currentPauseRequestId })
            : null);

        const closedByUser = opts.closedByType === ClosedByType.USER
            ? await this.resolveUser(manager, opts.actor)
            : null;

        if (targetRequest) {
            targetRequest.status = PauseRequestStatus.CLOSED;
            targetRequest.closeMode = opts.closeMode;
            targetRequest.closedByType = opts.closedByType;
            targetRequest.closedBy = closedByUser;
            targetRequest.closedById = closedByUser?.id || null;
            targetRequest.closedAt = now;
            targetRequest.closeReason = opts.reason;
            targetRequest.acceptedTaskCount = toAccept.length;
            targetRequest.cancelledTaskCount = toCancel.length;
            targetRequest.acceptedTaskIds = toAccept.map(task => task.id);
            await manager.save(targetRequest);
        }

        project.currentPauseRequestId = null;
        await manager.save(project);
        projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);

        return {
            project,
            acceptedCount: toAccept.length,
            cancelledCount: toCancel.length,
            unchangedCount: tasks.length - toAccept.length - toCancel.length,
            debtsLockedCount
        };
    }

    /**
     * Khóa toàn bộ công nợ chưa thu của hợp đồng. Debt đã PAID giữ nguyên.
     * Trả về số debt đã khóa.
     */
    private async lockContractDebts(
        manager: EntityManager,
        project: Projects,
        reason: string,
        actor?: ActorInfo
    ): Promise<number> {
        const contractId = project.contract?.id;
        if (!contractId) return 0;

        const debtRepo = manager.getRepository(Debts);
        const debts = await debtRepo.find({
            where: {
                contract: { id: contractId },
                status: In(DEBT_STATUSES_TO_LOCK)
            }
        });
        if (debts.length === 0) return 0;

        const lockedBy = await this.resolveUser(manager, actor);
        applyDebtLock(debts, reason, lockedBy);
        await debtRepo.save(debts);
        return debts.length;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. 3 ĐƯỜNG ĐÓNG DỰ ÁN
    // ─────────────────────────────────────────────────────────────────────

    /**
     * BD / BOD / ADMIN đóng dự án TRỰC TIẾP — không cần duyệt (chốt #38).
     * `reason` BẮT BUỘC (chốt #39) vì không qua duyệt thì lý do là căn cứ duy nhất.
     */
    async closeDirect(projectId: string, reason: string, actor?: ActorInfo) {
        const cleanReason = this.assertReason(reason, "Vui lòng nhập lý do đóng dự án");

        return AppDataSource.transaction(async (manager) => {
            const project = await this.getLockedProject(manager, projectId);
            if (project.status !== ProjectStatus.ON_HOLD) {
                throw this.httpError(
                    `Chỉ có thể đóng dự án đang tạm dừng (hiện tại: ${project.status})`,
                    409
                );
            }

            if (!actor?.role) throw this.httpError("Bạn cần đăng nhập để thực hiện", 401);
            if (!isManagementRole(actor.role)) {
                if (actor.role !== UserRole.BD) {
                    throw this.httpError("Chỉ BD, BOD hoặc ADMIN được đóng dự án trực tiếp", 403);
                }
                // BD phải là người phụ trách hợp đồng của dự án (chốt #41)
                await this.assertBdOwnsProjectContract(actor, projectId);
            }

            const result = await this.closeProject(manager, project, null, {
                closeMode: CloseMode.DIRECT,
                closedByType: ClosedByType.USER,
                actor,
                reason: cleanReason
            });

            await this.notifyCloseResult(manager, project, cleanReason, result, [
                UserRole.BOD, UserRole.ADMIN
            ], this.collectProjectStakeholderIds(project));

            return result;
        });
    }

    /** PM đề nghị đóng — tạo đơn PENDING, CHỜ BOD duyệt. */
    async requestClose(projectId: string, reason: string | undefined, actor?: ActorInfo) {
        return AppDataSource.transaction(async (manager) => {
            const project = await this.getLockedProject(manager, projectId);
            if (project.status !== ProjectStatus.ON_HOLD) {
                throw this.httpError(
                    `Chỉ có thể đề nghị đóng dự án đang tạm dừng (hiện tại: ${project.status})`,
                    409
                );
            }

            if (!actor?.role) throw this.httpError("Bạn cần đăng nhập để thực hiện", 401);
            if (!isManagementRole(actor.role) && !this.isProjectOperator(project, actor)) {
                throw this.httpError("Chỉ PM của dự án mới được đề nghị đóng dự án", 403);
            }

            const requester = await this.resolveUser(manager, actor);
            if (!requester) throw this.httpError("Tài khoản chưa được liên kết nhân sự", 403);

            const request = manager.getRepository(ProjectPauseRequests).create({
                project,
                projectId,
                requester,
                requesterId: requester.id,
                requesterRole: actor.role,
                pauseMode: project.currentPauseRequestId ? PauseMode.REQUEST : PauseMode.DIRECT,
                reason: reason?.trim() || "Đề nghị đóng dự án",
                status: PauseRequestStatus.PENDING,
                requestedAt: new Date(),
                closeMode: CloseMode.REQUEST
            });
            const savedRequest = await manager.save(request);

            projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);

            await this.notifyRoles(manager, [UserRole.BOD, UserRole.ADMIN], {
                title: "Đề nghị đóng dự án",
                content: `${requester.fullName} đề nghị đóng dự án ${project.name}. Lý do: ${savedRequest.reason}`,
                type: "PROJECT_CLOSE_REQUESTED",
                link: `/projects/${project.id}`,
                relatedEntityId: project.id
            }, [requester.id]);

            return savedRequest;
        });
    }

    /** BOD/ADMIN/ADMIN_SALE duyệt đơn đóng dự án của PM. */
    async approveClose(requestId: string, actor?: ActorInfo) {
        this.assertCloseApprover(actor);

        return AppDataSource.transaction(async (manager) => {
            const requestRepo = manager.getRepository(ProjectPauseRequests);
            const locked = await manager
                .createQueryBuilder(ProjectPauseRequests, "request")
                .select("request.id")
                .where("request.id = :requestId", { requestId })
                .setLock("pessimistic_write")
                .getOne();
            if (!locked) throw this.httpError("Không tìm thấy đơn đóng dự án", 404);

            const request = await requestRepo.findOne({ where: { id: requestId } });
            if (!request) throw this.httpError("Không tìm thấy đơn đóng dự án", 404);
            if (request.status !== PauseRequestStatus.PENDING) {
                throw this.httpError("Đơn này đã được xử lý", 409);
            }

            const project = await this.getLockedProject(manager, request.projectId);
            if (project.status !== ProjectStatus.ON_HOLD) {
                throw this.httpError(
                    `Dự án không ở trạng thái tạm dừng (hiện tại: ${project.status})`,
                    409
                );
            }

            const result = await this.closeProject(manager, project, request, {
                closeMode: CloseMode.REQUEST,
                closedByType: ClosedByType.USER,
                actor,
                reason: request.reason
            });

            await this.notifyUsers(manager, [request.requesterId].filter(Boolean), {
                title: "Đề nghị đóng dự án đã được duyệt",
                content: `Dự án ${project.name} đã được duyệt đóng. Kết quả: ${result.acceptedCount} công việc nghiệm thu, ${result.cancelledCount} công việc hủy.`,
                type: "PROJECT_CLOSED",
                link: `/projects/${project.id}`,
                relatedEntityId: project.id
            });

            return result;
        });
    }

    /** BOD/ADMIN/ADMIN_SALE từ chối đơn đóng — dự án VẪN ON_HOLD. */
    async rejectClose(requestId: string, feedback: string, actor?: ActorInfo) {
        this.assertCloseApprover(actor);
        const cleanFeedback = this.assertReason(feedback, "Vui lòng nhập lý do từ chối");

        return AppDataSource.transaction(async (manager) => {
            const requestRepo = manager.getRepository(ProjectPauseRequests);
            const request = await requestRepo.findOne({ where: { id: requestId } });
            if (!request) throw this.httpError("Không tìm thấy đơn đóng dự án", 404);
            if (request.status !== PauseRequestStatus.PENDING) {
                throw this.httpError("Đơn này đã được xử lý", 409);
            }

            request.status = PauseRequestStatus.REJECTED;
            request.feedback = cleanFeedback;
            request.approvedAt = new Date();
            const approver = await this.resolveUser(manager, actor);
            request.approver = approver;
            request.approverId = approver?.id || null;
            await manager.save(request);

            const project = await this.projectRepository.findOneBy({ id: request.projectId });
            if (project) {
                projectEmitter.emit(PROJECT_EVENTS.UPDATED, project);
            }
            await this.notifyUsers(manager, [request.requesterId].filter(Boolean), {
                title: "Đề nghị đóng dự án bị từ chối",
                content: `Đề nghị đóng dự án ${project?.name} bị từ chối. Lý do: ${cleanFeedback}. Dự án vẫn đang tạm dừng.`,
                type: "PROJECT_CLOSE_REJECTED",
                link: `/projects/${request.projectId}`,
                relatedEntityId: request.projectId
            });

            return request;
        });
    }

    private assertCloseApprover(actor?: ActorInfo) {
        if (!actor?.role) throw this.httpError("Bạn cần đăng nhập để thực hiện", 401);
        const allowed = [UserRole.BOD, UserRole.ADMIN, UserRole.ADMIN_SALE];
        if (!allowed.includes(actor.role as UserRole)) {
            throw this.httpError("Chỉ BOD, ADMIN hoặc ADMIN_SALE được duyệt đóng dự án", 403);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 10. ĐỔI TRẠNG THÁI DỰ ÁN QUA API CHUNG
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Các trạng thái BỊ CHẶN khi đổi qua `PATCH /projects/:id/status`.
     *
     * Phải đi qua endpoint chuyên dụng vì các trạng thái này kéo theo việc
     * chuyển trạng thái TASK + chốt Vinicoin + khóa công nợ. Đổi thẳng qua
     * route này sẽ bỏ qua hết → dữ liệu sai lệch âm thầm.
     */
    private static readonly BLOCKED_DIRECT_STATUSES: ProjectStatus[] = [
        ProjectStatus.ON_HOLD,
        ProjectStatus.PENDING_PAUSE_APPROVAL,
        ProjectStatus.COMPLETED,
        ProjectStatus.CANCELLED
    ];

    async updateStatus(projectId: string, status: string, actor?: ActorInfo) {
        const project = await this.projectRepository.findOneBy({ id: projectId });
        if (!project) throw this.httpError("Không tìm thấy dự án", 404);

        const target = status as ProjectStatus;
        if (!Object.values(ProjectStatus).includes(target)) {
            throw this.httpError(`Trạng thái "${status}" không hợp lệ`, 400);
        }

        if (ProjectPauseService.BLOCKED_DIRECT_STATUSES.includes(target)) {
            throw this.httpError(
                `Không thể đổi thẳng sang "${status}" qua API này. `
                + `Vui lòng dùng: /pause (tạm dừng), /close (đóng dự án).`,
                409
            );
        }

        if (!actor?.role) throw this.httpError("Bạn cần đăng nhập để thực hiện", 401);
        if (!isManagementRole(actor.role)) {
            throw this.httpError("Chỉ BOD hoặc ADMIN được đổi trạng thái dự án", 403);
        }

        project.status = target;
        const saved = await this.projectRepository.save(project);
        projectEmitter.emit(PROJECT_EVENTS.UPDATED, saved);
        return saved;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 9. DÀNH CHO CRON
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Force đóng dự án ở D+37 — gọi từ cron. KHÔNG qua duyệt.
     *
     * Idempotent: nếu `autoAcceptAt` đã null (đã xử lý) hoặc dự án không còn
     * `ON_HOLD` (đã resume / đã đóng tay) thì bỏ qua, không báo lỗi — để cron
     * chạy lại nhiều lần vẫn an toàn.
     */
    async forceCloseForCron(projectId: string) {
        return AppDataSource.transaction(async (manager) => {
            const project = await this.getLockedProject(manager, projectId);

            if (project.status !== ProjectStatus.ON_HOLD) return null;
            if (!project.autoAcceptAt || project.autoAcceptAt > new Date()) return null;

            const result = await this.closeProject(manager, project, null, {
                closeMode: CloseMode.DIRECT,
                closedByType: ClosedByType.SYSTEM,
                actor: undefined,
                reason: FORCE_CLOSE_REASON
            });

            await this.notifyCloseResult(manager, project, FORCE_CLOSE_REASON, result, [
                UserRole.BOD, UserRole.ADMIN
            ], this.collectProjectStakeholderIds(project));

            return result;
        });
    }

    /**
     * Gửi thông báo nhắc nhở hằng ngày trong 7 ngày cuối trước D+37
     * (tức D+31 → D+37, chốt #19). Người nhận: PM + BD phụ trách HĐ + BOD + ADMIN.
     *
     * Idempotent theo NGÀY: dùng `Projects.lastReminderDate` để không gửi trùng
     * dù cron chạy lại hoặc server restart / chạy nhiều instance.
     */
    async sendDailyReminders() {
        const now = new Date();
        const todayKey = now.toISOString().slice(0, 10);

        // Chỉ lấy dự án đang tạm dừng và CHƯA quá hạn tự đóng
        const projects = await this.projectRepository.find({
            where: {
                status: ProjectStatus.ON_HOLD,
                autoAcceptAt: MoreThan(now)
            },
            relations: ["team", "team.teamLead", "team.members", "team.members.user", "contract"]
        });

        let sent = 0;

        for (const project of projects) {
            const autoAcceptAt = project.autoAcceptAt;
            if (!autoAcceptAt) continue;

            // Chỉ nhắc trong cửa sổ 7 ngày cuối: D+30 <= now < D+37
            if (autoAcceptAt > calcAutoAcceptAt(now)) continue;
            if (now < calcReminderStartAt(autoAcceptAt)) continue;

            // Chống gửi trùng trong cùng 1 ngày
            const lastSent = project.lastReminderDate
                ? new Date(project.lastReminderDate).toISOString().slice(0, 10)
                : null;
            if (lastSent === todayKey) continue;

            const projectId = project.id;
            const projectName = project.name;
            const stakeholderIds = this.collectProjectStakeholderIds(project);

            await AppDataSource.transaction(async (manager) => {
                const tasks = await manager.getRepository(Tasks).find({
                    where: { project: { id: projectId } }
                });
                const { toAccept, toCancel } = classifyTasksForClose(tasks);
                const daysLeft = Math.max(
                    0,
                    Math.ceil((autoAcceptAt.getTime() - now.getTime()) / 86400000)
                );

                const payload = {
                    title: "Sắp tự động đóng dự án",
                    content: `Dự án ${projectName} sẽ tự động đóng sau ${daysLeft} ngày nữa `
                        + `(${autoAcceptAt.toLocaleDateString("vi-VN")}). `
                        + `Hiện có ${toAccept.length} công việc sẽ được nghiệm thu, `
                        + `${toCancel.length} công việc dở dang sẽ bị hủy.`,
                    type: "PROJECT_CLOSE_REMINDER",
                    link: `/projects/${projectId}`,
                    relatedEntityId: projectId
                };

                await this.notifyUsers(manager, stakeholderIds, payload);
                await this.notifyRoles(manager, [UserRole.BOD, UserRole.ADMIN], payload);

                await manager.getRepository(Projects).update(
                    { id: projectId },
                    { lastReminderDate: now }
                );
            });
            sent += 1;
        }

        return sent;
    }

    /** BOD/ADMIN/PM nhận thông báo khi dự án bị đóng (chốt #40). */
    private async notifyCloseResult(
        manager: EntityManager,
        project: Projects,
        reason: string,
        result: { acceptedCount: number; cancelledCount: number; debtsLockedCount: number },
        roleGroups: string[],
        extraUserIds: string[]
    ) {
        const content = `Dự án ${project.name} đã đóng. Lý do: ${reason}. `
            + `${result.acceptedCount} công việc được nghiệm thu, `
            + `${result.cancelledCount} công việc bị hủy, `
            + `${result.debtsLockedCount} khoản công nợ bị khóa.`;

        const payload = {
            title: "Dự án đã đóng",
            content,
            type: "PROJECT_CLOSED",
            link: `/projects/${project.id}`,
            relatedEntityId: project.id
        };

        await this.notifyRoles(manager, roleGroups, payload);
        await this.notifyUsers(manager, extraUserIds, payload);
    }
}
