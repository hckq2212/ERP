import { Request, Response } from "express";
import { ProjectService } from "../services/Project.Service";

export class ProjectController {
    private projectService = new ProjectService();

    getAll = async (req: Request, res: Response) => {
        try {
            const projects = await this.projectService.getAll();
            res.status(200).json(projects);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const project = await this.projectService.getOne(Number(req.params.id));
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

    confirm = async (req: Request, res: Response) => {
        try {
            // userId from auth middleware? For now maybe pass in body or hardcode
            // Assuming req.user exists if auth middleware is used.
            // But let's just take userId from body for simplicity if auth not fully set up
            const { userId } = req.body;
            const project = await this.projectService.confirm(Number(req.params.id), userId);
            res.status(200).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    start = async (req: Request, res: Response) => {
        try {
            const project = await this.projectService.start(Number(req.params.id));
            res.status(200).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
