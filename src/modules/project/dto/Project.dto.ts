import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString } from "class-validator";
import { ProjectStatus } from "../entities/Project.entity";

export class CreateProjectDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên dự án không được để trống" })
    name: string;

    @IsString()
    @IsNotEmpty({ message: "ID hợp đồng không được để trống" })
    contractId: string;

    @IsString()
    @IsNotEmpty({ message: "ID team không được để trống" })
    teamId: string;

    @IsDateString()
    @IsOptional()
    plannedStartDate?: string;

    @IsDateString()
    @IsOptional()
    plannedEndDate?: string;
}

export class UpdateProjectDTO {
    @IsString()
    @IsOptional()
    name?: string;

    @IsEnum(ProjectStatus)
    @IsOptional()
    status?: ProjectStatus;

    @IsDateString()
    @IsOptional()
    plannedStartDate?: string;

    @IsDateString()
    @IsOptional()
    plannedEndDate?: string;

    @IsDateString()
    @IsOptional()
    actualStartDate?: string;

    @IsDateString()
    @IsOptional()
    actualEndDate?: string;
}

export class AssignTeamDTO {
    @IsString()
    @IsNotEmpty({ message: "ID hợp đồng không được để trống" })
    contractId: string;

    @IsString()
    @IsNotEmpty({ message: "ID PM không được để trống" })
    pmId: string;

    @IsString()
    @IsOptional()
    name?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// TẠM DỪNG / ĐÓNG DỰ ÁN
// ─────────────────────────────────────────────────────────────────────────

export class PauseProjectDTO {
    @IsString()
    @IsNotEmpty({ message: "Vui lòng nhập lý do tạm dừng dự án" })
    reason: string;
}

export class RejectPauseDTO {
    @IsString()
    @IsNotEmpty({ message: "Vui lòng nhập lý do từ chối" })
    feedback: string;
}

export class ResumeProjectDTO {
    @IsString()
    @IsOptional()
    resumeReason?: string;
}

export class CloseProjectDTO {
    @IsString()
    @IsOptional()
    reason?: string;
}

/** BD đóng trực tiếp — LÝ DO BẮT BUỘC (không qua duyệt thì lý do là căn cứ duy nhất). */
export class CloseProjectDirectDTO {
    @IsString()
    @IsNotEmpty({ message: "Vui lòng nhập lý do đóng dự án" })
    reason: string;
}

export class RejectCloseDTO {
    @IsString()
    @IsNotEmpty({ message: "Vui lòng nhập lý do từ chối" })
    feedback: string;
}

/**
 * Đổi trạng thái dự án — CHỈ cho các trạng thái "an toàn".
 *
 * ⚠️ Các trạng thái `ON_HOLD` / `PENDING_PAUSE_APPROVAL` / `COMPLETED` / `CANCELLED`
 * BỊ CHẶN qua route này, vì phải đi qua endpoint chuyên dụng để không bỏ qua
 * việc chuyển trạng thái task + chốt Vinicoin + khóa công nợ.
 */
export class UpdateProjectStatusDTO {
    @IsString()
    @IsNotEmpty({ message: "Trạng thái không được để trống" })
    status: string;
}
