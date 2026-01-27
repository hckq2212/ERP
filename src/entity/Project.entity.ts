import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Contracts } from "./Contract.entity";
import { ProjectTeams } from "./ProjectTeam.entity";
import { Tasks } from "./Task.entity";

@Entity()
export class Projects extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @OneToOne(() => Contracts, (contract) => contract.project)
    @JoinColumn()
    contract: Contracts;

    @ManyToOne(() => ProjectTeams, (team) => team.projects)
    team: ProjectTeams;

    @Column()
    status: string;

    @Column({ type: "date", nullable: true })
    plannedStartDate: Date;

    @Column({ type: "date", nullable: true })
    plannedEndDate: Date;

    @Column({ type: "date", nullable: true })
    actualStartDate: Date;

    @Column({ type: "date", nullable: true })
    actualEndDate: Date;

    @OneToMany(() => Tasks, (task) => task.project)
    tasks: Tasks[];
}
