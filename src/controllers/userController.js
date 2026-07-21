import { prisma } from "../lib/prisma.js";

export async function getProfile(req, res, next) {
  try {
    const userId = req.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        timezone: true,
        tags: true,
        description: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (e) {
    next(e);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const userId = req.userId;
    const { description, tags } = req.body;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        description: description !== undefined ? description : undefined,
        tags: Array.isArray(tags) ? tags : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        timezone: true,
        tags: true,
        description: true,
      },
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
}
