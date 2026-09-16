import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDate, IsBoolean, IsNumber, MaxLength, IsArray, ArrayMinSize, IsIn, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { TaskStatus, PerformerType } from "../../../shared/entities/Enums";

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

    @IsString()
    @IsOptional()
    description?: string;

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

    @IsBoolean()
    @IsOptional()
    isExtra?: boolean;

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

export class UpdateTaskNicknameDTO {
    @IsString()
    @IsOptional()
    @MaxLength(120, { message: "Nickname không được vượt quá 120 ký tự" })
    nickname?: string | null;
}

export class BulkUnassignTasksDTO {
    @IsString()
    @IsNotEmpty({ message: "ID dự án không được để trống" })
    projectId: string;

    @IsArray({ message: "Danh sách công việc không hợp lệ" })
    @ArrayMinSize(1, { message: "Vui lòng chọn ít nhất một công việc" })
    @IsString({ each: true, message: "ID công việc không hợp lệ" })
    taskIds: string[];
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

export class RequestTaskStaffingDTO {
    @IsString()
    @IsOptional()
    @MaxLength(1000, { message: "Ghi chú không được vượt quá 1.000 ký tự" })
    note?: string;
}

export class RespondTaskStaffingDTO {
    @IsIn(["RESOLVE", "REJECT"])
    action: "RESOLVE" | "REJECT";
}

export class CreateSubtaskDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên subtask không được để trống" })
    @MaxLength(255, { message: "Tên subtask không được vượt quá 255 ký tự" })
    name: string;

    @IsString()
    @IsNotEmpty({ message: "Vui lòng chọn người thực hiện" })
    assigneeId: string;

    @IsNumber({ maxDecimalPlaces: 2 }, { message: "% phân bổ không hợp lệ" })
    @Min(0.01, { message: "% phân bổ phải lớn hơn 0" })
    @Max(100, { message: "% phân bổ không được vượt quá 100" })
    allocationPercent: number;

    @IsString()
    @IsOptional()
    description?: string;
}

export class RespondSubtaskPlanDTO {
    @IsIn(["APPROVE", "REJECT"])
    action: "APPROVE" | "REJECT";

    @IsString()
    @IsOptional()
    @MaxLength(1000, { message: "Ghi chú không được vượt quá 1.000 ký tự" })
    note?: string;
}
