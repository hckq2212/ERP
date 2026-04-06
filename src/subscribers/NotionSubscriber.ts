import { projectEmitter, PROJECT_EVENTS } from "../events/ProjectEmitter";
import { taskEmitter, TASK_EVENTS } from "../events/TaskEmitter";
import { contractEmitter, CONTRACT_EVENTS } from "../events/ContractEmitter";
import { customerEmitter, CUSTOMER_EVENTS } from "../events/CustomerEmitter";
import { ProjectNotionService } from "../services/notion_services/ProjectNotion.Service";
import { TaskNotionService } from "../services/notion_services/TaskNotion.Service";
import { ContractNotionService } from "../services/notion_services/ContractNotion.Service";
import { CustomerNotionService } from "../services/notion_services/CustomerNotion.Service";

/**
 * NotionSubscriber - Listens for ERP changes and syncs them to Notion in real-time.
 */
export const initNotionSubscriber = () => {
    const projectService = new ProjectNotionService();
    const taskService = new TaskNotionService();
    const contractService = new ContractNotionService();
    const customerService = new CustomerNotionService();

    // --- PROJECT EVENTS ---
    projectEmitter.on(PROJECT_EVENTS.CREATED, async (data) => {
        await projectService.sync(data);
    });

    projectEmitter.on(PROJECT_EVENTS.UPDATED, async (data) => {
        await projectService.sync(data);
    });

    // --- TASK EVENTS ---
    taskEmitter.on(TASK_EVENTS.CREATED, async (data) => {
        await taskService.sync(data);
    });

    taskEmitter.on(TASK_EVENTS.UPDATED, async (data) => {
        await taskService.sync(data);
    });

    taskEmitter.on(TASK_EVENTS.STATUS_CHANGED, async (data) => {
        await taskService.sync(data);
    });

    // --- CONTRACT EVENTS ---
    contractEmitter.on(CONTRACT_EVENTS.CREATED, async (data) => {
        await contractService.sync(data);
    });

    contractEmitter.on(CONTRACT_EVENTS.UPDATED, async (data) => {
        await contractService.sync(data);
    });

    contractEmitter.on(CONTRACT_EVENTS.SIGNED, async (data) => {
        await contractService.sync(data);
    });

    // --- CUSTOMER EVENTS ---
    customerEmitter.on(CUSTOMER_EVENTS.CREATED, async (data) => {
        await customerService.sync(data);
    });

    customerEmitter.on(CUSTOMER_EVENTS.UPDATED, async (data) => {
        await customerService.sync(data);
    });

    console.log("[NotionSubscriber] Webhook-like Real-time Sync Initialized for Projects, Tasks, Contracts, and Customers.");
};
