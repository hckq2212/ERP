import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Services } from "./Service.entity";
import { Contracts } from "./Contract.entity";
import { OpportunityServices } from "./OpportunityService.entity";
import { Tasks } from "./Task.entity";

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
}
