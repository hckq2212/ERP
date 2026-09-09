import { AppDataSource } from "../../../data-source";
import { ProjectTeams } from "../entities/ProjectTeam.entity";
import { TeamMembers, MemberRole } from "../entities/TeamMember.entity";
import { Users } from "../../user/entities/User.entity";
import { SecurityService } from "../../../shared/services/Security.Service";
import { UserRole } from "../../account/entities/Account.entity";

type ActorInfo = { id: string; userId?: string; role: string };

export class ProjectTeamService {
    private teamRepository = AppDataSource.getRepository(ProjectTeams);
    private memberRepository = AppDataSource.getRepository(TeamMembers);
    private userRepository = AppDataSource.getRepository(Users);

    private httpError(message: string, statusCode: number) {
        const error: any = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    private async assertCanManageTeam(teamId: string, actor?: ActorInfo) {
        if (!actor) throw this.httpError("Bạn cần đăng nhập để quản lý team", 401);
        if ([UserRole.ADMIN, UserRole.BOD].includes(actor.role as UserRole)) return;

        const actorUserId = actor.userId || actor.id;
        const team = await this.teamRepository.findOne({
            where: SecurityService.withTenant({ id: teamId }),
            relations: ["teamLead"]
        });
        if (!team) throw this.httpError("Không tìm thấy team", 404);

        if (team.teamLead?.id === actorUserId) return;

        const projectManagerMember = await this.memberRepository.findOne({
            where: SecurityService.withTenant({
                team: { id: teamId },
                user: { id: actorUserId },
                role: MemberRole.PROJECT_MANAGER
            })
        });
        if (actor.role !== UserRole.PM || !projectManagerMember) {
            throw this.httpError("Bạn không có quyền quản lý team này", 403);
        }
    }

    private async syncAccountRoleAsLead(member: TeamMembers) {
        const team = await this.teamRepository.findOne({
            where: SecurityService.withTenant({ id: member.team.id }),
            relations: ["teamLead", "members", "members.user"]
        });
        if (!team) throw this.httpError("Không tìm thấy team", 404);

        if (member.role === MemberRole.ACCOUNT) {
            const previousAccountMembers = (team.members || []).filter(item =>
                item.id !== member.id && item.role === MemberRole.ACCOUNT
            );
            for (const previousMember of previousAccountMembers) {
                previousMember.role = MemberRole.CONTENT_CREATOR;
            }
            if (previousAccountMembers.length > 0) {
                await this.memberRepository.save(previousAccountMembers);
            }

            team.teamLead = member.user;
            await this.teamRepository.save(team);
            return;
        }

        if (team.teamLead?.id === member.user?.id) {
            team.teamLead = null as any;
            await this.teamRepository.save(team);
        }
    }

    async getAll() {
        return await this.teamRepository.find({
            where: SecurityService.getTenantWhere(),
            relations: ["teamLead", "teamLead.accounts", "members", "members.user", "members.user.accounts"]
        });
    }

    async getOne(id: string) {
        const team = await this.teamRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["teamLead", "teamLead.accounts", "members", "members.user", "members.user.accounts"]
        });
        if (!team) throw new Error("Không tìm thấy team");
        return team;
    }

    async getMembers(teamId: string) {
        const team = await this.teamRepository.findOne({
            where: SecurityService.withTenant({ id: teamId }),
            relations: ["members", "members.user", "members.user.accounts"]
        });
        if (!team) throw new Error("Không tìm thấy team");
        return team.members;
    }


    async create(data: { name: string, teamLeadId: string }, actor?: ActorInfo) {
        if (!actor || ![UserRole.ADMIN, UserRole.BOD].includes(actor.role as UserRole)) {
            throw this.httpError("Bạn không có quyền tạo team", 403);
        }
        const teamLead = await this.userRepository.findOneBy({ id: data.teamLeadId });
        if (!teamLead) throw new Error("Không tìm thấy team lead");

        const team = this.teamRepository.create({
            name: data.name,
            teamLead: teamLead,
            ...SecurityService.getTenantWhere()
        } as any);

        return await this.teamRepository.save(team);
    }

    async update(id: string, data: { name?: string, teamLeadId?: string }, actor?: ActorInfo) {
        await this.assertCanManageTeam(id, actor);
        const team = await this.getOne(id);

        if (data.name) team.name = data.name;
        if (data.teamLeadId) {
            const updatedTeam = await this.changeLead(id, data.teamLeadId, actor);
            team.teamLead = updatedTeam.teamLead;
        }

        return await this.teamRepository.save(team);
    }

    async changeLead(teamId: string, newLeadId: string, actor?: ActorInfo) {
        if (!actor || ![UserRole.ADMIN, UserRole.BOD].includes(actor.role as UserRole)) {
            throw this.httpError("Bạn không có quyền đổi lead trực tiếp", 403);
        }
        const team = await this.teamRepository.findOne({
            where: SecurityService.withTenant({ id: teamId }),
            relations: ["teamLead", "members", "members.user"]
        });
        if (!team) throw new Error("Không tìm thấy team");

        const newLead = await this.userRepository.findOneBy({ id: newLeadId });
        if (!newLead) throw new Error("Không tìm thấy người dùng làm team lead mới");

        const existingMember = team.members?.find(member => member.user?.id === newLeadId);
        if (!existingMember) {
            const member = this.memberRepository.create({
                team,
                user: newLead,
                role: MemberRole.CONTENT_CREATOR,
                ...SecurityService.getTenantWhere()
            } as Partial<TeamMembers>);
            await this.memberRepository.save(member);
        }

        team.teamLead = newLead;
        return await this.teamRepository.save(team);
    }

    async delete(id: string, actor?: ActorInfo) {
        if (!actor || ![UserRole.ADMIN, UserRole.BOD].includes(actor.role as UserRole)) {
            throw this.httpError("Bạn không có quyền xóa team", 403);
        }
        const team = await this.getOne(id);
        // Important: Should we delete members first? TypeORM might handle it if cascade is set, 
        // but let's be safe.
        await this.memberRepository.delete(SecurityService.withTenant({ team: { id: id } }));
        return await this.teamRepository.remove(team);
    }

    async addMember(teamId: string, userId: string, role?: MemberRole, actor?: ActorInfo) {
        await this.assertCanManageTeam(teamId, actor);
        if (role === MemberRole.PROJECT_MANAGER && actor?.role !== UserRole.ADMIN && actor?.role !== UserRole.BOD) {
            throw this.httpError("Chỉ ADMIN/BOD mới được thêm PM cho đội dự án", 403);
        }
        const team = await this.getOne(teamId);
        const user = await this.userRepository.findOneBy({ id: userId });
        if (!user) throw new Error("Không tìm thấy người dùng");

        // Check if already a member
        const existing = await this.memberRepository.findOne({
            where: SecurityService.withTenant({ team: { id: teamId }, user: { id: userId } })
        });
        if (existing) throw new Error("Người dùng đã là thành viên của team này");

        const member = this.memberRepository.create({
            team,
            user,
            role: role || MemberRole.CONTENT_CREATOR,
            ...SecurityService.getTenantWhere()
        } as Partial<TeamMembers>);

        const savedMember = await this.memberRepository.save(member);
        await this.syncAccountRoleAsLead(savedMember);
        return savedMember;
    }

    async updateMember(memberId: string, data: { role?: MemberRole }, actor?: ActorInfo) {
        const member = await this.memberRepository.findOne({
            where: SecurityService.withTenant({ id: memberId }),
            relations: ["team", "user"]
        });
        if (!member) throw new Error("Không tìm thấy thành viên");
        await this.assertCanManageTeam(member.team.id, actor);

        const touchesProjectManagerRole = member.role === MemberRole.PROJECT_MANAGER || data.role === MemberRole.PROJECT_MANAGER;
        if (touchesProjectManagerRole && actor?.role !== UserRole.ADMIN && actor?.role !== UserRole.BOD) {
            throw this.httpError("Chỉ ADMIN/BOD mới được thay đổi PM của đội dự án", 403);
        }

        if (data.role) member.role = data.role;

        const savedMember = await this.memberRepository.save(member);
        await this.syncAccountRoleAsLead(savedMember);
        return savedMember;
    }

    async removeMember(memberId: string, actor?: ActorInfo) {
        const member = await this.memberRepository.findOne({
            where: SecurityService.withTenant({ id: memberId }),
            relations: ["team", "team.teamLead", "user"]
        });
        if (!member) throw new Error("Không tìm thấy thành viên");
        await this.assertCanManageTeam(member.team.id, actor);

        if (member.team && member.team.teamLead && member.user.id === member.team.teamLead.id) {
            throw new Error("Không thể xóa thành viên đang là Team Lead. Vui lòng chỉ định Lead mới trước khi xóa.");
        }
        if (member.role === MemberRole.PROJECT_MANAGER && actor?.role !== UserRole.ADMIN && actor?.role !== UserRole.BOD) {
            throw this.httpError("Chỉ ADMIN/BOD mới được xóa PM khỏi đội dự án", 403);
        }

        return await this.memberRepository.remove(member);
    }
}
