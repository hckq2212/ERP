import { EntityManager, FindOptionsWhere, Not, Raw } from "typeorm";
import { Accounts } from "../entities/Account.entity";

export function identifierMatches(identifier: string) {
    return Raw<string>(column => `LOWER(${column}) = LOWER(:identifier)`, { identifier });
}

export async function assertAccountIdentifiersAvailable(
    manager: EntityManager,
    { id, username, email }: { id?: string; username?: string; email?: string | null }
) {
    const where: FindOptionsWhere<Accounts>[] = [];
    for (const identifier of [username, email]) {
        if (typeof identifier !== "string") continue;
        const otherAccount = id === undefined ? {} : { id: Not(id) };
        where.push({ ...otherAccount, username: identifierMatches(identifier) });
        where.push({ ...otherAccount, email: identifierMatches(identifier) });
    }
    if (!where.length) return;

    // Serialize identifier changes so concurrent writes cannot each pass the availability check.
    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["accounts:login-identifiers"]);
    if (await manager.getRepository(Accounts).exists({ where })) {
        throw new Error("Tên đăng nhập hoặc email đã tồn tại");
    }
}
