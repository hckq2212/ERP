import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../events/OpportunityEmitter";
import { quotationEmitter, QUOTATION_EVENTS } from "../events/QuotationEmitter";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { contractEmitter, CONTRACT_EVENTS } from "../events/ContractEmitter";
import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { taskReviewEmitter, TASK_REVIEW_EVENTS } from "../events/TaskReviewEmitter";
import { notificationEmitter, NOTIFICATION_EVENTS } from "../events/NotificationEmitter";

/**
 * ModuleSubscribers - Centralized place to handle cross-module side effects.
 * This decouples core business logic from notifications, logging, and other secondary actions.
 */
export const initModuleSubscribers = () => {
    // --- OPPORTUNITY EVENTS ---
    opportunityEmitter.on(OPPORTUNITY_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Opportunity Created: ${data.opportunityCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: OPPORTUNITY_EVENTS.CREATED, payload: data });
    });
    opportunityEmitter.on(OPPORTUNITY_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Opportunity Updated: ${data.opportunityCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: OPPORTUNITY_EVENTS.UPDATED, payload: data });
    });
    opportunityEmitter.on(OPPORTUNITY_EVENTS.APPROVED, (data) => {
        // console.log(`[EVENT] Opportunity Approved: ${data.opportunityCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: OPPORTUNITY_EVENTS.APPROVED, payload: data });
    });
    opportunityEmitter.on(OPPORTUNITY_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Opportunity Deleted: ${data.id}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: OPPORTUNITY_EVENTS.DELETED, payload: data });
    });

    // --- QUOTATION EVENTS ---
    quotationEmitter.on(QUOTATION_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Quotation Created: Ver ${data.version} for Opportunity ${data.opportunity?.opportunityCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: QUOTATION_EVENTS.CREATED, payload: data });
    });
    quotationEmitter.on(QUOTATION_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Quotation Updated: Ver ${data.version}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: QUOTATION_EVENTS.UPDATED, payload: data });
    });
    quotationEmitter.on(QUOTATION_EVENTS.APPROVED, (data) => {
        // console.log(`[EVENT] Quotation Approved: Ver ${data.version}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: QUOTATION_EVENTS.APPROVED, payload: data });
    });
    quotationEmitter.on(QUOTATION_EVENTS.REJECTED, (data) => {
        // console.log(`[EVENT] Quotation Rejected: Ver ${data.version}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: QUOTATION_EVENTS.REJECTED, payload: data });
    });
    quotationEmitter.on(QUOTATION_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Quotation Deleted: ${data.id}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: QUOTATION_EVENTS.DELETED, payload: data });
    });

    // --- TASK EVENTS ---
    taskEmitter.on(TASK_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Task Created: ${data.code}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: TASK_EVENTS.CREATED, payload: data });
    });
    taskEmitter.on(TASK_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Task Updated: ${data.code}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: TASK_EVENTS.UPDATED, payload: data });
    });
    taskEmitter.on(TASK_EVENTS.STATUS_CHANGED, (data) => {
        // console.log(`[EVENT] Task Status Changed: ${data.code} -> ${data.status}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: TASK_EVENTS.STATUS_CHANGED, payload: data });
    });
    taskEmitter.on(TASK_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Task Deleted: ${data.id}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: TASK_EVENTS.DELETED, payload: data });
    });

    // --- CONTRACT EVENTS ---
    contractEmitter.on(CONTRACT_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Contract Created: ${data.contractCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: CONTRACT_EVENTS.CREATED, payload: data });
    });
    contractEmitter.on(CONTRACT_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Contract Updated: ${data.contractCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: CONTRACT_EVENTS.UPDATED, payload: data });
    });
    contractEmitter.on(CONTRACT_EVENTS.SIGNED, (data) => {
        // console.log(`[EVENT] Contract Signed: ${data.contractCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: CONTRACT_EVENTS.SIGNED, payload: data });
    });
    contractEmitter.on(CONTRACT_EVENTS.REJECTED, (data) => {
        // console.log(`[EVENT] Contract Rejected: ${data.contractCode}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: CONTRACT_EVENTS.REJECTED, payload: data });
    });
    contractEmitter.on(CONTRACT_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Contract Deleted: ${data.id}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: CONTRACT_EVENTS.DELETED, payload: data });
    });

    // --- PROJECT EVENTS ---
    projectEmitter.on(PROJECT_EVENTS.CREATED, (data) => {
        // console.log(`[EVENT] Project Created: ${data.name}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: PROJECT_EVENTS.CREATED, payload: data });
    });
    projectEmitter.on(PROJECT_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Project Updated: ${data.name}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: PROJECT_EVENTS.UPDATED, payload: data });
    });
    projectEmitter.on(PROJECT_EVENTS.DELETED, (data) => {
        // console.log(`[EVENT] Project Deleted: ${data.id}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: PROJECT_EVENTS.DELETED, payload: data });
    });

    // --- TASK REVIEW EVENTS ---
    taskReviewEmitter.on(TASK_REVIEW_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Task Review Updated for Task: ${data.taskId}`);
        notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event: TASK_REVIEW_EVENTS.UPDATED, payload: data });
    });

    // console.log("All Module Subscribers Initialized (Global SSE Broadcast Active)");
};
