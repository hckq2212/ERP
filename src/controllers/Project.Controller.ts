import { Request, Response } from "express";
import { ProjectService } from "../services/Project.Service";
import { AuthRequest } from "../middlewares/Auth.Middleware";


export class ProjectController {
    private projectService = new ProjectService();

    getAll = async (req: Request, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const filters = req.query;
            const projects = await this.projectService.getAll(filters, userInfo);
            res.status(200).json(projects);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const project = await this.projectService.getOne(req.params.id as string);
            res.status(200).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getByContract = async (req: Request, res: Response) => {
        try {
            const project = await this.projectService.getByContractId(req.params.contractId as string);
            res.status(200).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }


    assign = async (req: Request, res: Response) => {
        try {
            // body: { contractId, teamId, name? }
            const project = await this.projectService.assign(req.body);
            res.status(201).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    confirm = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) throw new Error("Bạn cần đăng nhập để thực hiện hành động này");

            const project = await this.projectService.confirm(req.params.id as string, userId as string);
            res.status(200).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }


    start = async (req: Request, res: Response) => {
        try {
            const project = await this.projectService.start(req.params.id as string);
            res.status(200).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
