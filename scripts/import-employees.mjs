import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").trim();
    }
  }
}

function normalizeBangladeshPhone(input) {
  const digits = String(input || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("880") && digits.length >= 13) return `+${digits.slice(0, 13)}`;
  if (digits.startsWith("0") && digits.length >= 11) return `+88${digits.slice(0, 11)}`;
  if (digits.startsWith("1") && digits.length === 10) return `+880${digits}`;
  return `+${digits}`;
}

function legacyLocalPhone(input) {
  const digits = String(input || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("880") && digits.length >= 13) return `0${digits.slice(3, 13)}`;
  if (digits.startsWith("1") && digits.length === 10) return `0${digits}`;
  return digits;
}

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  out.push(value);
  return out.map((item) => item.trim());
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const [headerLine, ...dataLines] = lines;
  const headers = parseCsvLine(headerLine);

  return dataLines.map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function isMissingColumnError(error) {
  const text = String(error?.message || "").toLowerCase();
  return text.includes("could not find") || text.includes("schema cache") || text.includes("column");
}

async function detectSchemaMode(supabase) {
  const modern = await supabase.from("employees").select("aliases").limit(1);
  if (!modern.error) return "modern";
  if (!isMissingColumnError(modern.error)) {
    throw new Error(`Unable to detect employees schema: ${modern.error.message}`);
  }
  return "legacy";
}

async function detectTagSupport(supabase) {
  const check = await supabase.from("employee_tags").select("employee_id").limit(1);
  if (!check.error) return true;
  if (isMissingColumnError(check.error) || String(check.error?.message || "").toLowerCase().includes("relation")) {
    return false;
  }
  return false;
}

async function upsertEmployeeModern(supabase, row, fullName, rawNumber, normalized) {
  const payload = {
    full_name: fullName,
    designation: row.designation || null,
    department: row.department || null,
    branch: row.branch || null,
    whatsapp_number_raw: rawNumber,
    whatsapp_e164: normalized,
    tracking_enabled: String(row.tracking_enabled).toLowerCase() === "true",
    is_active: String(row.is_active).toLowerCase() !== "false",
    status: row.status || "Active",
    aliases: String(row.aliases || "")
      .split(/[|,]/)
      .map((item) => item.trim())
      .filter(Boolean),
    notes: row.notes || null,
  };

  return supabase
    .from("employees")
    .upsert(payload, { onConflict: "whatsapp_e164" })
    .select("id")
    .single();
}

async function upsertEmployeeLegacy(supabase, row, fullName, rawNumber, normalized) {
  const localPhone = legacyLocalPhone(rawNumber) || legacyLocalPhone(normalized);

  const payload = {
    full_name: fullName,
    designation: row.designation || null,
    department: row.department || null,
    branch: row.branch || null,
    whatsapp_number: localPhone,
    is_active_for_tracking: String(row.tracking_enabled).toLowerCase() === "true",
    status: String(row.is_active).toLowerCase() === "false" ? "Inactive" : row.status || "Active",
  };

  return supabase
    .from("employees")
    .upsert(payload, { onConflict: "whatsapp_number" })
    .select("id")
    .single();
}

async function assignTagsIfSupported(supabase, employeeId, row, enableTagTables) {
  if (!enableTagTables) return;

  const tags = String(row.tags || "")
    .split(/[|,]/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  if (!tags.length) return;

  await supabase.from("employee_tags").delete().eq("employee_id", employeeId);

  const rowsToInsert = tags.map((tagKey) => ({
    employee_id: employeeId,
    tag_key: tagKey,
  }));

  const tagInsert = await supabase.from("employee_tags").insert(rowsToInsert);
  if (tagInsert.error) {
    console.error("Tag assign failed", employeeId, tagInsert.error.message);
  }
}

async function main() {
  parseEnv(path.resolve(".env.local"));
  parseEnv(path.resolve(".env"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const csvPath = process.argv[2] || "supabase/seed/employees.sample.csv";
  const csv = fs.readFileSync(path.resolve(csvPath), "utf8");
  const rows = parseCsv(csv);

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const schemaMode = await detectSchemaMode(supabase);
  const tagSupport = await detectTagSupport(supabase);

  console.log(`Detected employees schema mode: ${schemaMode}`);
  console.log(`Detected tag table support: ${tagSupport ? "yes" : "no"}`);

  let imported = 0;

  for (const row of rows) {
    const fullName = String(row.full_name || "").trim();
    const rawNumber = String(row.whatsapp_number || "").trim();
    const normalized = normalizeBangladeshPhone(rawNumber);

    if (!fullName || !normalized) continue;

    const upsert = schemaMode === "modern"
      ? await upsertEmployeeModern(supabase, row, fullName, rawNumber, normalized)
      : await upsertEmployeeLegacy(supabase, row, fullName, rawNumber, normalized);

    if (upsert.error || !upsert.data?.id) {
      console.error("Failed to import", fullName, upsert.error?.message);
      continue;
    }

    await assignTagsIfSupported(supabase, upsert.data.id, row, tagSupport);
    imported += 1;
  }

  console.log(`Imported/updated employees: ${imported}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
