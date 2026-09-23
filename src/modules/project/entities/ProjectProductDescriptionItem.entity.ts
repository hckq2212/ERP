import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { ProjectProductDescriptionSubmissions } from "./ProjectProductDescriptionSubmission.entity";

@Entity()
export class ProjectProductDescriptionItems extends BaseEntity {
    @ManyToOne(() => ProjectProductDescriptionSubmissions, (submission) => submission.items, { onDelete: "CASCADE" })
    @JoinColumn({ name: "submissionId" })
    submission: ProjectProductDescriptionSubmissions;

    submissionId: string;

    @Column()
    productName: string;

    @Column({ type: "varchar", nullable: true })
    fileUrl: string;

    @Column({ type: "varchar", nullable: true })
    fileName: string;

    @Column({ type: "text", nullable: true })
    extractedText: string;

    @Column({ type: "text", nullable: true })
    note: string;

    @Column({ type: "jsonb", nullable: true })
    documents: { url: string; name: string | null }[];
}
