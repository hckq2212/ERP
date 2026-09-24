import { UserRole } from "../../account/entities/Account.entity";
import { Projects } from "../entities/Project.entity";
import { MemberRole, memberHasRole } from "../entities/TeamMember.entity";

type ConfirmationProject = Pick<Projects, "team">;

/**
 * ADMIN hoặc bất kỳ Lead dự án (ACCOUNT) nào trong team đều có thể nhận dự án.
 * `teamLead` được giữ để tương thích dữ liệu cũ chưa có TeamMemberRole ACCOUNT.
 */
export const canConfirmProject = (
    project: ConfirmationProject,
    actorUserId: string,
    actorRole: string
) => actorRole === UserRole.ADMIN
    || project.team?.teamLead?.id === actorUserId
    || Boolean(project.team?.members?.some(member =>
        member.user?.id === actorUserId && memberHasRole(member, MemberRole.ACCOUNT)
    ));
