import { Entity, PrimaryGeneratedColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { ProjectTeams } from "./ProjectTeam.entity";
import { Users } from "./User.entity";

@Entity()
export class TeamMembers extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ProjectTeams, (team) => team.members)
    team: ProjectTeams;

    @ManyToOne(() => Users, (user) => user.teamMemberships)
    user: Users;
}
