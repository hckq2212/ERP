import { Router } from "express";
import multer from "multer";
import { DocumentLibraryController } from "../controllers/DocumentLibrary.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { UpdateDocumentDTO } from "../dto/DocumentLibrary.dto";

const router = Router();
const documentLibraryController = new DocumentLibraryController();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const MANAGE_ROLES = ["BOD", "ADMIN", "ADMIN_SALE"];

router.get("/", documentLibraryController.findDocuments);
router.get("/tags", documentLibraryController.getAllTags);
router.get("/:id", documentLibraryController.getOne);
router.get("/:id/download", documentLibraryController.download);
router.get("/:id/versions", documentLibraryController.getVersions);
router.get("/:id/versions/:versionId/download", documentLibraryController.downloadVersion);
router.post("/upload", roleMiddleware(MANAGE_ROLES), upload.single("file"), documentLibraryController.upload);
router.post("/:id/versions", roleMiddleware(MANAGE_ROLES), upload.single("file"), documentLibraryController.uploadNewVersion);
router.post("/:id/versions/:versionId/restore", roleMiddleware(MANAGE_ROLES), documentLibraryController.restoreVersion);
router.put("/:id", roleMiddleware(MANAGE_ROLES), validationMiddleware(UpdateDocumentDTO), documentLibraryController.update);
router.delete("/:id", roleMiddleware(MANAGE_ROLES), documentLibraryController.delete);

export default router;
