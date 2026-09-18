import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Accounts } from "../../account/entities/Account.entity";
import { DocumentVersions } from "./DocumentVersion.entity";

@Entity()
export class Documents extends BaseEntity {
    @Column()
    displayName: string;

    @Column({ nullable: true })
    description: string;

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

    @Column({ default: 1 })
    currentVersion: number;

    @Column("simple-array", { nullable: true })
    tags: string[];

    @Column({ default: 0 })
    downloadCount: number;

    @Column()
    uploadedById: string;

    @ManyToOne(() => Accounts)
    @JoinColumn({ name: "uploadedById" })
    uploadedBy: Accounts;

    @OneToMany(() => DocumentVersions, (version) => version.document)
    versions: DocumentVersions[];
}
