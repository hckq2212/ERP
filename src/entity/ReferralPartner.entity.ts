import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { PartnerType } from "./Venture.entity";
import { Customers } from "./Customer.entity";
import { Opportunities } from "./Opportunity.entity";

@Entity()
export class ReferralPartners extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

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
}
