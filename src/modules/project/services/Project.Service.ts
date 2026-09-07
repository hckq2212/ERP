import { Contracts } from "../../contract/entities/Contract.entity";
import { ProjectAssignmentService } from "./Project.AssignmentService";
import { ProjectJobSyncService } from "./Project.JobSyncService";
import { ProjectLifecycleService } from "./Project.LifecycleService";
import { ProjectMonthlyWorkService } from "./Project.MonthlyWorkService";
import { ProjectQueryService } from "./Project.QueryService";

export class ProjectService {
    private queryService = new ProjectQueryService();
    private assignmentService = new ProjectAssignmentService();
    private jobSyncService = new ProjectJobSyncService();
    private monthlyWorkService = new ProjectMonthlyWorkService();
    private lifecycleService = new ProjectLifecycleService();

    getAll(filters: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
        return this.queryService.getAll(filters, userInfo);
    }

    getOne(id: string, userInfo?: { id: string, role: string, userId?: string }) {
        return this.queryService.getOne(id, userInfo);
    }

    getByContractId(contractId: string) {
        return this.queryService.getByContractId(contractId);
    }

    assign(data: { contractId: string, pmId: string, name?: string }) {
        return this.assignmentService.assign(data);
    }

    createFromContract(contract: Contracts, userInfo?: { id: string, userId?: string }) {
        return this.assignmentService.createFromContract(contract, userInfo);
    }

    syncServiceJobs(id: string) {
        return this.jobSyncService.syncServiceJobs(id);
    }

    getMonthlyWorkTemplate(id: string, monthKey?: string, userInfo?: { id: string, role: string, userId?: string }) {
        return this.monthlyWorkService.getMonthlyWorkTemplate(id, monthKey, userInfo);
    }

    createMonthlyWorkAddendum(id: string, data: Parameters<ProjectMonthlyWorkService["createMonthlyWorkAddendum"]>[1], userInfo?: { id: string, role: string, userId?: string }) {
        return this.monthlyWorkService.createMonthlyWorkAddendum(id, data, userInfo);
    }

    createGoogleSheet(projectId: string) {
        return this.lifecycleService.createGoogleSheet(projectId);
    }

    confirm(id: string, actor: { id: string; userId?: string; role: string }) {
        return this.lifecycleService.confirm(id, actor);
    }
}
