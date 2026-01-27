import { Request, Response } from "express";
import { TaskService } from "../services/Task.Service";
import cloudinary from "../config/cloudinary";

export class TaskController {
    private taskService = new TaskService();

    getAll = async (req: Request, res: Response) => {
        try {
            const tasks = await this.taskService.getAll();
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
            // links comes as a stringified JSON array if sent as form-data, or just handle if it's parsed. 
            // Since we use upload.array(), body parsing might depend on complexity.
            // Usually with FormData, non-file fields are text.
            let links: any[] = [];
            if (req.body.links) {
                try {
                    links = JSON.parse(req.body.links);
                } catch (e) {
                    // Try to handle if it's already an object or simple string? 
                    // Let's assume it's JSON string as per common FormData patterns
                    links = [];
                }
            }

            const attachments: { type: string, name: string, url: string, size?: number, publicId?: string }[] = [];

            // Add links
            if (Array.isArray(links)) {
                links.forEach(link => {
                    // Assert structure or map?
                    // Assuming user sends { type: 'LINK', name: '...', url: '...' } or just strings?
                    // Request says "link", let's standardise.
                    if (typeof link === 'string') {
                        attachments.push({ type: "LINK", name: link, url: link });
                    } else {
                        attachments.push(link);
                    }
                });
            }

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
                            { resource_type: "auto", folder: "tasks" },
                            (error, result) => {
                                if (error) reject(error);
                                else resolve({
                                    type: "FILE",
                                    name: file.originalname,
                                    url: result?.secure_url,
                                    size: file.size,
                                    publicId: result?.public_id
                                });
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
