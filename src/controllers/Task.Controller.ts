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
            const files = req.files as Express.Multer.File[];
            // Parse links and attachments from body
            let bodyAttachments: any[] = [];

            const parseField = (field: any) => {
                if (!field) return [];
                if (typeof field === 'string') {
                    try {
                        return JSON.parse(field);
                    } catch (e) {
                        return [{ type: "LINK", name: field, url: field }];
                    }
                }
                return Array.isArray(field) ? field : [field];
            };

            const links = parseField(req.body.links);
            const existingAttachments = parseField(req.body.attachments);

            bodyAttachments = [...links, ...existingAttachments];

            const attachments: { type: string, name: string, url: string, size?: number, publicId?: string }[] = [];

            // Standardize body attachments
            bodyAttachments.forEach(item => {
                if (typeof item === 'string') {
                    attachments.push({ type: "LINK", name: item, url: item });
                } else if (item.url) {
                    attachments.push({
                        type: item.type || "LINK",
                        name: item.name || item.url,
                        url: item.url,
                        size: item.size,
                        publicId: item.publicId
                    });
                }
            });


            // Validations
            if (files) {
                const totalSize = files.reduce((sum, file) => sum + file.size, 0);
                if (totalSize > 25 * 1024 * 1024) {
                    return res.status(400).json({ message: "Tổng dung lượng file không được vượt quá 25MB" });
                }
                if (files.length + attachments.length > 5) { // Simple check, exact logic depends on reqs
                    // warning on limit
                }
            }

            // Upload files
            if (files && files.length > 0) {
                const uploadPromises = files.map(file => uploadToCloudinary(file, "GETVINI/ERP/tasks"));
                const uploadedFiles = await Promise.all(uploadPromises);
                // @ts-ignore
                attachments.push(...uploadedFiles);
            }

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
            const file = req.file as Express.Multer.File;
            const { link } = req.body;
            let resultData: any = null;

            if (file) {
                // Upload file to specific folder: GETVINI/ERP/TASK/{taskId}
                resultData = await uploadToCloudinary(file, `GETVINI/ERP/TASK/${taskId}`);
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
}
