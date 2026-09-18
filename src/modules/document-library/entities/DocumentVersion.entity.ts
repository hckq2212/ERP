import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Accounts } from "../../account/entities/Account.entity";
import { Documents } from "./Document.entity";

@Entity()
export class DocumentVersions extends BaseEntity {
    @Column()
    documentId: string;

    @ManyToOne(() => Documents, (document) => document.versions, { onDelete: "CASCADE" })
    @JoinColumn({ name: "documentId" })
    document: Documents;

    @Column()
    versionNumber: number;

    @Column()
    fileUrl: string;

    @Column()
    publicId: string;

    @Column()
    originalFileName: string;

    @Column({ nullable: true })
    fileExtension: string;

    @Column({ nullable: true })
    mimeType: string;

    @Column({ type: "bigint", nullable: true })
    fileSizeBytes: number;

    @Column({ default: "raw" })
    resourceType: string;

    @Column()
    uploadedById: string;

    @ManyToOne(() => Accounts)
    @JoinColumn({ name: "uploadedById" })
    uploadedBy: Accounts;
}
