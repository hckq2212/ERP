import { AppDataSource } from "../../../data-source";
import { Accounts, UserRole } from "../../account/entities/Account.entity";
import { Opportunities } from "../../opportunity/entities/Opportunity.entity";
import { Projects } from "../../project/entities/Project.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { MotionGenerations } from "../../video-generation/entities/MotionGeneration.entity";
import { VideoGenerations } from "../../video-generation/entities/VideoGeneration.entity";

type DashboardActor = {
    id: string;
    userId?: string;
    role: UserRole | string;
};

type AggregateRow = {
    totalPrompts: string;
    totalVideos: string;
    totalCost: string;
};

type DailyRow = {
    day: string;
    prompts: string;
    videos: string;
    cost: string;
};

const MEMBER_VIEW_ROLES = new Set<string>([
    UserRole.BOD,
    UserRole.ADMIN,
    UserRole.PM,
    UserRole.ADMIN_SALE,
]);

export class AiDashboardService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private projectRepository = AppDataSource.getRepository(Projects);
    private opportunityRepository = AppDataSource.getRepository(Opportunities);
    private taskRepository = AppDataSource.getRepository(Tasks);
    private videoRepository = AppDataSource.getRepository(VideoGenerations);
    private motionRepository = AppDataSource.getRepository(MotionGenerations);

    async getDashboard(
        actor: DashboardActor,
        requestedUserId?: string,
        projectId?: string,
        opportunityId?: string,
        taskId?: string,
        month = new Date().getMonth() + 1,
        year = new Date().getFullYear(),
    ) {
        this.validatePeriod(month, year);
        if (projectId && opportunityId) {
            throw this.httpError("Chỉ được chọn dự án hoặc cơ hội tại một thời điểm", 400);
        }

        const canViewMembers = MEMBER_VIEW_ROLES.has(actor.role);
        const targetUserId = canViewMembers ? requestedUserId : actor.userId;

        if (!canViewMembers && requestedUserId && requestedUserId !== actor.userId) {
            throw this.httpError("Bạn không có quyền xem thống kê AI của thành viên khác", 403);
        }

        const targetAccountIds = await this.resolveAccountIds(targetUserId, actor);
        const availableMembers = canViewMembers ? await this.getAvailableMembers() : [];
        const availableProjects = await this.getAvailableProjects(targetUserId);
        const availableOpportunities = await this.getAvailableOpportunities(targetUserId);

        if (projectId && !availableProjects.some((project) => project.id === projectId)) {
            throw this.httpError("Dự án không thuộc phạm vi thống kê AI được phép xem", 403);
        }

        if (opportunityId && !availableOpportunities.some((opportunity) => opportunity.id === opportunityId)) {
            throw this.httpError("Cơ hội không thuộc phạm vi thống kê AI được phép xem", 403);
        }

        const availableTasks = projectId || opportunityId
            ? await this.getAvailableTasks(projectId, opportunityId)
            : [];

        if (taskId && (!(projectId || opportunityId) || !availableTasks.some((task) => task.id === taskId))) {
            throw this.httpError("Công việc không thuộc dự án hoặc cơ hội đã chọn", 403);
        }

        const [videoStats, motionStats, videoDaily, motionDaily] = await Promise.all([
            this.getAggregate(this.videoRepository, targetAccountIds, projectId, opportunityId, taskId),
            this.getAggregate(this.motionRepository, targetAccountIds, projectId, opportunityId, taskId),
            this.getDaily(this.videoRepository, targetAccountIds, projectId, opportunityId, taskId, month, year),
            this.getDaily(this.motionRepository, targetAccountIds, projectId, opportunityId, taskId, month, year),
        ]);

        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyMap = new Map<number, { prompt: number; videos: number; total: number }>();

        for (const row of [...videoDaily, ...motionDaily]) {
            const day = Number(row.day);
            const current = dailyMap.get(day) || { prompt: 0, videos: 0, total: 0 };
            current.prompt += Number(row.prompts || 0);
            current.videos += Number(row.videos || 0);
            current.total += Number(row.cost || 0);
            dailyMap.set(day, current);
        }

        const generations = Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1;
            const item = dailyMap.get(day);
            return {
                day,
                prompt: item?.prompt || 0,
                images: 0,
                videos: item?.videos || 0,
            };
        });

        const spending = generations.map(({ day }) => ({
            day,
            total: dailyMap.get(day)?.total || 0,
        }));

        return {
            stats: {
                totalPrompts: Number(videoStats.totalPrompts || 0) + Number(motionStats.totalPrompts || 0),
                totalImages: 0,
                totalVideos: Number(videoStats.totalVideos || 0) + Number(motionStats.totalVideos || 0),
                totalCost: Number(videoStats.totalCost || 0) + Number(motionStats.totalCost || 0),
            },
            generations,
            spending,
            filters: {
                canViewMembers,
                availableMembers,
                availableProjects,
                availableOpportunities,
                availableTasks,
                selectedUserId: targetUserId || null,
                selectedProjectId: projectId || null,
                selectedOpportunityId: opportunityId || null,
                selectedTaskId: taskId || null,
                month,
                year,
            },
        };
    }

    private validatePeriod(month: number, year: number) {
        if (!Number.isInteger(month) || month < 1 || month > 12) {
            throw this.httpError("Tháng thống kê không hợp lệ", 400);
        }
        if (!Number.isInteger(year) || year < 2020 || year > 2100) {
            throw this.httpError("Năm thống kê không hợp lệ", 400);
        }
    }

    private async resolveAccountIds(targetUserId: string | undefined, actor: DashboardActor) {
        if (!targetUserId) return undefined;

        if (targetUserId === actor.userId) return [actor.id];

        const accounts = await this.accountRepository.find({
            where: { userId: targetUserId, isActive: true },
            select: { id: true },
        });
        if (!accounts.length) throw this.httpError("Không tìm thấy tài khoản của thành viên", 404);
        return accounts.map((account) => account.id);
    }

    private async getAvailableMembers() {
        const accounts = await this.accountRepository.find({
            where: { isActive: true },
            relations: ["user"],
            select: {
                id: true,
                role: true,
                userId: true,
                user: { id: true, fullName: true },
            },
            order: { user: { fullName: "ASC" } },
        });

        const members = new Map<string, { id: string; fullName: string; role: UserRole }>();
        for (const account of accounts) {
            if (account.user?.id && !members.has(account.user.id)) {
                members.set(account.user.id, {
                    id: account.user.id,
                    fullName: account.user.fullName,
                    role: account.role,
                });
            }
        }
        return Array.from(members.values());
    }

    private async getAvailableProjects(targetUserId?: string) {
        const query = this.projectRepository.createQueryBuilder("project")
            .leftJoin("project.team", "team")
            .leftJoin("team.teamLead", "teamLead")
            .leftJoin("team.members", "teamMember")
            .leftJoin("teamMember.user", "teamUser")
            .leftJoin("project.tasks", "task")
            .select(["project.id", "project.name"])
            .distinct(true)
            .orderBy("project.name", "ASC");

        if (targetUserId) {
            query.where(
                "teamLead.id = :targetUserId OR teamUser.id = :targetUserId OR task.assigneeId = :targetUserId OR task.helperId = :targetUserId",
                { targetUserId },
            );
        }

        const projects = await query.getMany();
        return projects.map(({ id, name }) => ({ id, name }));
    }

    private async getAvailableOpportunities(targetUserId?: string) {
        const query = this.opportunityRepository.createQueryBuilder("opportunity")
            .leftJoin("opportunity.createdBy", "createdBy")
            .leftJoin(Tasks, "task", "task.opportunityId = opportunity.id")
            .select(["opportunity.id", "opportunity.opportunityCode", "opportunity.name"])
            .distinct(true)
            .orderBy("opportunity.opportunityCode", "ASC")
            .addOrderBy("opportunity.name", "ASC");

        if (targetUserId) {
            query.where(
                "createdBy.id = :targetUserId OR task.assigneeId = :targetUserId OR task.helperId = :targetUserId",
                { targetUserId },
            );
        }

        const opportunities = await query.getMany();
        return opportunities.map(({ id, opportunityCode, name }) => ({ id, opportunityCode, name }));
    }

    private async getAvailableTasks(projectId?: string, opportunityId?: string) {
        const query = this.taskRepository.createQueryBuilder("task")
            .select(["task.id", "task.code", "task.name", "task.nickname"])
            .orderBy("task.code", "ASC")
            .addOrderBy("task.name", "ASC");

        if (projectId) {
            query.innerJoin("task.project", "project")
                .where("project.id = :projectId", { projectId });
        } else if (opportunityId) {
            query.where("task.opportunityId = :opportunityId", { opportunityId });
        } else {
            return [];
        }

        const tasks = await query.getMany();
        return tasks.map((task) => ({
            id: task.id,
            code: task.code,
            name: task.nickname || task.name,
        }));
    }

    private async getAggregate(
        repository: typeof this.videoRepository | typeof this.motionRepository,
        accountIds?: string[],
        projectId?: string,
        opportunityId?: string,
        taskId?: string,
    ): Promise<AggregateRow> {
        const query = repository.createQueryBuilder("generation")
            .select("SUM(CASE WHEN NULLIF(BTRIM(generation.motionPrompt), '') IS NOT NULL THEN 1 ELSE 0 END)", "totalPrompts")
            .addSelect("COUNT(generation.id)", "totalVideos")
            .addSelect("COALESCE(SUM(generation.cost), 0)", "totalCost")
            .where("generation.status = :status", { status: "succeeded" });

        this.applyFilters(query, accountIds, projectId, opportunityId, taskId);
        return query.getRawOne<AggregateRow>() as Promise<AggregateRow>;
    }

    private async getDaily(
        repository: typeof this.videoRepository | typeof this.motionRepository,
        accountIds: string[] | undefined,
        projectId: string | undefined,
        opportunityId: string | undefined,
        taskId: string | undefined,
        month: number,
        year: number,
    ): Promise<DailyRow[]> {
        const query = repository.createQueryBuilder("generation")
            .select("EXTRACT(DAY FROM generation.createdAt AT TIME ZONE 'Asia/Ho_Chi_Minh')", "day")
            .addSelect("SUM(CASE WHEN NULLIF(BTRIM(generation.motionPrompt), '') IS NOT NULL THEN 1 ELSE 0 END)", "prompts")
            .addSelect("COUNT(generation.id)", "videos")
            .addSelect("COALESCE(SUM(generation.cost), 0)", "cost")
            .where("generation.status = :status", { status: "succeeded" })
            .andWhere("EXTRACT(MONTH FROM generation.createdAt AT TIME ZONE 'Asia/Ho_Chi_Minh') = :month", { month })
            .andWhere("EXTRACT(YEAR FROM generation.createdAt AT TIME ZONE 'Asia/Ho_Chi_Minh') = :year", { year })
            .groupBy("EXTRACT(DAY FROM generation.createdAt AT TIME ZONE 'Asia/Ho_Chi_Minh')")
            .orderBy("EXTRACT(DAY FROM generation.createdAt AT TIME ZONE 'Asia/Ho_Chi_Minh')", "ASC");

        this.applyFilters(query, accountIds, projectId, opportunityId, taskId);
        return query.getRawMany<DailyRow>();
    }

    private applyFilters(
        query: any,
        accountIds?: string[],
        projectId?: string,
        opportunityId?: string,
        taskId?: string,
    ) {
        if (accountIds) {
            query.andWhere("generation.userId IN (:...accountIds)", { accountIds });
        }
        if (projectId) {
            query.andWhere("generation.projectId = :projectId", { projectId });
        }
        if (opportunityId) {
            query.andWhere("generation.opportunityId = :opportunityId", { opportunityId });
        }
        if (taskId) {
            query.andWhere("generation.taskId = :taskId", { taskId });
        }
    }

    private httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }
}
