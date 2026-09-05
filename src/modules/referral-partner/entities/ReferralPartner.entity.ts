import { Entity, Column, OneToMany } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";


import { Customers } from "../../customer/entities/Customer.entity";
import { Opportunities } from "../../opportunity/entities/Opportunity.entity";
import { Contracts } from "../../contract/entities/Contract.entity";

export enum PartnerType {
    BUSINESS = "BUSINESS",
    INDIVIDUAL = "INDIVIDUAL"
}

@Entity()
export class ReferralPartners extends BaseEntity {

    @Column()
    name: string;

    @Column({ nullable: true })
    taxId: string;

    @Column()
    phone: string;

    @Column()
    address: string;

    @Column()
    email: string;

    @Column({
        type: "enum",
        enum: PartnerType,
        default: PartnerType.BUSINESS
    })
    type: PartnerType;

    @OneToMany(() => Customers, (customer) => customer.referralPartner)
    customers: Customers[];

    @OneToMany(() => Opportunities, (opportunity) => opportunity.referralPartner)
    opportunities: Opportunities[];

    @OneToMany(() => Contracts, (contract) => contract.referralPartner)
    contracts: Contracts[];
}
