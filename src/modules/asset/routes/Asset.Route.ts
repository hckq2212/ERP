import { Router } from "express";
import multer from "multer";
import { AssetController } from "../controllers/Asset.Controller";

const router = Router();
const assetController = new AssetController();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/assets?tab=creative|upload&type=all|image|video|audio&favorite=true
router.get("/", assetController.findLibrary);
router.get("/:id", assetController.getOne);
router.post("/upload", upload.single("file"), assetController.upload);
router.patch("/:id/favorite", assetController.toggleFavorite);

export default router;