import { AppDataSource } from "../../../data-source";
import { SecurityService } from "../../../shared/services/Security.Service";
import { UserRole } from "../../account/entities/Account.entity";
import { Users } from "../../user/entities/User.entity";
import { Projects } from "../entities/Project.entity";
import { MemberRole } from "../entities/TeamMember.entity";
import {
    ProjectProductDescriptionStatus,
    ProjectProductDescriptionSubmissions
} from "../entities/ProjectProductDescriptionSubmission.entity";
import {
    ProjectProductDescriptionItems,
    ProjectProductDescriptionSourceType
} from "../entities/ProjectProductDescriptionItem.entity";

type Actor = { id: string; userId?: string; role: string; username?: string };

type ProductDescriptionItemInput = {
    productName?: string;
    sourceType?: ProjectProductDescriptionSourceType | "FILE" | "LINK";
    sourceName?: string;
    sourceUrl?: string;
    size?: number;
    publicId?: string;
};

type ProductDescriptionPayload = {
    items?: ProductDescriptionItemInput[];
    reviewNote?: string;
};

export class ProjectProductDescriptionService {
    private projectRepository = AppDataSource.getRepository(Projects);
    private userRepository = AppDataSource.getRepository(Users);
    private submissionRepository = AppDataSource.getRepository(ProjectProductDescriptionSubmissions);
    private itemRepository = AppDataSource.getRepository(ProjectProductDescriptionItems);

    private httpError(message: string, statusCode: number) {
        const error = new Error(message) as Error & { statusCode?: number };
        error.statusCode = statusCode;
        return error;
    }

    private getActorUserId(actor?: Actor) {
        if (!actor?.userId) {
            throw this.httpError("Bạn cần đăng nhập để thực hiện hành động này", 401);
        }
        return actor.userId;
    }

    private async assertProjectAccess(projectId: string, actor?: Actor) {
        if (!actor) throw this.httpError("Bạn cần đăng nhập để thực hiện hành động này", 401);

        let where: any = { id: projectId };
        let rbacWhere: any = {};
        try {
            rbacWhere = SecurityService.getProjectFilters(actor);
        } catch (error: any) {
            if (error.message === "FORBIDDEN_ACCESS") {
                throw this.httpError("Bạn không có quyền truy cập dự án này", 403);
            }
            throw error;
        }
        where = Array.isArray(rbacWhere)
            ? rbacWhere.map((condition) => ({ id: projectId, ...condition }))
            : { id: projectId, ...rbacWhere };

        const project = await this.projectRepository.findOne({
            where,
            relations: ["team", "team.teamLead", "team.members", "team.members.user"]
        });

        if (!project) throw this.httpError("Không tìm thấy dự án hoặc bạn không có quyền truy cập", 404);
        return project;
    }

    private assertAssignedPm(project: Projects, actor?: Actor) {
        if (actor?.role !== UserRole.PM || !actor.userId) {
            throw this.httpError("Chỉ PM phụ trách dự án được duyệt thông tin chuẩn sản phẩm", 403);
        }

        const isAssignedPm = project.team?.members?.some((member) =>
            member.role === MemberRole.PROJECT_MANAGER &&
            member.user?.id === actor.userId
        );

        if (!isAssignedPm) {
            throw this.httpError("Chỉ PM phụ trách dự án được duyệt thông tin chuẩn sản phẩm", 403);
        }
    }

    private assertCanEditProductDescription(project: Projects, actor?: Actor) {
        const actorUserId = this.getActorUserId(actor);
        const isBd = actor?.role === UserRole.BD;
        const isProjectLead = project.team?.teamLead?.id === actorUserId;
        const isAssignedPm = actor?.role === UserRole.PM && project.team?.members?.some((member) =>
            member.role === MemberRole.PROJECT_MANAGER &&
            member.user?.id === actorUserId
        );

        if (!isBd && !isProjectLead && !isAssignedPm) {
            throw this.httpError("Chỉ BD, PM phụ trách hoặc team lead của dự án được nhập thông tin chuẩn sản phẩm", 403);
        }
    }

