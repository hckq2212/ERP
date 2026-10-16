import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Users } from "../../user/entities/User.entity";
import { ChatRooms } from "./ChatRoom.entity";

@Entity()
@Index(["roomId", "createdAt"])
@Index(["roomId", "id"])
export class ChatMessages extends BaseEntity {
    @Index()
    @Column({ type: "varchar", length: 26 })
    roomId: string;

    @ManyToOne(() => ChatRooms, { onDelete: "CASCADE" })
    @JoinColumn({ name: "roomId" })
    room: ChatRooms;

    @Index()
    @Column({ type: "varchar", length: 26 })
    senderId: string;

    @ManyToOne(() => Users, { onDelete: "CASCADE" })
    @JoinColumn({ name: "senderId" })
    sender: Users;

    @Column({ type: "text" })
    content: string;

    @Column({ type: "json", nullable: true })
    attachments: { type: string; name: string; url: string; size?: number; publicId?: string }[] | null;

    @Column({ type: "json", nullable: true })
    reactions: {
        userId: string;
        emoji: string;
        user?: {
            id: string;
            fullName: string;
            avatarUrl?: string | null;
        };
        createdAt?: string;
    }[] | null;

    @Column({ type: "boolean", default: false })
    isPinned: boolean;

    @Column({ type: "timestamp", nullable: true })
    pinnedAt: Date | null;

    @Column({ type: "varchar", length: 26, nullable: true })
    pinnedById: string | null;

    @Column({ type: "boolean", default: false })
    isRecalled: boolean;

    @Column({ type: "timestamp", nullable: true })
    recalledAt: Date | null;

    @Column({ type: "boolean", default: false })
    isEdited: boolean;

    @Column({ type: "timestamp", nullable: true })
    editedAt: Date | null;

    @Index()
    @Column({ type: "varchar", length: 26, nullable: true })
    replyToId: string | null;

    @ManyToOne(() => ChatMessages, { onDelete: "SET NULL", nullable: true })
    @JoinColumn({ name: "replyToId" })
    replyTo: ChatMessages | null;

    @Column({ type: "boolean", default: false })
    isForwarded: boolean;

    @Column({ type: "varchar", length: 26, nullable: true })
    forwardedFromUserId: string | null;
}
