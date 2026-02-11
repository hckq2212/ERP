import { CreateDateColumn, UpdateDateColumn, PrimaryColumn, BeforeInsert } from "typeorm";
import { ulid } from "ulid";

export abstract class BaseEntity {
    @PrimaryColumn("varchar", { length: 26 })
    id: string;

    @CreateDateColumn({ type: "timestamp", default: () => "CURRENT_TIMESTAMP(6)" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp", default: () => "CURRENT_TIMESTAMP(6)", onUpdate: "CURRENT_TIMESTAMP(6)" })
    updatedAt: Date;

    @BeforeInsert()
    generateId() {
        if (!this.id) {
            this.id = ulid();
        }
    }
}
