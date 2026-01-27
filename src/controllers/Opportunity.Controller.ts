import { Request, Response } from "express";
import { OpportunityService } from "../services/Opportunity.Service";
import cloudinary from "../config/cloudinary";

export class OpportunityController {
    private opportunityService = new OpportunityService();

    getAll = async (req: Request, res: Response) => {
        try {
            const result = await this.opportunityService.getAll();
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            const result = await this.opportunityService.getOne(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            console.log(req.body);
            const files = req.files as Express.Multer.File[];
            const links = req.body.links ? JSON.parse(req.body.links) : [];

            // 1. Files validation
            // Multer 'limits' option handles max count (5), but let's be safe
            if (files && files.length > 5) {
                return res.status(400).json({ message: "Chỉ được upload tối đa 5 file" });
            }

            // 2. Size validation
            if (files) {
                const totalSize = files.reduce((sum, file) => sum + file.size, 0);
                if (totalSize > 25 * 1024 * 1024) { // 25MB
                    return res.status(400).json({ message: "Tổng dung lượng file không được vượt quá 25MB" });
                }
            }

            const attachments = [...links];

            // 3. Upload to Cloudinary
            if (files && files.length > 0) {
                const uploadPromises = files.map(file => {
                    return new Promise((resolve, reject) => {
                        const uploadStream = cloudinary.uploader.upload_stream(
                            { resource_type: "auto", folder: "opportunities" },
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
                attachments.push(...uploadedFiles);
            }

            const result = await this.opportunityService.create({
                ...req.body,
                attachments
            });
            res.status(201).json(result);

        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            const files = req.files as Express.Multer.File[];

            // Existing attachments logic is tricky. 
            // Simplified: User sends new list of links + new files. 
            // If they want to keep old files, they should send them in 'attachments' body or handle separate delete API.
            // For now, let's assume 'attachments' in body contains EVERYTHING to keep (links + old files refs) 
            // AND 'files' contains NEW files to add.

            const currentAttachments = req.body.attachments ? JSON.parse(req.body.attachments) : [];
            const links = req.body.links ? JSON.parse(req.body.links) : [];

            // Merge existing and new links
            // Let's rely on what front-end sends. If front-end sends existing files in 'attachments', we keep them.

            let finalAttachments = [...currentAttachments, ...links];

            // Validations
            const newFilesCount = files ? files.length : 0;
            const existingFilesCount = finalAttachments.filter((a: any) => a.type === 'FILE').length;

            if (newFilesCount + existingFilesCount > 5) {
                return res.status(400).json({ message: "Tổng số file (cũ + mới) không được vượt quá 5" });
            }

            if (files) {
                const totalSize = files.reduce((sum, file) => sum + file.size, 0);
                if (totalSize > 25 * 1024 * 1024) {
                    return res.status(400).json({ message: "Tổng dung lượng file mới không được vượt quá 25MB" });
                }
            }

            // Upload NEW files
            if (files && files.length > 0) {
                const uploadPromises = files.map(file => {
                    return new Promise((resolve, reject) => {
                        const uploadStream = cloudinary.uploader.upload_stream(
                            { resource_type: "auto", folder: "opportunities" },
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
                finalAttachments.push(...uploadedFiles);
            }

            const result = await this.opportunityService.update(id, {
                ...req.body,
                attachments: finalAttachments
            });
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            const result = await this.opportunityService.delete(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }
}
