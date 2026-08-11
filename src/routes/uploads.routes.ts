import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { HttpError } from "../lib/http-error";
import { publicImageUrl } from "../lib/public-image-url";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const uploadsRouter = Router();
const categoriesDirectory = path.resolve("uploads", "categories");
const subcategoriesDirectory = path.resolve("uploads", "subcategories");
const brandsDirectory = path.resolve("uploads", "brands");
const employeesDirectory = path.resolve("uploads", "employees");
const productsDirectory = path.resolve("uploads", "products");
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    fs.mkdirSync(categoriesDirectory, { recursive: true });
    callback(null, categoriesDirectory);
  },
  filename: (_req, file, callback) => {
    // A generated name prevents a new upload from overwriting an existing image.
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

export const uploadCategoryImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(new HttpError(400, "Only JPEG, PNG, WebP, and GIF images are allowed"));
    callback(null, true);
  },
});

export const uploadSubcategoryImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(subcategoriesDirectory, { recursive: true });
      callback(null, subcategoriesDirectory);
    },
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(new HttpError(400, "Only JPEG, PNG, WebP, and GIF images are allowed"));
    callback(null, true);
  },
});

export const uploadBrandImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(brandsDirectory, { recursive: true });
      callback(null, brandsDirectory);
    },
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(new HttpError(400, "Only JPEG, PNG, WebP, and GIF images are allowed"));
    callback(null, true);
  },
});

export const uploadEmployeeImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(employeesDirectory, { recursive: true });
      callback(null, employeesDirectory);
    },
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(new HttpError(400, "Only JPEG, PNG, WebP, and GIF images are allowed"));
    callback(null, true);
  },
});

export const uploadProductImages = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(productsDirectory, { recursive: true });
      callback(null, productsDirectory);
    },
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(new HttpError(400, "Only JPEG, PNG, WebP, and GIF images are allowed"));
    callback(null, true);
  },
});

// Upload first, then send the returned filename as "image" when creating a category.
uploadsRouter.post("/categories", requireAuth, requireAdmin, uploadCategoryImage.single("image"), (req, res, next) => {
  if (!req.file) return next(new HttpError(400, "Send an image file in the 'image' field"));
  res.status(201).json({
    success: true,
    data: {
      filename: req.file.filename,
      url: publicImageUrl(req, "category", req.file.filename),
    },
  });
});

uploadsRouter.post("/subcategories", requireAuth, requireAdmin, uploadSubcategoryImage.single("image"), (req, res, next) => {
  if (!req.file) return next(new HttpError(400, "Send an image file in the 'image' field"));
  res.status(201).json({ success: true, data: { filename: req.file.filename, url: publicImageUrl(req, "subcategory", req.file.filename) } });
});

uploadsRouter.post("/brands", requireAuth, requireAdmin, uploadBrandImage.single("image"), (req, res, next) => {
  if (!req.file) return next(new HttpError(400, "Send an image file in the 'image' field"));
  res.status(201).json({ success: true, data: { filename: req.file.filename, url: publicImageUrl(req, "brand", req.file.filename) } });
});

uploadsRouter.post("/employees", requireAuth, requireAdmin, uploadEmployeeImage.single("image"), (req, res, next) => {
  if (!req.file) return next(new HttpError(400, "Send an image file in the 'image' field"));
  res.status(201).json({ success: true, data: { filename: req.file.filename, url: publicImageUrl(req, "employee", req.file.filename) } });
});

uploadsRouter.post("/products", requireAuth, requireAdmin, uploadProductImages.fields([{ name: "thumbnailImages", maxCount: 5 }, { name: "additionalImages", maxCount: 5 }]), (req, res) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const toImage = (file: Express.Multer.File) => ({ filename: file.filename, url: publicImageUrl(req, "product", file.filename) });
  res.status(201).json({
    success: true,
    data: {
      thumbnailImages: (files?.thumbnailImages ?? []).map(toImage),
      additionalImages: (files?.additionalImages ?? []).map(toImage),
    },
  });
});
