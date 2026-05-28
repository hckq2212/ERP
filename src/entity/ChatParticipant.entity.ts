import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { ChatRooms } from "./ChatRoom.entity";
import { Users } from "./User.entity";

@Entity()
export class ChatParticipants extends BaseEntity {
    @Column({ type: "varchar", length: 26 })
    roomId: string;

    @ManyToOne(() => ChatRooms, { onDelete: "CASCADE" })
    @JoinColumn({ name: "roomId" })
    room: ChatRooms;

    @Column({ type: "varchar", length: 26 })
    userId: string;

    @ManyToOne(() => Users, { onDelete: "CASCADE" })
    @JoinColumn({ name: "userId" })
    user: Users;
}
