// seed.ts
// Bun + mysql2 (promise) + @faker-js/faker
// Reprodutseeritav mass-seemnestaja tahvel projektile.
// Usage: bun install && bun run seed.ts
import mysql from "mysql2/promise";
import { faker } from "@faker-js/faker";

// Read env
const {
  DB_HOST = "127.0.0.1",
  DB_PORT = "3306",
  DB_USER = "root",
  DB_PASS = "",
  DB_NAME = "tahvel",
} = process.env;

// Reproducible seed
faker.seed(123456);

// Configuration - result sizes (adjustable)
const TARGET_USERS = 2_000_000; // the required 2M target (users table)
const BATCH_SIZE = 5000;         // rows per multi-insert (tune to your server)
const CONCURRENT_BATCHES = 2;    // concurrency for insert promises

// Other tables' sizes (reasonable, justified in README)
const SUBJECTS_COUNT = 12;
const SCHOOLS_COUNT = 50;
const CLASSES_COUNT = 10000;
const CLASS_MEMBERSHIPS = 1_200_000;
const LESSONS_COUNT = 200_000;
const ASSIGNMENTS_COUNT = 100_000;
const SUBMISSIONS_COUNT = 800_000;

function chunkArray<T>(arr: T[], size: number) {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

async function main() {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: parseInt(DB_PORT),
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    multipleStatements: true,
  });

  console.log("Connected to DB", DB_HOST, DB_PORT, DB_NAME);

  // We'll disable foreign key checks while reorganising indexes and bulk loading
  await conn.query("SET FOREIGN_KEY_CHECKS=0;");

  // STEP 0: Drop UNIQUE indexes that would slow down bulk insert on users
  console.log("Dropping user unique indexes (if exist)...");
  try {
    await conn.query("ALTER TABLE users DROP INDEX ux_users_username;");
  } catch (e) {}
  try {
    await conn.query("ALTER TABLE users DROP INDEX ux_users_email;");
  } catch (e) {}

  // STEP 1: Ensure lookup tables (subjects, schools) exist and filled
  console.log("Seeding lookup tables (subjects, schools)...");
  // Simple upserts for lookup tables (id auto incremented in dump.sql)
  const subjects = [
    "Mathematics","Estonian","English","Physics","Chemistry","Biology",
    "History","Geography","Music","Art","Physical Education","Informatics"
  ].slice(0, SUBJECTS_COUNT);

  await conn.query("TRUNCATE TABLE subjects;");
  for (const s of subjects) {
    await conn.query("INSERT INTO subjects (name) VALUES (?);", [s]);
  }

  await conn.query("TRUNCATE TABLE schools;");
  for (let i = 0; i < SCHOOLS_COUNT; i++) {
    const name = `${faker.company.name()} School`;
    const address = faker.location.streetAddress();
    const city = faker.location.city();
    await conn.query("INSERT INTO schools (name,address,city) VALUES (?,?,?);", [name, address, city]);
  }

  // STEP 2: Bulk-generate users (2M)
  console.log(`Generating ${TARGET_USERS.toLocaleString()} users in batches of ${BATCH_SIZE}...`);
  // We will TRUNCATE users and then insert.
  await conn.query("TRUNCATE TABLE users;");
  // Prepare insertion in batches
  const totalBatches = Math.ceil(TARGET_USERS / BATCH_SIZE);
  for (let b = 0; b < totalBatches; b++) {
    const startIdx = b * BATCH_SIZE;
    const thisBatch = Math.min(BATCH_SIZE, TARGET_USERS - startIdx);
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < thisBatch; i++) {
      const globalIdx = startIdx + i + 1;
      const first = faker.person.firstName();
      const last = faker.person.lastName();
      // deterministic-ish username/email using index
      const username = `${first.toLowerCase()}.${last.toLowerCase()}.${globalIdx}`;
      const email = `${first.toLowerCase()}.${last.toLowerCase()}.${globalIdx}@${faker.internet.domainName()}`;
      const password = faker.internet.password(10); // fake hashed-like string; production not needed
      const role = faker.helpers.arrayElement(["student", "teacher", "parent", "admin"]);
      values.push(username, email, password, first, last, role);
      placeholders.push("(?,?,?,?,?,?)");
    }
    const sql = `INSERT INTO users (username,email,password,first_name,last_name,role) VALUES ${placeholders.join(",")};`;
    await conn.query(sql, values);
    if ((b + 1) % Math.max(1, Math.floor(totalBatches / 20)) === 0) {
      console.log(`  Progress: batch ${b + 1}/${totalBatches} (${Math.round(((b+1)/totalBatches)*100)}%)`);
    }
  }
  console.log("Users generation completed.");

  // STEP 3: recreate unique indexes for users (so uniqueness enforced afterwards)
  console.log("Recreating unique indexes for users...");
  try {
    await conn.query("ALTER TABLE users ADD UNIQUE KEY ux_users_username (username);");
    await conn.query("ALTER TABLE users ADD UNIQUE KEY ux_users_email (email);");
  } catch (e) {
    console.warn("Warning recreating user unique keys:", e.message || e);
  }

  // STEP 4: Populate classes
  console.log(`Generating ${CLASSES_COUNT} classes...`);
  await conn.query("TRUNCATE TABLE classes;");
  for (let i = 0; i < CLASSES_COUNT; i++) {
    const school_id = faker.number.int({ min: 1, max: SCHOOLS_COUNT });
    const name = `Class ${faker.helpers.arrayElement(["A","B","C","D"])}${faker.number.int({min:1,max:12})}`;
    const year = faker.number.int({ min: 1, max: 12 });
    await conn.query("INSERT INTO classes (school_id, name, year) VALUES (?,?,?);", [school_id, name, year]);
  }

  // STEP 5: Class memberships (map many students to classes)
  console.log(`Generating ${CLASS_MEMBERSHIPS.toLocaleString()} class_memberships...`);
  await conn.query("TRUNCATE TABLE class_memberships;");
  const membershipsBatches = Math.ceil(CLASS_MEMBERSHIPS / BATCH_SIZE);
  for (let b = 0; b < membershipsBatches; b++) {
    const startIdx = b * BATCH_SIZE;
    const thisBatch = Math.min(BATCH_SIZE, CLASS_MEMBERSHIPS - startIdx);
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < thisBatch; i++) {
      const class_id = faker.number.int({ min: 1, max: CLASSES_COUNT });
      const user_id = faker.number.int({ min: 1, max: TARGET_USERS });
      const start_date = faker.date.past({ years: 3 }).toISOString().slice(0,10);
      values.push(class_id, user_id, start_date, null);
      placeholders.push("(?,?,?,NULL)");
    }
    const sql = `INSERT INTO class_memberships (class_id,user_id,start_date,end_date) VALUES ${placeholders.join(",")};`;
    await conn.query(sql, values);
  }

  // STEP 6: Lessons
  console.log(`Generating ${LESSONS_COUNT.toLocaleString()} lessons...`);
  await conn.query("TRUNCATE TABLE lessons;");
  const lessonsBatches = Math.ceil(LESSONS_COUNT / BATCH_SIZE);
  for (let b = 0; b < lessonsBatches; b++) {
    const startIdx = b * BATCH_SIZE;
    const thisBatch = Math.min(BATCH_SIZE, LESSONS_COUNT - startIdx);
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < thisBatch; i++) {
      const class_id = faker.number.int({ min: 1, max: CLASSES_COUNT });
      const teacher_id = faker.number.int({ min: 1, max: TARGET_USERS });
      const date = faker.date.past({ years: 2 }).toISOString().slice(0,10);
      const start_time = `${faker.number.int({min:8,max:15})}:00:00`;
      const end_time = `${faker.number.int({min:16,max:19})}:00:00`;
      const topic = faker.lorem.words({ min: 2, max: 6 });
      const subject_id = faker.number.int({ min: 1, max: SUBJECTS_COUNT });
      values.push(class_id, teacher_id, date, start_time, end_time, topic, subject_id);
      placeholders.push("(?,?,?,?,?,?,?)");
    }
    const sql = `INSERT INTO lessons (class_id,teacher_id,date,start_time,end_time,topic,subject_id) VALUES ${placeholders.join(",")};`;
    await conn.query(sql, values);
  }

  // STEP 7: Assignments
  console.log(`Generating ${ASSIGNMENTS_COUNT.toLocaleString()} assignments...`);
  await conn.query("TRUNCATE TABLE assignments;");
  const assignmentsBatches = Math.ceil(ASSIGNMENTS_COUNT / BATCH_SIZE);
  for (let b = 0; b < assignmentsBatches; b++) {
    const startIdx = b * BATCH_SIZE;
    const thisBatch = Math.min(BATCH_SIZE, ASSIGNMENTS_COUNT - startIdx);
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < thisBatch; i++) {
      const title = faker.lorem.sentence({ min: 3, max: 6 });
      const description = faker.lorem.paragraph();
      const creator_id = faker.number.int({ min: 1, max: TARGET_USERS });
      const class_id = faker.number.int({ min: 1, max: CLASSES_COUNT });
      const subject_id = faker.number.int({ min: 1, max: SUBJECTS_COUNT });
      const due_date = faker.date.soon({ days: 120 }).toISOString().slice(0,19).replace('T',' ');
      values.push(title, description, creator_id, class_id, subject_id, due_date);
      placeholders.push("(?,?,?,?,?,?)");
    }
    const sql = `INSERT INTO assignments (title,description,creator_id,class_id,subject_id,due_date) VALUES ${placeholders.join(",")};`;
    await conn.query(sql, values);
  }

  // STEP 8: Submissions (some fraction of students submit)
  console.log(`Generating ${SUBMISSIONS_COUNT.toLocaleString()} submissions...`);
  await conn.query("TRUNCATE TABLE submissions;");
  const submissionsBatches = Math.ceil(SUBMISSIONS_COUNT / BATCH_SIZE);
  for (let b = 0; b < submissionsBatches; b++) {
    const startIdx = b * BATCH_SIZE;
    const thisBatch = Math.min(BATCH_SIZE, SUBMISSIONS_COUNT - startIdx);
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < thisBatch; i++) {
      const assignment_id = faker.number.int({ min: 1, max: ASSIGNMENTS_COUNT });
      const student_id = faker.number.int({ min: 1, max: TARGET_USERS });
      const submitted_at = faker.date.recent({ days: 365 }).toISOString().slice(0,19).replace('T',' ');
      const content = faker.lorem.paragraphs({ min: 1, max: 3 });
      values.push(assignment_id, student_id, submitted_at, content);
      placeholders.push("(?,?,?,?)");
    }
    const sql = `INSERT INTO submissions (assignment_id,student_id,submitted_at,content) VALUES ${placeholders.join(",")};`;
    try {
      await conn.query(sql, values);
    } catch (err: any) {
      // submissions has unique constraint on (assignment_id,student_id) — duplicates may raise errors, ignore duplicates
      const errMsg = (err && err.message) ? err.message : String(err);
      if (errMsg.includes("Duplicate") || errMsg.includes("Integrity constraint violation")) {
        // we will fall back to individual inserts for the problematic batch to skip duplicates
        for (let j = 0; j < thisBatch; j++) {
          const v = values.slice(j*4, j*4+4);
          try { await conn.query("INSERT IGNORE INTO submissions (assignment_id,student_id,submitted_at,content) VALUES (?,?,?,?)", v); } catch(e) {}
        }
      } else {
        console.error("Unexpected error on submissions batch:", err);
      }
    }
  }

  // STEP 9: Attendance (optional; moderate size)
  console.log("Generating attendance (unique lesson+student enforced)...");
  await conn.query("TRUNCATE TABLE attendance;");
  // We'll generate one attendance per lesson for a subset of students
  const ATTEND_PER_LESSON = 20; // on average
  const totalLessons = LESSONS_COUNT;
  for (let l = 0; l < totalLessons; l++) {
    const lesson_id = l + 1;
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let s = 0; s < ATTEND_PER_LESSON; s++) {
      const student_id = faker.number.int({ min: 1, max: TARGET_USERS });
      const status = faker.helpers.arrayElement(["present","absent","late","excused"]);
      values.push(lesson_id, student_id, status);
      placeholders.push("(?,?,?)");
    }
    const sql = `INSERT IGNORE INTO attendance (lesson_id,student_id,status) VALUES ${placeholders.join(",")};`;
    try { await conn.query(sql, values); } catch(e) {}
  }

  // STEP 10: Grades (small)
  console.log("Generating grades for a subset of submissions...");
  await conn.query("TRUNCATE TABLE grades;");
  const gradedCount = Math.min(50000, SUBMISSIONS_COUNT);
  for (let i = 0; i < gradedCount; i++) {
    const submission_id = faker.number.int({ min: 1, max: SUBMISSIONS_COUNT });
    const grade_value = faker.helpers.arrayElement(["PASSED","FAILED","1","2","3","4","5"]);
    const comment = faker.lorem.sentence();
    const grade_at = faker.date.recent({ days: 400 }).toISOString().slice(0,19).replace('T',' ');
    try {
      await conn.query("INSERT IGNORE INTO grades (submission_id,grade_value,comment,grade_at,grade_missing) VALUES (?,?,?,?,0);",
        [submission_id, grade_value, comment, grade_at]);
    } catch(e) {}
  }

  // Re-enable FK checks
  await conn.query("SET FOREIGN_KEY_CHECKS=1;");
  console.log("Seeding completed. All foreign-key checks re-enabled.");

  await conn.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
