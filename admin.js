const adminState = {
  products: [],
  search: "",
  filters: {
    category: "",
    application: "",
    model: "",
    status: "",
  },
  user: null,
};

const loginView = document.querySelector("#loginView");
const dashboardView = document.querySelector("#dashboardView");
const loginForm = document.querySelector("#loginForm");
const productForm = document.querySelector("#productForm");
const loginMessage = document.querySelector("#loginMessage");
const productMessage = document.querySelector("#productMessage");
const adminProducts = document.querySelector("#adminProducts");
const adminEmpty = document.querySelector("#adminEmpty");
const adminCount = document.querySelector("#adminCount");
const adminSearch = document.querySelector("#adminSearch");
const categoryFilter = document.querySelector("#categoryFilter");
const applicationFilter = document.querySelector("#applicationFilter");
const modelFilter = document.querySelector("#modelFilter");
const statusFilter = document.querySelector("#statusFilter");
const adminUser = document.querySelector("#adminUser");
const logoutButton = document.querySelector("#logoutButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const newProductButton = document.querySelector("#newProductButton");
const formTitle = document.querySelector("#formTitle");
const imagePreview = document.querySelector("#imagePreview");
const imagePreviewImg = imagePreview.querySelector("img");
const modelOptions = document.querySelector("#modelOptions");

const MODEL_GROUPS = {
  Camiones: ["Accelo", "Atego", "Actros", "Arocs", "Axor"],
  Vans: ["Sprinter", "Vito"],
};

function escapeHtml(value) {
  return value
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

function normalize(value) {
  return value
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la operación");
  return payload;
}

function setView(isAuthenticated) {
  if (!isAuthenticated) clearExcelMessages();
  loginView.hidden = isAuthenticated;
  dashboardView.hidden = !isAuthenticated;
  logoutButton.hidden = !isAuthenticated;
  adminUser.textContent = isAuthenticated && adminState.user ? adminState.user.email : "";
}

function getFilteredProducts() {
  const query = normalize(adminState.search.trim());

  return adminState.products.filter((product) =>
    (!query ||
      [product.name, product.description]
        .some((value) => normalize(value || "").includes(query))) &&
    (!adminState.filters.category || product.category === adminState.filters.category) &&
    (!adminState.filters.application || product.application === adminState.filters.application) &&
    (!adminState.filters.model || (product.models || []).includes(adminState.filters.model)) &&
    (!adminState.filters.status ||
      (adminState.filters.status === "active"
        ? product.status === "active" && !product.sold && Number(product.stock || 0) > 0
        : adminState.filters.status === "sold"
          ? product.sold
          : adminState.filters.status === "out-of-stock"
            ? product.status === "active" && !product.sold && Number(product.stock || 0) === 0
            : product.status === adminState.filters.status))
  );
}

function getStatusLabel(product) {
  if (product.status === "inactive") return "Dado de baja";
  if (product.sold) return "Vendido";
  if (Number(product.stock || 0) === 0) return "Sin stock";
  return "Activo";
}

function getStatusClass(product) {
  if (product.status === "inactive") return "is-inactive";
  if (product.sold) return "is-sold";
  if (Number(product.stock || 0) === 0) return "is-out-of-stock";
  return "is-active";
}

function renderModelFilter() {
  const currentValue = modelFilter.value;
  const models = [...new Set(adminState.products.flatMap((product) => product.models || []))].sort();

  modelFilter.innerHTML = `
    <option value="">Todos</option>
    ${models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("")}
  `;

  if (models.includes(currentValue)) modelFilter.value = currentValue;
  else adminState.filters.model = "";
}

function renderProducts() {
  const products = getFilteredProducts();
  adminCount.textContent = `${products.length} producto${products.length === 1 ? "" : "s"}`;
  adminEmpty.hidden = products.length > 0;

  adminProducts.innerHTML = products
    .map(
      (product) => `
        <tr>
          <td>
            <div class="admin-product-cell">
              <img src="${escapeHtml(product.image || 'assets/product-placeholder.svg')}" alt="" onerror="this.onerror=null;this.src='assets/product-placeholder.svg'" />
              <div>
                <strong>${escapeHtml(product.name)}</strong>
                <span>${escapeHtml(product.category)} | ${escapeHtml(product.application)}</span>
                <small>${escapeHtml((product.models || []).join(", ") || "Sin modelos")}</small>
              </div>
            </div>
          </td>
          <td>${formatPrice(product.price)}</td>
          <td>${Number(product.stock || 0)}</td>
          <td><span class="status-pill ${getStatusClass(product)}">${getStatusLabel(product)}</span></td>
          <td>
            <div class="row-actions">
              <button type="button" data-action="edit" data-id="${product.id}">Editar</button>
              <button type="button" data-action="sold" data-id="${product.id}">
                ${product.sold ? "Quitar vendido" : "Vendido"}
              </button>
              <button type="button" data-action="toggle-status" data-id="${product.id}">
                ${product.status === "inactive" ? "Reactivar" : "Dar de baja"}
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function getModelsForApplication(application) {
  if (application === "Camiones") return MODEL_GROUPS.Camiones;
  if (application === "Vans") return MODEL_GROUPS.Vans;
  return [...MODEL_GROUPS.Camiones, ...MODEL_GROUPS.Vans];
}

function getSelectedModels() {
  return [...modelOptions.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

function renderModelOptions(selectedModels = []) {
  const selected = new Set(selectedModels);
  const application = productForm.elements.application.value;
  const models = getModelsForApplication(application);

  modelOptions.innerHTML = models
    .map(
      (model) => `
        <label class="model-option">
          <input type="checkbox" value="${escapeHtml(model)}" ${selected.has(model) ? "checked" : ""} />
          <span>${escapeHtml(model)}</span>
        </label>
      `
    )
    .join("");
}

function resetForm() {
  productForm.reset();
  productForm.elements.id.value = "";
  productForm.elements.category.value = "Repuestos";
  productForm.elements.application.value = "Camiones";
  productForm.elements.stock.value = 0;
  productForm.elements.badge.value = "";
  productForm.elements.status.value = "active";
  formTitle.textContent = "Cargar producto";
  cancelEditButton.hidden = true;
  renderModelOptions([]);
  updateImagePreview("");
  productMessage.textContent = "";
}

function updateImagePreview(src) {
  if (!src) {
    imagePreview.hidden = true;
    imagePreviewImg.removeAttribute("src");
    return;
  }

  imagePreview.hidden = false;
  imagePreviewImg.src = src;
}

function fillForm(product) {
  productForm.elements.id.value = product.id;
  productForm.elements.name.value = product.name;
  productForm.elements.category.value = product.category;
  productForm.elements.application.value = product.application;
  renderModelOptions(product.models || []);
  productForm.elements.description.value = product.description;
  productForm.elements.price.value = product.price;
  productForm.elements.stock.value = Number(product.stock || 0);
  productForm.elements.badge.value = product.badge;
  productForm.elements.image.value = product.image;
  productForm.elements.status.value = product.status;
  productForm.elements.sold.checked = product.sold;
  updateImagePreview(product.image);
  formTitle.textContent = "Editar producto";
  cancelEditButton.hidden = false;
  productMessage.textContent = "";
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getProductPayload() {
  return {
    name: productForm.elements.name.value,
    category: productForm.elements.category.value,
    application: productForm.elements.application.value,
    models: getSelectedModels(),
    description: productForm.elements.description.value,
    price: Number(productForm.elements.price.value),
    stock: Number(productForm.elements.stock.value),
    badge: productForm.elements.badge.value,
    image: productForm.elements.image.value,
    status: productForm.elements.status.value,
    sold: productForm.elements.sold.checked,
  };
}

async function loadProducts() {
  const payload = await requestJson("/api/admin/products");
  adminState.products = payload.products;
  renderModelFilter();
  renderProducts();
}

async function checkSession() {
  try {
    const payload = await requestJson("/api/admin/me");
    if (!payload.user) {
      adminState.user = null;
      setView(false);
      return;
    }
    adminState.user = payload.user;
    setView(true);
    await loadProducts();
  } catch {
    adminState.user = null;
    setView(false);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";

  try {
    const payload = await requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: loginForm.elements.email.value,
        password: loginForm.elements.password.value,
      }),
    });
    adminState.user = payload.user;
    setView(true);
    loginForm.reset();
    await loadProducts();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await requestJson("/api/admin/logout", { method: "POST", body: "{}" });
  adminState.user = null;
  setView(false);
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  productMessage.textContent = "";

  const id = productForm.elements.id.value;
  const method = id ? "PUT" : "POST";
  const url = id ? `/api/admin/products/${id}` : "/api/admin/products";

  try {
    await requestJson(url, {
      method,
      body: JSON.stringify(getProductPayload()),
    });
    resetForm();
    productMessage.textContent = "Producto guardado.";
    await loadProducts();
  } catch (error) {
    productMessage.textContent = error.message;
  }
});

adminProducts.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = Number(button.dataset.id);
  const product = adminState.products.find((item) => item.id === id);
  if (!product) return;

  if (button.dataset.action === "edit") {
    fillForm(product);
    return;
  }

  const body =
    button.dataset.action === "sold"
      ? { sold: !product.sold }
      : { status: product.status === "inactive" ? "active" : "inactive" };

  await requestJson(`/api/admin/products/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  await loadProducts();
});

adminSearch.addEventListener("input", (event) => {
  adminState.search = event.target.value;
  renderProducts();
});

categoryFilter.addEventListener("change", (event) => {
  adminState.filters.category = event.target.value;
  renderProducts();
});

applicationFilter.addEventListener("change", (event) => {
  adminState.filters.application = event.target.value;
  renderProducts();
});

modelFilter.addEventListener("change", (event) => {
  adminState.filters.model = event.target.value;
  renderProducts();
});

statusFilter.addEventListener("change", (event) => {
  adminState.filters.status = event.target.value;
  renderProducts();
});

productForm.elements.image.addEventListener("input", (event) => {
  updateImagePreview(event.target.value.trim());
});

productForm.elements.application.addEventListener("change", () => {
  renderModelOptions(getSelectedModels());
});

productForm.elements.imageFile.addEventListener("change", () => {
  const file = productForm.elements.imageFile.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    productMessage.textContent = "El archivo seleccionado debe ser una imagen.";
    productForm.elements.imageFile.value = "";
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    productMessage.textContent = "La imagen no puede superar los 4 MB.";
    productForm.elements.imageFile.value = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    productForm.elements.image.value = reader.result;
    updateImagePreview(reader.result);
    productMessage.textContent = "";
  });
  reader.readAsDataURL(file);
});

