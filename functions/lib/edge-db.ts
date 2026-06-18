import { createClient, SupabaseClient } from "@supabase/supabase-js";

// =========================================================================
// Type definitions (self-contained for edge runtime - no Node.js deps)
// =========================================================================

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface Installment {
  dueDate: string;
  amount: number;
  paid: boolean;
  paidDate?: string;
  paymentId?: string;
}

export interface Loan {
  id: string;
  customerId: string;
  customerName?: string;
  type: string;
  amount: number;
  interestRate: number;
  durationWeeks?: number;
  weeklyPayment?: number;
  monthlyInterest?: number;
  balance: number;
  status: string;
  totalProfit: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  repaymentSchedule?: Installment[];
}

export interface LoanPayment {
  id: string;
  loanId: string;
  customerName?: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  notes: string;
  isDeleted: boolean;
  createdAt: string;
}

export interface Saving {
  id: string;
  date: string;
  amount: number;
  contributorName: string;
  notes: string;
  isDeleted: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export interface DeletedRecord {
  id: string;
  originalTable: string;
  recordData: any;
  deletedAt: string;
  deletedBy: string;
}

export interface AppNotification {
  id: string;
  loanId: string;
  customerName: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
}

// =========================================================================
// Edge-compatible Supabase Database Manager
// =========================================================================

export class EdgeDatabase {
  private supabase: SupabaseClient;

  constructor(url: string, key: string) {
    this.supabase = createClient(url, key);
  }

  // --- Users ---

  async getUsers(): Promise<User[]> {
    const { data, error } = await this.supabase.from("users").select("*");
    if (error) throw error;
    return (data || []).map((r: any) => ({
      id: r.id, email: r.email, passwordHash: r.password_hash,
      fullName: r.full_name, role: r.role, createdAt: r.created_at
    }));
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase.from("users").select("*")
      .eq("email", email.toLowerCase()).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id, email: data.email, passwordHash: data.password_hash,
      fullName: data.full_name, role: data.role, createdAt: data.created_at
    };
  }

  async addUser(user: User): Promise<void> {
    const { error } = await this.supabase.from("users").insert({
      id: user.id, email: user.email, password_hash: user.passwordHash,
      full_name: user.fullName, role: user.role, created_at: user.createdAt
    });
    if (error) throw error;
  }

  async updateUserProfile(email: string, fullName: string): Promise<boolean> {
    const { data, error } = await this.supabase.from("users")
      .update({ full_name: fullName }).eq("email", email.toLowerCase()).select();
    if (error) throw error;
    return !!(data && data.length > 0);
  }

  async changeUserPassword(email: string, oldPass: string, newPass: string): Promise<boolean> {
    const user = await this.getUserByEmail(email);
    if (!user || user.passwordHash !== oldPass) return false;
    const { error } = await this.supabase.from("users")
      .update({ password_hash: newPass }).eq("email", email.toLowerCase());
    if (error) throw error;
    return true;
  }

  // --- Customers ---

