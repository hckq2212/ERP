import { Router } from "express";
import { ContractAddendumController } from "../controllers/ContractAddendum.Controller";
import multer from "multer";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const DANGEROUS_EXTENSIONS = /\.(exe|bat|cmd|sh|php|js|mjs|cjs|vbs|msi|bin|scr|jar|apk|com|pif|reg|dll|sys|html|htm)$/i;

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB cho tệp phụ lục hợp đồng
        files: 1
    },
    fileFilter: (_req, file, cb) => {
        if (DANGEROUS_EXTENSIONS.test(file.originalname || "")) {
            return cb(new Error("Định dạng tệp thực thi hoặc mã độc bị cấm tải lên"));
        }
        cb(null, true);
    }
});

const router = Router();
const controller = new ContractAddendumController();

const addendumAuthorRoles = roleMiddleware(["ADMIN", "BOD", "ADMIN_SALE", "BD"]);

router.post("/", addendumAuthorRoles, controller.create);
router.post("/:id/items", addendumAuthorRoles, controller.addItems);
router.post("/:id/upload-signed", addendumAuthorRoles, controller.uploadSigned);
router.post("/:id/scale-down", addendumAuthorRoles, controller.scaleDown);
router.post("/:id/sale-approve", roleMiddleware(["BD", "ADMIN"]), controller.saleApprove);
router.post("/:id/sale-reject", roleMiddleware(["BD", "ADMIN"]), controller.saleReject);
router.post("/:id/resubmit", addendumAuthorRoles, controller.resubmit);
router.post("/:id/bod-approve", roleMiddleware(["BOD", "ADMIN"]), controller.bodApprove);
router.post("/:id/bod-reject", roleMiddleware(["BOD", "ADMIN"]), controller.bodReject);

export default router;
