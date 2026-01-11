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
          const json = JSON.parse(body || "{}");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject({
              statusCode: res.statusCode,
              message: json.message || `GitHub API error: ${res.statusCode}`,
              errors: json.errors,
            });
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

function generateScheduleId() {
  return "jadwal_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
}

function validateSchedule(schedule) {
  const errors = [];

  // Class validation
  if (!schedule.class || !["XI A", "XI B"].includes(schedule.class)) {
    errors.push("Kelas harus diisi dan harus 'XI A' atau 'XI B'");
  }

  // Day validation
  const validDays = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];
  if (!schedule.day || !validDays.includes(schedule.day)) {
    errors.push("Hari harus diisi dan harus Senin, Selasa, Rabu, Kamis, atau Jumat");
  }

  // Subject validation
  if (!schedule.subject || schedule.subject.trim() === "") {
    errors.push("Mata pelajaran wajib diisi");
  }

  // Teacher validation
  if (typeof schedule.teacher === "undefined") {
    errors.push("Kolom guru wajib ada");
  } else if (typeof schedule.teacher !== "string") {
    errors.push("Guru harus berupa string");
  }

  // Icon validation - PROFESSIONAL ICONS ONLY
  const validIcons = [
    "fa-book", "fa-calculator", "fa-flask", "fa-atom", "fa-dna",
    "fa-globe-asia", "fa-scroll", "fa-language", "fa-running",
    "fa-music", "fa-palette", "fa-laptop-code", "fa-scale-balanced",
    "fa-landmark", "fa-chart-line", "fa-microscope", "fa-pencil-alt",
    "fa-graduation-cap", "fa-clock", "fa-calendar", "fa-user-tie",
    "fa-chalkboard-teacher", "fa-brain", "fa-book-open", "fa-flask",
    "fa-code", "fa-history", "fa-music", "fa-paint-brush", "fa-dumbbell",
    "fa-heartbeat", "fa-pray", "fa-comments", "fa-globe", "fa-map",
    "fa-balance-scale", "fa-economy", "fa-chart-bar", "fa-file-alt",
    "fa-sitemap", "fa-network-wired", "fa-cogs"
  ];
  
  if (!schedule.icon || !validIcons.includes(schedule.icon)) {
    errors.push("Ikon mata pelajaran tidak valid. Gunakan ikon profesional.");
  }

  // Time validation
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  
  if (!schedule.startTime || !timeRegex.test(schedule.startTime)) {
    errors.push("Waktu mulai harus diisi dengan format HH:mm (24 jam)");
  }

  if (!schedule.endTime || !timeRegex.test(schedule.endTime)) {
    errors.push("Waktu selesai harus diisi dengan format HH:mm (24 jam)");
  }

  // Time comparison
  if (schedule.startTime && schedule.endTime) {
    const start = new Date(`2000-01-01T${schedule.startTime}:00`);
    const end = new Date(`2000-01-01T${schedule.endTime}:00`);
    
    if (end <= start) {
      errors.push("Waktu selesai harus setelah waktu mulai");
    }
  }

  // Type validation
  const validTypes = ["subject", "break", "prayer"];
  if (!schedule.type || !validTypes.includes(schedule.type)) {
    errors.push("Tipe jadwal harus diisi (subject, break, atau prayer)");
  }

  return errors;
}

module.exports = async (req, res) => {
  // Handle CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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
      
      // Sort schedules by day and time
      if (schedules && schedules.length > 0) {
        const dayOrder = { "Senin": 1, "Selasa": 2, "Rabu": 3, "Kamis": 4, "Jumat": 5 };
        
        schedules.sort((a, b) => {
          if (dayOrder[a.day] !== dayOrder[b.day]) {
            return dayOrder[a.day] - dayOrder[b.day];
          }
          
          // Convert time to minutes for comparison
          const timeToMinutes = (timeStr) => {
            const [hours, minutes] = timeStr.split(":").map(Number);
            return hours * 60 + minutes;
          };
          
          return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        });
      }
      
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

    // POST: Add new schedule
    if (req.method === "POST") {
      const newSchedule = req.body;

      // Set default type jika tidak ada
      if (!newSchedule.type) newSchedule.type = "subject";
      
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
      const updatedSchedule = req.body;

      // Validasi
      if (!updatedSchedule.id) {
        return res.status(400).json({ error: "ID jadwal wajib diisi" });
      }

      // Set default type jika tidak ada
      if (!updatedSchedule.type) updatedSchedule.type = "subject";
      
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