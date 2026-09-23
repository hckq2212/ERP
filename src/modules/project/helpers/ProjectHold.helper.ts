import { Repository, EntityManager, In } from "typeorm";
import { Projects, ProjectStatus } from "../entities/Project.entity";

const ON_HOLD_MESSAGE =
    "Dự án đang tạm dừng. Vui lòng bấm \"Làm tiếp\" hoặc \"Đóng dự án\" trước khi thay đổi công việc.";

const buildHoldError = (projectNames?: string[]) => {
    const error: any = new Error(
        projectNames && projectNames.length > 0
            ? `${ON_HOLD_MESSAGE} (Dự án: ${projectNames.join(", ")})`
            : ON_HOLD_MESSAGE
    );
    error.statusCode = 409;
    return error;
};

const resolveProjectRepository = (
    projectRepository?: Repository<Projects>,
    manager?: EntityManager
): Repository<Projects> => {
    if (manager) return manager.getRepository(Projects);
    if (projectRepository) return projectRepository;
    throw new Error("ProjectHold.helper: cần truyền projectRepository hoặc manager");
};

/**
 * Chặn mọi thao tác ghi lên task thuộc dự án đang tạm dừng (ON_HOLD).
 *
 * Bối cảnh: khi dự án tạm dừng, task DỞ DANG được chuyển sang `TaskStatus.ON_HOLD`.
 * (Task thuộc 3 trạng thái cuối `COMPLETED`/`INTERNAL_COMPLETED`/`ACCEPTED` được
 * miễn trừ, giữ nguyên status.) Nhưng chỉ đổi status là KHÔNG đủ để khoá — không có
 * ràng buộc DB nào ngăn service sửa task. Nếu thiếu guard, task sẽ tự nhảy khỏi
 * ON_HOLD ngay khi có người thao tác (nộp kết quả, phân công lại, xoá...).
 *
 * Guard này phải được gọi ở ĐẦU mỗi service method có ghi dữ liệu task.
 * KHÔNG gọi ở: endpoint resume / close (đó là 2 lối thoát), và mọi thao tác chỉ đọc.
 *
 * ⚠️ CHỈ chặn khi `status === ON_HOLD`. KHÔNG chặn ở `PENDING_PAUSE_APPROVAL` —
 * vì theo luồng, giai đoạn đó dự án VẪN CHẠY BÌNH THƯỜNG (task chưa đổi gì,
 * đồng hồ 37 ngày chưa chạy), chỉ là "có đơn xin tạm dừng đang chờ duyệt".
 */
export const assertProjectNotOnHold = async (
    projectRepository: Repository<Projects> | undefined,
    projectIds: (string | null | undefined)[],
    manager?: EntityManager
): Promise<void> => {
    const uniqueIds = [...new Set(projectIds.filter(Boolean) as string[])];
    // Task nội bộ (không thuộc dự án) luôn được phép thao tác.
    if (uniqueIds.length === 0) return;

    const repo = resolveProjectRepository(projectRepository, manager);

    // `select` chỉ lấy id + name để nhẹ query. An toàn vì `status` nằm trong WHERE
    // (TypeORM vẫn lọc đúng dù cột đó không có trong SELECT).
    const onHoldProjects = await repo.find({
        where: { id: In(uniqueIds), status: ProjectStatus.ON_HOLD },
        select: { id: true, name: true }
    });

    if (onHoldProjects.length > 0) {
        throw buildHoldError(onHoldProjects.map(project => project.name));
    }
};

/**
 * Kiểm tra 1 task đã load sẵn (có quan hệ `project`) có thuộc dự án đang tạm dừng không.
 * Dùng cho các service đã có sẵn `task.project` trong tay, tránh query thêm project.
 */
export const assertTaskProjectNotOnHold = (
    task: { project?: Pick<Projects, "id" | "name" | "status"> | null } | null | undefined
): void => {
    if (!task?.project) return;
    if (task.project.status === ProjectStatus.ON_HOLD) {
        throw buildHoldError([task.project.name]);
    }
};
