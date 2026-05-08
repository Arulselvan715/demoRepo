const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const APP_VERSION = "2026-05-08-fix3";
const publicDir = path.join(__dirname, "public");
const dataFile = path.join(__dirname, "data.json");

const defaultData = {
  products: [],
  suppliers: [],
  stock_logs: [],
  counters: {
    product_id: 1,
    supplier_id: 1,
    log_id: 1
  }
};

const ensureDataFile = () => {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
  }
};

const readData = () => JSON.parse(fs.readFileSync(dataFile, "utf8"));
const writeData = (data) => fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

const send = (res, status, body, contentType = "application/json", extraHeaders = {}) => {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders
  });
  res.end(contentType === "application/json" ? JSON.stringify(body) : body);
};

const notFound = (res) => send(res, 404, { error: "Not found." });
const badRequest = (res, message) => send(res, 400, { error: message });

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_error) {
        reject(new Error("Invalid JSON payload."));
      }
    });
    req.on("error", reject);
  });

const toInt = (value, fallback = -1) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
};

const fullProduct = (data, product) => {
  const supplier = data.suppliers.find((s) => s.supplier_id === product.supplier_id);
  return {
    ...product,
    supplier_name: supplier ? supplier.supplier_name : "Unknown"
  };
};

const addLog = (data, product_id, action, quantity_changed, transaction_note = "") => {
  data.stock_logs.unshift({
    log_id: data.counters.log_id++,
    product_id,
    product_name: (data.products.find((p) => p.product_id === product_id) || {}).name || "",
    action,
    quantity_changed,
    transaction_note,
    date: new Date().toISOString()
  });
};

const serveStatic = (urlPath, res) => {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(publicDir, cleanPath);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript"
  };
  const content = fs.readFileSync(filePath);
  send(res, 200, content, contentTypes[ext] || "application/octet-stream", {
    "Cache-Control": "no-store, no-cache, must-revalidate"
  });
  return true;
};