cancelEditButton.addEventListener("click", resetForm);
newProductButton.addEventListener("click", () => {
  resetForm();
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
});

const excelFile = document.querySelector('#excelFile');
const excelImport = document.querySelector('#excelImport');
const excelMessage = document.querySelector('#excelMessage');
const EXCEL_COLUMNS = [
  ['id', 'ID', 10], ['name', 'Nombre', 35], ['category', 'Categoría', 18],
  ['application', 'Aplicación', 18], ['models', 'Modelos', 30],
  ['description', 'Descripción', 50], ['price', 'Precio', 16], ['stock', 'Stock', 12],
  ['badge', 'Etiqueta', 18], ['image', 'Imagen', 40], ['status', 'Estado', 16], ['sold', 'Vendido', 12],
];

async function downloadWorkbook(filename, products = []) {
  if (!window.ExcelJS) throw new Error('No se pudo iniciar el generador de Excel. Recargá la página.');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = EXCEL_COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  products.forEach((product) => sheet.addRow({
    ...product,
    models: (product.models || []).join(', '),
    image: String(product.image || '').startsWith('data:') ? '' : product.image,
    status: product.status === 'active' ? 'Activo' : 'Inactivo',
    sold: product.sold ? 'Sí' : 'No',
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172C3E' } };
  sheet.getRow(1).height = 28;
  sheet.autoFilter = 'A1:L1';
  sheet.getColumn('price').numFmt = '#,##0';
  const instructions = workbook.addWorksheet('Instrucciones');
  instructions.getColumn(1).width = 115;
  [
    'CARGA DE PRODUCTOS — Cigliutti Guerini',
    'Completá la hoja Productos. No cambies los encabezados. Máximo 2000 productos por archivo y 5 MB.',
    'ID vacío crea un producto. Para actualizar, exportá el catálogo y conservá sus IDs.',
    'Obligatorios: Nombre, Categoría, Aplicación, Modelos, Descripción, Precio y Stock.',
    'Categoría: Repuestos, Accesorios o Lubricantes. Aplicación: Camiones, Vans o Ambos.',
    'Modelos separados por coma. Precio y Stock deben ser números enteros iguales o mayores a cero.',
    'Etiqueta: Oferta, Nuevo, Destacado o vacío. Estado: Activo o Inactivo. Vendido: Sí o No.',
    'Imagen: URL http/https o ruta assets/products/. Vacío conserva la imagen existente.',
    'No uses fórmulas ni fotos pegadas. Si hay errores, no se importa ningún producto.',
  ].forEach((line) => instructions.addRow([line]));
  instructions.getRow(1).font = { bold: true, size: 16 };
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

document.querySelector('#downloadTemplate').addEventListener('click', async () => {
  try { await downloadWorkbook('plantilla-productos.xlsx'); }
  catch (error) { excelMessage.textContent = error.message; }
});

document.querySelector('#exportCatalog').addEventListener('click', async () => {
  try { await downloadWorkbook('catalogo-productos.xlsx', adminState.products); }
  catch (error) { excelMessage.textContent = error.message; }
});

function clearExcelMessages() {
  document.querySelector('#excelErrors').replaceChildren();
  excelMessage.textContent = '';
}

excelFile.addEventListener('change', clearExcelMessages);
document.querySelector('#excelForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (excelImport.disabled) return;
  clearExcelMessages();
  const file = excelFile.files[0];
  if (!file || !file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024) {
    excelMessage.textContent = 'Seleccioná un archivo .xlsx de hasta 5 MB.';
    return;
  }
  excelImport.disabled = true;
  excelFile.disabled = true;
  excelMessage.textContent = 'Importando productos…';
  try {
    const response = await fetch('/api/admin/excel/import', { method: 'POST', body: file });
    const result = await response.json();
    if (!response.ok) {
      document.querySelector('#excelErrors').innerHTML = (result.errors || []).map((error) => `<li>Fila ${error.row}: ${escapeHtml(error.message)}</li>`).join('');
      throw new Error(result.error || 'No se pudo importar el archivo.');
    }
    excelFile.value = '';
    resetForm();
    excelMessage.textContent = `Importación completada: ${result.created} creado(s) y ${result.updated} actualizado(s). Descargá el catálogo para obtener los IDs asignados.`;
    try { await loadProducts(); }
    catch { excelMessage.textContent += ' Recargá la página para ver el catálogo actualizado.'; }
  } catch (error) {
    excelMessage.textContent = `${error.message} Si se cortó la conexión, comprobá el catálogo antes de reintentar.`;
  } finally { excelImport.disabled = false; excelFile.disabled = false; }
});

renderModelOptions([]);
checkSession();
