import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Contracts } from "./Contract.entity";
import { ContractServices } from "./ContractService.entity";
import { PaymentMilestones } from "./PaymentMilestone.entity";

export enum AddendumStatus {
    DRAFT = "DRAFT",
    SIGNED = "SIGNED",
    CANCELLED = "CANCELLED"
}

@Entity()
export class ContractAddendums extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string; // e.g., "Phụ lục 01: Bổ sung hạng mục quay phim"

    @ManyToOne(() => Contracts, (contract) => contract.addendums)
    contract: Contracts;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number; // Có thể âm nếu là phụ lục cắt giảm

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    cost: number;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ nullable: true })
    signed_contract: string; // URL file phụ lục đã ký

    @Column({
        type: "enum",
        enum: AddendumStatus,
        default: AddendumStatus.DRAFT
    })
    status: AddendumStatus;

    @OneToMany(() => ContractServices, (service) => service.addendum)
    services: ContractServices[];

    @OneToMany(() => PaymentMilestones, (milestone) => milestone.addendum)
    milestones: PaymentMilestones[];
}
