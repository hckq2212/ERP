import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { ReferralPartners } from "./ReferralPartner.entity";
import { Contracts } from "./Contract.entity";
import { Opportunities } from "./Opportunity.entity";

export enum CustomerSource {
    INTERNAL = "INTERNAL",
    REFERRAL_PARTNER = "REFERRAL_PARTNER"
}

@Entity()
export class Customers extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column()
    phone: string;

    @Column()
    email: string;

    @Column()
    address: string;

    @Column({ nullable: true })
    taxId: string;

    @Column({
        type: "enum",
        enum: CustomerSource,
        default: CustomerSource.INTERNAL
    })
    source: CustomerSource;

    @ManyToOne(() => ReferralPartners, (referralPartner) => referralPartner.customers)
    referralPartner: ReferralPartners;

    @OneToMany(() => Contracts, (contract) => contract.customer)
    contracts: Contracts[];

    @OneToMany(() => Opportunities, (opportunity) => opportunity.customer)
    opportunities: Opportunities[];
}