  async getCustomers(): Promise<Customer[]> {
    const { data, error } = await this.supabase.from("customers").select("*").eq("is_deleted", false);
    if (error) throw error;
    return (data || []).map((r: any) => ({
      id: r.id, name: r.name, phone: r.phone, address: r.address,
      notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at, isDeleted: r.is_deleted
    }));
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    const { data, error } = await this.supabase.from("customers").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id, name: data.name, phone: data.phone, address: data.address,
      notes: data.notes, createdAt: data.created_at, updatedAt: data.updated_at, isDeleted: data.is_deleted
    };
  }

  async addCustomer(c: { name: string; phone: string; address: string; notes: string }, authorEmail: string): Promise<Customer> {
    const id = `cust_${Date.now()}`;
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from("customers").insert({
      id, name: c.name, phone: c.phone, address: c.address, notes: c.notes,
      created_at: now, updated_at: now, is_deleted: false
    }).select().single();
    if (error) throw error;
    await this.audit(authorEmail, "CREATE_CUSTOMER", "customers", id, `Created customer: ${c.name}`);
    return {
      id: data.id, name: data.name, phone: data.phone, address: data.address,
      notes: data.notes, createdAt: data.created_at, updatedAt: data.updated_at, isDeleted: data.is_deleted
    };
  }

  async updateCustomer(id: string, updates: any, authorEmail: string): Promise<Customer | null> {
    const mapped: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) mapped.name = updates.name;
    if (updates.phone !== undefined) mapped.phone = updates.phone;
    if (updates.address !== undefined) mapped.address = updates.address;
    if (updates.notes !== undefined) mapped.notes = updates.notes;

    const { data, error } = await this.supabase.from("customers")
      .update(mapped).eq("id", id).select().maybeSingle();
    if (error) throw error;
    if (!data) return null;
    await this.audit(authorEmail, "UPDATE_CUSTOMER", "customers", id, `Updated customer details for: ${data.name}`);
    return {
      id: data.id, name: data.name, phone: data.phone, address: data.address,
      notes: data.notes, createdAt: data.created_at, updatedAt: data.updated_at, isDeleted: data.is_deleted
    };
  }

  // --- Loans ---

  async getLoans(includeDeleted = false): Promise<Loan[]> {
    const { data: loans, error } = await this.supabase.from("loans")
      .select("*, customers(name)").order("created_at", { ascending: false });
    if (error) throw error;
    let filtered = loans || [];
    if (!includeDeleted) filtered = filtered.filter((l: any) => !l.is_deleted);

    return filtered.map((l: any) => ({
      id: l.id, customerId: l.customer_id,
      customerName: l.customers ? l.customers.name : "Unknown Customer",
      type: l.type, amount: Number(l.amount), interestRate: Number(l.interest_rate),
      durationWeeks: l.duration_weeks,
      weeklyPayment: l.weekly_payment ? Number(l.weekly_payment) : undefined,
      monthlyInterest: l.monthly_interest ? Number(l.monthly_interest) : undefined,
      balance: Number(l.balance), status: l.status, totalProfit: Number(l.total_profit),
      createdAt: l.created_at, updatedAt: l.updated_at, isDeleted: l.is_deleted,
      repaymentSchedule: l.repayment_schedule
    }));
  }

  async addLoan(l: any, authorEmail: string): Promise<Loan> {
    const id = `loan_${Date.now()}`;
    const customer = await this.getCustomerById(l.customerId);
    const customerName = customer ? customer.name : "Unknown";

    let balance = l.amount;
    let repaymentSchedule: Installment[] = [];

    if (l.type === "weekly") {
      const duration = l.durationWeeks || 12;
      const weeklyReturn = l.weeklyPayment || 200;
      balance = duration * weeklyReturn;
      const startDate = new Date();
      for (let i = 1; i <= duration; i++) {
        const dueDate = new Date(startDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        repaymentSchedule.push({ dueDate: dueDate.toISOString(), amount: weeklyReturn, paid: false });
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from("loans").insert({
      id, customer_id: l.customerId, type: l.type, amount: l.amount,
      interest_rate: l.interestRate, duration_weeks: l.durationWeeks,
      weekly_payment: l.weeklyPayment, monthly_interest: l.monthlyInterest,
      balance, status: "active", total_profit: 0, created_at: now, updated_at: now,
      is_deleted: false, repayment_schedule: l.type === "weekly" ? repaymentSchedule : null
    }).select().single();
    if (error) throw error;

    await this.audit(authorEmail, "CREATE_LOAN", "loans", id, `Issued ${l.type} loan of ₹${l.amount} to ${customerName}`);
    await this.supabase.from("notifications").insert({
      id: `not_disb_${Date.now()}`, loan_id: id, customer_name: customerName,
      title: "New Loan Disbursed",
      message: `A new ${l.type} loan of ₹${l.amount} was opened for ${customerName}.`,
      type: "upcoming", read: false, created_at: now
    });

    return {
      id: data.id, customerId: data.customer_id, customerName, type: data.type,
      amount: Number(data.amount), interestRate: Number(data.interest_rate),
      durationWeeks: data.duration_weeks,
      weeklyPayment: data.weekly_payment ? Number(data.weekly_payment) : undefined,
      monthlyInterest: data.monthly_interest ? Number(data.monthly_interest) : undefined,
      balance: Number(data.balance), status: data.status, totalProfit: Number(data.total_profit),
      createdAt: data.created_at, updatedAt: data.updated_at, isDeleted: data.is_deleted,
      repaymentSchedule: data.repayment_schedule
    };
  }

  async settleInterestOnlyPrincipal(loanId: string, amountPaid: number, authorEmail: string): Promise<Loan | null> {
    const { data: loan, error: errFetch } = await this.supabase.from("loans")
      .select("*, customers(name)").eq("id", loanId).maybeSingle();
    if (errFetch || !loan || loan.type !== "interest_only" || loan.status === "closed") return null;

    const newBalance = Math.max(0, Number(loan.balance) - amountPaid);
    const newStatus = newBalance === 0 ? "closed" : loan.status;
    const { data: updated, error: errUp } = await this.supabase.from("loans")
      .update({ balance: newBalance, status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", loanId).select().single();
    if (errUp) throw errUp;

    const customerName = loan.customers ? loan.customers.name : "Unknown";
    const payId = `pay_principal_${Date.now()}`;
    await this.supabase.from("loan_payments").insert({
      id: payId, loan_id: loanId, customer_name: customerName,
      payment_date: new Date().toISOString(), amount: amountPaid,
      payment_method: "bank_transfer", notes: "Principal Part/Settle Outstanding Payment",
      is_deleted: false, created_at: new Date().toISOString()
    });
    await this.audit(authorEmail, "SETTLE_PRINCIPAL", "loans", loanId, `Principal settle payment of ₹${amountPaid} on loan #${loanId}`);

    return {
      id: updated.id, customerId: updated.customer_id, customerName,
      type: updated.type, amount: Number(updated.amount), interestRate: Number(updated.interest_rate),
      durationWeeks: updated.duration_weeks,
      weeklyPayment: updated.weekly_payment ? Number(updated.weekly_payment) : undefined,
      monthlyInterest: updated.monthly_interest ? Number(updated.monthly_interest) : undefined,
      balance: Number(updated.balance), status: updated.status, totalProfit: Number(updated.total_profit),
      createdAt: updated.created_at, updatedAt: updated.updated_at, isDeleted: updated.is_deleted,
      repaymentSchedule: updated.repayment_schedule
    };
  }

  async recordPayment(pay: any, authorEmail: string): Promise<LoanPayment | null> {
    const { data: loan, error: errFetch } = await this.supabase.from("loans")
      .select("*, customers(name)").eq("id", pay.loanId).maybeSingle();
    if (errFetch || !loan) return null;
    const customerName = loan.customers ? loan.customers.name : "Unknown";

    const id = `pay_${Date.now()}`;
    let newBalance = Number(loan.balance);
    let newTotalProfit = Number(loan.total_profit);
    let repaymentSchedule = loan.repayment_schedule;

    if (loan.type === "weekly" && repaymentSchedule) {
      let remainingToApply = pay.amount;
      for (const inst of repaymentSchedule) {
        if (!inst.paid && remainingToApply >= inst.amount) {
          inst.paid = true;
          inst.paidDate = pay.paymentDate;
          inst.paymentId = id;
          remainingToApply -= inst.amount;
        }
      }
      newBalance = Math.max(0, newBalance - pay.amount);
      const totalRepayable = (loan.weekly_payment || 0) * (loan.duration_weeks || 0);
      const profitRatio = totalRepayable > 0 ? (totalRepayable - loan.amount) / totalRepayable : 0;
      const interestAmount = pay.amount * profitRatio;
      newTotalProfit += interestAmount;

      if (interestAmount > 0) {
        await this.supabase.from("profit_records").insert({
          id: `pr_${Date.now()}_${id}`, date: pay.paymentDate,
          amount: Number(interestAmount.toFixed(2)), type: "loan_interest",
          description: `${customerName} - Weekly Repay installment profit ratio share`,
          created_at: new Date().toISOString()
        });
      }
    } else {
      newTotalProfit += pay.amount;
      await this.supabase.from("profit_records").insert({
        id: `pr_${Date.now()}_${id}`, date: pay.paymentDate,
        amount: pay.amount, type: "loan_interest",
        description: `${customerName} - Interest Payment (Interest-Only Loan)`,
        created_at: new Date().toISOString()
      });
    }

    const newStatus = (loan.type === "weekly" && newBalance <= 0) ? "closed" : loan.status;
    await this.supabase.from("loans").update({
      balance: newBalance, total_profit: newTotalProfit,
      repayment_schedule: repaymentSchedule, status: newStatus,
      updated_at: new Date().toISOString()
    }).eq("id", pay.loanId);

    await this.supabase.from("loan_payments").insert({
      id, loan_id: pay.loanId, customer_name: customerName,
      payment_date: pay.paymentDate, amount: pay.amount,
      payment_method: pay.paymentMethod, notes: pay.notes || "",
      is_deleted: false, created_at: new Date().toISOString()
    });

    await this.audit(authorEmail, "RECORD_PAYMENT", "loanPayments", id, `Recorded payment of ₹${pay.amount} from ${customerName}`);

    return {
      id, loanId: pay.loanId, customerName,
      paymentDate: pay.paymentDate, amount: pay.amount,
      paymentMethod: pay.paymentMethod, notes: pay.notes || "",
      isDeleted: false, createdAt: new Date().toISOString()
    };
  }

  // --- Savings ---

  async getSavings(): Promise<Saving[]> {
    const { data, error } = await this.supabase.from("savings").select("*").eq("is_deleted", false);
    if (error) throw error;
    return (data || []).map((s: any) => ({
      id: s.id, date: s.date, amount: Number(s.amount),
      contributorName: s.contributor_name, notes: s.notes,
      isDeleted: s.is_deleted, createdAt: s.created_at
    }));
  }

  async addSaving(s: any, authorEmail: string): Promise<Saving> {
    const id = `sav_${Date.now()}`;
    const { data, error } = await this.supabase.from("savings").insert({
      id, date: s.date, amount: s.amount, contributor_name: s.contributorName,
      notes: s.notes, is_deleted: false, created_at: new Date().toISOString()
    }).select().single();
    if (error) throw error;
    await this.audit(authorEmail, "CREATE_SAVING", "savings", id, `Added daily savings of ₹${s.amount} under ${s.contributorName}`);
    return {
      id: data.id, date: data.date, amount: Number(data.amount),
      contributorName: data.contributor_name, notes: data.notes,
      isDeleted: data.is_deleted, createdAt: data.created_at
    };
  }

  // --- Notifications ---

  async getNotifications(): Promise<AppNotification[]> {
    const { data, error } = await this.supabase.from("notifications").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((n: any) => ({
      id: n.id, loanId: n.loan_id, customerName: n.customer_name,
      title: n.title, message: n.message, type: n.type,
      read: n.read, createdAt: n.created_at
    }));
  }

  async markNotificationRead(id: string): Promise<boolean> {
    const { data, error } = await this.supabase.from("notifications").update({ read: true }).eq("id", id).select();
    if (error) throw error;
    return !!(data && data.length > 0);
  }

  async dismissAllNotifications(): Promise<void> {
    const { error } = await this.supabase.from("notifications").update({ read: true }).eq("read", false);
    if (error) throw error;
  }

  // --- Trash / Deletions ---

  async deleteRecord(tableName: string, id: string, permanent: boolean, authorEmail: string): Promise<boolean> {
    const tableMap: any = { customers: "customers", loans: "loans", loanPayments: "loan_payments", savings: "savings" };
    const dbTable = tableMap[tableName];
    if (!dbTable) return false;

    if (permanent) {
      const { error } = await this.supabase.from(dbTable).delete().eq("id", id);
      if (error) return false;
      await this.audit(authorEmail, "PERMANENT_DELETE", tableName, id, `Permanently deleted record from ${tableName}`);
    } else {
      const { data: record, error: errFetch } = await this.supabase.from(dbTable).select("*").eq("id", id).maybeSingle();
      if (errFetch || !record) return false;
      const { error: errUp } = await this.supabase.from(dbTable).update({ is_deleted: true }).eq("id", id);
      if (errUp) return false;
      await this.supabase.from("deleted_records").insert({
        id: `del_${Date.now()}_${id}`, original_table: tableName,
        record_data: record, deleted_at: new Date().toISOString(), deleted_by: authorEmail
      });
      await this.audit(authorEmail, "SOFT_DELETE", tableName, id, `Moved record ${id} to Trash Bin`);
    }
    return true;
  }

  async restoreRecord(trashId: string, authorEmail: string): Promise<boolean> {
    const { data: trashItem, error: errFetch } = await this.supabase.from("deleted_records")
      .select("*").eq("id", trashId).maybeSingle();
    if (errFetch || !trashItem) return false;

    const tableMap: any = { customers: "customers", loans: "loans", loanPayments: "loan_payments", savings: "savings" };
    const dbTable = tableMap[trashItem.original_table];
    if (!dbTable) return false;

    const recordData = trashItem.record_data;
    const { data: existing } = await this.supabase.from(dbTable).select("id").eq("id", recordData.id).maybeSingle();
    if (existing) {
      await this.supabase.from(dbTable).update({ is_deleted: false }).eq("id", recordData.id);
    } else {
      recordData.is_deleted = false;
      await this.supabase.from(dbTable).insert(recordData);
    }

    await this.supabase.from("deleted_records").delete().eq("id", trashId);
    await this.audit(authorEmail, "RESTORE_RECORD", trashItem.original_table, recordData.id, `Restored deleted record from Trash Bin`);
    return true;
  }

  async bulkDeleteRecords(tableName: string, ids: string[], permanent: boolean, authorEmail: string): Promise<number> {
    let count = 0;
    for (const id of ids) {
      if (await this.deleteRecord(tableName, id, permanent, authorEmail)) count++;
    }
    return count;
  }

  async getTrashBin(): Promise<DeletedRecord[]> {
    const { data, error } = await this.supabase.from("deleted_records").select("*").order("deleted_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r: any) => ({
      id: r.id, originalTable: r.original_table, recordData: r.record_data,
      deletedAt: r.deleted_at, deletedBy: r.deleted_by
    }));
  }

  // --- Audit ---

  async audit(userEmail: string, action: string, entityType: string, entityId: string, details: string): Promise<void> {
    await this.supabase.from("audit_logs").insert({
      id: `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      user_email: userEmail, action, entity_type: entityType,
      entity_id: entityId, details, created_at: new Date().toISOString()
    });
  }

  async getAuditLogs(): Promise<AuditLog[]> {
    const { data, error } = await this.supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).map((l: any) => ({
      id: l.id, userEmail: l.user_email, action: l.action,
      entityType: l.entity_type, entityId: l.entity_id,
      details: l.details, createdAt: l.created_at
    }));
  }

  // --- Backup ---

  async backupDatabase(): Promise<string> {
    const users = await this.getUsers();
    const { data: customers } = await this.supabase.from("customers").select("*");
    const { data: loans } = await this.supabase.from("loans").select("*");
    const { data: loanPayments } = await this.supabase.from("loan_payments").select("*");
    const { data: savings } = await this.supabase.from("savings").select("*");
    const { data: profitRecords } = await this.supabase.from("profit_records").select("*");
    const { data: notifications } = await this.supabase.from("notifications").select("*");
    const { data: auditLogs } = await this.supabase.from("audit_logs").select("*");
    const { data: deletedRecords } = await this.supabase.from("deleted_records").select("*");

    return JSON.stringify({
      users, customers: customers || [], loans: loans || [],
      loanPayments: loanPayments || [], savings: savings || [],
      profitRecords: profitRecords || [], notifications: notifications || [],
      auditLogs: auditLogs || [], deletedRecords: deletedRecords || []
    }, null, 2);
  }

  async restoreDatabaseBackup(jsonData: string, authorEmail: string): Promise<{ success: boolean; error?: string }> {
    try {
      const parsed = JSON.parse(jsonData);
      if (!parsed.users || !parsed.customers || !parsed.loans) {
        return { success: false, error: "Invalid backup format. Missing core tables." };
      }
      // Truncate all tables (order matters for FK constraints)
      await this.supabase.from("deleted_records").delete().neq("id", "");
      await this.supabase.from("audit_logs").delete().neq("id", "");
      await this.supabase.from("notifications").delete().neq("id", "");
      await this.supabase.from("profit_records").delete().neq("id", "");
      await this.supabase.from("savings").delete().neq("id", "");
      await this.supabase.from("loan_payments").delete().neq("id", "");
      await this.supabase.from("loans").delete().neq("id", "");
      await this.supabase.from("customers").delete().neq("id", "");
      await this.supabase.from("users").delete().neq("id", "");

      if (parsed.users?.length) {
        await this.supabase.from("users").insert(parsed.users.map((u: any) => ({
          id: u.id, email: u.email, password_hash: u.passwordHash || u.password_hash,
          full_name: u.fullName || u.full_name, role: u.role, created_at: u.createdAt || u.created_at
        })));
      }
      if (parsed.customers?.length) await this.supabase.from("customers").insert(parsed.customers);
      if (parsed.loans?.length) await this.supabase.from("loans").insert(parsed.loans);
      if (parsed.loanPayments?.length) await this.supabase.from("loan_payments").insert(parsed.loanPayments);
      if (parsed.savings?.length) await this.supabase.from("savings").insert(parsed.savings);
      if (parsed.profitRecords?.length) await this.supabase.from("profit_records").insert(parsed.profitRecords);
      if (parsed.notifications?.length) await this.supabase.from("notifications").insert(parsed.notifications);
      if (parsed.auditLogs?.length) await this.supabase.from("audit_logs").insert(parsed.auditLogs);
      if (parsed.deletedRecords?.length) await this.supabase.from("deleted_records").insert(parsed.deletedRecords);

      await this.audit(authorEmail, "RESTORE_FULL_BACKUP", "database", "all", "Restored full database backup successfully");
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to parse json backup" };
    }
  }

  // --- Dashboard ---

  async getDashboardStats(): Promise<any> {
    const activeLoans = await this.getLoans();
    const { data: allActivePayments } = await this.supabase.from("loan_payments").select("*").eq("is_deleted", false);
    const { data: activeSavings } = await this.supabase.from("savings").select("*").eq("is_deleted", false);
    const { data: profitRecords } = await this.supabase.from("profit_records").select("*");

    const nonClosedLoans = activeLoans.filter(l => l.status !== "closed");
    const totalCapitalValue = 100000;
    const totalMoneyLent = nonClosedLoans.reduce((acc, l) => acc + l.amount, 0);
    const profitListAll = profitRecords || [];
    const totalCumulativeProfit = profitListAll.reduce((acc, pr) => acc + Number(pr.amount), 0);

    const thisMonthText = new Date().toISOString().substring(0, 7);
    const currentMonthProfit = profitListAll
      .filter(pr => pr.date.startsWith(thisMonthText))
      .reduce((acc, pr) => acc + Number(pr.amount), 0);

    const totalSavings = (activeSavings || []).reduce((acc, s) => acc + Number(s.amount), 0);
    const overdueCount = nonClosedLoans.filter(l => l.status === "overdue").length;

    const todayStr = new Date().toISOString().split("T")[0];
    const todayCollections = (allActivePayments || [])
      .filter(p => p.payment_date.startsWith(todayStr))
      .reduce((acc, p) => acc + Number(p.amount), 0);

    const months = [];
    const profitByMonth: { [key: string]: number } = {};
    const collectionsByMonth: { [key: string]: number } = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mLabel = d.toLocaleString("default", { month: "short", year: "2-digit" });
      const mKey = d.toISOString().substring(0, 7);
      months.push({ label: mLabel, key: mKey });
      profitByMonth[mKey] = 0;
      collectionsByMonth[mKey] = 0;
    }
    profitListAll.forEach(pr => {
      const mKey = pr.date.substring(0, 7);
      if (profitByMonth[mKey] !== undefined) profitByMonth[mKey] += Number(pr.amount);
    });
    (allActivePayments || []).forEach(pay => {
      const mKey = pay.payment_date.substring(0, 7);
      if (collectionsByMonth[mKey] !== undefined) collectionsByMonth[mKey] += Number(pay.amount);
    });
    const monthlyTrends = months.map(m => ({
      name: m.label,
      profit: Number(profitByMonth[m.key].toFixed(2)),
      collections: Number(collectionsByMonth[m.key].toFixed(2))
    }));

    let totalDuesInWeekly = 0;
    let totalPaidInWeekly = 0;
    activeLoans.filter(l => l.type === "weekly" && l.repaymentSchedule).forEach(l => {
      l.repaymentSchedule?.forEach(inst => {
        totalDuesInWeekly++;
        if (inst.paid) totalPaidInWeekly++;
      });
    });
    const recoveryRate = totalDuesInWeekly > 0 ? Math.round((totalPaidInWeekly / totalDuesInWeekly) * 100) : 100;

    return {
      totalCapital: totalCapitalValue, totalMoneyLent,
      activeLoansCount: nonClosedLoans.length, currentMonthProfit,
      totalCumulativeProfit, totalSavings,
      overdueLoansCount: overdueCount, todayCollectionsAmount: todayCollections,
      monthlyTrends, recoveryRate
    };
  }

  // --- Overdue Checks ---

  async runOverdueChecks(): Promise<void> {
    const now = new Date();
    const activeLoans = await this.getLoans();
    for (const loan of activeLoans) {
      if (loan.isDeleted || loan.status === "closed") continue;
      if (loan.type === "weekly" && loan.repaymentSchedule) {
        let isOverdue = false;
        loan.repaymentSchedule.forEach(inst => {
          const due = new Date(inst.dueDate);
          if (due.getTime() < now.getTime() && !inst.paid) {
            if (Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)) >= 3) {
              isOverdue = true;
            }
          }
        });
        const newStatus = isOverdue ? "overdue" : "active";
        if (loan.status !== newStatus) {
          await this.supabase.from("loans").update({ status: newStatus }).eq("id", loan.id);
          if (isOverdue) {
            const exists = await this.supabase.from("notifications")
              .select("id").eq("loan_id", loan.id).eq("type", "overdue").eq("read", false).maybeSingle();
            if (!exists.data) {
              await this.supabase.from("notifications").insert({
                id: `n_check_${Date.now()}_${loan.id}`, loan_id: loan.id,
                customer_name: loan.customerName || "Customer",
                title: "Overdue Loan Detected",
                message: `${loan.customerName} is marked Overdue. Paid installments are lagging.`,
                type: "overdue", read: false, created_at: new Date().toISOString()
              });
            }
          }
        }
      }
    }
  }
}
