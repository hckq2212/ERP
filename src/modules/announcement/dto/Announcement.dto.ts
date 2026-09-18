import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, IsDateString } from "class-validator"
import { AnnouncementCategory, AnnouncementPriority, AnnouncementScopeType, AnnouncementStatus } from "../entities/Announcement.entity"

export class CreateAnnouncementDTO {
    @IsString()
    @IsNotEmpty({ message: "Tiêu đề không được để trống" })
    title: string

    @IsString()
    @IsNotEmpty({ message: "Nội dung không được để trống" })
    content: string

    @IsEnum(AnnouncementCategory)
    @IsNotEmpty({ message: "Loại thông báo không được để trống" })
    category: AnnouncementCategory

    @IsEnum(AnnouncementPriority)
    @IsOptional()
    priority?: AnnouncementPriority

    @IsEnum(AnnouncementScopeType)
    @IsNotEmpty({ message: "Phạm vi gửi không được để trống" })
    scopeType: AnnouncementScopeType

    @IsArray()
    @IsOptional()
    targetRoles?: string[]

    @IsArray()
    @IsOptional()
    targetTeamIds?: string[]

    @IsArray()
    @IsOptional()
    targetUserIds?: string[]

    @IsDateString()
    @IsOptional()
    eventStartAt?: string

    @IsDateString()
    @IsOptional()
    eventEndAt?: string

    @IsString()
    @IsOptional()
    eventLocation?: string

    @IsString()
    @IsOptional()
    link?: string

    @IsString()
    @IsOptional()
    attachmentUrl?: string

    @IsEnum(AnnouncementStatus)
    @IsOptional()
    status?: AnnouncementStatus

    @IsDateString()
    @IsOptional()
    scheduledAt?: string
}

export class UpdateAnnouncementDTO {
    @IsString()
    @IsOptional()
    title?: string

    @IsString()
    @IsOptional()
    content?: string

    @IsEnum(AnnouncementCategory)
    @IsOptional()
    category?: AnnouncementCategory

    @IsEnum(AnnouncementPriority)
    @IsOptional()
    priority?: AnnouncementPriority

    @IsEnum(AnnouncementScopeType)
    @IsOptional()
    scopeType?: AnnouncementScopeType

    @IsArray()
    @IsOptional()
    targetRoles?: string[]

    @IsArray()
    @IsOptional()
    targetTeamIds?: string[]

    @IsArray()
    @IsOptional()
    targetUserIds?: string[]

    @IsDateString()
    @IsOptional()
    eventStartAt?: string

    @IsDateString()
    @IsOptional()
    eventEndAt?: string

    @IsString()
    @IsOptional()
    eventLocation?: string

    @IsString()
    @IsOptional()
    link?: string

    @IsString()
    @IsOptional()
    attachmentUrl?: string

    @IsEnum(AnnouncementStatus)
    @IsOptional()
    status?: AnnouncementStatus

    @IsDateString()
    @IsOptional()
    scheduledAt?: string
}
