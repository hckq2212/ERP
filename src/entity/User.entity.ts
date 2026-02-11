import { Entity, Column, OneToOne, JoinColumn, OneToMany } from "typeorm"
import { BaseEntity } from "./BaseEntity"
import { Accounts } from "./Account.entity"
import { TeamMembers } from "./TeamMember.entity"
import { ProjectTeams } from "./ProjectTeam.entity"
import { Tasks } from "./Task.entity"
import { Opportunities } from "./Opportunity.entity"

@Entity()
export class Users extends BaseEntity {

    @Column()
    fullName: string

    @Column()
    phoneNumber: string

    @OneToOne(() => Accounts, (account) => account.user)
    @JoinColumn()
    account: Accounts

    @OneToMany(() => TeamMembers, (teamMember) => teamMember.user)
    teamMemberships: TeamMembers[]

    @OneToMany(() => ProjectTeams, (projectTeam) => projectTeam.teamLead)
    ledTeams: ProjectTeams[]

    @OneToMany(() => Tasks, (task) => task.assignee)
    tasks: Tasks[]

    @OneToMany(() => Opportunities, (opportunity) => opportunity.createdBy)
    opportunities: Opportunities[]
}
