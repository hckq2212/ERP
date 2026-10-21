import { Router } from "express";
import { VendorController } from "../controllers/Vendor.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import multer from "multer";

const router = Router();
const vendorController = new VendorController();

router.get("/", vendorController.getAll);
router.get("/by-job/:jobId", vendorController.getByJob);
router.get("/:id", vendorController.getOne);
router.post("/", roleMiddleware(["ADMIN", "BOD"]), vendorController.create);
router.patch("/:id", roleMiddleware(["ADMIN", "BOD"]), vendorController.update);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), vendorController.delete);

// Vendor Jobs
router.get("/:id/jobs", vendorController.getJobs);
router.post("/:id/jobs/:jobId", roleMiddleware(["ADMIN", "BOD"]), vendorController.addJob);
router.patch("/:id/jobs/:jobId", roleMiddleware(["ADMIN", "BOD"]), vendorController.addJob);
router.delete("/:id/jobs/:jobId", roleMiddleware(["ADMIN", "BOD"]), vendorController.removeJob);

export default router;
