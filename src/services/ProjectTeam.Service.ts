import { AppDataSource } from "../data-source";
import { ProjectTeams } from "../entity/ProjectTeam.entity";
import { TeamMembers } from "../entity/TeamMember.entity";
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
            const teamLead = await this.userRepository.findOneBy({ id: data.teamLeadId });
            if (!teamLead) throw new Error("Không tìm thấy team lead");
            team.teamLead = teamLead;
        }

        return await this.teamRepository.save(team);
    }

    async delete(id: number) {
        const team = await this.getOne(id);
        // Important: Should we delete members first? TypeORM might handle it if cascade is set, 
        // but let's be safe.
        await this.memberRepository.delete({ team: { id: id } });
        return await this.teamRepository.remove(team);
    }

    async addMember(teamId: number, userId: number) {
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
            user
        });

        return await this.memberRepository.save(member);
    }

    async removeMember(memberId: number) {
        const member = await this.memberRepository.findOneBy({ id: memberId });
        if (!member) throw new Error("Không tìm thấy thành viên");
        return await this.memberRepository.remove(member);
    }
}
