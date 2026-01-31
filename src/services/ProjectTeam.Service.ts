import { AppDataSource } from "../data-source";
import { ProjectTeams } from "../entity/ProjectTeam.entity";
import { TeamMembers, MemberRole } from "../entity/TeamMember.entity";
import { Users } from "../entity/User.entity";

export class ProjectTeamService {
    private teamRepository = AppDataSource.getRepository(ProjectTeams);
    private memberRepository = AppDataSource.getRepository(TeamMembers);
    private userRepository = AppDataSource.getRepository(Users);

    async getAll() {
        return await this.teamRepository.find({
            relations: ["teamLead", "members", "members.user"]
        });
    }

    async getOne(id: number) {
        const team = await this.teamRepository.findOne({
            where: { id },
            relations: ["teamLead", "members", "members.user"]
        });
        if (!team) throw new Error("Không tìm thấy team");
        return team;
    }

    async getMembers(teamId: number) {
        const team = await this.teamRepository.findOne({
            where: { id: teamId },
            relations: ["members", "members.user"]
        });
        if (!team) throw new Error("Không tìm thấy team");
        return team.members;
    }


    async create(data: { name: string, teamLeadId: number }) {
        const teamLead = await this.userRepository.findOneBy({ id: data.teamLeadId });
        if (!teamLead) throw new Error("Không tìm thấy team lead");

        const team = this.teamRepository.create({
            name: data.name,
            teamLead: teamLead
        });

        return await this.teamRepository.save(team);
    }

    async update(id: number, data: { name?: string, teamLeadId?: number }) {
        const team = await this.getOne(id);

        if (data.name) team.name = data.name;
        if (data.teamLeadId) {
            await this.changeLead(id, data.teamLeadId);
        }

        return await this.teamRepository.save(team);
    }

    async changeLead(teamId: number, newLeadId: number) {
        const team = await this.teamRepository.findOne({
            where: { id: teamId },
            relations: ["teamLead"]
        });
        if (!team) throw new Error("Không tìm thấy team");

        const newLead = await this.userRepository.findOneBy({ id: newLeadId });
        if (!newLead) throw new Error("Không tìm thấy người dùng làm team lead mới");

        team.teamLead = newLead;
        return await this.teamRepository.save(team);
    }

    async delete(id: number) {
        const team = await this.getOne(id);
        // Important: Should we delete members first? TypeORM might handle it if cascade is set, 
        // but let's be safe.
        await this.memberRepository.delete({ team: { id: id } });
        return await this.teamRepository.remove(team);
    }

    async addMember(teamId: number, userId: number, role?: MemberRole) {
        const team = await this.getOne(teamId);
        const user = await this.userRepository.findOneBy({ id: userId });
        if (!user) throw new Error("Không tìm thấy người dùng");

        // Check if already a member
        const existing = await this.memberRepository.findOne({
            where: { team: { id: teamId }, user: { id: userId } }
        });
        if (existing) throw new Error("Người dùng đã là thành viên của team này");

        const member = this.memberRepository.create({
            team,
            user,
            role: role || MemberRole.CONTENT_CREATOR
        });

        return await this.memberRepository.save(member);
    }

    async updateMember(memberId: number, data: { role?: MemberRole }) {
        const member = await this.memberRepository.findOneBy({ id: memberId });
        if (!member) throw new Error("Không tìm thấy thành viên");

        if (data.role) member.role = data.role;

        return await this.memberRepository.save(member);
    }

    async removeMember(memberId: number) {
        const member = await this.memberRepository.findOne({
            where: { id: memberId },
            relations: ["team", "team.teamLead", "user"]
        });
        if (!member) throw new Error("Không tìm thấy thành viên");

        if (member.team && member.team.teamLead && member.user.id === member.team.teamLead.id) {
            throw new Error("Không thể xóa thành viên đang là Team Lead. Vui lòng chỉ định Lead mới trước khi xóa.");
        }

        return await this.memberRepository.remove(member);
    }
}
