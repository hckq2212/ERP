import { AppDataSource } from "../../../data-source"
import { Announcements, AnnouncementScopeType, AnnouncementStatus } from "../entities/Announcement.entity"
import { AnnouncementRecipients } from "../entities/AnnouncementRecipient.entity"
import { Users } from "../../user/entities/User.entity"
import { TeamMembers } from "../../project/entities/TeamMember.entity"
import { In, Brackets } from "typeorm"
import { NotificationService } from "../../notification/services/Notification.Service"

export class AnnouncementService {
    private announcementRepository = AppDataSource.getRepository(Announcements)
    private recipientRepository = AppDataSource.getRepository(AnnouncementRecipients)
    private userRepository = AppDataSource.getRepository(Users)
    private teamMemberRepository = AppDataSource.getRepository(TeamMembers)
    private notificationService = new NotificationService()

    private async resolveRecipients(data: {
        scopeType: AnnouncementScopeType
        targetRoles?: string[]
        targetTeamIds?: string[]
        targetUserIds?: string[]
    }, excludeUserId?: string): Promise<Users[]> {
        let users: Users[] = []

        if (data.scopeType === AnnouncementScopeType.ALL) {
            users = await this.userRepository.find({
                where: { isLocked: false },
                relations: ["accounts"]
            })
        } else if (data.scopeType === AnnouncementScopeType.ROLE) {
            if (!data.targetRoles || data.targetRoles.length === 0) return []
            users = await this.userRepository.find({
                where: { isLocked: false, accounts: { role: In(data.targetRoles) as any } },
                relations: ["accounts"]
            })
        } else if (data.scopeType === AnnouncementScopeType.TEAM) {
            if (!data.targetTeamIds || data.targetTeamIds.length === 0) return []
            const members = await this.teamMemberRepository.find({
                where: { team: { id: In(data.targetTeamIds) } },
                relations: ["user", "user.accounts", "team", "team.teamLead", "team.teamLead.accounts"]
            })
            const usersMap = new Map<string, Users>()
            members.forEach(member => {
                if (member.user) usersMap.set(member.user.id, member.user)
                if (member.team?.teamLead) usersMap.set(member.team.teamLead.id, member.team.teamLead)
            })
            users = Array.from(usersMap.values())
        } else if (data.scopeType === AnnouncementScopeType.USER) {
            if (!data.targetUserIds || data.targetUserIds.length === 0) return []
            users = await this.userRepository.find({
                where: { id: In(data.targetUserIds) },
                relations: ["accounts"]
            })
        }

        // Người tạo thông báo không tính là người nhận, không tham gia vào số liệu đã xem/chưa xem
        return excludeUserId ? users.filter(user => user.id !== excludeUserId) : users
    }

    async create(data: any, createdById: string) {
        if (data.eventStartAt && data.eventEndAt && new Date(data.eventEndAt) < new Date(data.eventStartAt)) {
            throw new Error("Ngày kết thúc không được trước ngày bắt đầu")
        }

        let pendingNotifications: { recipientId: string, notification: any }[] = []

        const savedAnnouncement = await AppDataSource.transaction(async (manager) => {
            const createdBy = await manager.getRepository(Users).findOne({ where: { id: createdById } })

            const status = data.status || AnnouncementStatus.SENT

            const announcement = manager.getRepository(Announcements).create({
                title: data.title,
                content: data.content,
                category: data.category,
                priority: data.priority,
                scopeType: data.scopeType,
                targetRoles: data.targetRoles,
                targetTeamIds: data.targetTeamIds,
                targetUserIds: data.targetUserIds,
                eventStartAt: data.eventStartAt ? new Date(data.eventStartAt) : null,
                eventEndAt: data.eventEndAt ? new Date(data.eventEndAt) : null,
                eventLocation: data.eventLocation,
                link: data.link,
                attachmentUrl: data.attachmentUrl,
                status,
                scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
                createdBy: createdBy as any
            }) as unknown as Announcements

            const savedAnnouncement = await manager.getRepository(Announcements).save(announcement)

            if (status === AnnouncementStatus.SENT) {
                const recipients = await this.resolveRecipients(data, createdById)

                const recipientEntities = recipients.map(user => manager.getRepository(AnnouncementRecipients).create({
                    announcement: savedAnnouncement,
                    recipient: user,
                    isRead: false
                }))

                if (recipientEntities.length > 0) {
                    await manager.getRepository(AnnouncementRecipients).save(recipientEntities as any)
                }

                savedAnnouncement.recipientCount = recipients.length
                await manager.getRepository(Announcements).save(savedAnnouncement)

                for (const user of recipients) {
                    // emit: false -> tránh báo SSE trước khi transaction commit (client refetch sẽ không thấy dữ liệu mới, phải F5 mới thấy)
                    const savedNotification = await this.notificationService.createNotification({
                        title: savedAnnouncement.title,
                        content: savedAnnouncement.content,
                        type: savedAnnouncement.category,
                        recipient: user,
                        sender: createdBy as any,
                        link: savedAnnouncement.link,
                        relatedEntityId: savedAnnouncement.id,
                        relatedEntityType: "ANNOUNCEMENT"
                    }, manager, { emit: false })

                    pendingNotifications.push({ recipientId: user.id, notification: savedNotification })
                }
            }

            return savedAnnouncement
        })

        // Transaction đã commit xong, giờ mới báo real-time cho các client đang mở SSE
        for (const { recipientId, notification } of pendingNotifications) {
            this.notificationService.emitNewNotification(recipientId, notification)
        }

        return savedAnnouncement
    }

