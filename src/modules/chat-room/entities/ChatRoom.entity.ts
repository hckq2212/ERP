import { Column, Entity } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";

@Entity()
export class ChatRooms extends BaseEntity {
    @Column({ nullable: true })
    name: string;

    @Column({ default: false })
    isGroup: boolean;

    @Column({ type: "varchar", length: 26, nullable: true })
    creatorId: string | null;
}
