import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Services } from "./Service.entity";
import { Contracts } from "./Contract.entity";
import { OpportunityServices } from "./OpportunityService.entity";
import { Tasks } from "./Task.entity";
import { ContractAddendums } from "./ContractAddendum.entity";

export enum ContractServiceStatus {
    ACTIVE = "ACTIVE",
    CANCELLED = "CANCELLED"
}

@Entity()
export class ContractServices extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Services, (service) => service.contractServices)
    service: Services;

    @ManyToOne(() => Contracts, (contract) => contract.services)
    contract: Contracts;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number;

    @ManyToOne(() => OpportunityServices, (oppService) => oppService.contractServices, { nullable: true })
    opportunityService: OpportunityServices;

    @OneToMany(() => Tasks, (task) => task.contractService)
    tasks: Tasks[];

    @ManyToOne(() => ContractAddendums, (addendum) => addendum.services, { nullable: true })
    addendum: ContractAddendums;

    @Column({
        type: "enum",
        enum: ContractServiceStatus,
        default: ContractServiceStatus.ACTIVE
    })
    status: ContractServiceStatus;

    @Column({ type: "json", nullable: true })
    result: { type: string, name: string, url: string, size?: number, publicId?: string };
}
