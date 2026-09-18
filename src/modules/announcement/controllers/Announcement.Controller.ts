import { Response } from "express"
import { AnnouncementService } from "../services/Announcement.Service"
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware"

export class AnnouncementController {
    private announcementService = new AnnouncementService()

    create = async (req: AuthRequest, res: Response) => {
        try {
            const createdById = req.user?.userId || req.user?.id
            const result = await this.announcementService.create(req.body, createdById as string)
            res.status(201).json(result)
        } catch (error: any) {
            res.status(400).json({ message: error.message })
        }
    }

    getAll = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id
            const role = req.user?.role as string
            const result = await this.announcementService.getAll(req.query, { userId: userId as string, role })
            res.status(200).json(result)
        } catch (error: any) {
            res.status(500).json({ message: error.message })
        }
    }

    getOne = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id
            const role = req.user?.role as string
            const result = await this.announcementService.getOne(req.params.id as string, { userId: userId as string, role })
            res.status(200).json(result)
        } catch (error: any) {
            res.status(404).json({ message: error.message })
        }
    }

    update = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.announcementService.update(req.params.id as string, req.body)
            res.status(200).json(result)
        } catch (error: any) {
            res.status(400).json({ message: error.message })
        }
    }

    delete = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.announcementService.delete(req.params.id as string)
            res.status(200).json(result)
        } catch (error: any) {
            res.status(400).json({ message: error.message })
        }
    }

    markAsRead = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id
            const result = await this.announcementService.markAsRead(req.params.id as string, userId as string)
            res.status(200).json(result)
        } catch (error: any) {
            res.status(400).json({ message: error.message })
        }
    }
}
