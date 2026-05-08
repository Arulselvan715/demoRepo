const toast = document.getElementById("toast");
const APP_BUILD = "2026-05-08-fix3";
const API_BASE = window.location.port === "3000" ? "" : "http://localhost:3000";
let suppliers = [];
let products = [];

const showToast = (message, isError = false) => {
  toast.textContent = message;
  toast.style.background = isError ? "#cf354c" : "#111";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
};

const request = async (url, options = {}) => {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    let message = "Request failed";
    try {
      const body = await response.json();
      message = body.error || message;
    } catch (_error) {
      message = response.statusText;
    }
    const enriched = new Error(message);
    enriched.status = response.status;
    throw enriched;
  }
  if (response.status === 204) return null;
  return response.json();
};

const renderDashboard = async () => {
  const data = await request("/api/dashboard");
  const cards = document.getElementById("dashboardCards");
  cards.innerHTML = `
    <div class="card"><h3>Total Products</h3><strong>${data.totalProducts}</strong></div>
    <div class="card"><h3>Low Stock Items</h3><strong>${data.lowStockItems}</strong></div>
    <div class="card"><h3>Total Suppliers</h3><strong>${data.totalSuppliers}</strong></div>
    <div class="card"><h3>Stock Transactions</h3><strong>${data.stockTransactions}</strong></div>
  `;
};

const refreshSupplierDropdowns = () => {
  const productSupplier = document.getElementById("productSupplier");
  productSupplier.innerHTML = `<option value="">Select Supplier</option>${suppliers
    .map((s) => `<option value="${s.supplier_id}">${s.supplier_name}</option>`)
    .join("")}`;
};

const refreshStockProductDropdown = () => {
  const stockProductId = document.getElementById("stockProductId");
  stockProductId.innerHTML = `<option value="">Select Product</option>${products
    .map((p) => `<option value="${p.product_id}">${p.name}</option>`)
    .join("")}`;
  document.getElementById("updateStockBtn").disabled = products.length === 0;
};

const renderBuildInfo = async () => {
  const el = document.getElementById("buildInfo");
  try {
    const health = await request("/api/health");
    const serverVersion = health.version || "unknown";
    el.textContent = `Build: ${APP_BUILD} | Server: ${serverVersion} | API: ${API_BASE || "same-origin"}`;
  } catch (_error) {
    el.textContent = `Build: ${APP_BUILD} | Server: unavailable | API: ${API_BASE || "same-origin"}`;
  }
};

const updateStock = async (productId, payload) => {
  const endpoints = [`/api/products/${productId}/stock`, `/api/products/${productId}/stock/`];
  const methods = ["POST", "PUT", "PATCH"];
  let lastError = new Error("Stock update failed.");

  for (const url of endpoints) {
    for (const method of methods) {
      try {
        return await request(url, { method, body: JSON.stringify(payload) });
      } catch (error) {
        lastError = error;
        if (![404, 405].includes(error.status)) {
          throw error;
        }
      }
    }
  }

  throw lastError;
};

