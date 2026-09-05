import { Request, Response } from "express";
import { ProjectTeamService } from "../services/ProjectTeam.Service";

const sendError = (res: Response, error: any) => {
    res.status(error.statusCode || 500).json({ message: error.message });
};

export class ProjectTeamController {
    private teamService = new ProjectTeamService();

    getAll = async (req: Request, res: Response) => {
        try {
            const teams = await this.teamService.getAll();
            res.status(200).json(teams);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const team = await this.teamService.getOne(req.params.id as string);
            res.status(200).json(team);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getMembers = async (req: Request, res: Response) => {
        try {
            const members = await this.teamService.getMembers(req.params.id as string);
            res.status(200).json(members);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }


    create = async (req: Request, res: Response) => {
        try {
            const team = await this.teamService.create(req.body, (req as any).user);
            res.status(201).json(team);
        } catch (error) {
            sendError(res, error);
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const team = await this.teamService.update(req.params.id as string, req.body, (req as any).user);
            res.status(200).json(team);
        } catch (error) {
            sendError(res, error);
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            await this.teamService.delete(req.params.id as string, (req as any).user);
            res.status(200).json({ message: "Xóa team thành công" });
        } catch (error) {
            sendError(res, error);
        }
    }

    changeLead = async (req: Request, res: Response) => {
        try {
            const { newLeadId } = req.body;
            const team = await this.teamService.changeLead(req.params.id as string, newLeadId, (req as any).user);
            res.status(200).json(team);
        } catch (error) {
            sendError(res, error);
        }
    }

    addMember = async (req: Request, res: Response) => {
        try {
            const { userId, role } = req.body;
            const member = await this.teamService.addMember(req.params.id as string, userId, role, (req as any).user);
            res.status(201).json(member);
        } catch (error) {
            sendError(res, error);
        }
    }

    updateMember = async (req: Request, res: Response) => {
        try {
            const member = await this.teamService.updateMember(req.params.memberId as string, req.body, (req as any).user);
            res.status(200).json(member);
        } catch (error) {
            sendError(res, error);
        }
    }

    removeMember = async (req: Request, res: Response) => {
        try {
            await this.teamService.removeMember(req.params.memberId as string, (req as any).user);
            res.status(200).json({ message: "Xóa thành viên thành công" });
        } catch (error) {
            sendError(res, error);
        }
    }
}