    private validateItems(rawItems?: ProductDescriptionItemInput[]) {
        if (!Array.isArray(rawItems) || rawItems.length === 0) {
            throw this.httpError("Vui lòng thêm ít nhất một sản phẩm", 400);
        }

        return rawItems.map((item, index) => {
            const productName = item.productName?.trim();
            const sourceType = item.sourceType;
            const sourceUrl = item.sourceUrl?.trim();
            const sourceName = item.sourceName?.trim() || sourceUrl;

            if (!productName) {
                throw this.httpError(`Vui lòng nhập tên sản phẩm ở dòng ${index + 1}`, 400);
            }
            if (sourceType !== ProjectProductDescriptionSourceType.FILE && sourceType !== ProjectProductDescriptionSourceType.LINK) {
                throw this.httpError(`Vui lòng chọn file hoặc link cho sản phẩm ${productName}`, 400);
            }
            if (!sourceUrl) {
                throw this.httpError(`Vui lòng cung cấp file hoặc link cho sản phẩm ${productName}`, 400);
            }
            if (!sourceName) {
                throw this.httpError(`Vui lòng cung cấp tên tài liệu cho sản phẩm ${productName}`, 400);
            }

            return {
                productName,
                sourceType: sourceType as ProjectProductDescriptionSourceType,
                sourceName,
                sourceUrl,
                size: item.size,
                publicId: item.publicId
            };
        });
    }

    private async findSubmissionForProject(projectId: string, submissionId: string) {
        const submission = await this.submissionRepository.findOne({
            where: { id: submissionId, projectId },
            relations: ["project", "project.team", "project.team.members", "project.team.members.user", "createdBy", "reviewedBy", "items"]
        });

        if (!submission) throw this.httpError("Không tìm thấy bản thông tin chuẩn sản phẩm", 404);
        return submission;
    }

    private assertEditableSubmission(submission: ProjectProductDescriptionSubmissions, actor: Actor) {
        const actorUserId = this.getActorUserId(actor);
        if (submission.createdById !== actorUserId) {
            throw this.httpError("Bạn chỉ được chỉnh sửa bản thông tin do mình tạo", 403);
        }
        if (![ProjectProductDescriptionStatus.DRAFT, ProjectProductDescriptionStatus.REJECTED].includes(submission.status)) {
            throw this.httpError("Chỉ có thể chỉnh sửa bản nháp hoặc bản không được duyệt", 400);
        }
    }

    async getByProject(projectId: string, actor?: Actor) {
        await this.assertProjectAccess(projectId, actor);

        return this.submissionRepository.find({
            where: { projectId },
            relations: ["createdBy", "reviewedBy", "items"],
            order: {
                versionNumber: "DESC",
                createdAt: "DESC"
            }
        });
    }

    async create(projectId: string, payload: ProductDescriptionPayload, actor?: Actor) {
        const actorUserId = this.getActorUserId(actor);
        const project = await this.assertProjectAccess(projectId, actor);
        this.assertCanEditProductDescription(project, actor);
        const createdBy = await this.userRepository.findOneBy({ id: actorUserId });
        if (!createdBy) throw this.httpError("Không tìm thấy người tạo", 404);

        const items = this.validateItems(payload.items);
        const submission = this.submissionRepository.create({
            project,
            projectId: project.id,
            status: ProjectProductDescriptionStatus.DRAFT,
            versionNumber: null as any,
            createdBy,
            createdById: createdBy.id,
            reviewedBy: null as any,
            reviewedById: null as any,
            reviewedAt: null as any,
            reviewNote: null as any
        });

        const saved = await this.submissionRepository.save(submission);
        const itemEntities = items.map((item) => this.itemRepository.create({
            ...item,
            submission: saved,
            submissionId: saved.id
        }));
        await this.itemRepository.save(itemEntities);

        return this.findSubmissionForProject(projectId, saved.id);
    }

