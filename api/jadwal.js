const https = require("https");

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = "klandestin-s/api-school.man3";
const FILEPATH = "jadwal.json";
const BRANCH = "main";

function githubRequest(path, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path,
      method,
      headers: {
        "User-Agent": "Vercel-App",
        Authorization: `token ${TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          // Terima response text jika bukan JSON
          if (res.headers["content-type"].includes("application/json")) {
            resolve(JSON.parse(body || "{}"));
          } else {
            resolve(body);
          }
        } catch (e) {
          reject({
            statusCode: 500,
            message: "JSON parse error",
            details: e.message,
          });
        }
      });
    });

    req.on("error", (error) => {
      reject({
        statusCode: 500,
        message: "Network error",
        details: error.message,
      });
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function getCurrentSchedules() {
  try {
    const fileData = await githubRequest(`/repos/${REPO}/contents/${FILEPATH}?ref=${BRANCH}`);

    if (typeof fileData === "string") {
      return { schedules: [], sha: null };
    }

    if (!fileData.content) return { schedules: [], sha: null };

    const content = Buffer.from(fileData.content, "base64").toString("utf8");
    return {
      schedules: JSON.parse(content),
      sha: fileData.sha,
    };
  } catch (error) {
    if (error.statusCode === 404) return { schedules: [], sha: null };
    throw error;
  }
}

// ... (bagian lainnya tetap sama)

module.exports = async (req, res) => {
  // Handle CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!TOKEN) {
    return res.status(500).json({
      error: "Missing GitHub token. Set GITHUB_TOKEN environment variable.",
    });
  }

  try {
    // GET: Return schedule list
    if (req.method === "GET") {
      const { schedules } = await getCurrentSchedules();
      return res.status(200).json(schedules || []);
    }

    // Helper function for updating GitHub file
    const updateGitHubFile = async (schedules, message, sha) => {
      const updatePayload = {
        message,
        content: Buffer.from(JSON.stringify(schedules, null, 2)).toString("base64"),
        branch: BRANCH,
      };

      if (sha) updatePayload.sha = sha;

      return githubRequest(`/repos/${REPO}/contents/${FILEPATH}`, "PUT", updatePayload);
    };

    // Pastikan body request adalah JSON
    let requestBody;
    try {
      if (req.method === "POST" || req.method === "PUT") {
        requestBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      }
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON format" });
    }

    // POST: Add new schedule
    if (req.method === "POST") {
      const newSchedule = requestBody;

      // Validasi
      const errors = validateSchedule(newSchedule);
      if (errors.length > 0) {
        return res.status(400).json({
          error: errors.join(", "),
        });
      }

      // Generate unique ID
      newSchedule.id = generateScheduleId();

      // Get current schedules
      const { schedules, sha } = await getCurrentSchedules();
      const updatedSchedules = [...schedules, newSchedule];

      // Update file on GitHub
      await updateGitHubFile(updatedSchedules, `Tambah jadwal: ${newSchedule.subject} untuk ${newSchedule.class}`, sha);

      return res.status(201).json({
        success: true,
        message: "Jadwal berhasil ditambahkan",
        schedule: newSchedule,
      });
    }

    // PUT: Update existing schedule
    if (req.method === "PUT") {
      const updatedSchedule = requestBody;

      // Validasi
      if (!updatedSchedule.id) {
        return res.status(400).json({ error: "ID jadwal wajib diisi" });
      }

      const errors = validateSchedule(updatedSchedule);
      if (errors.length > 0) {
        return res.status(400).json({
          error: errors.join(", "),
        });
      }

      // Get current schedules
      const { schedules, sha } = await getCurrentSchedules();

      // Find schedule index
      const scheduleIndex = schedules.findIndex((s) => s.id === updatedSchedule.id);
      if (scheduleIndex === -1) {
        return res.status(404).json({ error: "Jadwal tidak ditemukan" });
      }

      // Update schedule
      schedules[scheduleIndex] = updatedSchedule;

      // Update file on GitHub
      await updateGitHubFile(schedules, `Update jadwal: ${updatedSchedule.subject} untuk ${updatedSchedule.class}`, sha);

      return res.status(200).json({
        success: true,
        message: "Jadwal berhasil diperbarui",
        schedule: updatedSchedule,
      });
    }

    // DELETE: Delete schedule
    if (req.method === "DELETE") {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: "ID jadwal wajib diisi" });
      }

      // Get current schedules
      const { schedules, sha } = await getCurrentSchedules();

      // Find schedule index
      const scheduleIndex = schedules.findIndex((s) => s.id === id);
      if (scheduleIndex === -1) {
        return res.status(404).json({ error: "Jadwal tidak ditemukan" });
      }

      // Remove schedule
      const [deletedSchedule] = schedules.splice(scheduleIndex, 1);

      // Update file on GitHub
      await updateGitHubFile(schedules, `Hapus jadwal: ${deletedSchedule.subject} untuk ${deletedSchedule.class}`, sha);

      return res.status(200).json({
        success: true,
        message: "Jadwal berhasil dihapus",
        schedule: deletedSchedule,
      });
    }

    return res.status(405).json({
      error: "Method not allowed. Supported methods: GET, POST, PUT, DELETE",
    });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Internal server error",
      details: error.details || error.errors || "No additional details",
    });
  }
};
