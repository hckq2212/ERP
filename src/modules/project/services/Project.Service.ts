import { Contracts } from "../../contract/entities/Contract.entity";
import { ProjectAssignmentService } from "./Project.AssignmentService";
import { ProjectJobSyncService } from "./Project.JobSyncService";
import { ProjectLifecycleService } from "./Project.LifecycleService";
import { ProjectMonthlyWorkService } from "./Project.MonthlyWorkService";
import { ProjectQueryService } from "./Project.QueryService";
import { ProjectServiceAddendumService } from "./Project.ServiceAddendumService";

export class ProjectService {
    private queryService = new ProjectQueryService();
    private assignmentService = new ProjectAssignmentService();
    private jobSyncService = new ProjectJobSyncService();
    private monthlyWorkService = new ProjectMonthlyWorkService();
    private lifecycleService = new ProjectLifecycleService();
    private serviceAddendumService = new ProjectServiceAddendumService();

    getAll(filters: any = {}, userInfo?: { id: string, role: string, userId?: string }) {
        return this.queryService.getAll(filters, userInfo);
    }

    getOne(id: string, userInfo?: { id: string, role: string, userId?: string }) {
        return this.queryService.getOne(id, userInfo);
    }

    getByContractId(contractId: string, userInfo?: { id: string, role: string, userId?: string }) {
        return this.queryService.getByContractId(contractId, userInfo);
    }

    getMyProjects(userInfo: { id: string, role: string, userId?: string }) {
        return this.queryService.getMyProjects(userInfo);
    }

    assign(data: { contractId: string, pmId: string, name?: string }, actor?: { id: string, role: string, userId?: string }) {
        return this.assignmentService.assign(data, actor);
    }

    createFromContract(contract: Contracts, userInfo?: { id: string, userId?: string }) {
        return this.assignmentService.createFromContract(contract, userInfo);
    }

    update(id: string, data: { plannedStartDate?: string | null, plannedEndDate?: string | null }, actor?: { id: string, role: string, userId?: string }) {
        return this.assignmentService.updateSchedule(id, data, actor);
    }

    syncServiceJobs(id: string, actor?: { id: string, role: string, userId?: string }) {
        return this.jobSyncService.syncServiceJobs(id, actor);
    }

    getMonthlyWorkTemplate(id: string, monthKey?: string, userInfo?: { id: string, role: string, userId?: string }) {
        return this.monthlyWorkService.getMonthlyWorkTemplate(id, monthKey, userInfo);
    }

    createMonthlyWorkAddendum(id: string, data: Parameters<ProjectMonthlyWorkService["createMonthlyWorkAddendum"]>[1], userInfo?: { id: string, role: string, userId?: string }) {
        return this.monthlyWorkService.createMonthlyWorkAddendum(id, data, userInfo);
    }

    createServiceAddendum(id: string, data: Parameters<ProjectServiceAddendumService["createServiceAddendum"]>[1], userInfo?: { id: string, role: string, userId?: string }) {
        return this.serviceAddendumService.createServiceAddendum(id, data, userInfo);
    }

    createGoogleSheet(projectId: string) {
        return this.lifecycleService.createGoogleSheet(projectId);
    }

    confirm(id: string, actor: { id: string; userId?: string; role: string }) {
        return this.lifecycleService.confirm(id, actor);
    }

    requestStaffing(id: string, note: string | undefined, actor?: { id: string, role: string, userId?: string }) {
        return this.assignmentService.requestStaffing(id, note, actor);
    }
}
