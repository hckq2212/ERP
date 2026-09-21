import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "system_settings" })
export class SystemSettings {
    @PrimaryColumn({ type: "varchar", length: 100 })
    key!: string;

    @Column({ type: "jsonb" })
    value!: Record<string, any>;

    @Column({ name: "updated_by_id", type: "varchar", length: 26, nullable: true })
    updatedById!: string | null;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "now()" })
    updatedAt!: Date;
}
