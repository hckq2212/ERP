import { Request, Response } from "express";
import { ProjectService } from "../services/Project.Service";
import { ProjectProductDescriptionService } from "../services/ProjectProductDescription.Service";
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware";


export class ProjectController {
    private projectService = new ProjectService();
    private productDescriptionService = new ProjectProductDescriptionService();

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
            const userInfo = (req as any).user;
            const project = await this.projectService.getOne(req.params.id as string, userInfo);
            res.status(200).json(project);
        } catch (error: any) {
            if (error.message === "FORBIDDEN_ACCESS" || error.message.includes("không có quyền xem")) {
                res.status(403).json({ message: error.message });
            } else {
                res.status(404).json({ message: error.message });
            }
        }
    }

    getByContract = async (req: Request, res: Response) => {
        try {
            // Usually getByContract should also have RBAC, but let's stick to getOne/getAll for now
            // as they are the main entry points
            const project = await this.projectService.getByContractId(req.params.contractId as string);
            res.status(200).json(project);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }


    assign = async (req: Request, res: Response) => {
        try {
            // body: { contractId, pmId, name? }
            const project = await this.projectService.assign(req.body);
            res.status(201).json(project);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    confirm = async (req: AuthRequest, res: Response) => {
        try {
            const actor = req.user || (req as any).user;
            if (!actor) {
                return res.status(401).json({ message: "Bạn cần đăng nhập để thực hiện hành động này" });
            }

            const project = await this.projectService.confirm(req.params.id as string, actor as any);
            res.status(200).json(project);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    }

    getMonthlyWorkTemplate = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.projectService.getMonthlyWorkTemplate(
                req.params.id as string,
                req.query.month as string | undefined,
                req.user as any
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    createMonthlyWorkAddendum = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.projectService.createMonthlyWorkAddendum(
                req.params.id as string,
                req.body,
                req.user as any
            );
            res.status(201).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    retryGoogleSheet = async (req: AuthRequest, res: Response) => {
        // Google Sheet integration is temporarily disabled.
        void req;
        res.status(503).json({ message: "Google Sheet integration is temporarily disabled" });
    }

    syncServiceJobs = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.projectService.syncServiceJobs(req.params.id as string);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getProductDescriptions = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.productDescriptionService.getByProject(req.params.id as string, req.user as any);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    }

    createProductDescription = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.productDescriptionService.create(req.params.id as string, req.body, req.user as any);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    }

    updateProductDescription = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.productDescriptionService.update(
                req.params.id as string,
                req.params.submissionId as string,
                req.body,
                req.user as any
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    }

    submitProductDescription = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.productDescriptionService.submit(
                req.params.id as string,
                req.params.submissionId as string,
                req.user as any
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    }

    approveProductDescription = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.productDescriptionService.approve(
                req.params.id as string,
                req.params.submissionId as string,
                req.user as any
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    }

    rejectProductDescription = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.productDescriptionService.reject(
                req.params.id as string,
                req.params.submissionId as string,
                req.body,
                req.user as any
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    }

    // start = async (req: Request, res: Response) => {
    //     try {
    //         const project = await this.projectService.start(req.params.id as string);
    //         res.status(200).json(project);
    //     } catch (error) {
    //         res.status(500).json({ message: error.message });
    //     }
    // }
}
