import { Request, Response } from "express";
import { OpportunityService } from "../services/Opportunity.Service";
import { AuthRequest } from "../middlewares/Auth.Middleware";
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
            const authReq = req as AuthRequest;
            const accountId = authReq.user?.id;

            console.log(req.body);
            const files = req.files as Express.Multer.File[];

            // Handle multipart/form-data stringified fields
            const links = req.body.links ? JSON.parse(req.body.links) : [];
            const services = req.body.services ? JSON.parse(req.body.services) : [];
            const attachments = [...links];

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

            // 3. Upload to Cloudinary
            if (files && files.length > 0) {
                const uploadPromises = files.map(file => {
                    return new Promise((resolve, reject) => {
                        // Extract file extension and name without extension
                        const fileExtension = file.originalname.split('.').pop()?.toLowerCase() || '';
                        const fileNameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.')) || file.originalname;
                        // Create a safe filename (remove special characters, keep Vietnamese)
                        const safeFileName = fileNameWithoutExt.replace(/[^a-zA-Z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ_-]/g, '_');
                        // Add extension to public_id to preserve file type
                        const publicIdWithExtension = fileExtension ? `${safeFileName}.${fileExtension}` : safeFileName;

                        const uploadStream = cloudinary.uploader.upload_stream(
                            {
                                resource_type: "auto",
                                folder: "GETVINI/ERP/opportunities",
                                public_id: publicIdWithExtension, // Include extension in public_id
                                use_filename: true,
                                unique_filename: true // Add timestamp to avoid duplicates
                            },
                            (error, result) => {
                                if (error) reject(error);
                                else {
                                    // Generate download URL with attachment flag and original filename
                                    const downloadUrl = cloudinary.url(result!.public_id, {
                                        resource_type: result!.resource_type,
                                        flags: `attachment:${file.originalname}`,
                                        secure: true
                                    });

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
                attachments.push(...uploadedFiles);
            }

            const result = await this.opportunityService.create({
                ...req.body,
                services,
                attachments,
                accountId
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

            // Fetch existing opportunity to preserve attachments if not provided
            const existingOpportunity = await this.opportunityService.getOne(id);

            let currentAttachments = [];
            if (req.body.attachments) {
                try {
                    currentAttachments = JSON.parse(req.body.attachments);
                } catch (e) {
                    currentAttachments = [];
                }
            } else {
                currentAttachments = existingOpportunity.attachments || [];
            }

            let links = [];
            if (req.body.links) {
                try {
                    links = JSON.parse(req.body.links);
                } catch (e) {
                    links = [];
                }
            }

            let services = [];
            if (req.body.services) {
                try {
                    services = JSON.parse(req.body.services);
                } catch (e) {
                    services = [];
                }
            }

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
                finalAttachments.push(...uploadedFiles);
            }

            const updateData: any = {
                ...req.body,
                attachments: finalAttachments
            };

            if (req.body.services) {
                updateData.services = services;
            }

            const result = await this.opportunityService.update(id, updateData);
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