ensureDataFile();

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = parsedUrl;

  try {
    if (pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") {
        return send(res, 204, null);
      }

      const data = readData();

      if (req.method === "GET" && pathname === "/api/health") {
        return send(res, 200, { status: "ok", version: APP_VERSION });
      }

      if (req.method === "GET" && pathname === "/api/dashboard") {
        const lowStockItems = data.products.filter((p) => p.quantity < p.minimum_stock).length;
        return send(res, 200, {
          totalProducts: data.products.length,
          lowStockItems,
          totalSuppliers: data.suppliers.length,
          stockTransactions: data.stock_logs.length
        });
      }

      if (pathname === "/api/suppliers" && req.method === "GET") {
        return send(res, 200, data.suppliers.slice().sort((a, b) => b.supplier_id - a.supplier_id));
      }

      if (pathname === "/api/suppliers" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.supplier_name || !body.phone || !body.email || !body.address) {
          return badRequest(res, "All supplier fields are required.");
        }
        const supplier = {
          supplier_id: data.counters.supplier_id++,
          supplier_name: body.supplier_name.trim(),
          phone: body.phone.trim(),
          email: body.email.trim(),
          address: body.address.trim()
        };
        data.suppliers.push(supplier);
        writeData(data);
        return send(res, 201, supplier);
      }

      if (pathname.match(/^\/api\/suppliers\/\d+$/)) {
        const supplierId = toInt(pathname.split("/").pop());
        const supplierIndex = data.suppliers.findIndex((s) => s.supplier_id === supplierId);
        if (supplierIndex < 0) return notFound(res);

        if (req.method === "PUT") {
          const body = await readBody(req);
          if (!body.supplier_name || !body.phone || !body.email || !body.address) {
            return badRequest(res, "All supplier fields are required.");
          }
          data.suppliers[supplierIndex] = {
            ...data.suppliers[supplierIndex],
            supplier_name: body.supplier_name.trim(),
            phone: body.phone.trim(),
            email: body.email.trim(),
            address: body.address.trim()
          };
          writeData(data);
          return send(res, 200, data.suppliers[supplierIndex]);
        }

        if (req.method === "DELETE") {
          if (data.products.some((p) => p.supplier_id === supplierId)) {
            return badRequest(res, "Supplier is assigned to products and cannot be deleted.");
          }
          data.suppliers.splice(supplierIndex, 1);
          writeData(data);
          return send(res, 204, null);
        }
      }

      if (pathname === "/api/products" && req.method === "GET") {
        const search = (parsedUrl.searchParams.get("search") || "").toLowerCase();
        const category = (parsedUrl.searchParams.get("category") || "").toLowerCase();
        const supplier = (parsedUrl.searchParams.get("supplier") || "").toLowerCase();
        const result = data.products
          .map((p) => fullProduct(data, p))
          .filter(
            (p) =>
              p.name.toLowerCase().includes(search) &&
              p.category.toLowerCase().includes(category) &&
              p.supplier_name.toLowerCase().includes(supplier)
          )
          .sort((a, b) => b.product_id - a.product_id);
        return send(res, 200, result);
      }

      if (pathname === "/api/products" && req.method === "POST") {
        const body = await readBody(req);
        const name = (body.name || "").trim();
        const categoryText = (body.category || "").trim();
        const quantity = toInt(body.quantity);
        const minimum_stock = toInt(body.minimum_stock ?? 10);
        const supplier_id = toInt(body.supplier_id);
        const price = Number(body.price);

        if (!name || !categoryText || quantity < 0 || minimum_stock < 0 || supplier_id < 1 || Number.isNaN(price) || price < 0) {
          return badRequest(res, "Invalid product details.");
        }
        if (!data.suppliers.find((s) => s.supplier_id === supplier_id)) {
          return badRequest(res, "Supplier does not exist.");
        }
        if (data.products.find((p) => p.name.toLowerCase() === name.toLowerCase())) {
          return send(res, 409, { error: "Duplicate product name is not allowed." });
        }

        const product = {
          product_id: data.counters.product_id++,
          name,
          category: categoryText,
          quantity,
          price,
          supplier_id,
          minimum_stock
        };
        data.products.push(product);
        addLog(data, product.product_id, "CREATE_PRODUCT", quantity, "Initial product stock");
        writeData(data);
        return send(res, 201, fullProduct(data, product));
      }

      if (pathname.match(/^\/api\/products\/\d+$/)) {
        const productId = toInt(pathname.split("/").pop());
        const productIndex = data.products.findIndex((p) => p.product_id === productId);
        if (productIndex < 0) return notFound(res);
        const existing = data.products[productIndex];

        if (req.method === "PUT") {
          const body = await readBody(req);
          const name = (body.name ?? existing.name).trim();
          const categoryText = (body.category ?? existing.category).trim();
          const quantity = body.quantity === undefined ? existing.quantity : toInt(body.quantity);
          const minimum_stock = body.minimum_stock === undefined ? existing.minimum_stock : toInt(body.minimum_stock);
          const supplier_id = body.supplier_id === undefined ? existing.supplier_id : toInt(body.supplier_id);
          const price = body.price === undefined ? existing.price : Number(body.price);

          if (!name || !categoryText || quantity < 0 || minimum_stock < 0 || supplier_id < 1 || Number.isNaN(price) || price < 0) {
            return badRequest(res, "Invalid product details.");
          }
          if (!data.suppliers.find((s) => s.supplier_id === supplier_id)) {
            return badRequest(res, "Supplier does not exist.");
          }
          if (data.products.some((p) => p.product_id !== productId && p.name.toLowerCase() === name.toLowerCase())) {
            return send(res, 409, { error: "Duplicate product name is not allowed." });
          }

          const diff = quantity - existing.quantity;
          data.products[productIndex] = { ...existing, name, category: categoryText, quantity, minimum_stock, supplier_id, price };
          if (diff !== 0) {
            addLog(data, productId, "ADJUST_STOCK", diff, "Manual stock adjustment through product update");
          }
          writeData(data);
          return send(res, 200, fullProduct(data, data.products[productIndex]));
        }

        if (req.method === "DELETE") {
          data.products.splice(productIndex, 1);
          data.stock_logs = data.stock_logs.filter((l) => l.product_id !== productId);
          writeData(data);
          return send(res, 204, null);
        }
      }

      if (pathname.match(/^\/api\/products\/\d+\/stock\/?$/) && ["POST", "PUT", "PATCH"].includes(req.method)) {
        const productId = toInt(pathname.split("/")[3]);
        const product = data.products.find((p) => p.product_id === productId);
        if (!product) return notFound(res);

        const body = await readBody(req);
        const qty = toInt(body.quantity);
        if (!["IN", "OUT"].includes(body.action) || qty <= 0) {
          return badRequest(res, "Action must be IN/OUT and quantity must be positive.");
        }
        const delta = body.action === "IN" ? qty : -qty;
        if (product.quantity + delta < 0) {
          return badRequest(res, "Stock cannot be negative.");
        }
        product.quantity += delta;
        addLog(data, product.product_id, body.action === "IN" ? "STOCK_IN" : "STOCK_OUT", delta, (body.note || "").trim());
        writeData(data);
        return send(res, 200, fullProduct(data, product));
      }

      if (pathname.match(/^\/api\/products\/\d+\/stock\/?$/)) {
        return send(res, 405, { error: "Method not allowed. Use POST, PUT, or PATCH for stock updates." });
      }

      if (pathname === "/api/alerts/low-stock" && req.method === "GET") {
        const alerts = data.products
          .filter((p) => p.quantity < p.minimum_stock)
          .map((p) => {
            const supplier = data.suppliers.find((s) => s.supplier_id === p.supplier_id);
            return {
              product_id: p.product_id,
              name: p.name,
              quantity: p.quantity,
              minimum_stock: p.minimum_stock,
              supplier_name: supplier ? supplier.supplier_name : "Unknown",
              message: `${p.name} is running low! (${p.quantity}/${p.minimum_stock})`
            };
          })
          .sort((a, b) => a.quantity - b.quantity);
        return send(res, 200, alerts);
      }

      if (pathname === "/api/stock-logs" && req.method === "GET") {
        return send(res, 200, data.stock_logs.slice(0, 200));
      }

      return notFound(res);
    }

    if (!serveStatic(pathname, res)) {
      notFound(res);
    }
  } catch (error) {
    if (error.message === "Invalid JSON payload.") {
      return badRequest(res, error.message);
    }
    send(res, 500, { error: "Internal server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Warehouse Inventory System running at http://localhost:${PORT}`);
});
