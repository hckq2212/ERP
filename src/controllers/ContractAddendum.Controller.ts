import { Request, Response } from "express";
import { ContractAddendumService } from "../services/ContractAddendum.Service";
import cloudinary from "../config/cloudinary";

export class ContractAddendumController {
    private service = new ContractAddendumService();

    private uploadFileToCloudinary = (file: Express.Multer.File, folder: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const fileExtension = file.originalname.split('.').pop()?.toLowerCase() || '';
            const fileNameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.')) || file.originalname;
            const safeFileName = fileNameWithoutExt.replace(/[^a-zA-Z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ_-]/g, '_');
            const publicIdWithExtension = fileExtension ? `${safeFileName}.${fileExtension}` : safeFileName;

            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    resource_type: "auto",
                    folder: folder,
                    public_id: publicIdWithExtension,
                    use_filename: true,
                    unique_filename: true
                },
                (error, result) => {
                    if (error) reject(error);
                    else {
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
    };

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.service.create(req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    addItems = async (req: Request, res: Response) => {
        try {
            const result = await this.service.addItems(Number(req.params.id), req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    uploadSigned = async (req: Request, res: Response) => {
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json({ message: "Không tìm thấy file upload" });
            }

            const fileData = await this.uploadFileToCloudinary(file, "GETVINI/ERP/addendum");
            const result = await this.service.uploadSigned(Number(req.params.id), fileData);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    scaleDown = async (req: Request, res: Response) => {
        try {
            const result = await this.service.scaleDown(Number(req.params.id), req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
