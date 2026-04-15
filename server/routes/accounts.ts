import { Router } from "express";
import db, { schema, sqlite } from "../db/index.js";
import { eq } from "drizzle-orm";

const router = Router();

// ─── Accounts CRUD ───────────────────────────────────────

router.get("/", async (_req, res) => {
  try {
    const accts = await db.select().from(schema.accounts);
    res.json(accts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const accountContacts = await db.select().from(schema.contacts).where(eq(schema.contacts.accountId, id));
    res.json({ ...account, contacts: accountContacts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const result = db.insert(schema.accounts).values(req.body).run();
    const id = result.lastInsertRowid as number;
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    res.status(201).json(account);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    if (!existing) return res.status(404).json({ error: "Account not found" });

    await db.update(schema.accounts).set(req.body).where(eq(schema.accounts.id, id)).run();
    const [updated] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(schema.contacts).where(eq(schema.contacts.accountId, id)).run();
    await db.delete(schema.accounts).where(eq(schema.accounts.id, id)).run();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Contacts CRUD ───────────────────────────────────────

router.get("/:id/contacts", async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const list = await db.select().from(schema.contacts).where(eq(schema.contacts.accountId, accountId));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/contacts", async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const result = db.insert(schema.contacts).values({ ...req.body, accountId }).run();
    const cid = result.lastInsertRowid as number;
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, cid));
    res.status(201).json(contact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id/contacts/:contactId", async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId);
    await db.update(schema.contacts).set(req.body).where(eq(schema.contacts.id, contactId)).run();
    const [updated] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/contacts/:contactId", async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId);
    await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId)).run();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
