import { Column, Entity, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Contracts } from "../../contract/entities/Contract.entity";
import { Users } from "../../user/entities/User.entity";

@Entity()
export class VatInvoices extends BaseEntity {
    @Column()
    name: string;

    @Column()
    fileUrl: string;

    @ManyToOne(() => Contracts, (contract) => contract.vatInvoices, { onDelete: "CASCADE" })
    contract: Contracts;

    @ManyToOne(() => Users, { nullable: true })
    createdBy: Users;
}
