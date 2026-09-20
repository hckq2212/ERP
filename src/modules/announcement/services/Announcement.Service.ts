import { AppDataSource } from "../../../data-source"
import { Announcements, AnnouncementScopeType, AnnouncementStatus } from "../entities/Announcement.entity"
import { AnnouncementRecipients } from "../entities/AnnouncementRecipient.entity"
import { AnnouncementComments } from "../entities/AnnouncementComment.entity"
import { Users } from "../../user/entities/User.entity"
import { TeamMembers } from "../../project/entities/TeamMember.entity"
import { In, Brackets } from "typeorm"

export class AnnouncementService {
    private announcementRepository = AppDataSource.getRepository(Announcements)
    private recipientRepository = AppDataSource.getRepository(AnnouncementRecipients)
    private commentRepository = AppDataSource.getRepository(AnnouncementComments)
    private userRepository = AppDataSource.getRepository(Users)
    private teamMemberRepository = AppDataSource.getRepository(TeamMembers)

    private async resolveRecipients(data: {
        scopeType: AnnouncementScopeType
        targetRoles?: string[]
        targetTeamIds?: string[]
        targetUserIds?: string[]
        ccUserIds?: string[]
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

        if (data.ccUserIds && data.ccUserIds.length > 0) {
            const ccUsers = await this.userRepository.find({
                where: { id: In(data.ccUserIds) },
                relations: ["accounts"]
            })
            const mergedMap = new Map<string, Users>()
            users.forEach(user => mergedMap.set(user.id, user))
            ccUsers.forEach(user => mergedMap.set(user.id, user))
            users = Array.from(mergedMap.values())
        }

        // Người tạo thông báo không tính là người nhận, không tham gia vào số liệu đã xem/chưa xem
        return excludeUserId ? users.filter(user => user.id !== excludeUserId) : users
    }

    async create(data: any, createdById: string) {
        if (data.eventStartAt && data.eventEndAt && new Date(data.eventEndAt) < new Date(data.eventStartAt)) {
            throw new Error("Ngày kết thúc không được trước ngày bắt đầu")
        }

        return await AppDataSource.transaction(async (manager) => {
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
                mediaUrls: data.mediaUrls,
                ccUserIds: data.ccUserIds,
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
            }

            return savedAnnouncement
        })
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
            qb.leftJoin(AnnouncementRecipients, "recipient", "recipient.announcementId = announcement.id AND recipient.recipientId = :viewerId", { viewerId: requester.userId })
                .andWhere(new Brackets(scopeQb => {
                    scopeQb.where("recipient.id IS NOT NULL AND announcement.status = :sentStatus", { sentStatus: AnnouncementStatus.SENT })
                        .orWhere("createdBy.id = :viewerId", { viewerId: requester.userId })
                }))
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

        const ids = data.map(item => item.id)
        const readMap = new Map<string, boolean>()

        if (ids.length > 0) {
            const recipientRows = await this.recipientRepository
                .createQueryBuilder("recipient")
                .select("recipient.announcementId", "announcementId")
                .addSelect("recipient.isRead", "isRead")
                .where("recipient.announcementId IN (:...ids)", { ids })
                .andWhere("recipient.recipientId = :userId", { userId: requester.userId })
                .getRawMany()

            recipientRows.forEach(row => readMap.set(row.announcementId, row.isRead))
        }

        const dataWithReadStatus = data.map(item => ({
            ...item,
            isRead: readMap.has(item.id) ? readMap.get(item.id) : true
        }))

        return {
            data: dataWithReadStatus,
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

        const isManager = ["BOD", "ADMIN"].includes(requester.role) || announcement.createdBy?.id === requester.userId

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

    private async ensureAccess(id: string, requester: { userId: string, role: string }) {
        const isManager = ["BOD", "ADMIN"].includes(requester.role)
        if (isManager) return

        const ownAnnouncement = await this.announcementRepository.findOne({
            where: { id, createdBy: { id: requester.userId } }
        })
        if (ownAnnouncement) return

        const ownRecipient = await this.recipientRepository.findOne({
            where: { announcement: { id }, recipient: { id: requester.userId } }
        })
        if (!ownRecipient) throw new Error("Bạn không có quyền truy cập thông báo này")
    }

    async getComments(id: string, requester: { userId: string, role: string }) {
        const announcement = await this.announcementRepository.findOne({ where: { id } })
        if (!announcement) throw new Error("Không tìm thấy thông báo")

        await this.ensureAccess(id, requester)

        return await this.commentRepository.find({
            where: { announcement: { id } },
            relations: ["author"],
            order: { createdAt: "ASC" }
        })
    }

    async addComment(id: string, requester: { userId: string, role: string }, content: string) {
        const announcement = await this.announcementRepository.findOne({ where: { id } })
        if (!announcement) throw new Error("Không tìm thấy thông báo")

        await this.ensureAccess(id, requester)

        const author = await this.userRepository.findOne({ where: { id: requester.userId } })
        if (!author) throw new Error("Không tìm thấy người dùng")

        const comment = this.commentRepository.create({
            announcement,
            author,
            content
        }) as unknown as AnnouncementComments

        return await this.commentRepository.save(comment)
    }

    async deleteComment(id: string, commentId: string, requester: { userId: string, role: string }) {
        const comment = await this.commentRepository.findOne({
            where: { id: commentId, announcement: { id } },
            relations: ["author"]
        })
        if (!comment) throw new Error("Không tìm thấy bình luận")

        const isManager = ["BOD", "ADMIN"].includes(requester.role)
        if (!isManager && comment.author?.id !== requester.userId) {
            throw new Error("Bạn không có quyền xoá bình luận này")
        }

        await this.commentRepository.remove(comment)
        return { success: true }
    }
}