    async getAll(query: any, requester: { userId: string, role: string }) {
        const page = parseInt(query.page) || 1
        const limit = parseInt(query.limit) || 10
        const skip = (page - 1) * limit

        const isManager = ["BOD", "ADMIN"].includes(requester.role)

        const qb = this.announcementRepository.createQueryBuilder("announcement")
            .leftJoinAndSelect("announcement.createdBy", "createdBy")
            .orderBy("announcement.createdAt", "DESC")

        if (!isManager) {
            qb.innerJoin(AnnouncementRecipients, "recipient", "recipient.announcementId = announcement.id")
                .andWhere("recipient.recipientId = :userId", { userId: requester.userId })
                .andWhere("announcement.status = :sentStatus", { sentStatus: AnnouncementStatus.SENT })
        }

        if (query.search) {
            qb.andWhere(new Brackets(subQb => {
                subQb.where("announcement.title ILIKE :search", { search: `%${query.search}%` })
                    .orWhere("announcement.content ILIKE :search", { search: `%${query.search}%` })
            }))
        }

        if (query.category) {
            qb.andWhere("announcement.category = :category", { category: query.category })
        }

        if (query.priority) {
            qb.andWhere("announcement.priority = :priority", { priority: query.priority })
        }

        if (query.status) {
            qb.andWhere("announcement.status = :status", { status: query.status })
        }

        if (query.scopeType) {
            qb.andWhere("announcement.scopeType = :scopeType", { scopeType: query.scopeType })
        }

        if (query.createdById) {
            qb.andWhere("createdBy.id = :createdById", { createdById: query.createdById })
        }

        if (query.fromDate) {
            qb.andWhere("announcement.createdAt >= :fromDate", { fromDate: new Date(query.fromDate) })
        }

        if (query.toDate) {
            qb.andWhere("announcement.createdAt <= :toDate", { toDate: new Date(query.toDate) })
        }

        const [data, total] = await qb.skip(skip).take(limit).getManyAndCount()

        return {
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    }

    async getOne(id: string, requester: { userId: string, role: string }) {
        const announcement = await this.announcementRepository.findOne({
            where: { id },
            relations: ["createdBy"]
        })
        if (!announcement) throw new Error("Không tìm thấy thông báo")

        const isManager = ["BOD", "ADMIN"].includes(requester.role)

        if (!isManager) {
            const ownRecipient = await this.recipientRepository.findOne({
                where: { announcement: { id }, recipient: { id: requester.userId } }
            })
            if (!ownRecipient) throw new Error("Bạn không có quyền xem thông báo này")

            return {
                ...announcement,
                isRead: ownRecipient.isRead
            }
        }

        const recipients = await this.recipientRepository.find({
            where: { announcement: { id } },
            relations: ["recipient"]
        })

        const readCount = recipients.filter(r => r.isRead).length
        const totalRecipients = recipients.length

        return {
            ...announcement,
            recipients,
            totalRecipients,
            readCount,
            unreadCount: totalRecipients - readCount,
            readRate: totalRecipients > 0 ? Math.round((readCount / totalRecipients) * 100) : 0
        }
    }

    async markAsRead(id: string, userId: string) {
        const now = new Date()

        // Cập nhật atomic: luôn ghi lại thời điểm xem gần nhất, chỉ set "đã đọc" lần đầu tiên
        const result = await this.recipientRepository
            .createQueryBuilder()
            .update(AnnouncementRecipients)
            .set({
                lastViewedAt: now,
                isRead: true,
                readAt: () => 'COALESCE("readAt", :now)'
            })
            .setParameter("now", now)
            .where("announcementId = :id", { id })
            .andWhere("recipientId = :userId", { userId })
            .execute()

        // Người xem không phải là người nhận (VD: người tạo, quản lý xem lại) thì không có gì để cập nhật
        if (!result.affected) return null

        return await this.recipientRepository.findOne({
            where: { announcement: { id }, recipient: { id: userId } }
        })
    }

    async update(id: string, data: any) {
        const announcement = await this.announcementRepository.findOne({ where: { id } })
        if (!announcement) throw new Error("Không tìm thấy thông báo")

        if (announcement.status === AnnouncementStatus.SENT) {
            throw new Error("Không thể chỉnh sửa thông báo đã gửi")
        }

        const nextStartAt = data.eventStartAt ? new Date(data.eventStartAt) : announcement.eventStartAt
        const nextEndAt = data.eventEndAt ? new Date(data.eventEndAt) : announcement.eventEndAt

        if (nextStartAt && nextEndAt && nextEndAt < nextStartAt) {
            throw new Error("Ngày kết thúc không được trước ngày bắt đầu")
        }

        Object.assign(announcement, {
            ...data,
            eventStartAt: nextStartAt,
            eventEndAt: nextEndAt,
            scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : announcement.scheduledAt
        })

        return await this.announcementRepository.save(announcement)
    }

    async delete(id: string) {
        const announcement = await this.announcementRepository.findOne({ where: { id } })
        if (!announcement) throw new Error("Không tìm thấy thông báo")

        if (announcement.status === AnnouncementStatus.SENT) {
            announcement.status = AnnouncementStatus.CANCELLED
            return await this.announcementRepository.save(announcement)
        }

        await this.announcementRepository.remove(announcement)
        return { success: true }
    }
}
