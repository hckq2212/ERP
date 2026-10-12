import { AppDataSource } from "../../../data-source";
import { Services } from "../../service/entities/Service.entity";
import { OpportunityServices } from "../../opportunity-service/entities/OpportunityService.entity";
import { QuotationDetails } from "../entities/QuotationDetail.entity";
import { resolveServiceBudget } from "../../../shared/helpers/ServiceBudget.helper";

export async function validateQuotationBudgets(
    items: any[], opportunityId: string, previousDetails: QuotationDetails[] = []
): Promise<void> {
    const seenIds = new Set<string>();
    for (const item of items) {
        const previous = item.id ? previousDetails.find(detail => detail.id === item.id) : undefined;
        if (item.id && (!previous || seenIds.has(item.id) ||
            (previous.serviceId || previous.service?.id) !== item.serviceId)) {
            throw new Error("Dòng báo giá cũ không hợp lệ hoặc bị trùng");
        }
        if (item.id) seenIds.add(item.id);
        const service = item.serviceId
            ? await AppDataSource.getRepository(Services).findOneBy({ id: item.serviceId }) : null;
        const source = item.opportunityServiceId
            ? await AppDataSource.getRepository(OpportunityServices).findOne({
                where: { id: item.opportunityServiceId, opportunity: { id: opportunityId }, serviceId: item.serviceId }
            }) : null;
        if (item.opportunityServiceId && !source) throw new Error("Dịch vụ không thuộc cơ hội của báo giá");
        item.budget = resolveServiceBudget(service, item.budget, previous?.budget ?? source?.budget ?? 0);
    }
}
