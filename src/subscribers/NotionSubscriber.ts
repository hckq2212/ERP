import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { contractEmitter, CONTRACT_EVENTS } from "../events/ContractEmitter";
import { customerEmitter, CUSTOMER_EVENTS } from "../events/CustomerEmitter";
import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../events/OpportunityEmitter";
import { quotationEmitter, QUOTATION_EVENTS } from "../events/QuotationEmitter";
import { userEmitter, USER_EVENTS } from "../events/UserEmitter";
import { ProjectNotionService } from "../services/notion_services/ProjectNotion.Service";
import { TaskNotionService } from "../services/notion_services/TaskNotion.Service";
import { ContractNotionService } from "../services/notion_services/ContractNotion.Service";
import { CustomerNotionService } from "../services/notion_services/CustomerNotion.Service";
import { OpportunityNotionService } from "../services/notion_services/OpportunityNotion.Service";
import { QuotationNotionService } from "../services/notion_services/QuotationNotion.Service";
import { UserNotionService } from "../services/notion_services/UserNotion.Service";

/**
 * NotionSubscriber - Listens for ERP changes and syncs them to Notion in real-time.
 */
export const initNotionSubscriber = () => {
    const projectService = new ProjectNotionService();
    const taskService = new TaskNotionService();
    const contractService = new ContractNotionService();
    const customerService = new CustomerNotionService();
    const opportunityService = new OpportunityNotionService();
    const quotationService = new QuotationNotionService();
    const userService = new UserNotionService();

    const safe = <T>(label: string, fn: (data: T) => Promise<void>) => {
        return async (data: T) => {
            try {
                await fn(data);
            } catch (err) {
                console.error(`[NotionSubscriber] Failed to sync ${label}:`, err);
            }
        };
    };

    // --- PROJECT EVENTS ---
    projectEmitter.on(PROJECT_EVENTS.CREATED, safe("Project.CREATED", async (data) => projectService.sync(data)));

    projectEmitter.on(PROJECT_EVENTS.UPDATED, safe("Project.UPDATED", async (data) => projectService.sync(data)));

    // --- TASK EVENTS ---
    taskEmitter.on(TASK_EVENTS.CREATED, safe("Task.CREATED", async (data) => taskService.sync(data)));

    taskEmitter.on(TASK_EVENTS.UPDATED, safe("Task.UPDATED", async (data) => taskService.sync(data)));

    taskEmitter.on(TASK_EVENTS.STATUS_CHANGED, safe("Task.STATUS_CHANGED", async (data) => taskService.sync(data)));

    // --- CONTRACT EVENTS ---
    contractEmitter.on(CONTRACT_EVENTS.CREATED, safe("Contract.CREATED", async (data) => contractService.sync(data)));

    contractEmitter.on(CONTRACT_EVENTS.UPDATED, safe("Contract.UPDATED", async (data) => contractService.sync(data)));

    contractEmitter.on(CONTRACT_EVENTS.SIGNED, safe("Contract.SIGNED", async (data) => contractService.sync(data)));

    // --- CUSTOMER EVENTS ---
    customerEmitter.on(CUSTOMER_EVENTS.CREATED, safe("Customer.CREATED", async (data) => customerService.sync(data)));

    customerEmitter.on(CUSTOMER_EVENTS.UPDATED, safe("Customer.UPDATED", async (data) => customerService.sync(data)));

    // --- OPPORTUNITY EVENTS ---
    opportunityEmitter.on(OPPORTUNITY_EVENTS.CREATED, safe("Opportunity.CREATED", async (data) => opportunityService.sync(data)));

    opportunityEmitter.on(OPPORTUNITY_EVENTS.UPDATED, safe("Opportunity.UPDATED", async (data) => opportunityService.sync(data)));

    opportunityEmitter.on(OPPORTUNITY_EVENTS.APPROVED, safe("Opportunity.APPROVED", async (data) => opportunityService.sync(data)));

    // --- QUOTATION EVENTS ---
    quotationEmitter.on(QUOTATION_EVENTS.CREATED, safe("Quotation.CREATED", async (data) => quotationService.sync(data)));

    quotationEmitter.on(QUOTATION_EVENTS.UPDATED, safe("Quotation.UPDATED", async (data) => quotationService.sync(data)));

    quotationEmitter.on(QUOTATION_EVENTS.APPROVED, safe("Quotation.APPROVED", async (data) => quotationService.sync(data)));

    // --- USER EVENTS ---
    userEmitter.on(USER_EVENTS.CREATED, safe("User.CREATED", async (data) => userService.sync(data)));

    userEmitter.on(USER_EVENTS.UPDATED, safe("User.UPDATED", async (data) => userService.sync(data)));

    userEmitter.on(USER_EVENTS.DELETED, safe("User.DELETED", async (data) => {
        // Notion doesn't have a "delete" in this one-way sync usually, but we could archive or do nothing.
        // For now, we sync to reflect status changes if any.
        await userService.sync(data);
    }));

};
