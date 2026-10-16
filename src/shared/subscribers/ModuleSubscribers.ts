import { opportunityEmitter, OPPORTUNITY_EVENTS } from "../../modules/opportunity/events/OpportunityEmitter";
import { quotationEmitter, QUOTATION_EVENTS } from "../../modules/quotation/events/QuotationEmitter";
import { taskEmitter, TASK_EVENTS } from "../../modules/task/events/TaskEmitter";
import { contractEmitter, CONTRACT_EVENTS } from "../../modules/contract/events/ContractEmitter";
import { projectEmitter, PROJECT_EVENTS } from "../../modules/project/events/ProjectEmitter";
import { teamEmitter, TEAM_EVENTS } from "../../modules/project/events/TeamEmitter";
import { taskReviewEmitter, TASK_REVIEW_EVENTS } from "../../modules/task/events/TaskReviewEmitter";
import { taskResultCheckEmitter, TASK_RESULT_CHECK_EVENTS } from "../../modules/task/events/TaskResultCheckEmitter";
import { customerEmitter, CUSTOMER_EVENTS } from "../../modules/customer/events/CustomerEmitter";
import { userEmitter, USER_EVENTS } from "../../modules/user/events/UserEmitter";
import { acceptanceEmitter, ACCEPTANCE_EVENTS } from "../../modules/acceptance/events/AcceptanceEmitter";
import { contractAddendumEmitter, CONTRACT_ADDENDUM_EVENTS } from "../../modules/contract-addendum/events/ContractAddendumEmitter";
import { notificationEmitter, NOTIFICATION_EVENTS } from "../../modules/notification/events/NotificationEmitter";
import { RedisService } from "../services/Redis.Service";

