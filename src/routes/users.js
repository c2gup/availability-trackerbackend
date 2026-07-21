import { Router } from "express";
import { getProfile, updateProfile } from "../controllers/userController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

export const userRoutes = Router();

userRoutes.use(authenticate);
userRoutes.use(requireRole("USER"));

userRoutes.get("/me/profile", getProfile);
userRoutes.put("/me/profile", updateProfile);
