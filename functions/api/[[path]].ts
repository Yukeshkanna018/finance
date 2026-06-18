import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { EdgeDatabase } from "../lib/edge-db";

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Helper to authenticate user using Bearer token (email)
async function getAuthenticatedUser(c: any, db: EdgeDatabase) {
  const authHeader = c.req.header("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  
  try {
    const users = await db.getUsers();
    const user = users.find((u) => u.email === token);
    return user || null;
  } catch (e) {
    return null;
  }
}

// Middleware to inject DB instance and enforce Authentication
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/debug-env") {
    await next();
    return;
  }

  const isAuthRoute = path === "/api/auth/register" || path === "/api/auth/login";

  const supabaseUrl = c.env.SUPABASE_URL;
  const supabaseKey = c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return c.json({ error: "Missing Supabase configuration on Cloudflare Pages" }, 500);
  }

  const db = new EdgeDatabase(supabaseUrl, supabaseKey);
  c.set("db", db);

  if (isAuthRoute) {
    await next();
    return;
  }

  const user = await getAuthenticatedUser(c, db);
  if (!user) {
    return c.json({ error: "Unauthorized access: Please authenticate" }, 401);
  }
  c.set("user", user);
  await next();
});

app.get("/api/debug-env", (c) => {
  return c.json({
    keys: Object.keys(c.env || {}),
    envType: typeof c.env,
    hasUrl: !!c.env?.SUPABASE_URL,
    hasKey: !!(c.env?.SUPABASE_SERVICE_ROLE_KEY || c.env?.SUPABASE_ANON_KEY)
  });
});

/* =========================================================================
   1. Authentication API Endpoints
   ========================================================================= */

app.post("/api/auth/register", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const { email, password, fullName } = await c.req.json();
  if (!email || !password || !fullName) {
    return c.json({ error: "Missing registration payloads" }, 400);
  }

  const existing = await db.getUserByEmail(email);
  if (existing) {
    return c.json({ error: "An account with this email already exists" }, 400);
  }

  const newUser = {
    id: `u_${Date.now()}`,
    email: email.toLowerCase(),
    passwordHash: password,
    fullName,
    role: "staff",
    createdAt: new Date().toISOString()
  };
  
  await db.addUser(newUser);
  await db.audit(newUser.email, "REGISTER_USER", "users", newUser.id, `Created a new account for ${fullName}`);

  return c.json({
    email: newUser.email,
    fullName: newUser.fullName,
    token: newUser.email,
    role: newUser.role
  });
});

app.post("/api/auth/login", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const { email, password } = await c.req.json();
  if (!email || !password) {
    return c.json({ error: "Please enter your email and password" }, 400);
  }

  const user = await db.getUserByEmail(email);
  if (!user || user.passwordHash !== password) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  await db.audit(user.email, "LOGIN_SUCCESS", "users", user.id, `${user.fullName} logged in successfully`);

  return c.json({
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    token: user.email
  });
});

app.put("/api/auth/profile", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const { fullName } = await c.req.json();

  if (!fullName) {
    return c.json({ error: "Full name is required" }, 400);
  }

  const success = await db.updateUserProfile(user.email, fullName);
  if (success) {
    return c.json({ success: true, fullName });
  } else {
    return c.json({ error: "User session not found" }, 404);
  }
});

app.post("/api/auth/change-password", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const { oldPassword, newPassword } = await c.req.json();

  if (!oldPassword || !newPassword) {
    return c.json({ error: "Old and new password fields are required" }, 400);
  }

  const success = await db.changeUserPassword(user.email, oldPassword, newPassword);
  if (success) {
    await db.audit(user.email, "CHANGE_PASSWORD", "users", user.id, "Successfully changed password");
    return c.json({ success: true });
  } else {
    return c.json({ error: "Incorrect current password" }, 400);
  }
});

/* =========================================================================
   2. Dashboard API Endpoints
   ========================================================================= */

app.get("/api/dashboard/stats", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  await db.runOverdueChecks();
  const stats = await db.getDashboardStats();
  return c.json(stats);
});

/* =========================================================================
   3. Customer Management API Endpoints
   ========================================================================= */

app.get("/api/customers", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  return c.json(await db.getCustomers());
});

app.post("/api/customers", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const { name, phone, address, notes } = await c.req.json();

  if (!name || !phone) {
    return c.json({ error: "Name and Phone number are required fields" }, 400);
  }

  const newCust = await db.addCustomer({ name, phone, address: address || "", notes: notes || "" }, user.email);
  return c.json(newCust);
});

app.put("/api/customers/:id", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const id = c.req.param("id");
  const { name, phone, address, notes } = await c.req.json();

  const updated = await db.updateCustomer(id, { name, phone, address, notes }, user.email);
  if (updated) {
    return c.json(updated);
  } else {
    return c.json({ error: "Customer not found" }, 404);
  }
});

/* =========================================================================
   4. Loan Management API Endpoints
   ========================================================================= */

app.get("/api/loans", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  return c.json(await db.getLoans());
});

app.post("/api/loans", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const { customerId, type, amount, interestRate, durationWeeks, weeklyPayment, monthlyInterest } = await c.req.json();

  if (!customerId || !type || !amount || !interestRate) {
    return c.json({ error: "Missing required loan configuration values" }, 400);
  }

  const newLoan = await db.addLoan({
    customerId,
    type,
    amount: Number(amount),
    interestRate: Number(interestRate),
    durationWeeks: durationWeeks ? Number(durationWeeks) : undefined,
    weeklyPayment: weeklyPayment ? Number(weeklyPayment) : undefined,
    monthlyInterest: monthlyInterest ? Number(monthlyInterest) : undefined
  }, user.email);

  return c.json(newLoan);
});

