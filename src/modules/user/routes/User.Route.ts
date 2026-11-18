import { Router } from "express";
import { UserController } from "../controllers/User.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { CreateUserDTO, UpdateUserDTO } from "../dto/User.dto";
import multer from "multer";

const router = Router();
const userController = new UserController();

const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/webp"
]);

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 3
    },
    fileFilter: (_req, file, cb) => {
        const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
        const allowedExts = new Set(["pdf", "doc", "docx", "jpg", "jpeg", "png", "webp"]);
        if (allowedExts.has(ext) && (ALLOWED_MIME_TYPES.has(file.mimetype) || file.mimetype.startsWith("image/"))) {
            cb(null, true);
        } else {
            cb(new Error("Chỉ chấp nhận tệp hợp đồng lao động dạng PDF, Word (doc, docx) hoặc hình ảnh (jpg, png, webp)"));
        }
    }
});


router.get("/", userController.getAll);
router.get("/:id", userController.getOne);

// Only BOD, ADMIN (and ADMIN_SALE) can manage users (Create, Update, Delete)
router.post("/", roleMiddleware(["BOD", "ADMIN"]), validationMiddleware(CreateUserDTO), userController.create);
router.put("/:id", roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]), upload.array("laborContract", 3), validationMiddleware(UpdateUserDTO), userController.update);
router.patch("/:id", roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]), upload.array("laborContract", 3), validationMiddleware(UpdateUserDTO), userController.update);
router.patch("/:id/labor-contracts", roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]), userController.updateLaborContracts);
router.delete("/:id", roleMiddleware(["BOD", "ADMIN"]), userController.delete);

export default router;
