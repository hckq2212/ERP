import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { Users } from "./User.entity";
import { TeamMembers } from "./TeamMember.entity";
import { Projects } from "./Project.entity";

@Entity()
export class ProjectTeams extends TenantEntity {

    @Column()
    name: string;

    @ManyToOne(() => Users, (user) => user.ledTeams)
    teamLead: Users;

    @OneToMany(() => TeamMembers, (teamMember) => teamMember.team)
    members: TeamMembers[];

    @OneToMany(() => Projects, (project) => project.team)
    projects: Projects[];
}
