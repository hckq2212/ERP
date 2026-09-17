import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { ProjectProductDescriptionSubmissions } from "./ProjectProductDescriptionSubmission.entity";

export type ProjectProductDescriptionSpec = {
    key: string;
    value: string;
};

@Entity()
export class ProjectProductDescriptionItems extends BaseEntity {
    @ManyToOne(() => ProjectProductDescriptionSubmissions, (submission) => submission.items, { onDelete: "CASCADE" })
    @JoinColumn({ name: "submissionId" })
    submission: ProjectProductDescriptionSubmissions;

    submissionId: string;

    @Column()
    productName: string;

    @Column({ type: "simple-json" })
    specs: ProjectProductDescriptionSpec[];

    @Column({ type: "text", nullable: true })
    note: string | null;

    @Column({ type: "varchar", nullable: true })
    docUrl: string | null;
}
