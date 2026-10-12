import { EntityManager } from "typeorm";
import { Services } from "../../service/entities/Service.entity";
import { OpportunityServices } from "../../opportunity-service/entities/OpportunityService.entity";
import { QuotationDetails } from "../entities/QuotationDetail.entity";
import { SecurityService } from "../../../shared/services/Security.Service";
import { resolveServiceBudget } from "../../../shared/helpers/ServiceBudget.helper";

export async function prepareQuotationDetails(
    manager: EntityManager,
    items: any[],
    opportunityId: string,
    previousDetails: QuotationDetails[] = []
) {
    const seenIds = new Set<string>();
    const prepared = [];
    for (const item of items) {
        const previous = item.id ? previousDetails.find(detail => detail.id === item.id) : undefined;
        if (item.id && (!previous || seenIds.has(item.id))) {
            throw new Error("Dòng báo giá cũ không hợp lệ hoặc bị trùng");
        }
        if (item.id) seenIds.add(item.id);
        const service = await manager.getRepository(Services).findOne({
            where: SecurityService.withTenant({ id: item.serviceId || "__missing__" }),
            lock: { mode: "pessimistic_read" }
        });
        if (!service) throw new Error(`Không tìm thấy dịch vụ với ID: ${item.serviceId}`);
        if (previous && ((previous.serviceId || previous.service?.id) !== service.id ||
            (previous.opportunityServiceId || undefined) !== (item.opportunityServiceId || undefined) ||
            Boolean(previous.isPackageService) !== Boolean(item.isPackageService) ||
            (previous.packageKey || undefined) !== (item.packageKey || undefined))) {
            throw new Error("Liên kết dòng báo giá cũ không hợp lệ");
        }
        // Lock only the source row: relation filters can generate nullable joins that
        // PostgreSQL does not allow in an unrestricted FOR UPDATE query.
        const sourceRepository = manager.getRepository(OpportunityServices);
        const ownedSource = item.opportunityServiceId ? await sourceRepository.findOne({
            where: SecurityService.withTenant({
                id: item.opportunityServiceId, opportunity: { id: opportunityId }, serviceId: service.id
            })
        }) : null;
        const opportunityService = ownedSource ? await sourceRepository.findOne({
            where: SecurityService.withTenant({ id: ownedSource.id, serviceId: service.id }),
            lock: { mode: "pessimistic_write" }
        }) : null;
        if (item.opportunityServiceId && !opportunityService) {
            throw new Error("Dịch vụ không thuộc cơ hội của báo giá");
        }
        const budget = resolveServiceBudget(service, item.budget, previous?.budget ?? opportunityService?.budget ?? 0);
        // A historical quotation may differ from its opportunity; preserve both when locked.
        const syncBudget = service.isBudget === true || budget === Number(opportunityService?.budget || 0);
        prepared.push({ item, service, opportunityService, budget, syncBudget });
    }
    return prepared;
}
