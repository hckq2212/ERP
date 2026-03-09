import { Request, Response } from "express";
import { TaskService } from "../services/Task.Service";
import { uploadToCloudinary } from "../helpers/cloudinary.helper";

export class TaskController {
    private taskService = new TaskService();

    getAll = async (req: any, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const filters = req.query;
            const tasks = await this.taskService.getAll(filters, userInfo);
            res.status(200).json(tasks);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }


    getOne = async (req: Request, res: Response) => {
        try {
            const task = await this.taskService.getOne(req.params.id as string);
            res.status(200).json(task);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const user = (req as any).user;
            const task = await this.taskService.create(req.body, user);
            res.status(201).json(task);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    createInternal = async (req: Request, res: Response) => {
        try {
            const user = (req as any).user;
            const task = await this.taskService.createInternalTask(req.body, user);
            res.status(201).json(task);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const task = await this.taskService.update(req.params.id as string, req.body);
            res.status(200).json(task);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    assign = async (req: Request, res: Response) => {
        try {
            // attachments should now be pre-uploaded and sent in body
            const { attachments: bodyAttachments = [], links = [] } = req.body;

            const attachments: any[] = [...links];

            // Standardize attachments from body (both pre-uploaded files and links)
            bodyAttachments.forEach((item: any) => {
                if (typeof item === 'string') {
                    attachments.push({ type: "LINK", name: item, url: item });
                } else if (item.url) {
                    attachments.push({
                        type: item.type || "FILE",
                        name: item.name || item.url,
                        url: item.url,
                        size: item.size,
                        publicId: item.publicId
                    });
                }
            });

            const user = (req as any).user;
            const result = await this.taskService.assign(req.params.id as string, {
                ...req.body,
                attachments
            }, user);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    submitResult = async (req: Request, res: Response) => {
        try {
            const taskId = req.params.id as string;
            // result is now pre-uploaded and sent in body
            const { result: bodyResult, link } = req.body;
            let resultData: any = null;

            if (bodyResult && bodyResult.url) {
                resultData = {
                    type: bodyResult.type || "FILE",
                    name: bodyResult.name || "Kết quả công việc",
                    url: bodyResult.url,
                    size: bodyResult.size,
                    publicId: bodyResult.publicId
                };
            } else if (link) {
                resultData = {
                    type: "LINK",
                    name: link,
                    url: link
                };
            }

            if (!resultData) {
                return res.status(400).json({ message: "Vui lòng cung cấp link hoặc file kết quả" });
            }

            const result = await this.taskService.submitResult(taskId, { result: resultData });
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }


    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.taskService.delete(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    assessExtraTask = async (req: Request, res: Response) => {
        try {
            const result = await this.taskService.assessExtraTask(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    reassign = async (req: Request, res: Response) => {
        try {
            const user = (req as any).user;
            const result = await this.taskService.reassign(req.params.id as string, req.body, user);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    requestSupport = async (req: Request, res: Response) => {
        try {
            const result = await this.taskService.requestSupport(req.params.id as string, req.body.note);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    assignSupportTeam = async (req: Request, res: Response) => {
        try {
            const result = await this.taskService.assignSupportTeam(req.params.id as string, req.body.teamId);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
