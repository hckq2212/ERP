import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDate, IsBoolean, IsNumber } from "class-validator";
import { Type } from "class-transformer";
import { TaskStatus, PerformerType } from "../entity/Enums";

export class CreateTaskDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên task không được để trống" })
    name: string;

    @IsString()
    @IsNotEmpty({ message: "ID dự án không được để trống" })
    projectId: string;

    @IsString()
    @IsOptional()
    jobId?: string;

    @IsString()
    @IsOptional()
    assigneeId?: string;

    @IsEnum(PerformerType)
    @IsOptional()
    performerType?: PerformerType;

    @IsDate({ message: "Ngày bắt đầu không hợp lệ" })
    @IsOptional()
    @Type(() => Date)
    plannedStartDate?: Date;

    @IsDate({ message: "Ngày kết thúc không hợp lệ" })
    @IsOptional()
    @Type(() => Date)
    plannedEndDate?: Date;

    @IsBoolean()
    @IsOptional()
    isOutput?: boolean;

    @IsOptional()
    attachments?: any[];
}

export class UpdateTaskStatusDTO {
    @IsEnum(TaskStatus)
    @IsNotEmpty({ message: "Trạng thái không được để trống" })
    status: TaskStatus;

    @IsString()
    @IsOptional()
    result?: string;
}

export class TaskAssignmentDTO {
    @IsString()
    @IsNotEmpty({ message: "ID người thực hiện không được để trống" })
    assigneeId: string;

    @IsEnum(PerformerType)
    @IsOptional()
    performerType?: PerformerType;

    @IsDate({ message: "Ngày bắt đầu không hợp lệ" })
    @IsOptional()
    @Type(() => Date)
    plannedStartDate?: Date;

    @IsDate({ message: "Ngày kết thúc không hợp lệ" })
    @IsOptional()
    @Type(() => Date)
    plannedEndDate?: Date;

    @IsString()
    @IsOptional()
    description?: string;

    @IsOptional()
    attachments?: any[];

    @IsString()
    @IsOptional()
    projectId?: string;
}
