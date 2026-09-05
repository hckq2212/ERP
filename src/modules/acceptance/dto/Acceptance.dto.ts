import { IsString, IsNotEmpty, IsOptional, IsArray } from "class-validator";

export class CreateAcceptanceDTO {
    @IsString()
    @IsNotEmpty({ message: "ID dự án không được để trống" })
    projectId: string;

    @IsArray()
    @IsNotEmpty({ message: "Danh sách dịch vụ không được để trống" })
    serviceIds: string[];

    @IsString()
    @IsOptional()
    note?: string;

    @IsArray()
    @IsOptional()
    attachments?: any[];
}

export class ApproveAcceptanceDTO {
    @IsString()
    @IsOptional()
    feedback?: string;
}

export class RejectAcceptanceDTO {
    @IsString()
    @IsNotEmpty({ message: "Lý do từ chối không được để trống" })
    feedback: string;
}
