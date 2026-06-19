import { Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Companies } from "./Company.entity";

export abstract class TenantEntity extends BaseEntity {
    @Index()
    @ManyToOne(() => Companies, { nullable: true, onDelete: "RESTRICT" })
    @JoinColumn({ name: "companyId" })
    company: Companies;
}
