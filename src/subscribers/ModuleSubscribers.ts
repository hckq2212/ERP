import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../events/OpportunityEmitter";
import { quotationEmitter, QUOTATION_EVENTS } from "../events/QuotationEmitter";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { contractEmitter, CONTRACT_EVENTS } from "../events/ContractEmitter";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { taskReviewEmitter, TASK_REVIEW_EVENTS } from "../events/TaskReviewEmitter";
import { notificationEmitter, NOTIFICATION_EVENTS } from "../events/NotificationEmitter";
import { TenantContext } from "../context/TenantContext";

const resolveCompanyId = (payload: any) => {
    return TenantContext.getCompany()?.id || payload?.company?.id || payload?.companyId;
};

const emitModuleEvent = (event: string, payload: any) => {
    const companyId = resolveCompanyId(payload);
    if (!companyId) {
        console.warn(`[SSE] Skipped module event without companyId: ${event}`);
        return;
    }
    notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { companyId, event, payload });
};

/**
 * ModuleSubscribers - Centralized place to handle cross-module side effects.
 * This decouples core business logic from notifications, logging, and other secondary actions.
 */
export const initModuleSubscribers = () => {
    // --- OPPORTUNITY EVENTS ---
    opportunityEmitter.on(OPPORTUNITY_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Opportunity Created: ${data.opportunityCode}`);
        emitModuleEvent(OPPORTUNITY_EVENTS.CREATED, data);
    });
    opportunityEmitter.on(OPPORTUNITY_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Opportunity Updated: ${data.opportunityCode}`);
        emitModuleEvent(OPPORTUNITY_EVENTS.UPDATED, data);
    });
    opportunityEmitter.on(OPPORTUNITY_EVENTS.APPROVED, (data) => {
        // console.log(`[EVENT] Opportunity Approved: ${data.opportunityCode}`);
        emitModuleEvent(OPPORTUNITY_EVENTS.APPROVED, data);
    });
    opportunityEmitter.on(OPPORTUNITY_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Opportunity Deleted: ${data.id}`);
        emitModuleEvent(OPPORTUNITY_EVENTS.DELETED, data);
    });

    // --- QUOTATION EVENTS ---
    quotationEmitter.on(QUOTATION_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Quotation Created: Ver ${data.version} for Opportunity ${data.opportunity?.opportunityCode}`);
        emitModuleEvent(QUOTATION_EVENTS.CREATED, data);
    });
    quotationEmitter.on(QUOTATION_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Quotation Updated: Ver ${data.version}`);
        emitModuleEvent(QUOTATION_EVENTS.UPDATED, data);
    });
    quotationEmitter.on(QUOTATION_EVENTS.APPROVED, (data) => {
        // console.log(`[EVENT] Quotation Approved: Ver ${data.version}`);
        emitModuleEvent(QUOTATION_EVENTS.APPROVED, data);
    });
    quotationEmitter.on(QUOTATION_EVENTS.REJECTED, (data) => {
        // console.log(`[EVENT] Quotation Rejected: Ver ${data.version}`);
        emitModuleEvent(QUOTATION_EVENTS.REJECTED, data);
    });
    quotationEmitter.on(QUOTATION_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Quotation Deleted: ${data.id}`);
        emitModuleEvent(QUOTATION_EVENTS.DELETED, data);
    });

    // --- TASK EVENTS ---
    taskEmitter.on(TASK_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Task Created: ${data.code}`);
        emitModuleEvent(TASK_EVENTS.CREATED, data);
    });
    taskEmitter.on(TASK_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Task Updated: ${data.code}`);
        emitModuleEvent(TASK_EVENTS.UPDATED, data);
    });
    taskEmitter.on(TASK_EVENTS.STATUS_CHANGED, (data) => {
        // console.log(`[EVENT] Task Status Changed: ${data.code} -> ${data.status}`);
        emitModuleEvent(TASK_EVENTS.STATUS_CHANGED, data);
    });
    taskEmitter.on(TASK_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Task Deleted: ${data.id}`);
        emitModuleEvent(TASK_EVENTS.DELETED, data);
    });

    // --- CONTRACT EVENTS ---
    contractEmitter.on(CONTRACT_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Contract Created: ${data.contractCode}`);
        emitModuleEvent(CONTRACT_EVENTS.CREATED, data);
    });
    contractEmitter.on(CONTRACT_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Contract Updated: ${data.contractCode}`);
        emitModuleEvent(CONTRACT_EVENTS.UPDATED, data);
    });
    contractEmitter.on(CONTRACT_EVENTS.SIGNED, (data) => {
        // console.log(`[EVENT] Contract Signed: ${data.contractCode}`);
        emitModuleEvent(CONTRACT_EVENTS.SIGNED, data);
    });
    contractEmitter.on(CONTRACT_EVENTS.REJECTED, (data) => {
        // console.log(`[EVENT] Contract Rejected: ${data.contractCode}`);
        emitModuleEvent(CONTRACT_EVENTS.REJECTED, data);
    });
    contractEmitter.on(CONTRACT_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Contract Deleted: ${data.id}`);
        emitModuleEvent(CONTRACT_EVENTS.DELETED, data);
    });

    // --- PROJECT EVENTS ---
    projectEmitter.on(PROJECT_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Project Created: ${data.name}`);
        emitModuleEvent(PROJECT_EVENTS.CREATED, data);
    });
    projectEmitter.on(PROJECT_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Project Updated: ${data.name}`);
        emitModuleEvent(PROJECT_EVENTS.UPDATED, data);
    });
    projectEmitter.on(PROJECT_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Project Deleted: ${data.id}`);
        emitModuleEvent(PROJECT_EVENTS.DELETED, data);
    });

    // --- TASK REVIEW EVENTS ---
    taskReviewEmitter.on(TASK_REVIEW_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Task Review Updated for Task: ${data.taskId}`);
        emitModuleEvent(TASK_REVIEW_EVENTS.UPDATED, data);
    });

    // console.log("All Module Subscribers Initialized (Global SSE Broadcast Active)");
};
