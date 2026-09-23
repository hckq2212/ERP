import { AppDataSource } from "../../../data-source";
import { TeamMembers } from "../entities/TeamMember.entity";
import { TeamMemberRoles } from "../entities/TeamMemberRole.entity";

/**
 * Consolidates legacy rows `(team, user, role)` into one membership per
 * `(team, user)` with child role rows. It is idempotent and can safely run
 * during deployments while the legacy column still exists.
 */
export const migrateTeamMemberRoles = async () => {
    await AppDataSource.transaction(async manager => {
        const memberRepository = manager.getRepository(TeamMembers);
        const roleRepository = manager.getRepository(TeamMemberRoles);
        const members = await memberRepository.createQueryBuilder("member")
            .addSelect("member.legacyRole")
            .leftJoinAndSelect("member.team", "team")
            .leftJoinAndSelect("member.user", "user")
            .leftJoinAndSelect("member.roles", "roles")
            .orderBy("member.createdAt", "ASC")
            .getMany();

        const groups = new Map<string, TeamMembers[]>();
        for (const member of members) {
            if (!member.team?.id || !member.user?.id) continue;
            const key = `${member.team.id}:${member.user.id}`;
            groups.set(key, [...(groups.get(key) || []), member]);
        }

        for (const group of groups.values()) {
            const [canonical, ...duplicates] = group;
            const roles = new Set(group.flatMap(member => [
                ...(member.roles || []).map(item => item.role),
                ...(member.legacyRole ? [member.legacyRole] : [])
            ]));

            const existingRoles = new Set((canonical.roles || []).map(item => item.role));
            const missingRoles = [...roles]
                .filter(role => !existingRoles.has(role))
                .map(role => roleRepository.create({ member: canonical, role }));
            if (missingRoles.length) await roleRepository.save(missingRoles);

            if (duplicates.length) await memberRepository.remove(duplicates);
            await memberRepository.createQueryBuilder()
                .update(TeamMembers)
                .set({ legacyRole: null })
                .where("id = :id", { id: canonical.id })
                .execute();
        }
    });

    // Added after consolidation so existing duplicate legacy rows cannot make
    // application startup fail before they are migrated.
    await AppDataSource.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_team_members_team_user" ON "team_members" ("teamId", "userId")'
    );
};
