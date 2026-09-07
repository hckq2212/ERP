import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { ProjectProductDescriptionSubmissions } from "./ProjectProductDescriptionSubmission.entity";

export enum ProjectProductDescriptionSourceType {
    FILE = "FILE",
    LINK = "LINK"
}

@Entity()
export class ProjectProductDescriptionItems extends BaseEntity {
    @ManyToOne(() => ProjectProductDescriptionSubmissions, (submission) => submission.items, { onDelete: "CASCADE" })
    @JoinColumn({ name: "submissionId" })
    submission: ProjectProductDescriptionSubmissions;

    @Column({ type: "varchar", length: 26 })
    submissionId: string;

    @Column()
    productName: string;

    @Column({
        type: "enum",
        enum: ProjectProductDescriptionSourceType
    })
    sourceType: ProjectProductDescriptionSourceType;

    @Column()
    sourceName: string;

    @Column()
    sourceUrl: string;

    @Column({ type: "int", nullable: true })
    size: number;

    @Column({ nullable: true })
    publicId: string;
}