    async update(projectId: string, submissionId: string, payload: ProductDescriptionPayload, actor?: Actor) {
        const project = await this.assertProjectAccess(projectId, actor);
        this.assertCanEditProductDescription(project, actor);
        const submission = await this.findSubmissionForProject(projectId, submissionId);
        this.assertEditableSubmission(submission, actor as Actor);

        const items = this.validateItems(payload.items);
        await this.itemRepository.delete({ submissionId: submission.id });
        const itemEntities = items.map((item) => this.itemRepository.create({
            ...item,
            submission,
            submissionId: submission.id
        }));
        await this.itemRepository.save(itemEntities);

        submission.status = ProjectProductDescriptionStatus.DRAFT;
        submission.reviewedBy = null as any;
        submission.reviewedById = null as any;
        submission.reviewedAt = null as any;
        submission.reviewNote = null as any;
        await this.submissionRepository.save(submission);

        return this.findSubmissionForProject(projectId, submission.id);
    }

    async submit(projectId: string, submissionId: string, actor?: Actor) {
        const project = await this.assertProjectAccess(projectId, actor);
        this.assertCanEditProductDescription(project, actor);
        const submission = await this.findSubmissionForProject(projectId, submissionId);
        this.assertEditableSubmission(submission, actor as Actor);

        if (!submission.items?.length) {
            throw this.httpError("Vui lòng thêm ít nhất một sản phẩm trước khi gửi duyệt", 400);
        }

        submission.status = ProjectProductDescriptionStatus.PENDING_REVIEW;
        submission.reviewedBy = null as any;
        submission.reviewedById = null as any;
        submission.reviewedAt = null as any;
        submission.reviewNote = null as any;
        await this.submissionRepository.save(submission);

        return this.findSubmissionForProject(projectId, submission.id);
    }

    async approve(projectId: string, submissionId: string, actor?: Actor) {
        const project = await this.assertProjectAccess(projectId, actor);
        this.assertAssignedPm(project, actor);
        const actorUserId = this.getActorUserId(actor);
        const reviewer = await this.userRepository.findOneBy({ id: actorUserId });
        if (!reviewer) throw this.httpError("Không tìm thấy người duyệt", 404);

        const submission = await this.findSubmissionForProject(projectId, submissionId);
        if (submission.status !== ProjectProductDescriptionStatus.PENDING_REVIEW) {
            throw this.httpError("Chỉ có thể duyệt bản đang chờ review", 400);
        }

        const maxResult = await this.submissionRepository
            .createQueryBuilder("submission")
            .select("MAX(submission.versionNumber)", "max")
            .where("submission.projectId = :projectId", { projectId })
            .andWhere("submission.status = :status", { status: ProjectProductDescriptionStatus.APPROVED })
            .getRawOne<{ max: string | number | null }>();

        submission.status = ProjectProductDescriptionStatus.APPROVED;
        submission.versionNumber = Number(maxResult?.max || 0) + 1;
        submission.reviewedBy = reviewer;
        submission.reviewedById = reviewer.id;
        submission.reviewedAt = new Date();
        submission.reviewNote = null as any;
        await this.submissionRepository.save(submission);

        return this.findSubmissionForProject(projectId, submission.id);
    }

    async reject(projectId: string, submissionId: string, payload: ProductDescriptionPayload, actor?: Actor) {
        const project = await this.assertProjectAccess(projectId, actor);
        this.assertAssignedPm(project, actor);
        const actorUserId = this.getActorUserId(actor);
        const reviewer = await this.userRepository.findOneBy({ id: actorUserId });
        if (!reviewer) throw this.httpError("Không tìm thấy người duyệt", 404);

        const submission = await this.findSubmissionForProject(projectId, submissionId);
        if (submission.status !== ProjectProductDescriptionStatus.PENDING_REVIEW) {
            throw this.httpError("Chỉ có thể không duyệt bản đang chờ review", 400);
        }

        submission.status = ProjectProductDescriptionStatus.REJECTED;
        submission.versionNumber = null as any;
        submission.reviewedBy = reviewer;
        submission.reviewedById = reviewer.id;
        submission.reviewedAt = new Date();
        submission.reviewNote = payload.reviewNote?.trim() || null as any;
        await this.submissionRepository.save(submission);

        return this.findSubmissionForProject(projectId, submission.id);
    }
}
