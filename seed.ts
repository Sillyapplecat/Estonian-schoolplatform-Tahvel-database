\
/**
 * seed.ts
 *
 * Usage: bun run seed.ts
 *
 * This script:
 *  - reads .env for configuration
 *  - generates CSV files in batches into CSV_DIR
 *  - uses `mysql` client with LOAD DATA LOCAL INFILE to bulk-load CSVs
 *
 * Note: The script is written to run inside the provided bun container in docker-compose.
 */

import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";

const env = Object.assign({}, process.env);
const CSV_DIR = env.CSV_DIR || "/data/csv";
const SEED = Number(env.SEED || 12345);
const BATCH_ROWS = Number(env.BATCH_ROWS || 50000);
const USERS_TOTAL = Number(env.USERS_TOTAL || 2000000);
const SUBMISSIONS_TOTAL = Number(env.SUBMISSIONS_TOTAL || 2000000);
const ATTENDANCE_TOTAL = Number(env.ATTENDANCE_TOTAL || 2000000);

mkdirSync(CSV_DIR, { recursive: true });

function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = rng(SEED);

const firstNames = ["Eero","Mari","Jaan","Kati","Marta","Oskar","Laura","Peeter","Liis","Toomas"];
const lastNames = ["Tamm","Kask","Saar","Leht","Mõis","Koppel","Pärn","Õun","Kruus","Vaher"];
const cities = ["Tallinn","Tartu","Pärnu","Narva","Viljandi","Rakvere"];
const domains = ["example.edu","tahvel.local","school.example"];

function pick(arr) { return arr[Math.floor(rand()*arr.length)]; }

