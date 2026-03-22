import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum } from "class-validator";
import { AcceptanceStatus } from "../entity/AcceptanceRequest.entity";

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

export class UpdateAcceptanceStatusDTO {
    @IsEnum(AcceptanceStatus)
    @IsNotEmpty({ message: "Trạng thái không được để trống" })
    status: AcceptanceStatus;

    @IsString()
    @IsOptional()
    note?: string;
}
