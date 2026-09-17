import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Projects } from "../../project/entities/Project.entity";
import { Users } from "../../user/entities/User.entity";

@Entity()
@Index(["projectId", "word"], { unique: true })
export class ProjectSpellCheckWhitelists extends BaseEntity {
    @ManyToOne(() => Projects, { onDelete: "CASCADE" })
    @JoinColumn({ name: "projectId" })
    project: Projects;

    @Column({ type: "varchar", length: 26 })
    projectId: string;

    @Column()
    word: string;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "addedById" })
    addedBy: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    addedById: string | null;
}