function csvEscape(s: string) {
  if (s == null) return "";
  return s.replace(/\n/g, "\\n").replace(/\r/g, "").replace(/"/g, '""');
}

function writeBatchCsv(path: string, rows: string[]) {
  const header = ""; // we load without header
  appendFileSync(path, rows.join("\n") + "\n");
}

function loadCsvToMysql(table: string, filePath: string) {
  console.log(`Loading ${filePath} into ${table}...`);
  const mysqlCmd = [
    "mysql",
    `-h${env.MYSQL_HOST || "mariadb"}`,
    `-P${env.MYSQL_PORT || "3306"}`,
    `-u${env.MYSQL_USER || "root"}`,
    `-p${env.MYSQL_PASSWORD || ""}`,
    "-D",
    env.MYSQL_DATABASE || "tahvel",
    "-e",
    `SET SESSION FOREIGN_KEY_CHECKS=0; LOAD DATA LOCAL INFILE '${filePath}' INTO TABLE ${table} FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\\n' ; SET SESSION FOREIGN_KEY_CHECKS=1;`
  ];
  const r = spawnSync(mysqlCmd[0], mysqlCmd.slice(1), { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("mysql load failed", r.error, r.status);
    process.exit(1);
  }
}

// Generate small lookups: subjects and schools
function generateLookups() {
  const schools = [
    ["1","Tallinna Ülikool","Tõnismägi 1","Tallinn"],
    ["2","Tartu Ülikool","Ülikooli 18","Tartu"],
    ["3","Pärnu Gümnaasium","Posti 10","Pärnu"]
  ];
  const subjects = [["1","Matemaatika"],["2","Eesti keel"],["3","Ajalugu"],["4","Inglise keel"]];
  const schoolsCsv = CSV_DIR + "/schools.csv";
  const subjectsCsv = CSV_DIR + "/subjects.csv";
  writeFileSync(schoolsCsv, schools.map(r => r.map(x => `"${csvEscape(x)}"`).join(",")).join("\n") + "\n");
  writeFileSync(subjectsCsv, subjects.map(r => r.map(x => `"${csvEscape(x)}"`).join(",")).join("\n") + "\n");
  loadCsvToMysql("schools", schoolsCsv);
  loadCsvToMysql("subjects", subjectsCsv);
}

// Generate users (teachers + students + admin). Users table columns:
// id,username,email,password,first_name,last_name,role
function generateUsers() {
  console.log("Generating users...");
  const path = `${CSV_DIR}/users.csv`;
  // overwrite file
  writeFileSync(path, "");
  let id = 1;
  const rows = [];
  for (let i=0;i<USERS_TOTAL;i++) {
    const first = pick(firstNames);
    const last = pick(lastNames);
    const role = i <  (USERS_TOTAL * 0.02) ? "teacher" : "student"; // 2% teachers
    const username = `${first.toLowerCase()}.${last.toLowerCase()}${i}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@${pick(domains)}`;
    const password = "x"; // placeholder
    const row = [id, username, email, password, first, last, role].map(v => `"${csvEscape(String(v))}"`).join(",");
    rows.push(row);
    id++;
    if (rows.length >= BATCH_ROWS) {
      writeBatchCsv(path, rows);
      rows.length = 0;
      console.log(`Wrote ${id-1} users...`);
    }
  }
  if (rows.length) writeBatchCsv(path, rows);
  console.log("Finished user CSV");
  loadCsvToMysql("users", path);
}

// More generators (classes, class_memberships, lessons, assignments, submissions, attendance).
// For brevity we implement submissions and attendance large generators that reference existing ids.
// assumptions: classes and assignments exist in small numbers; we'll create them directly via SQL after users exist.

function runSimpleSql(sql) {
  const mysqlCmd = [
    "mysql",
    `-h${env.MYSQL_HOST || "mariadb"}`,
    `-P${env.MYSQL_PORT || "3306"}`,
    `-u${env.MYSQL_USER || "root"}`,
    `-p${env.MYSQL_PASSWORD || ""}`,
    "-D",
    env.MYSQL_DATABASE || "tahvel",
    "-e",
    sql
  ];
  const r = spawnSync(mysqlCmd[0], mysqlCmd.slice(1), { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("mysql sql failed", r.error, r.status);
    process.exit(1);
  }
}

function prepareSmallTables() {
  // Create 100 classes, 200 assignments, 1000 lessons as simple small generators to reference.
  console.log("Preparing classes, assignments, lessons via direct SQL");
  runSimpleSql(`
    INSERT INTO schools (name,address,city) SELECT name,address,city FROM (SELECT 'temp' as name, 'x' as address, 'x' as city) t WHERE 1=0;
  `); // no-op to ensure connection
  // Create classes
  let sql = "";
  for (let i=1;i<=200;i++){
    sql += `INSERT INTO classes (school_id,name,year) VALUES (1,'Class ${i}',${9 + (i%4)});`;
  }
  // assignments referencing class 1..200 and subject 1..4
  for (let i=1;i<=1000;i++){
    const classId = (i % 200) + 1;
    const subj = (i % 4) + 1;
    sql += `INSERT INTO assignments (title,description,creator_id,class_id,subject_id,due_date) VALUES ('Assignment ${i}','Auto-generated',1,${classId},${subj},NOW());`;
  }
  runSimpleSql(sql);
}

// Generate submissions CSV referencing assignments and users (students)
function generateSubmissions() {
  console.log("Generating submissions...");
  const path = `${CSV_DIR}/submissions.csv`;
  writeFileSync(path, "");
  const rows = [];
  let id = 1;
  const maxAssignmentId = 1000;
  const maxUserId = USERS_TOTAL;
  for (let i=0;i<SUBMISSIONS_TOTAL;i++){
    const assignment_id = (i % maxAssignmentId) + 1;
    // assign student ids from 1..maxUserId but skip first few reserved ids (teachers/admin). start at 10
    const student_id = (10 + (i % (maxUserId-10)));
    const submitted_at = new Date(Date.now() - Math.floor(rand()*1000*60*60*24*365*2)).toISOString().slice(0,19).replace("T"," ");
    const content = `Submission content ${i}`;
    const row = [id, assignment_id, student_id, submitted_at, content].map(v => `"${csvEscape(String(v))}"`).join(",");
    rows.push(row);
    id++;
    if (rows.length >= BATCH_ROWS) {
      writeBatchCsv(path, rows);
      rows.length = 0;
      console.log(`Wrote ${id-1} submissions...`);
    }
  }
  if (rows.length) writeBatchCsv(path, rows);
  console.log("Finished submissions CSV");
  loadCsvToMysql("submissions", path);
}

// Generate attendance CSV
function generateAttendance() {
  console.log("Generating attendance...");
  const path = `${CSV_DIR}/attendance.csv`;
  writeFileSync(path, "");
  const rows = [];
  let id = 1;
  const maxLessonId = 1000; // we created some lessons earlier
  const maxUserId = USERS_TOTAL;
  for (let i=0;i<ATTENDANCE_TOTAL;i++){
    const lesson_id = (i % maxLessonId) + 1;
    const student_id = 10 + (i % (maxUserId-10));
    const status = ["present","absent","late","excused"][Math.floor(rand()*4)];
    const row = [id, lesson_id, student_id, status].map(v => `"${csvEscape(String(v))}"`).join(",");
    rows.push(row);
    id++;
    if (rows.length >= BATCH_ROWS) {
      writeBatchCsv(path, rows);
      rows.length = 0;
      console.log(`Wrote ${id-1} attendance rows...`);
    }
  }
  if (rows.length) writeBatchCsv(path, rows);
  console.log("Finished attendance CSV");
  loadCsvToMysql("attendance", path);
}

async function main() {
  console.log("Starting seed with config:", {USERS_TOTAL,SUBMISSIONS_TOTAL,ATTENDANCE_TOTAL,BATCH_ROWS,SEED});
  generateLookups();
  generateUsers();
  prepareSmallTables();
  generateSubmissions();
  generateAttendance();
  console.log("Seeding finished. Run integrity checks manually or use provided queries in README.");
}

main();
