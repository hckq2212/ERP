import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Projects } from "./Project.entity";
import { Users } from "../../user/entities/User.entity";
import { ProjectProductDescriptionItems } from "./ProjectProductDescriptionItem.entity";

export enum ProjectProductDescriptionStatus {
    DRAFT = "DRAFT",
    PENDING_REVIEW = "PENDING_REVIEW",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED"
}

@Entity()
export class ProjectProductDescriptionSubmissions extends BaseEntity {
    @ManyToOne(() => Projects, { onDelete: "CASCADE" })
    @JoinColumn({ name: "projectId" })
    project: Projects;

    @Column({ type: "varchar", length: 26 })
    projectId: string;

    @Column({
        type: "enum",
        enum: ProjectProductDescriptionStatus,
        default: ProjectProductDescriptionStatus.DRAFT
    })
    status: ProjectProductDescriptionStatus;

    @Column({ type: "int", nullable: true })
    versionNumber: number;

    @ManyToOne(() => Users)
    @JoinColumn({ name: "createdById" })
    createdBy: Users;

    @Column({ type: "varchar", length: 26 })
    createdById: string;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "reviewedById" })
    reviewedBy: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    reviewedById: string;

    @Column({ type: "timestamp", nullable: true })
    reviewedAt: Date;

    @Column({ type: "text", nullable: true })
    reviewNote: string;

    @OneToMany(() => ProjectProductDescriptionItems, (item) => item.submission)
    items: ProjectProductDescriptionItems[];
}
