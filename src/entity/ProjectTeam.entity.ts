import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Users } from "./User.entity";
import { TeamMembers } from "./TeamMember.entity";
import { Projects } from "./Project.entity";

@Entity()
export class ProjectTeams extends BaseEntity {

    @Column()
    name: string;

    @ManyToOne(() => Users, (user) => user.ledTeams)
    teamLead: Users;

    @OneToMany(() => TeamMembers, (teamMember) => teamMember.team)
    members: TeamMembers[];

    @OneToMany(() => Projects, (project) => project.team)
    projects: Projects[];
}
