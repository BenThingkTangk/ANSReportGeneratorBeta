import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { parseANSFile } from "./ansParser";
import { generateANSReport } from "./ansAlgorithm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Upload and parse .ans file
  app.post("/api/upload", upload.single("ansFile"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded" });
      }

      const buffer = req.file.buffer;
      
      // Parse the .ans binary file
      const patientData = parseANSFile(buffer);
      
      // Generate the full ANS report using the algorithm
      const report = generateANSReport(patientData);

      res.json({
        success: true,
        patientData,
        report,
      });
    } catch (error: any) {
      console.error("Error processing file:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to process ANS file",
      });
    }
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "1.0.0" });
  });

  return httpServer;
}
