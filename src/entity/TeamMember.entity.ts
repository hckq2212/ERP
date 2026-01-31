import { Entity, PrimaryGeneratedColumn, ManyToOne, Column } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { ProjectTeams } from "./ProjectTeam.entity";
import { Users } from "./User.entity";

export enum MemberRole {
    CONTENT_CREATOR = "CONTENT_CREATOR",
    EDITOR = "EDITOR",
    GRAPHIC_DESIGNER = "GRAPHIC_DESIGNER",
    CAMERAMAN = "CAMERAMAN",
    PROJECT_MANAGER = "PROJECT_MANAGER",
    ACCOUNT_MANAGER = "ACCOUNT_MANAGER",
    SCRIPTER = "SCRIPTER",
    SOCIAL_MEDIA_MANAGER = "SOCIAL_MEDIA_MANAGER",
    SEO_SPECIALIST = "SEO_SPECIALIST"
}

@Entity()
export class TeamMembers extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ProjectTeams, (team) => team.members)
    team: ProjectTeams;

    @ManyToOne(() => Users, (user) => user.teamMemberships)
    user: Users;

    @Column({
        type: "enum",
        enum: MemberRole,
        default: MemberRole.CONTENT_CREATOR
    })
    role: MemberRole;
}
