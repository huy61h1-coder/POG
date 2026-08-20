import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  sku: text("sku").notNull(),
  barcode: text("barcode").notNull().default(""),
  name: text("name").notNull(),
  line: text("line").notNull(),
  side: text("side").notNull().default("A"),
  bay: integer("bay").notNull().default(1),
  price: integer("price").notNull().default(0),
  stock: integer("stock").notNull().default(0),
  loss: integer("loss").notNull().default(0),
  expDate: text("exp_date").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_products_sku").on(table.sku),
  index("idx_products_barcode").on(table.barcode),
  index("idx_products_line_side").on(table.line, table.side),
]);

export const roles = sqliteTable("roles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("STAFF"),
  createdAt: integer("created_at").notNull(),
});

export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_logs_created_at").on(table.createdAt)]);

export const pickingItems = sqliteTable("picking_items", {
  userId: text("user_id").notNull(),
  productId: text("product_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  picked: integer("picked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.productId] })]);

export const pogFiles = sqliteTable("pog_files", {
  id: text("id").primaryKey(),
  line: text("line").notNull(),
  side: text("side").notNull(),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_pog_line_side").on(table.line, table.side)]);
