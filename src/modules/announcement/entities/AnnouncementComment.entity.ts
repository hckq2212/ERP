import { Entity, Column, ManyToOne, Relation } from "typeorm"
import { BaseEntity } from "../../../shared/entities/BaseEntity"
import { Users } from "../../user/entities/User.entity"
import { Announcements } from "./Announcement.entity"

@Entity()
export class AnnouncementComments extends BaseEntity {

    @ManyToOne(() => Announcements, { onDelete: "CASCADE" })
    announcement: Relation<Announcements>

    @ManyToOne(() => Users)
    author: Relation<Users>

    @Column({ type: "text" })
    content: string
}
