import { AppDataSource } from "../data-source";
import { Users } from "../entity/User.entity";
import { Projects } from "../entity/Project.entity";
import { Tasks } from "../entity/Task.entity";
import { Customers } from "../entity/Customer.entity";
import { Contracts } from "../entity/Contract.entity";
import { Opportunities } from "../entity/Opportunity.entity";
import { Quotations } from "../entity/Quotation.entity";
import { ProjectNotionService } from "../services/notion_services/ProjectNotion.Service";
import { TaskNotionService } from "../services/notion_services/TaskNotion.Service";
import { CustomerNotionService } from "../services/notion_services/CustomerNotion.Service";
import { ContractNotionService } from "../services/notion_services/ContractNotion.Service";
import { OpportunityNotionService } from "../services/notion_services/OpportunityNotion.Service";
import { QuotationNotionService } from "../services/notion_services/QuotationNotion.Service";
import { UserNotionService } from "../services/notion_services/UserNotion.Service";

/**
 * Bulk sync all existing Entities to Notion.
 */
const bulkSync = async () => {
    try {
        console.log("--- Starting Bulk Sync to Notion ---");
        await AppDataSource.initialize();

        const customerNotionService = new CustomerNotionService();
        const contractNotionService = new ContractNotionService();
        const projectNotionService = new ProjectNotionService();
        const taskNotionService = new TaskNotionService();
        const opportunityNotionService = new OpportunityNotionService();
        const quotationNotionService = new QuotationNotionService();
        const userNotionService = new UserNotionService();

        // 1. Sync All Users
        console.log("Syncing Users...");
        const userRepository = AppDataSource.getRepository(Users);
        const users = await userRepository.find({
            relations: ["account"]
        });
        console.log(`Found ${users.length} users.`);
        for (const user of users) {
            console.log(`Syncing User: ${user.fullName}`);
            await userNotionService.sync(user);
        }

        // NOTE: order matters because we sync relations:
        // Customers -> Opportunities -> Contracts -> Projects -> Tasks -> Quotations
        console.log("Syncing Customers...");
        const customerRepository = AppDataSource.getRepository(Customers);
        const customers = await customerRepository.find();
        console.log(`Found ${customers.length} customers.`);
        for (const customer of customers) {
            console.log(`Syncing Customer: ${customer.name}`);
            await customerNotionService.sync(customer);
        }

        // 2. Sync All Opportunities
        console.log("Syncing Opportunities...");
        const opportunityRepository = AppDataSource.getRepository(Opportunities);
        const opportunities = await opportunityRepository.find({
            relations: ["customer"]
        });
        console.log(`Found ${opportunities.length} opportunities.`);
        for (const opportunity of opportunities) {
            console.log(`Syncing Opportunity: ${opportunity.opportunityCode} - ${opportunity.name}`);
            await opportunityNotionService.sync(opportunity);
        }

        // 3. Sync All Contracts
        console.log("Syncing Contracts...");
        const contractRepository = AppDataSource.getRepository(Contracts);
        const contracts = await contractRepository.find({
            relations: ["customer", "opportunity"]
        });
        console.log(`Found ${contracts.length} contracts.`);
        for (const contract of contracts) {
            console.log(`Syncing Contract: ${contract.contractCode} - ${contract.name}`);
            await contractNotionService.sync(contract);
        }

        // 4. Sync All Projects
        console.log("Syncing Projects...");
        const projectRepository = AppDataSource.getRepository(Projects);
        const projects = await projectRepository.find({
            relations: ["contract", "contract.customer", "team", "team.teamLead"]
        });
        console.log(`Found ${projects.length} projects.`);
        for (const project of projects) {
            console.log(`Syncing Project: ${project.name}`);
            await projectNotionService.sync(project);
        }

        // 5. Sync All Tasks
        console.log("Syncing Tasks...");
        const taskRepository = AppDataSource.getRepository(Tasks);
        const tasks = await taskRepository.find({
            relations: ["project", "assignee", "supervisor", "assigner"]
        });
        console.log(`Found ${tasks.length} tasks.`);
        for (const task of tasks) {
            console.log(`Syncing Task: ${task.name}`);
            await taskNotionService.sync(task);
        }

        // 6. Sync All Quotations
        console.log("Syncing Quotations...");
        const quotationRepository = AppDataSource.getRepository(Quotations);
        const quotations = await quotationRepository.find({
            relations: ["opportunity"]
        });
        console.log(`Found ${quotations.length} quotations.`);
        for (const quotation of quotations) {
            console.log(`Syncing Quotation: Ver ${quotation.version} - ${quotation.id}`);
            await quotationNotionService.sync(quotation);
        }

        console.log("--- Bulk Sync Completed successfully ---");
        process.exit(0);
    } catch (error) {
        console.error("Bulk sync failed:", error);
        process.exit(1);
    }
};

bulkSync();
