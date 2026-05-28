import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { ChatRooms } from "./ChatRoom.entity";
import { Users } from "./User.entity";

@Entity()
export class ChatMessages extends BaseEntity {
    @Column({ type: "varchar", length: 26 })
    roomId: string;

    @ManyToOne(() => ChatRooms, { onDelete: "CASCADE" })
    @JoinColumn({ name: "roomId" })
    room: ChatRooms;

    @Column({ type: "varchar", length: 26 })
    senderId: string;

    @ManyToOne(() => Users, { onDelete: "CASCADE" })
    @JoinColumn({ name: "senderId" })
    sender: Users;

    @Column({ type: "text" })
    content: string;

    @Column({ type: "json", nullable: true })
    attachments: { type: string; name: string; url: string; size?: number; publicId?: string }[];
}
