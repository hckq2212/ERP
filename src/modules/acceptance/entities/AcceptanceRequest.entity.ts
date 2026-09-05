import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Users } from "../../user/entities/User.entity";
import { ContractServices } from "../../contract/entities/ContractService.entity";
import { Projects } from "../../project/entities/Project.entity";

export enum AcceptanceStatus {
    PENDING = "PENDING",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED",
    PROCESSED = 'PROCESSED'
}

@Entity()
export class AcceptanceRequests extends BaseEntity {

    @Column()
    name: string; // e.g., "Đợt nghiệm thu tháng 02/2026"

    @ManyToOne(() => Users)
    requester: Users;

    @ManyToOne(() => Projects)
    project: Projects;

    @Column({ type: "varchar", length: 26 })
    projectId: string;

    @ManyToOne(() => Users, { nullable: true })
    approver: Users;

    @Column({
        type: "enum",
        enum: AcceptanceStatus,
        default: AcceptanceStatus.PENDING
    })
    status: AcceptanceStatus;

    @Column({ type: "text", nullable: true })
    note: string;

    @Column({ type: "text", nullable: true })
    feedback: string;

    @OneToMany(() => ContractServices, (service) => service.acceptanceRequest)
    services: ContractServices[];
}
