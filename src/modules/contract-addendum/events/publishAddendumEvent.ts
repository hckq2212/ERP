import { RedisService } from "../../../shared/services/Redis.Service";
import { contractAddendumEmitter } from "./ContractAddendumEmitter";

/** Invalidate server caches before clients refetch in response to SSE. Call only after commit. */
export async function publishAddendumEvent(event: string, addendum: any): Promise<void> {
    const contractId = addendum.contract?.id || addendum.contractId;
    const projectId = addendum.project?.id || addendum.projectId;
    const patterns = ["contracts:*all*", "projects:*all*"];
    if (contractId) patterns.push(`contracts:*:detail:${contractId}*`);
    if (projectId) patterns.push(`projects:*:detail:${projectId}*`);
    if (event === "contract_addendum_approved") patterns.push("tasks:workload:*", "dashboard:*");
    const results = await Promise.all(patterns.map(pattern => RedisService.deleteCache(pattern)));
    if (results.some(result => !result.complete)) {
        console.warn("[Addendum] Cache invalidation incomplete", { id: addendum.id, contractId, projectId });
    }
    contractAddendumEmitter.emit(event, { id: addendum.id, contractId, projectId });
}
