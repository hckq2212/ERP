import { Entity, Column } from "typeorm";
import { BaseEntity } from "./BaseEntity";

@Entity()
export class ChatRooms extends BaseEntity {
    @Column({ nullable: true })
    name: string;

    @Column({ default: false })
    isGroup: boolean;

    @Column({ type: "varchar", length: 26, nullable: true })
    creatorId: string;
}
