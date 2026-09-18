import { Entity, Column, ManyToOne, Relation } from "typeorm"
import { BaseEntity } from "../../../shared/entities/BaseEntity"
import { Users } from "../../user/entities/User.entity"
import { Announcements } from "./Announcement.entity"

@Entity()
export class AnnouncementRecipients extends BaseEntity {

    @ManyToOne(() => Announcements, { onDelete: "CASCADE" })
    announcement: Relation<Announcements>

    @ManyToOne(() => Users)
    recipient: Relation<Users>

    @Column({ default: false })
    isRead: boolean

    @Column({ type: "timestamp", nullable: true })
    readAt: Date

    @Column({ type: "timestamp", nullable: true })
    lastViewedAt: Date
}
