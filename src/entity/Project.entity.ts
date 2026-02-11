import { Entity, Column, OneToOne, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Contracts } from "./Contract.entity";
import { ProjectTeams } from "./ProjectTeam.entity";
import { Tasks } from "./Task.entity";

export enum ProjectStatus {
    PENDING_CONFIRMATION = "PENDING_CONFIRMATION", // Chờ xác nhận
    CONFIRMED = "CONFIRMED", // Team Lead đã nhận
    IN_PROGRESS = "IN_PROGRESS", // Đang thực hiện (sau khi upload hợp đồng đã ký)
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED"
}

@Entity()
export class Projects extends BaseEntity {

    @Column()
    name: string;

    @OneToOne(() => Contracts, (contract) => contract.project)
    @JoinColumn()
    contract: Contracts;

    @ManyToOne(() => ProjectTeams, (team) => team.projects)
    team: ProjectTeams;

    @Column({
        type: "enum",
        enum: ProjectStatus,
        default: ProjectStatus.PENDING_CONFIRMATION
    })
    status: ProjectStatus;

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
