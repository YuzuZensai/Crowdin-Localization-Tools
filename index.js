require("dotenv").config();
const { google } = require("googleapis");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

console.log("Starting VRChat Localization Tool...");

const auth = new google.auth.GoogleAuth({
  credentials: {
    private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

console.log("Google Sheets API configured successfully");

const sheets = google.sheets({ version: "v4", auth });

const dataFolder = path.join(__dirname, "data");
if (!fs.existsSync(dataFolder)) {
  fs.mkdirSync(dataFolder, { recursive: true });
}

async function getGitHash() {
  return new Promise((resolve, reject) => {
    exec("git rev-parse --short HEAD", (error, stdout, stderr) => {
      if (error) {
        console.error("❌ Error getting git hash:", error);
        reject(error);
        return;
      }
      resolve("#" + stdout.trim());
    });
  });
}

async function updateAPIMetadata() {
  console.log("Updating API Metadata...");
  try {
    const date = new Date();

    const offsetedTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const currentDate = offsetedTime
      .toLocaleString("en-US", {
        timeZone: "Etc/GMT-7",
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      .replace(",", "");
    console.log(`Current timestamp: ${currentDate}`);

    sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "API Metadata!B2",
      valueInputOption: "RAW",
      resource: {
        values: [[currentDate]],
      },
    });

    let hash;
    try {
      hash = await getGitHash();
    } catch (error) {
      hash = "Unknown";
    }
    sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "API Metadata!C2",
      valueInputOption: "RAW",
      resource: { values: [[hash]] },
    });

    console.log("✅ API Metadata updated successfully");
  } catch (error) {
    console.error("❌ Error updating API Metadata:", error.message);
    if (error.stack) console.error(error.stack);
  }
}

async function getVRChatLocalizationData() {
  console.log("Starting to fetch VRChat localization data...");
  try {
    console.log("Fetching data from Google Sheets...");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "A1:E1000",
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.error("❌ No data found in the spreadsheet");
      return;
    }

    const headers = rows[0];
    console.log(`📊 Found ${rows.length - 1} total rows of data`);

    const csvWriter = createCsvWriter({
      path: "./data/data.csv",
      header: [
        { id: "english", title: headers[0] || "Source" },
        { id: "thai", title: headers[1] || "Target" },
        { id: "note", title: headers[2] || "Note" },
        { id: "category", title: headers[3] || "Category" },
      ],
    });

    const data = rows.slice(1).map((row) => ({
      english: row[0] || "",
      thai: row[1] || "",
      note: row[2] || "",
      category: row[3] || "",
    }));

    console.log("Writing data to CSV file...");
    await csvWriter.writeRecords(data);
    console.log(
      `✅ CSV file has been created successfully with ${data.length} translations`
    );

    console.log("Proceeding to update API metadata...");
    return updateAPIMetadata();
  } catch (error) {
    console.error("❌ Error accessing spreadsheet:", error.message);
    if (error.stack) console.error(error.stack);
    throw error;
  }
}

console.log("🚀 Initializing VRChat Localization process...");
getVRChatLocalizationData()
  .then(() => {
    console.log("✨ Process completed!");
  })
  .catch((error) => {
    console.error("❌ Process failed:", error);
  });
