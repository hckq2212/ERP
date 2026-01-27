import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Customers } from "./Customer.entity";
import { Quotations } from "./Quotation.entity";
import { OpportunityServices } from "./OpportunityService.entity";
import { Contracts } from "./Contract.entity";

export enum Region {
    NATIONAL = "TOÀN QUỐC",
    NORTH = "BẮC",
    CENTRAL = "TRUNG",
    SOUTH = "NAM"
}

@Entity()
export class Opportunities extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    opportunityCode: string;

    @Column()
    name: string;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column()
    field: string;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    expectedRevenue: number;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    budget: number;

    @Column({ type: "date", nullable: true })
    startDate: Date;

    @Column({ type: "date", nullable: true })
    endDate: Date;

    @Column()
    priority: string;

    @Column({ type: "int", default: 0 })
    successChance: number;

    @Column({
        type: "enum",
        enum: Region,
        default: Region.NATIONAL
    })
    region: Region;

    @Column({ type: "int", default: 0 })
    durationMonths: number;

    @Column()
    status: string;

    @ManyToOne(() => Customers, (customer) => customer.opportunities)
    customer: Customers;

    @OneToMany(() => Quotations, (quotation) => quotation.opportunity)
    quotations: Quotations[];

    @OneToMany(() => OpportunityServices, (oppService) => oppService.opportunity)
    services: OpportunityServices[];

    @OneToMany(() => Contracts, (contract) => contract.opportunity)
    contracts: Contracts[];
}
