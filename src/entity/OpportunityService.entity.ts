import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Services } from "./Service.entity";
import { Opportunities } from "./Opportunity.entity";
import { ContractServices } from "./ContractService.entity";

@Entity()
export class OpportunityServices extends BaseEntity {

    @ManyToOne(() => Services, (service) => service.opportunityServices)
    service: Services;

    @ManyToOne(() => Opportunities, (opportunity) => opportunity.services)
    opportunity: Opportunities;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    costAtSale: number;

    @Column({ type: "int", default: 1 })
    quantity: number;

    @OneToMany(() => ContractServices, (contractService) => contractService.opportunityService)
    contractServices: ContractServices[];
}
