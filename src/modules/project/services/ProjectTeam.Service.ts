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

        if (actor.role !== UserRole.PM || team.teamLead?.id !== actorUserId) {
            throw this.httpError("Bạn không có quyền quản lý team này", 403);
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
            if (!actor || ![UserRole.ADMIN, UserRole.BOD].includes(actor.role as UserRole)) {
                throw this.httpError("Bạn không có quyền đổi lead của team", 403);
            }
            const newLead = await this.userRepository.findOneBy({ id: data.teamLeadId });
            if (!newLead) throw new Error("Không tìm thấy người dùng làm team lead mới");
            team.teamLead = newLead;
        }

        return await this.teamRepository.save(team);
    }

    async changeLead(teamId: string, newLeadId: string, actor?: ActorInfo) {
        if (!actor || ![UserRole.ADMIN, UserRole.BOD].includes(actor.role as UserRole)) {
            throw this.httpError("Bạn không có quyền đổi lead của team", 403);
        }
        const team = await this.teamRepository.findOne({
            where: SecurityService.withTenant({ id: teamId }),
            relations: ["teamLead"]
        });
        if (!team) throw new Error("Không tìm thấy team");

        const newLead = await this.userRepository.findOneBy({ id: newLeadId });
        if (!newLead) throw new Error("Không tìm thấy người dùng làm team lead mới");

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
        } as any);

        return await this.memberRepository.save(member);
    }

    async updateMember(memberId: string, data: { role?: MemberRole }, actor?: ActorInfo) {
        const member = await this.memberRepository.findOne({
            where: SecurityService.withTenant({ id: memberId }),
            relations: ["team"]
        });
        if (!member) throw new Error("Không tìm thấy thành viên");
        await this.assertCanManageTeam(member.team.id, actor);

        if (data.role) member.role = data.role;

        return await this.memberRepository.save(member);
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

        return await this.memberRepository.remove(member);
    }
}
