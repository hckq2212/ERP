import { Entity, Column, PrimaryColumn, OneToMany, CreateDateColumn, UpdateDateColumn, BeforeInsert } from "typeorm";
import { ulid } from "ulid";
import { AiModels } from "../../ai-model/entities/AiModel.entity";

@Entity({ name: "ai_providers" })
export class AiProviders {
    @PrimaryColumn("varchar", { length: 26 })
    id!: string;

    @Column({ length: 100 })
    code!: string;

    @Column({ length: 255 })
    name!: string;

    @Column({ type: "text", nullable: true })
    description!: string;

    @Column({ name: "is_active", type: "boolean", default: true })
    isActive!: boolean;

    @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
    createdAt!: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "now()" })
    updatedAt!: Date;

    @OneToMany(() => AiModels, (model) => model.provider)
    models!: AiModels[];

    @BeforeInsert()
    generateId() {
        if (!this.id) {
            this.id = ulid();
        }
    }
}