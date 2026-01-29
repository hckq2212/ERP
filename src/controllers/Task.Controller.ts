import { Request, Response } from "express";
import { TaskService } from "../services/Task.Service";
import cloudinary from "../config/cloudinary";

export class TaskController {
    private taskService = new TaskService();

    getAll = async (req: any, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const tasks = await this.taskService.getAll(userInfo);
            res.status(200).json(tasks);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }


    getOne = async (req: Request, res: Response) => {
        try {
            const task = await this.taskService.getOne(Number(req.params.id));
            res.status(200).json(task);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const task = await this.taskService.create(req.body);
            res.status(201).json(task);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const task = await this.taskService.update(Number(req.params.id), req.body);
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
                const uploadPromises = files.map(file => {
                    return new Promise((resolve, reject) => {
                        const uploadStream = cloudinary.uploader.upload_stream(
                            { resource_type: "auto", folder: "GETVINI/ERP/tasks" },
                            (error, result) => {
                                if (error) reject(error);
                                else {
                                    const downloadUrl = cloudinary.url(result!.public_id, {
                                        resource_type: result!.resource_type,
                                        flags: 'attachment',
                                        secure: true
                                    });

                                    const fileExtension = file.originalname.split('.').pop()?.toLowerCase() || '';

                                    resolve({
                                        type: "FILE",
                                        name: file.originalname,
                                        extension: fileExtension,
                                        mimeType: file.mimetype,
                                        url: result?.secure_url,
                                        downloadUrl: downloadUrl,
                                        size: file.size,
                                        publicId: result?.public_id
                                    });
                                }
                            }
                        );
                        uploadStream.end(file.buffer);
                    });
                });

                const uploadedFiles = await Promise.all(uploadPromises);
                // @ts-ignore
                attachments.push(...uploadedFiles);
            }

            const result = await this.taskService.assign(Number(req.params.id), {
                ...req.body,
                attachments
            });
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.taskService.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