const renderSuppliers = async () => {
  suppliers = await request("/api/suppliers");
  const tbody = document.getElementById("suppliersTable");
  tbody.innerHTML = suppliers
    .map(
      (s) => `
      <tr>
        <td>${s.supplier_id}</td>
        <td>${s.supplier_name}</td>
        <td>${s.phone}</td>
        <td>${s.email}</td>
        <td class="actions">
          <button onclick="editSupplier(${s.supplier_id})">Edit</button>
          <button class="danger" onclick="removeSupplier(${s.supplier_id})">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  refreshSupplierDropdowns();
};

const getProductFilters = () => {
  const search = document.getElementById("searchName").value.trim();
  const category = document.getElementById("searchCategory").value.trim();
  const supplier = document.getElementById("searchSupplier").value.trim();
  return new URLSearchParams({ search, category, supplier }).toString();
};

const renderProducts = async () => {
  products = await request(`/api/products?${getProductFilters()}`);
  const tbody = document.getElementById("productsTable");
  tbody.innerHTML = products
    .map(
      (p) => `
      <tr>
        <td>${p.product_id}</td>
        <td>${p.name}</td>
        <td>${p.category}</td>
        <td>${p.supplier_name}</td>
        <td>${Number(p.price).toFixed(2)}</td>
        <td class="${p.quantity < p.minimum_stock ? "low-stock" : ""}">${p.quantity}</td>
        <td>${p.minimum_stock}</td>
        <td class="actions">
          <button onclick="editProduct(${p.product_id})">Edit</button>
          <button class="danger" onclick="removeProduct(${p.product_id})">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  refreshStockProductDropdown();
};

const renderAlerts = async () => {
  const alerts = await request("/api/alerts/low-stock");
  const box = document.getElementById("alertsList");
  if (!alerts.length) {
    box.innerHTML = `<div>No low-stock alerts right now.</div>`;
    return;
  }
  box.innerHTML = alerts.map((a) => `<div class="alert-item">${a.message}</div>`).join("");
};

const renderLogs = async () => {
  const logs = await request("/api/stock-logs");
  const tbody = document.getElementById("logsTable");
  tbody.innerHTML = logs
    .map(
      (l) => `
      <tr>
        <td>${l.log_id}</td>
        <td>${l.product_name}</td>
        <td>${l.action}</td>
        <td>${l.quantity_changed}</td>
        <td>${l.transaction_note || ""}</td>
        <td>${new Date(l.date).toLocaleString()}</td>
      </tr>
    `
    )
    .join("");
};

const refreshAll = async () => {
  await Promise.all([renderDashboard(), renderSuppliers(), renderProducts(), renderAlerts(), renderLogs()]);
};

window.editSupplier = (id) => {
  const s = suppliers.find((x) => x.supplier_id === id);
  if (!s) return;
  document.getElementById("supplierId").value = s.supplier_id;
  document.getElementById("supplierName").value = s.supplier_name;
  document.getElementById("supplierPhone").value = s.phone;
  document.getElementById("supplierEmail").value = s.email;
  document.getElementById("supplierAddress").value = s.address;
};

window.removeSupplier = async (id) => {
  if (!confirm("Delete this supplier?")) return;
  try {
    await request(`/api/suppliers/${id}`, { method: "DELETE" });
    showToast("Supplier deleted");
    await refreshAll();
  } catch (error) {
    showToast(error.message, true);
  }
};

window.editProduct = (id) => {
  const p = products.find((x) => x.product_id === id);
  if (!p) return;
  document.getElementById("productId").value = p.product_id;
  document.getElementById("productName").value = p.name;
  document.getElementById("productCategory").value = p.category;
  document.getElementById("productPrice").value = p.price;
  document.getElementById("productQuantity").value = p.quantity;
  document.getElementById("productMinStock").value = p.minimum_stock;
  document.getElementById("productSupplier").value = p.supplier_id;
};

window.removeProduct = async (id) => {
  if (!confirm("Delete this product?")) return;
  try {
    await request(`/api/products/${id}`, { method: "DELETE" });
    showToast("Product deleted");
    await refreshAll();
  } catch (error) {
    showToast(error.message, true);
  }
};

document.getElementById("supplierForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("supplierId").value;
  const payload = {
    supplier_name: document.getElementById("supplierName").value,
    phone: document.getElementById("supplierPhone").value,
    email: document.getElementById("supplierEmail").value,
    address: document.getElementById("supplierAddress").value
  };
  try {
    if (id) {
      await request(`/api/suppliers/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Supplier updated");
    } else {
      await request("/api/suppliers", { method: "POST", body: JSON.stringify(payload) });
      showToast("Supplier added");
    }
    event.target.reset();
    document.getElementById("supplierId").value = "";
    await refreshAll();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("productId").value;
  const payload = {
    name: document.getElementById("productName").value,
    category: document.getElementById("productCategory").value,
    price: Number(document.getElementById("productPrice").value),
    quantity: Number(document.getElementById("productQuantity").value),
    minimum_stock: Number(document.getElementById("productMinStock").value),
    supplier_id: Number(document.getElementById("productSupplier").value)
  };
  try {
    if (id) {
      await request(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Product updated");
    } else {
      await request("/api/products", { method: "POST", body: JSON.stringify(payload) });
      showToast("Product added");
    }
    event.target.reset();
    document.getElementById("productId").value = "";
    document.getElementById("productMinStock").value = "10";
    await refreshAll();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("updateStockBtn").addEventListener("click", async () => {
  const productId = document.getElementById("stockProductId").value;
  if (!productId) {
    showToast("Select a product before updating stock.", true);
    return;
  }
  const quantity = Number(document.getElementById("stockQty").value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    showToast("Enter a valid stock quantity.", true);
    return;
  }
  const payload = {
    action: document.getElementById("stockAction").value,
    quantity,
    note: document.getElementById("stockNote").value
  };
  try {
    await updateStock(productId, payload);
    showToast("Stock updated");
    document.getElementById("stockForm").reset();
    await refreshAll();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("searchBtn").addEventListener("click", async () => {
  await renderProducts();
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  document.getElementById("searchName").value = "";
  document.getElementById("searchCategory").value = "";
  document.getElementById("searchSupplier").value = "";
  await renderProducts();
});

document.getElementById("cancelSupplierEdit").addEventListener("click", () => {
  document.getElementById("supplierForm").reset();
  document.getElementById("supplierId").value = "";
});

document.getElementById("cancelProductEdit").addEventListener("click", () => {
  document.getElementById("productForm").reset();
  document.getElementById("productId").value = "";
  document.getElementById("productMinStock").value = "10";
});

Promise.all([renderBuildInfo(), refreshAll()]).catch((error) => {
  showToast(error.message, true);
});
