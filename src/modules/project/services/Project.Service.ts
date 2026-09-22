import { Contracts } from "../../contract/entities/Contract.entity";
import { ProjectAssignmentService } from "./Project.AssignmentService";
import { ProjectJobSyncService } from "./Project.JobSyncService";
import { ProjectLifecycleService } from "./Project.LifecycleService";
import { ProjectMonthlyWorkService } from "./Project.MonthlyWorkService";
import { ProjectQueryService } from "./Project.QueryService";
import { ProjectPauseService } from "./ProjectPause.Service";
import { ProjectServiceAddendumService } from "./Project.ServiceAddendumService";

type ActorInfo = { id?: string; userId?: string; role?: string };

export class ProjectService {
    private queryService = new ProjectQueryService();
    private assignmentService = new ProjectAssignmentService();
    private jobSyncService = new ProjectJobSyncService();
    private monthlyWorkService = new ProjectMonthlyWorkService();
    private lifecycleService = new ProjectLifecycleService();
    private pauseService = new ProjectPauseService();
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

    // ─────────────────────────────────────────────────────────────────────
    // TẠM DỪNG DỰ ÁN
    // ─────────────────────────────────────────────────────────────────────

    requestPause(id: string, reason: string, actor?: ActorInfo) {
        return this.pauseService.requestPause(id, reason, actor);
    }

    approvePause(requestId: string, actor?: ActorInfo) {
        return this.pauseService.approvePause(requestId, actor);
    }

    rejectPause(requestId: string, feedback: string, actor?: ActorInfo) {
        return this.pauseService.rejectPause(requestId, feedback, actor);
    }

    pauseDirect(id: string, reason: string, actor?: ActorInfo) {
        return this.pauseService.pauseDirect(id, reason, actor);
    }

    resume(id: string, resumeReason: string | undefined, actor?: ActorInfo) {
        return this.pauseService.resume(id, resumeReason, actor);
    }

    getPauseHistory(id: string) {
        return this.pauseService.getPauseHistory(id);
    }

    getHoldSummary(id: string) {
        return this.pauseService.getHoldSummary(id);
    }

    closeDirect(id: string, reason: string, actor?: ActorInfo) {
        return this.pauseService.closeDirect(id, reason, actor);
    }

    requestClose(id: string, reason: string | undefined, actor?: ActorInfo) {
        return this.pauseService.requestClose(id, reason, actor);
    }

    approveClose(requestId: string, actor?: ActorInfo) {
        return this.pauseService.approveClose(requestId, actor);
    }

    rejectClose(requestId: string, feedback: string, actor?: ActorInfo) {
        return this.pauseService.rejectClose(requestId, feedback, actor);
    }

    updateStatus(id: string, status: string, actor?: ActorInfo) {
        return this.pauseService.updateStatus(id, status, actor);
    }

    updateWorkingFiles(id: string, workingFiles: any[], actor?: ActorInfo) {
        return this.lifecycleService.updateWorkingFiles(id, workingFiles, actor);
    }
}