app.post("/api/loans/:id/settle-principal", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const id = c.req.param("id");
  const { amount } = await c.req.json();

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return c.json({ error: "A valid positive settlement amount is required" }, 400);
  }

  const loan = await db.settleInterestOnlyPrincipal(id, Number(amount), user.email);
  if (loan) {
    return c.json(loan);
  } else {
    return c.json({ error: "Interest-Only Active Loan not found or already settled" }, 404);
  }
});

/* =========================================================================
   5. Payment Tracking API Endpoints
   ========================================================================= */

app.get("/api/payments", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const loans = await db.getLoans();
  return c.json(loans.flatMap(l => l.isDeleted ? [] : []));
});

app.get("/api/payments/history", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const allPayments = await db.backupDatabase();
  const parsed = JSON.parse(allPayments);
  const activePayments = (parsed.loanPayments || []).filter((p: any) => !p.isDeleted);
  return c.json(activePayments);
});

app.post("/api/payments", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const { loanId, paymentDate, amount, paymentMethod, notes } = await c.req.json();

  if (!loanId || !paymentDate || !amount || !paymentMethod) {
    return c.json({ error: "Missing payment fields" }, 400);
  }

  const savedPayment = await db.recordPayment({
    loanId,
    paymentDate,
    amount: Number(amount),
    paymentMethod,
    notes: notes || ""
  }, user.email);

  if (savedPayment) {
    return c.json(savedPayment);
  } else {
    return c.json({ error: "Loan is inactive, already closed, or not found" }, 404);
  }
});

/* =========================================================================
   6. Savings Management API Endpoints
   ========================================================================= */

app.get("/api/savings", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  return c.json(await db.getSavings());
});

app.post("/api/savings", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const { date, amount, notes } = await c.req.json();

  if (!date || !amount) {
    return c.json({ error: "Saving deposit Date and Amount are required" }, 400);
  }

  const newSaving = await db.addSaving({
    date,
    amount: Number(amount),
    contributorName: user.fullName,
    notes: notes || ""
  }, user.email);

  return c.json(newSaving);
});

/* =========================================================================
   7. Notifications API Endpoints
   ========================================================================= */

app.get("/api/notifications", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  return c.json(await db.getNotifications());
});

app.put("/api/notifications/:id/read", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const id = c.req.param("id");
  const success = await db.markNotificationRead(id);
  return c.json({ success });
});

app.post("/api/notifications/dismiss-all", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  await db.dismissAllNotifications();
  return c.json({ success: true });
});

/* =========================================================================
   8. Trash and Soft Deletions API Endpoints
   ========================================================================= */

app.get("/api/trash", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  return c.json(await db.getTrashBin());
});

app.post("/api/trash/restore/:id", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const id = c.req.param("id");
  
  const ok = await db.restoreRecord(id, user.email);
  if (ok) {
    return c.json({ success: true });
  } else {
    return c.json({ error: "Deleted record not found in Trash" }, 404);
  }
});

app.delete("/api/:table/:id", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const table = c.req.param("table");
  const id = c.req.param("id");
  const permanent = c.req.query("permanent");

  const isPermanent = permanent === "true";
  
  const validTables = ["customers", "loans", "loanPayments", "savings"];
  if (!validTables.includes(table)) {
    return c.json({ error: "Invalid target operation table" }, 400);
  }

  const success = await db.deleteRecord(table as any, id, isPermanent, user.email);
  if (success) {
    return c.json({ success: true, id, permanent: isPermanent });
  } else {
    return c.json({ error: "Record not found or failed to delete" }, 404);
  }
});

app.post("/api/:table/bulk-delete", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const table = c.req.param("table");
  const { ids, permanent } = await c.req.json();

  if (!ids || !Array.isArray(ids)) {
    return c.json({ error: "Array of record ids required" }, 400);
  }

  const isPermanent = permanent === true;
  const validTables = ["customers", "loans", "loanPayments", "savings"];
  if (!validTables.includes(table)) {
    return c.json({ error: "Invalid target table for bulk deletion" }, 400);
  }

  const count = await db.bulkDeleteRecords(table as any, ids, isPermanent, user.email);
  return c.json({ success: true, count, permanent: isPermanent });
});

/* =========================================================================
   9. Audit Logs & Database Backup/Restore API Endpoints
   ========================================================================= */

app.get("/api/audit-logs", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  return c.json(await db.getAuditLogs());
});

app.get("/api/database/export", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const backupData = await db.backupDatabase();
  return new Response(backupData, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename=finance_backup_${Date.now()}.json`
    }
  });
});

app.post("/api/database/import", async (c) => {
  const db = c.get("db") as EdgeDatabase;
  const user = c.get("user") as any;
  const { backupJson } = await c.req.json();

  if (!backupJson) {
    return c.json({ error: "Missing backup JSON payload" }, 400);
  }

  const result = await db.restoreDatabaseBackup(typeof backupJson === "string" ? backupJson : JSON.stringify(backupJson), user.email);
  if (result.success) {
    return c.json({ success: true });
  } else {
    return c.json({ error: result.error || "Failed to restore backup" }, 400);
  }
});

export const onRequest = handle(app);