const emitModuleEvent = (event: string, payload: any) => {
    notificationEmitter.emit(NOTIFICATION_EVENTS.MODULE_EVENT, { event, payload });
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
    opportunityEmitter.on(OPPORTUNITY_EVENTS.REJECTED, (data) => {
        emitModuleEvent(OPPORTUNITY_EVENTS.REJECTED, data);
    });
    opportunityEmitter.on(OPPORTUNITY_EVENTS.RESUBMITTED, (data) => {
        emitModuleEvent(OPPORTUNITY_EVENTS.RESUBMITTED, data);
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
        emitModuleEvent(TASK_EVENTS.CREATED, data);
        RedisService.deleteCache('dashboard:*').catch(() => {});
        RedisService.deleteCache('tasks:workload:*').catch(() => {});
        const pId = data?.projectId || data?.project?.id;
        if (pId) RedisService.deleteCache(`projects:*:detail:${pId}*`).catch(() => {});
    });
    taskEmitter.on(TASK_EVENTS.UPDATED, (data) => {
        emitModuleEvent(TASK_EVENTS.UPDATED, data);
        RedisService.deleteCache('dashboard:*').catch(() => {});
        RedisService.deleteCache('tasks:workload:*').catch(() => {});
        const pId = data?.projectId || data?.project?.id;
        if (pId) RedisService.deleteCache(`projects:*:detail:${pId}*`).catch(() => {});
    });
    taskEmitter.on(TASK_EVENTS.STATUS_CHANGED, (data) => {
        emitModuleEvent(TASK_EVENTS.STATUS_CHANGED, data);
        RedisService.deleteCache('dashboard:*').catch(() => {});
        RedisService.deleteCache('tasks:workload:*').catch(() => {});
        const pId = data?.projectId || data?.project?.id;
        if (pId) RedisService.deleteCache(`projects:*:detail:${pId}*`).catch(() => {});
    });
    taskEmitter.on(TASK_EVENTS.DELETED, (data) => {
        emitModuleEvent(TASK_EVENTS.DELETED, data);
        RedisService.deleteCache('dashboard:*').catch(() => {});
        RedisService.deleteCache('tasks:workload:*').catch(() => {});
        const pId = data?.projectId || data?.project?.id;
        if (pId) RedisService.deleteCache(`projects:*:detail:${pId}*`).catch(() => {});
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
        emitModuleEvent(PROJECT_EVENTS.CREATED, data);
        RedisService.deleteCache('projects:*all*').catch(() => {});
        RedisService.deleteCache('dashboard:*').catch(() => {});
    });
    projectEmitter.on(PROJECT_EVENTS.UPDATED, (data) => {
        emitModuleEvent(PROJECT_EVENTS.UPDATED, data);
        RedisService.deleteCache('projects:*all*').catch(() => {});
        if (data?.id) RedisService.deleteCache(`projects:*:detail:${data.id}*`).catch(() => {});
        RedisService.deleteCache('dashboard:*').catch(() => {});
    });
    projectEmitter.on(PROJECT_EVENTS.DELETED, (data) => {
        emitModuleEvent(PROJECT_EVENTS.DELETED, data);
        RedisService.deleteCache('projects:*all*').catch(() => {});
        if (data?.id) RedisService.deleteCache(`projects:*:detail:${data.id}*`).catch(() => {});
        RedisService.deleteCache('dashboard:*').catch(() => {});
    });

    // --- CUSTOMER EVENTS ---
    customerEmitter.on(CUSTOMER_EVENTS.CREATED, (data) => {
        emitModuleEvent(CUSTOMER_EVENTS.CREATED, data);
    });
    customerEmitter.on(CUSTOMER_EVENTS.UPDATED, (data) => {
        emitModuleEvent(CUSTOMER_EVENTS.UPDATED, data);
    });
    customerEmitter.on(CUSTOMER_EVENTS.DELETED, (data) => {
        emitModuleEvent(CUSTOMER_EVENTS.DELETED, data);
    });

    // --- USER EVENTS ---
    userEmitter.on(USER_EVENTS.CREATED, (data) => {
        emitModuleEvent(USER_EVENTS.CREATED, data);
    });
    userEmitter.on(USER_EVENTS.UPDATED, (data) => {
        emitModuleEvent(USER_EVENTS.UPDATED, data);
    });
    userEmitter.on(USER_EVENTS.DELETED, (data) => {
        emitModuleEvent(USER_EVENTS.DELETED, data);
    });

    // --- TEAM EVENTS ---
    teamEmitter.on(TEAM_EVENTS.CREATED, (data) => {
        emitModuleEvent(TEAM_EVENTS.CREATED, data);
    });
    teamEmitter.on(TEAM_EVENTS.UPDATED, (data) => {
        emitModuleEvent(TEAM_EVENTS.UPDATED, data);
    });
    teamEmitter.on(TEAM_EVENTS.DELETED, (data) => {
        emitModuleEvent(TEAM_EVENTS.DELETED, data);
    });
    teamEmitter.on(TEAM_EVENTS.MEMBER_ADDED, (data) => {
        emitModuleEvent(TEAM_EVENTS.MEMBER_ADDED, data);
    });
    teamEmitter.on(TEAM_EVENTS.MEMBER_UPDATED, (data) => {
        emitModuleEvent(TEAM_EVENTS.MEMBER_UPDATED, data);
    });
    teamEmitter.on(TEAM_EVENTS.MEMBER_REMOVED, (data) => {
        emitModuleEvent(TEAM_EVENTS.MEMBER_REMOVED, data);
    });

    // --- ACCEPTANCE EVENTS ---
    acceptanceEmitter.on(ACCEPTANCE_EVENTS.CREATED, (data) => {
        emitModuleEvent(ACCEPTANCE_EVENTS.CREATED, data);
    });
    acceptanceEmitter.on(ACCEPTANCE_EVENTS.APPROVED, (data) => {
        emitModuleEvent(ACCEPTANCE_EVENTS.APPROVED, data);
    });
    acceptanceEmitter.on(ACCEPTANCE_EVENTS.REJECTED, (data) => {
        emitModuleEvent(ACCEPTANCE_EVENTS.REJECTED, data);
    });
    acceptanceEmitter.on(ACCEPTANCE_EVENTS.PROCESSED, (data) => {
        emitModuleEvent(ACCEPTANCE_EVENTS.PROCESSED, data);
    });

    // --- CONTRACT ADDENDUM EVENTS ---
    contractAddendumEmitter.on(CONTRACT_ADDENDUM_EVENTS.CREATED, (data) => {
        emitModuleEvent(CONTRACT_ADDENDUM_EVENTS.CREATED, data);
    });
    contractAddendumEmitter.on(CONTRACT_ADDENDUM_EVENTS.UPDATED, (data) => {
        emitModuleEvent(CONTRACT_ADDENDUM_EVENTS.UPDATED, data);
    });
    contractAddendumEmitter.on(CONTRACT_ADDENDUM_EVENTS.SIGNED, (data) => {
        emitModuleEvent(CONTRACT_ADDENDUM_EVENTS.SIGNED, data);
    });
    contractAddendumEmitter.on(CONTRACT_ADDENDUM_EVENTS.REJECTED, (data) => {
        emitModuleEvent(CONTRACT_ADDENDUM_EVENTS.REJECTED, data);
    });
    contractAddendumEmitter.on(CONTRACT_ADDENDUM_EVENTS.APPROVED, (data) => {
        emitModuleEvent(CONTRACT_ADDENDUM_EVENTS.APPROVED, data);
    });

    // --- TASK REVIEW EVENTS ---
    taskReviewEmitter.on(TASK_REVIEW_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Task Review Updated for Task: ${data.taskId}`);
        emitModuleEvent(TASK_REVIEW_EVENTS.UPDATED, data);
    });

    // --- TASK RESULT CHECK EVENTS ---
    taskResultCheckEmitter.on(TASK_RESULT_CHECK_EVENTS.UPDATED, (data) => {
        // console.log(`[EVENT] Task Result Check Updated for Task: ${data.taskId}`);
        emitModuleEvent(TASK_RESULT_CHECK_EVENTS.UPDATED, data);
    });

    // console.log("All Module Subscribers Initialized (Global SSE Broadcast Active)");
};
